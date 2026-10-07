/**
 * End-to-end customer journey against a real PostgreSQL database:
 * BOOK → PAY → ISSUE WRISTBAND → GATE (manual approve + anti-passback) → RIDE (entitlement,
 * buy-at-scanner) → WALLET (ledger, idempotency, concurrency) → REFUND → LOST CARD → EXIT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pool, withTx } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { buildApp } from '../app.js';
import { disposeGateRuntimes } from '../services/gates.js';
import { reconcileWallets } from '../services/wallet.js';
import { businessDate } from '../lib/codes.js';
import { staticQrPayload, dynamicQrPayload } from '../lib/crypto.js';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const ids: Record<string, any> = {};

async function api(method: string, url: string, body?: unknown, who?: string, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers } });
  const json = res.body ? res.json() : null;
  return { status: res.statusCode, body: json };
}
async function ok(method: string, url: string, body?: unknown, who?: string, headers: Record<string, string> = {}) {
  const r = await api(method, url, body, who, headers);
  if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(false);
  const r = await withTx((tx) => seed(tx));
  ids.branch = r.branch;
  app = await buildApp();
  for (const [who, code, pin] of [['cashier', 'EMP010', '1010'], ['gate', 'EMP020', '2020'], ['ride', 'EMP030', '3030'], ['food', 'EMP040', '4040'], ['sup', 'EMP003', '3333'], ['admin', 'EMP001', '1111']]) {
    tokens[who] = (await ok('POST', '/api/auth/staff/login', { employeeCode: code, pin })).token;
  }
  const pk = await pool.query(`SELECT id, code FROM packages`);
  ids.packages = Object.fromEntries(pk.rows.map((p) => [p.code, p.id]));
  const tt = await pool.query(`SELECT id, code FROM ticket_types`);
  ids.tt = Object.fromEntries(tt.rows.map((t) => [t.code, t.id]));
  const g = await pool.query(`SELECT id, code FROM gates`);
  ids.gates = Object.fromEntries(g.rows.map((x) => [x.code, x.id]));
  const rides = await pool.query(`SELECT id, code FROM rides`);
  ids.rides = Object.fromEntries(rides.rows.map((x) => [x.code, x.id]));
  const stores = await pool.query(`SELECT id, code FROM stores`);
  ids.stores = Object.fromEntries(stores.rows.map((x) => [x.code, x.id]));
  const prods = await pool.query(`SELECT id, sku FROM products`);
  ids.products = Object.fromEntries(prods.rows.map((x) => [x.sku, x.id]));
});

afterAll(async () => {
  await app?.close();
  disposeGateRuntimes();
  await pool.end();
});

describe('counter sale → wristband', () => {
  it('requires an open shift for cash', async () => {
    const b = await ok('POST', '/api/bookings', { packageId: ids.packages.DAY_PASS, visitDate: businessDate(), guests: [{ ticketTypeId: ids.tt.ADULT, qty: 2 }], customerName: 'Walk-in A' }, 'cashier');
    const r = await api('POST', `/api/orders/${b.order_id}/payments`, { method: 'CASH', amount: b.total, tendered: b.total }, 'cashier');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SHIFT_REQUIRED');
    ids.booking = b;
  });

  it('sells, takes cash with change and issues wristbands', async () => {
    await ok('POST', '/api/shifts/open', { openingCash: 100000 }, 'cashier');
    const b = ids.booking;
    expect(b.total).toBe(2 * 59000);
    const paid = await ok('POST', `/api/orders/${b.order_id}/payments`, { method: 'CASH', amount: b.total, tendered: 120000 }, 'cashier');
    expect(paid.order.status).toBe('PAID');
    expect(paid.payment.change_amount).toBe(2000);
    const detail = await ok('GET', `/api/bookings/${b.id}`, undefined, 'cashier');
    expect(detail.status).toBe('CONFIRMED');
    expect(detail.tickets.every((t: any) => t.status === 'ACTIVE')).toBe(true);
    const issued = await ok('POST', `/api/bookings/${b.id}/checkin`, { assignments: detail.tickets.map((t: any) => ({ ticketId: t.id, mode: 'GENERATE', heightCm: 170 })) }, 'cashier');
    expect(issued).toHaveLength(2);
    expect(issued[0].code).toMatch(/^WB-\d{8}$/);
    ids.wb1 = issued[0];
    ids.wb2 = issued[1];
  });

  it('booking payment cannot be captured twice', async () => {
    const r = await api('POST', `/api/orders/${ids.booking.order_id}/payments`, { method: 'CASH', amount: 100, tendered: 100 }, 'cashier');
    expect(r.status).toBe(409);
  });

  it('tops up a wristband wallet (ledger based)', async () => {
    const r = await ok('POST', '/api/wallet/topup', { scan: ids.wb1.qr, amount: 50000, payments: [{ method: 'CASH', amount: 50000, tendered: 50000 }] }, 'cashier', { 'idempotency-key': 'topup-test-1' });
    expect(r.balance).toBe(50000);
    // same idempotency key → no double credit
    const again = await ok('POST', '/api/wallet/topup', { scan: ids.wb1.qr, amount: 50000, payments: [{ method: 'CASH', amount: 50000, tendered: 50000 }] }, 'cashier', { 'idempotency-key': 'topup-test-1' });
    expect(again.balance).toBe(50000);
    const prof = await ok('POST', '/api/credentials/scan', { scan: ids.wb1.barcode }, 'cashier');
    expect(prof.wallet.balance).toBe(50000);
    expect(prof.tickets[0].status).toBe('ACTIVE');
  });
});

describe('entrance gate', () => {
  it('denies unknown and forged QR', async () => {
    const r1 = await ok('POST', `/api/gates/${ids.gates.G05}/scan`, { code: 'ABCDEFGHJKMNPQRS' }, 'gate');
    expect(r1.result).toBe('DENIED');
    expect(r1.reasonCode).toBe('NOT_FOUND');
    await sleep(2700);
    const forged = ids.wb1.qr.slice(0, -2) + (ids.wb1.qr.endsWith('AA') ? 'BB' : 'AA');
    const r2 = await ok('POST', `/api/gates/${ids.gates.G05}/scan`, { code: forged }, 'gate');
    expect(r2.reasonCode).toBe('FORGED_QR');
  });

  it('manual mode: scan → WAITING_APPROVAL → operator approves → INSIDE', async () => {
    const scan = await ok('POST', `/api/gates/${ids.gates.G03}/scan`, { code: ids.wb1.qr }, 'gate');
    expect(scan.result).toBe('PENDING');
    expect(scan.checks.every((c: any) => c.ok)).toBe(true);
    const busy = await api('POST', `/api/gates/${ids.gates.G03}/scan`, { code: ids.wb2.qr }, 'gate');
    expect(busy.status).toBe(409); // scanner locked until decision
    const d = await ok('POST', `/api/gates/${ids.gates.G03}/approve`, { scanId: scan.scanId }, 'gate');
    expect(d.result).toBe('APPROVED');
    const t = await pool.query(`SELECT presence, entry_count FROM tickets WHERE id = $1`, [ids.wb1.ticketId]);
    expect(t.rows[0].presence).toBe('INSIDE');
  });

  it('anti-passback: same wristband at another gate → DUPLICATE ENTRY ATTEMPT', async () => {
    const r = await ok('POST', `/api/gates/${ids.gates.G06}/scan`, { code: ids.wb1.qr }, 'gate');
    expect(r.result).toBe('DENIED');
    expect(r.reasonCode).toBe('DUPLICATE_ENTRY');
    expect(r.isDuplicate).toBe(true);
    expect(r.duplicateOf.gate_name).toBe('Gate 03');
    const sec = await pool.query(`SELECT count(*)::int AS n FROM security_events WHERE type = 'DUPLICATE_ENTRY'`);
    expect(sec.rows[0].n).toBe(1);
  });

  it('auto gate admits the second guest; occupancy counts both', async () => {
    const r = await ok('POST', `/api/gates/${ids.gates.G09}/scan`, { code: ids.wb2.qr }, 'gate');
    expect(r.result).toBe('AUTO_APPROVED');
    const occ = await ok('GET', '/api/occupancy', undefined, 'gate');
    expect(occ.inside).toBe(2);
  });

  it('every scan is logged (incl. denied)', async () => {
    const r = await pool.query(`SELECT result, count(*)::int AS n FROM gate_scans GROUP BY result`);
    const m = Object.fromEntries(r.rows.map((x) => [x.result, x.n]));
    expect(m.DENIED).toBeGreaterThanOrEqual(3);
    expect(m.APPROVED).toBe(1);
  });
});

describe('ride entitlement engine', () => {
  it('included ride → granted', async () => {
    const r = await ok('POST', `/api/rides/${ids.rides.R01}/scan`, { code: ids.wb1.qr }, 'ride');
    expect(r.result).toBe('GRANTED');
  });

  it('VR not included → buy with wallet on the same screen → granted', async () => {
    const r = await ok('POST', `/api/rides/${ids.rides.R04}/scan`, { code: ids.wb1.qr }, 'ride');
    expect(r.result).toBe('NOT_INCLUDED');
    expect(r.reason.th).toBe('แพ็กเกจของคุณไม่รวมเครื่องเล่นนี้');
    expect(r.purchase.available).toBe(true);
    const price = r.purchase.price;
    const p = await ok('POST', `/api/rides/${ids.rides.R04}/purchase`, { code: ids.wb1.qr, method: 'WALLET' }, 'ride', { 'idempotency-key': 'vr-buy-1' });
    expect(p.status).toBe('PAID');
    expect(p.access.result).toBe('GRANTED');
    expect(p.walletBalance).toBe(50000 - price);
    // retry with same key must not charge again
    const again = await ok('POST', `/api/rides/${ids.rides.R04}/purchase`, { code: ids.wb1.qr, method: 'WALLET' }, 'ride', { 'idempotency-key': 'vr-buy-1' });
    expect(again.walletBalance).toBe(50000 - price);
    ids.balanceAfterVr = 50000 - price;
    // one-time entitlement consumed → next scan not included
    const r2 = await ok('POST', `/api/rides/${ids.rides.R04}/scan`, { code: ids.wb1.qr }, 'ride');
    expect(r2.result).toBe('NOT_INCLUDED');
    expect(r2.reasonCode).toBe('EXHAUSTED');
  });

  it('multi-use Go Kart: 3 → 2 → 1 → 0 → denied', async () => {
    const p = await ok('POST', `/api/rides/${ids.rides.R05}/purchase`, { code: ids.wb1.qr, method: 'WALLET' }, 'ride');
    expect(p.access.entitlement.usesRemaining).toBe(2);
    expect((await ok('POST', `/api/rides/${ids.rides.R05}/scan`, { code: ids.wb1.qr }, 'ride')).entitlement.usesRemaining).toBe(1);
    expect((await ok('POST', `/api/rides/${ids.rides.R05}/scan`, { code: ids.wb1.qr }, 'ride')).entitlement.usesRemaining).toBe(0);
    const r4 = await ok('POST', `/api/rides/${ids.rides.R05}/scan`, { code: ids.wb1.qr }, 'ride');
    expect(r4.result).toBe('NOT_INCLUDED');
    expect(r4.reason.th).toBe('คุณใช้สิทธิ์ครบแล้ว');
  });

  it('cash at ride waits for operator confirmation', async () => {
    const p = await ok('POST', `/api/rides/${ids.rides.R06}/purchase`, { code: ids.wb2.qr, method: 'CASH' }, 'ride');
    // Haunted House is in DAY_PASS → purchase still allowed as add-on; access only after cash confirmed
    expect(p.status).toBe('PENDING');
    expect(p.message).toBe('WAITING FOR CASH PAYMENT');
    const r = await api('POST', `/api/rides/purchase-requests/${p.requestId}/confirm-cash`, {}, 'ride');
    expect(r.status).toBe(422); // cash needs an open shift (cash accountability)
    expect(r.body.error.code).toBe('SHIFT_REQUIRED');
    await ok('POST', '/api/shifts/open', { openingCash: 0 }, 'ride');
    await ok('POST', `/api/rides/purchase-requests/${p.requestId}/confirm-cash`, {}, 'ride');
    const req = await ok('GET', `/api/rides/purchase-requests/${p.requestId}`, undefined, 'ride');
    expect(req.status).toBe('PAID');
  });
});

describe('POS & wallet safety', () => {
  it('double tap with the same idempotency key debits once', async () => {
    const body = { storeId: ids.stores.FC, items: [{ type: 'PRODUCT', productId: ids.products.F006, qty: 1 }], scan: ids.wb1.qr, payments: [{ method: 'WALLET', amount: 4500 }] };
    await ok('POST', '/api/shifts/open', { openingCash: 0 }, 'food');
    const a = await ok('POST', '/api/pos/checkout', body, 'food', { 'idempotency-key': 'pos-tap-1' });
    const b = await ok('POST', '/api/pos/checkout', body, 'food', { 'idempotency-key': 'pos-tap-1' });
    expect(a.order.order_no).toBe(b.order.order_no);
    const bal = (await ok('POST', '/api/credentials/scan', { scan: ids.wb1.qr }, 'food')).wallet.balance;
    expect(bal).toBe(a.walletBalance);
    ids.icecreamOrder = a.order.id;
    ids.balance = bal;
  });

  it('concurrent payments never overdraw the wallet', async () => {
    const amount = ids.balance; // each tries to spend the full balance
    // two parallel wallet debits of the full balance through the ledger directly
    const { postLedger, walletForAccount } = await import('../services/wallet.js');
    const cred = await pool.query('SELECT account_id FROM credentials WHERE id = $1', [ids.wb1.credentialId]);
    const w = await walletForAccount(pool, cred.rows[0].account_id);
    const results = await Promise.allSettled([1, 2].map((i) => withTx((tx) => postLedger(tx, { walletId: w.id, type: 'PAYMENT', debit: amount, idempotencyKey: `race-${i}` }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as any).reason.code).toBe('INSUFFICIENT_BALANCE');
    const after = await walletForAccount(pool, cred.rows[0].account_id);
    expect(Number(after.balance)).toBe(0);
    // give the money back for later tests
    await withTx((tx) => postLedger(tx, { walletId: w.id, type: 'REVERSAL', credit: amount, idempotencyKey: 'race-reverse' }));
  });

  it('kitchen receives food orders with a queue number', async () => {
    const r = await ok('POST', '/api/pos/checkout', { storeId: ids.stores.FC, items: [{ type: 'PRODUCT', productId: ids.products.F001, qty: 1, modifiers: [{ group: 'ความเผ็ด Spicy', option: 'เผ็ดน้อย Medium' }] }],
      payments: [{ method: 'CASH', amount: 12000, tendered: 20000 }] }, 'food');
    expect(r.order.queue_no).toMatch(/^F\d{3}$/);
    const kds = await ok('GET', `/api/kitchen/${ids.stores.FC}/orders`, undefined, 'food');
    expect(kds.some((o: any) => o.queue_no === r.order.queue_no && o.kitchen_status === 'NEW')).toBe(true);
    await ok('POST', `/api/kitchen/orders/${r.order.id}/status`, { status: 'PREPARING' }, 'food');
    await ok('POST', `/api/kitchen/orders/${r.order.id}/status`, { status: 'READY' }, 'food');
  });

  it('required modifiers are enforced server side', async () => {
    const r = await api('POST', '/api/pos/checkout', { storeId: ids.stores.FC, items: [{ type: 'PRODUCT', productId: ids.products.F001, qty: 1 }], payments: [] }, 'food');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MODIFIER_REQUIRED');
  });

  it('void requires manager approval and refunds the wallet', async () => {
    const denied = await api('POST', `/api/orders/${ids.icecreamOrder}/void`, { reason: 'customer changed mind' }, 'sup');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const appr = await ok('POST', '/api/approvals', { employeeCode: 'EMP002', pin: '2222', action: 'VOID', reason: 'customer changed mind' }, 'sup');
    const before = (await ok('POST', '/api/credentials/scan', { scan: ids.wb1.qr }, 'sup')).wallet.balance;
    await ok('POST', `/api/orders/${ids.icecreamOrder}/void`, { reason: 'customer changed mind', approvalId: appr.approvalId }, 'sup');
    const after = (await ok('POST', '/api/credentials/scan', { scan: ids.wb1.qr }, 'sup')).wallet.balance;
    expect(after - before).toBe(4500);
    const reuse = await api('POST', `/api/orders/${ids.icecreamOrder}/void`, { reason: 'again', approvalId: appr.approvalId }, 'sup');
    expect(reuse.status).toBeGreaterThanOrEqual(400);
  });

  it('wallet ledger reconciles with balances', async () => {
    expect(await reconcileWallets(pool)).toHaveLength(0);
  });
});

describe('online booking + slip verification', () => {
  it('guest books, pays by PromptPay slip, admin approves → CONFIRMED', async () => {
    const b = await ok('POST', '/api/public/bookings', {
      branchId: ids.branch, packageId: ids.packages.BASIC, visitDate: businessDate(), guests: [{ ticketTypeId: ids.tt.ADULT, qty: 1 }, { ticketTypeId: ids.tt.CHILD, qty: 1 }],
      customerName: 'Guest Online', phone: '0899999999', paymentMode: 'PAY_NOW',
    });
    expect(b.booking_no).toMatch(/^BK-\d{6}-\d{5}$/);
    expect(b.status).toBe('PENDING_PAYMENT');
    const pay = await ok('POST', `/api/public/bookings/${b.booking_no}/pay`, { token: b.token, method: 'PROMPTPAY' });
    expect(pay.qrPayload).toMatch(/^000201/);
    const slip = await ok('POST', `/api/public/payments/${pay.paymentId}/slip`, { token: b.token, reference: 'TRX123' });
    expect(slip.status).toBe('WAITING');
    const list = await ok('GET', '/api/payment-verifications', undefined, 'admin');
    expect(list.some((r: any) => r.booking_no === b.booking_no)).toBe(true);
    await ok('POST', `/api/payment-verifications/${slip.id}/review`, { decision: 'APPROVE' }, 'admin');
    const view = await ok('GET', `/api/public/bookings/${b.booking_no}?token=${b.token}`);
    expect(view.status).toBe('CONFIRMED');
    expect(view.paymentStatus).toBe('PAID');
    // without the secret token the booking is not visible
    expect((await api('GET', `/api/public/bookings/${b.booking_no}`)).status).toBe(404);
    ids.onlineBooking = view;
  });

  it('counter scans the booking barcode and binds a member card', async () => {
    const found = await ok('POST', '/api/bookings/scan', { scan: ids.onlineBooking.qr }, 'cashier');
    expect(found.booking_no).toBe(ids.onlineBooking.booking_no);
    const card = await ok('POST', '/api/credentials/issue', { type: 'WRISTBAND', count: 1, activate: false }, 'admin');
    const issued = await ok('POST', `/api/bookings/${found.id}/checkin`, { assignments: [{ ticketId: found.tickets[0].id, mode: 'SCAN', scan: card[0].qr }] }, 'cashier');
    expect(issued[0].code).toBe(card[0].code);
  });
});

describe('lost card & exit', () => {
  it('replacing a lost wristband moves wallet + rights; old one is denied', async () => {
    await ok('POST', `/api/gates/${ids.gates.X01}/scan`, { code: ids.wb1.qr }, 'gate'); // exit first
    const t = await pool.query(`SELECT presence FROM tickets WHERE id = $1`, [ids.wb1.ticketId]);
    expect(t.rows[0].presence).toBe('OUTSIDE');
    const before = (await ok('POST', '/api/credentials/scan', { scan: ids.wb1.qr }, 'sup')).wallet.balance;
    const appr = await ok('POST', '/api/approvals', { employeeCode: 'EMP002', pin: '2222', action: 'CARD_REPLACE', reason: 'lost' }, 'sup');
    const rep = await ok('POST', `/api/credentials/${ids.wb1.credentialId}/replace`, { reason: 'LOST', approvalId: appr.approvalId }, 'sup');
    const oldScan = await ok('POST', `/api/gates/${ids.gates.G10}/scan`, { code: ids.wb1.qr }, 'gate');
    expect(oldScan.reasonCode).toBe('CREDENTIAL_LOST');
    await sleep(2700);
    const newScan = await ok('POST', `/api/gates/${ids.gates.G10}/scan`, { code: rep.payloads.qr }, 'gate');
    expect(newScan.result).toBe('AUTO_APPROVED');
    const prof = await ok('POST', '/api/credentials/scan', { scan: rep.payloads.qr }, 'sup');
    expect(prof.wallet.balance).toBe(before);
  });

  it('member digital card dynamic QR is accepted; static QR of digital card still resolves', async () => {
    const login = await ok('POST', '/api/member/login', { identifier: '0812345678', password: 'member1234' });
    tokens.member = login.token;
    const card = await ok('GET', '/api/member/card', undefined, 'member');
    expect(card.dynamic).toBe(true);
    const cred = await pool.query(`SELECT token FROM credentials WHERE code = $1`, [card.code]);
    expect(card.qr).toBe(dynamicQrPayload(cred.rows[0].token).payload);
    const prof = await ok('POST', '/api/credentials/scan', { scan: card.qr }, 'cashier');
    expect(prof.member.member_code).toBeTruthy();
    expect(prof.wallet.balance).toBe(50000);
    expect(staticQrPayload(cred.rows[0].token)).toMatch(/^TP1\./);
  });
});

describe('link an existing card to a member', () => {
  it('outside card number becomes the member card and works at the counter and gate', async () => {
    const m = await pool.query(`SELECT id FROM members WHERE phone = '0812345678'`);
    ids.member = m.rows[0].id;
    // 16 digits look like a token to the parser — must still fall back to the card number
    for (const number of ['8850001234567', '1234567890123456']) {
      const r = await ok('POST', `/api/members/${ids.member}/link-card`, { scan: ` ${number} ` }, 'cashier');
      expect(r.created).toBe(true);
      expect(r.credential.physicalSerial).toBe(number);
      const prof = await ok('POST', '/api/credentials/scan', { scan: number }, 'cashier');
      expect(prof.member.member_code).toBeTruthy();
      expect(prof.wallet.balance).toBe(50000);
    }
    const g = await ok('POST', `/api/gates/${ids.gates.G07}/scan`, { code: '8850001234567' }, 'gate');
    expect(g.reasonCode).not.toBe('NOT_FOUND');
    // linking the same card again is a no-op, not a duplicate
    const again = await ok('POST', `/api/members/${ids.member}/link-card`, { scan: '8850001234567' }, 'cashier');
    expect(again.created).toBe(false);
  });

  it('pre-printed park card (NEW stock) is activated and bound; tickets cannot be linked as cards', async () => {
    const issued = await ok('POST', '/api/credentials/issue', { type: 'MEMBER_CARD', count: 1, activate: false, branchId: ids.branch }, 'sup');
    const card = (issued.credentials ?? issued)[0];
    const r = await ok('POST', `/api/members/${ids.member}/link-card`, { scan: card.payloads?.qr ?? card.qr ?? card.code }, 'cashier');
    expect(r.created).toBe(false);
    expect(r.credential.status).toBe('ACTIVE');
    const c = await pool.query(`SELECT member_id FROM credentials WHERE id = $1`, [r.credential.id]);
    expect(c.rows[0].member_id).toBe(ids.member);
    const t = await pool.query(`SELECT code FROM credentials WHERE type = 'QR_TICKET' LIMIT 1`);
    if (t.rows[0]) expect((await api('POST', `/api/members/${ids.member}/link-card`, { scan: t.rows[0].code }, 'cashier')).status).toBe(422);
  });
});

describe('RBAC', () => {
  it('gate operator cannot sell tickets or view reports', async () => {
    expect((await api('POST', '/api/bookings', { packageId: ids.packages.DAY_PASS, visitDate: businessDate(), guests: [{ ticketTypeId: ids.tt.ADULT, qty: 1 }] }, 'gate')).status).toBe(403);
    expect((await api('GET', '/api/reports/daily-sales?from=2026-01-01&to=2026-12-31', undefined, 'gate')).status).toBe(403);
    expect((await api('GET', '/api/dashboard')).status).toBe(401);
  });
  it('audit log captured important actions', async () => {
    const r = await pool.query(`SELECT DISTINCT action FROM audit_logs`);
    const actions = r.rows.map((x) => x.action);
    for (const a of ['LOGIN', 'BOOKING_CREATE', 'GATE_SCAN', 'GATE_APPROVE', 'RIDE_ACCESS', 'ORDER_VOID', 'CREDENTIAL_REPLACE', 'SHIFT_OPEN']) expect(actions).toContain(a);
    await expect(pool.query(`UPDATE audit_logs SET action = 'X'`)).rejects.toThrow(/append-only/);
  });
});
