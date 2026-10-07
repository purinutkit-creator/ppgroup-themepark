import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { parse, zDate, zMoney, zPhone, zPositiveMoney, zUuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { withIdempotency } from '../lib/idempotency.js';
import { branchOf, can, requireAnyPerm, requirePerm } from '../middleware/auth.js';
import { publish, rooms } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { grantApproval } from '../services/approvals.js';
import {
  bindMember, credentialPayloads, credentialProfile, issueCredential, linkCardToMember, replaceCredential, resolveScan, rotateToken, setCredentialStatus, unbindMember,
} from '../services/credentials.js';
import { createGuestAccount } from '../services/accounts.js';
import { adjustWallet, refundOrder, walletCashOut } from '../services/refunds.js';
import { ledgerHistory, reconcileWallets, walletForAccount } from '../services/wallet.js';
import { cancelOrder, capturePayment, confirmExternalPayment, createOrder, memberContext, orderDetail, priceItems, type ItemInput, type PaymentInput } from '../services/orders.js';
import { initiatePayment } from '../services/payments.js';
import { bookingCalendar, bookingDetail, bookingFromScan, cancelBooking, checkinBooking, createBooking, listBookings, quote } from '../services/bookings.js';
import { memberSummary, registerMember } from '../services/membership.js';
import { postPoints } from '../services/points.js';
import { consumeApproval } from '../services/approvals.js';
import { cashMovement, closeShift, openShift, shiftSummary } from '../services/shifts.js';
import { getSetting } from '../services/settings.js';

const paymentSchema = z.object({
  method: z.enum(['CASH', 'PROMPTPAY', 'CARD', 'DEBIT', 'BANK_TRANSFER', 'EWALLET', 'WALLET', 'POINTS', 'MOBILE_BANKING']),
  amount: zPositiveMoney, tendered: zMoney.optional(), reference: z.string().max(100).nullish(), scan: z.string().optional(), credentialId: zUuid.optional(),
});
const itemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PRODUCT'), productId: zUuid, qty: z.number().int().min(1).max(999), modifiers: z.array(z.object({ group: z.string(), option: z.string() })).optional(), notes: z.string().max(200).optional(), voucherCode: z.string().optional() }),
  z.object({ type: z.literal('TOPUP'), amount: zPositiveMoney }),
  z.object({ type: z.literal('MEMBERSHIP'), membershipProductId: zUuid, mode: z.enum(['NEW', 'RENEWAL', 'UPGRADE']), physicalCard: z.boolean().optional() }),
  z.object({ type: z.literal('RIDE_ADDON'), rideId: zUuid, qty: z.number().int().min(1).max(20).optional() }),
  z.object({ type: z.literal('LOCKER'), rateId: zUuid, lockerId: zUuid.nullish() }),
]);

async function paymentsFromInput(db: any, payments: Array<z.infer<typeof paymentSchema>>): Promise<PaymentInput[]> {
  const out: PaymentInput[] = [];
  for (const p of payments) {
    let credentialId = p.credentialId ?? null;
    if (p.method === 'WALLET' && !credentialId && p.scan) credentialId = (await resolveScan(db, p.scan, { allowCode: true })).credential.id;
    out.push({ method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference ?? null, credentialId });
  }
  return out;
}

export async function operationsRoutes(app: FastifyInstance) {
  // ============================ approvals ============================
  app.post('/api/approvals', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    if (req.actor.type !== 'STAFF') throw forbidden();
    const b = parse(z.object({ employeeCode: z.string().min(1).transform((s) => s.toUpperCase()), pin: z.string().min(4), reason: z.string().min(3).max(300),
      action: z.enum(['REFUND', 'VOID', 'MANUAL_GATE_OPEN', 'GATE_OVERRIDE', 'TICKET_OVERRIDE', 'WALLET_ADJUST', 'DISCOUNT_OVER_LIMIT', 'TRANSACTION_EDIT', 'POINTS_ADJUST', 'SHIFT_OVER_SHORT', 'CARD_REPLACE', 'RIDE_OVERRIDE']),
      referenceType: z.string().optional(), referenceId: z.string().optional() }), req.body);
    const r = await withTx((tx) => grantApproval(tx, req.actor, b));
    return { approvalId: r.id, expiresAt: r.expires_at };
  });

  // ============================ credentials / cards ============================
  app.post('/api/credentials/scan', { preHandler: requireAnyPerm('credential.view', 'pos.sell', 'wallet.topup', 'ticket.sell') }, async (req) => {
    const b = parse(z.object({ scan: z.string().min(1) }), req.body);
    const { credential } = await resolveScan(pool, b.scan, { allowCode: can(req.actor, 'credential.lookup_code') });
    return credentialProfile(pool, credential.id);
  });
  app.get('/api/credentials', { preHandler: requirePerm('credential.view') }, async (req) => {
    const q = req.query as any;
    const branchId = branchOf(req, q.branchId);
    const params: unknown[] = [branchId];
    let where = '(c.branch_id = $1 OR c.branch_id IS NULL)';
    if (q.q) { params.push(`%${q.q.trim()}%`); where += ` AND (c.code ILIKE $2 OR c.physical_serial ILIKE $2 OR m.phone ILIKE $2 OR m.email ILIKE $2 OR m.member_code ILIKE $2 OR (m.first_name || ' ' || m.last_name) ILIKE $2)`; }
    if (q.type) { params.push(q.type); where += ` AND c.type = $${params.length}`; }
    if (q.status) { params.push(q.status); where += ` AND c.status = $${params.length}`; }
    return query(pool, `SELECT c.id, c.code, c.type, c.status, c.physical_serial, c.issued_at, c.expires_at, c.last_used_at, m.member_code, m.first_name || ' ' || m.last_name AS member_name, m.phone,
        w.balance AS wallet_balance FROM credentials c LEFT JOIN members m ON m.id = c.member_id LEFT JOIN wallet_accounts w ON w.account_id = c.account_id
      WHERE ${where} AND c.type NOT IN ('QR_TICKET','BOOKING') ORDER BY c.issued_at DESC LIMIT 200`, params);
  });
  app.get('/api/credentials/:id', { preHandler: requireAnyPerm('credential.view', 'pos.sell', 'wallet.topup') }, async (req) => credentialProfile(pool, (req.params as any).id));
  /** "เปิด Barcode ของบัตร" — payloads for full-screen display / printing / binding */
  app.get('/api/credentials/:id/barcode', { preHandler: requirePerm('credential.issue') }, async (req) => {
    const c = await one(pool, 'SELECT id, code, type, token, status FROM credentials WHERE id = $1', [(req.params as any).id]);
    if (!c) throw notFound('Credential');
    await audit(pool, req.actor, { action: 'CREDENTIAL_BARCODE_VIEW', entityType: 'credential', entityId: c.code });
    return { code: c.code, type: c.type, status: c.status, ...credentialPayloads(c) };
  });
  app.get('/api/credentials/:id/history', { preHandler: requirePerm('credential.view') }, async (req) => {
    const id = (req.params as any).id;
    const c = await one(pool, 'SELECT * FROM credentials WHERE id = $1', [id]);
    if (!c) throw notFound('Credential');
    const [transactions, orders, ledger, rides, gates, points, replacements] = await Promise.all([
      query(pool, `SELECT t.*, s.name AS store_name FROM transactions t LEFT JOIN stores s ON s.id = t.store_id WHERE t.credential_id = $1 OR t.account_id = $2 ORDER BY t.created_at DESC LIMIT 200`, [id, c.account_id]),
      query(pool, `SELECT o.id, o.order_no, o.type, o.status, o.total, o.created_at, s.name AS store_name FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE o.credential_id = $1 OR o.account_id = $2 ORDER BY o.created_at DESC LIMIT 100`, [id, c.account_id]),
      c.account_id ? walletForAccount(pool, c.account_id).then((w) => ledgerHistory(pool, w.id, 200)) : [],
      query(pool, `SELECT l.*, r.name AS ride_name FROM ride_access_logs l JOIN rides r ON r.id = l.ride_id WHERE l.credential_id = $1 OR l.account_id = $2 ORDER BY l.scanned_at DESC LIMIT 100`, [id, c.account_id]),
      query(pool, `SELECT s.*, g.name AS gate_name FROM gate_scans s JOIN gates g ON g.id = s.gate_id WHERE s.credential_id = $1 ORDER BY s.scanned_at DESC LIMIT 100`, [id]),
      c.member_id ? query(pool, 'SELECT * FROM points_ledger WHERE member_id = $1 ORDER BY created_at DESC LIMIT 100', [c.member_id]) : [],
      query(pool, `SELECT r.*, o.code AS old_code, n.code AS new_code FROM card_replacements r JOIN credentials o ON o.id = r.old_credential_id JOIN credentials n ON n.id = r.new_credential_id
                   WHERE r.old_credential_id = $1 OR r.new_credential_id = $1 ORDER BY r.created_at DESC`, [id]),
    ]);
    return { transactions, orders, ledger, rides, gates, points, replacements };
  });
  app.post('/api/credentials/issue', { preHandler: requirePerm('credential.issue') }, async (req) => {
    const b = parse(z.object({
      type: z.enum(['MEMBER_CARD', 'TEMP_CARD', 'WRISTBAND', 'PRINTED_WRISTBAND']), count: z.number().int().min(1).max(500).default(1), memberId: zUuid.nullish(),
      physicalSerial: z.string().trim().max(64).nullish(), activate: z.boolean().default(true), expirationPolicy: z.enum(['NONE', 'END_OF_DAY', 'END_OF_VISIT', 'PACKAGE', 'FIXED']).optional(),
      expiresAt: z.string().nullish(), branchId: zUuid.optional(),
    }), req.body);
    const branchId = branchOf(req, b.branchId);
    if (b.count > 1 && (b.memberId || b.physicalSerial)) throw badRequest('BATCH_LIMIT', 'Batch issue cannot bind member / serial');
    return withTx(async (tx) => {
      const out = [];
      for (let i = 0; i < b.count; i++) {
        const accountId = b.memberId ? (await import('../services/accounts.js')).ensureMemberAccount(tx, b.memberId) : b.activate ? createGuestAccount(tx, { branchId }) : null;
        const c = await issueCredential(tx, { type: b.type, branchId, memberId: b.memberId ?? null, accountId: await accountId, status: b.activate ? 'ACTIVE' : 'NEW',
          physicalSerial: b.physicalSerial?.toUpperCase() ?? null, expirationPolicy: b.expirationPolicy ?? (b.type === 'MEMBER_CARD' ? 'NONE' : 'END_OF_DAY'),
          expiresAt: b.expiresAt ?? null, issuedBy: req.actor.staffId });
        out.push({ id: c.id, code: c.code, type: c.type, status: c.status, ...credentialPayloads(c) });
      }
      await audit(tx, req.actor, { action: 'CREDENTIAL_ISSUE', entityType: 'credential', entityId: out[0]?.code, after: { count: out.length, type: b.type, memberId: b.memberId }, branchId });
      return out;
    });
  });
  app.post('/api/credentials/:id/status', { preHandler: requirePerm('credential.manage') }, async (req) => {
    const b = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'LOST', 'BLOCKED', 'CLOSED', 'EXPIRED']), reason: z.string().min(2), expiresAt: z.string().nullish() }), req.body);
    return withTx((tx) => setCredentialStatus(tx, req.actor, (req.params as any).id, b.status, b.reason, b.expiresAt !== undefined ? { expiresAt: b.expiresAt } : {}));
  });
  app.post('/api/credentials/:id/replace', { preHandler: requirePerm('credential.manage') }, async (req) => {
    const b = parse(z.object({ reason: z.enum(['LOST', 'DAMAGED', 'STOLEN', 'UPGRADE', 'OTHER']), newType: z.enum(['MEMBER_CARD', 'TEMP_CARD', 'WRISTBAND', 'PRINTED_WRISTBAND', 'DIGITAL_CARD']).optional(),
      physicalSerial: z.string().nullish(), approvalId: zUuid.nullish(), note: z.string().max(300).optional() }), req.body);
    return withTx(async (tx) => {
      const old = await one(tx, 'SELECT branch_id FROM credentials WHERE id = $1', [(req.params as any).id]);
      const approval = await consumeApproval(tx, req.actor, b.approvalId, 'CARD_REPLACE', old?.branch_id);
      const r = await replaceCredential(tx, req.actor, { oldCredentialId: (req.params as any).id, ...b, approvalId: approval });
      return { ...r, payloads: credentialPayloads(r.credential) };
    });
  });
  app.post('/api/credentials/:id/bind', { preHandler: requirePerm('credential.manage') }, async (req) => {
    const b = parse(z.object({ memberId: zUuid }), req.body);
    return withTx((tx, after) => bindMember(tx, req.actor, (req.params as any).id, b.memberId, after));
  });
  app.post('/api/credentials/:id/unbind', { preHandler: requirePerm('credential.manage') }, async (req) =>
    withTx((tx) => unbindMember(tx, req.actor, (req.params as any).id, parse(z.object({ reason: z.string().min(2) }), req.body).reason)));
  app.post('/api/credentials/:id/rotate', { preHandler: requirePerm('credential.manage') }, async (req) => withTx((tx) => rotateToken(tx, req.actor, (req.params as any).id)).then(() => ({ ok: true })));
  app.post('/api/credentials/:id/link-ticket', { preHandler: requirePerm('ticket.sell') }, async (req) => {
    const b = parse(z.object({ ticketCode: z.string().min(5) }), req.body);
    return withTx(async (tx) => {
      const c = await one(tx, 'SELECT * FROM credentials WHERE id = $1 FOR UPDATE', [(req.params as any).id]);
      const t = await one(tx, 'SELECT * FROM tickets WHERE ticket_code = $1 FOR UPDATE', [b.ticketCode.toUpperCase()]);
      if (!c || !t) throw notFound('Credential / ticket');
      if (c.status !== 'ACTIVE') throw conflict('CREDENTIAL_NOT_ACTIVE', `Credential is ${c.status}`);
      await tx.query(`INSERT INTO credential_links(credential_id, link_type, ticket_id, created_by) VALUES ($1,'TICKET',$2,$3) ON CONFLICT DO NOTHING`, [c.id, t.id, req.actor.staffId]);
      if (t.account_id !== c.account_id && c.account_id) {
        await tx.query('UPDATE tickets SET account_id = $2 WHERE id = $1', [t.id, c.account_id]);
        await tx.query('UPDATE ride_entitlements SET account_id = $2 WHERE ticket_id = $1', [t.id, c.account_id]);
      }
      await audit(tx, req.actor, { action: 'CREDENTIAL_LINK_TICKET', entityType: 'credential', entityId: c.code, after: { ticket: t.ticket_code } });
      return { ok: true };
    });
  });

  // ============================ wallet ============================
  /** Counter / kiosk top-up: scan card → amount → payment(s) → ledger credit. */
  app.post('/api/wallet/topup', { preHandler: requirePerm('wallet.topup') }, async (req) => {
    const b = parse(z.object({ scan: z.string().optional(), credentialId: zUuid.optional(), amount: zPositiveMoney, payments: z.array(paymentSchema).min(1) }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`topup:${req.actor.staffId ?? req.actor.deviceId}`, key, b, () => withTx(async (tx, after) => {
      const cred = b.credentialId ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [b.credentialId]) : (await resolveScan(tx, b.scan ?? '', { allowCode: true })).credential;
      if (!cred) throw notFound('Credential');
      if (cred.status !== 'ACTIVE') throw conflict('CREDENTIAL_NOT_ACTIVE', `Card is ${cred.status}`);
      if (b.payments.some((p) => p.method === 'WALLET' || p.method === 'POINTS')) throw badRequest('INVALID_METHOD', 'Top-up cannot be paid with wallet / points');
      const branchId = branchOf(req, cred.branch_id ?? req.actor.branchId);
      const mctx = await memberContext(tx, cred.member_id);
      const lines = await priceItems(tx, branchId, [{ type: 'TOPUP', amount: b.amount }], mctx);
      const { order } = await createOrder(tx, req.actor, { branchId, type: 'TOPUP', channel: req.actor.deviceType === 'KIOSK' ? 'KIOSK' : 'COUNTER', lines, memberCtx: mctx, accountId: cred.account_id,
        credentialId: cred.id, idempotencyKey: key ? `order:${key}` : null, applyPromotions: false });
      const sum = b.payments.reduce((s, p) => s + p.amount, 0);
      if (sum !== order.total) throw badRequest('PAYMENT_MISMATCH', 'Payments must equal the top-up amount');
      let last: any;
      for (const [i, p] of (await paymentsFromInput(tx, b.payments)).entries()) last = await capturePayment(tx, req.actor, order.id, { ...p, idempotencyKey: key ? `${key}:p${i}` : null }, after);
      const w = await walletForAccount(tx, cred.account_id);
      return { orderNo: order.order_no, amount: b.amount, balance: Number(w.balance), change: last?.payment?.change_amount ?? 0 };
    }));
  });
  app.post('/api/wallet/adjust', { preHandler: requirePerm('wallet.adjust') }, async (req) => {
    const b = parse(z.object({ credentialId: zUuid, direction: z.enum(['CREDIT', 'DEBIT']), amount: zPositiveMoney, reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body);
    return withTx((tx, after) => adjustWallet(tx, req.actor, b, after));
  });
  app.post('/api/wallet/cashout', { preHandler: requirePerm('wallet.cashout') }, async (req) => {
    const b = parse(z.object({ scan: z.string(), amount: zPositiveMoney.optional(), method: z.enum(['CASH', 'TRANSFER_TO_MEMBER']), memberId: zUuid.optional(), reason: z.string().optional() }), req.body);
    return withIdempotency(`cashout:${req.actor.staffId}`, req.headers['idempotency-key'] as string, b, () => withTx((tx, after) => walletCashOut(tx, req.actor, b, after)));
  });
  app.get('/api/wallet/reconcile', { preHandler: requirePerm('transaction.view') }, async () => ({ mismatches: await reconcileWallets(pool) }));

  // ============================ POS / orders ============================
  app.get('/api/pos/catalog', { preHandler: requirePerm('pos.sell') }, async (req) => {
    const q = parse(z.object({ storeId: zUuid }), req.query);
    const store = await one(pool, 'SELECT * FROM stores WHERE id = $1', [q.storeId]);
    if (!store) throw notFound('Store');
    branchOf(req, store.branch_id);
    const products = await query(pool, `SELECT p.*, c.name AS category_name, c.type AS category_type, CASE WHEN p.track_stock THEN COALESCE(i.qty, 0) END AS stock
        FROM products p JOIN product_stores ps ON ps.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN inventory i ON i.product_id = p.id AND i.store_id = ps.store_id
       WHERE ps.store_id = $1 AND p.is_active ORDER BY c.sort, p.sort, p.name`, [q.storeId]);
    return { store, products };
  });
  /** One-shot checkout (create + pay). Safe for offline replay thanks to the Idempotency-Key. */
  app.post('/api/pos/checkout', { preHandler: requirePerm('pos.sell') }, async (req) => {
    const b = parse(z.object({
      storeId: zUuid, items: z.array(itemSchema).min(1), scan: z.string().optional(), memberId: zUuid.optional(), couponCode: z.string().nullish(),
      manualDiscount: z.object({ percent: z.number().min(0).max(100).optional(), amount: zMoney.optional(), reason: z.string().min(2), approvalId: zUuid.nullish() }).nullish(),
      payments: z.array(paymentSchema).default([]), notes: z.string().max(300).nullish(), offlineCreatedAt: z.string().optional(),
    }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`pos:${req.actor.staffId ?? req.actor.deviceId}`, key, b, () => withTx(async (tx, after) => {
      const store = await one(tx, 'SELECT * FROM stores WHERE id = $1 AND is_active', [b.storeId]);
      if (!store) throw notFound('Store');
      const branchId = branchOf(req, store.branch_id);
      let cred: any = null;
      if (b.scan) {
        cred = (await resolveScan(tx, b.scan, { allowCode: can(req.actor, 'credential.lookup_code') })).credential;
        if (cred.status !== 'ACTIVE') throw conflict('CREDENTIAL_NOT_ACTIVE', `Card is ${cred.status}`);
      }
      const mctx = await memberContext(tx, b.memberId ?? cred?.member_id ?? null);
      const lines = await priceItems(tx, branchId, b.items as ItemInput[], mctx);
      const type = store.type === 'RESTAURANT' ? 'FOOD' : store.type === 'RETAIL' ? 'RETAIL' : lines.every((l) => l.itemType === 'TOPUP') ? 'TOPUP' : 'POS';
      const { order, rejectedCoupon } = await createOrder(tx, req.actor, { branchId, storeId: store.id, type, channel: 'POS', lines, memberCtx: mctx, accountId: cred?.account_id ?? mctx.accountId,
        credentialId: cred?.id ?? null, couponCode: b.couponCode, manualDiscount: b.manualDiscount ?? null, notes: b.notes, idempotencyKey: key ? `order:${key}` : null,
        metadata: b.offlineCreatedAt ? { offlineCreatedAt: b.offlineCreatedAt } : {} });
      let current = order;
      const pays = await paymentsFromInput(tx, b.payments.map((p) => (p.method === 'WALLET' && !p.scan && !p.credentialId && cred ? { ...p, credentialId: cred.id } : p)));
      for (const [i, p] of pays.entries()) current = (await capturePayment(tx, req.actor, order.id, { ...p, channel: 'POS', idempotencyKey: key ? `${key}:p${i}` : null }, after)).order;
      const wallet = cred?.account_id ? await walletForAccount(tx, cred.account_id) : null;
      return { order: await orderDetail(tx, order.id), rejectedCoupon, walletBalance: wallet ? Number(wallet.balance) : null, status: current.status };
    }));
  });
  app.post('/api/orders/:id/payments', { preHandler: requirePerm('payment.accept') }, async (req) => {
    const b = parse(paymentSchema, req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withTx(async (tx, after) => {
      const [p] = await paymentsFromInput(tx, [b]);
      const r = await capturePayment(tx, req.actor, (req.params as any).id, { ...p, idempotencyKey: key ?? null }, after);
      return { payment: r.payment, order: await orderDetail(tx, r.order.id) };
    });
  });
  /** Counter PromptPay: generate dynamic QR for outstanding amount; confirm when received. */
  app.post('/api/orders/:id/payments/initiate', { preHandler: requirePerm('payment.accept') }, async (req) => {
    const b = parse(z.object({ method: z.enum(['PROMPTPAY', 'CARD', 'DEBIT']) }), req.body);
    return withTx((tx) => initiatePayment(tx, req.actor, (req.params as any).id, b.method, 'counter'));
  });
  app.post('/api/payments/:id/confirm', { preHandler: requirePerm('payment.accept') }, async (req) => {
    const b = parse(z.object({ reference: z.string().max(100).optional() }), req.body);
    const r = await confirmExternalPayment(req.actor, (req.params as any).id, { reference: b.reference, payload: { confirmedBy: req.actor.staffId } });
    return { payment: r.payment, order: await orderDetail(pool, r.order.id) };
  });
  app.get('/api/orders', { preHandler: requirePerm('transaction.view') }, async (req) => {
    const q = req.query as any;
    const branchId = branchOf(req, q.branchId);
    return query(pool, `SELECT o.id, o.order_no, o.type, o.channel, o.status, o.total, o.paid_total, o.refunded_total, o.created_at, o.queue_no, o.kitchen_status, s.name AS store_name, st.first_name AS staff_name, o.customer_name
        FROM orders o LEFT JOIN stores s ON s.id = o.store_id LEFT JOIN staff st ON st.id = o.staff_id
       WHERE o.branch_id = $1 AND ($2::text IS NULL OR o.order_no ILIKE '%' || $2 || '%') AND ($3::text IS NULL OR o.type = $3) AND ($4::uuid IS NULL OR o.store_id = $4)
       ORDER BY o.created_at DESC LIMIT 200`, [branchId, q.q || null, q.type || null, q.storeId || null]);
  });
  app.get('/api/orders/:id', { preHandler: requireAnyPerm('transaction.view', 'pos.sell', 'payment.accept') }, async (req) => orderDetail(pool, (req.params as any).id));
  app.post('/api/orders/:id/cancel', { preHandler: requireAnyPerm('pos.sell', 'ticket.sell') }, async (req) =>
    withTx((tx) => cancelOrder(tx, req.actor, (req.params as any).id, parse(z.object({ reason: z.string().min(2) }), req.body).reason)).then(() => ({ ok: true })));
  app.post('/api/orders/:id/refund', { preHandler: requirePerm('refund.create') }, async (req) => {
    const b = parse(z.object({ amount: zPositiveMoney.optional(), items: z.array(z.object({ orderItemId: zUuid, qty: z.number().int().positive() })).optional(),
      method: z.enum(['CASH', 'ORIGINAL', 'WALLET', 'BANK_TRANSFER']), reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withTx((tx, after) => refundOrder(tx, req.actor, { orderId: (req.params as any).id, ...b, idempotencyKey: key ?? null }, after));
  });
  app.post('/api/orders/:id/void', { preHandler: requirePerm('pos.void') }, async (req) => {
    const b = parse(z.object({ reason: z.string().min(3), approvalId: zUuid.nullish(), method: z.enum(['CASH', 'ORIGINAL', 'WALLET']).default('ORIGINAL') }), req.body);
    return withTx((tx, after) => refundOrder(tx, req.actor, { orderId: (req.params as any).id, method: b.method, reason: b.reason, approvalId: b.approvalId, void: true }, after));
  });

  // ============================ kitchen display ============================
  app.get('/api/kitchen/:storeId/orders', { preHandler: requirePerm('kitchen.manage') }, async (req) => {
    const { storeId } = req.params as { storeId: string };
    return query(pool, `SELECT o.id, o.order_no, o.queue_no, o.kitchen_status, o.notes, o.created_at, o.updated_at, o.channel, o.customer_name,
        (SELECT json_agg(json_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes) ORDER BY i.name) FROM order_items i WHERE i.order_id = o.id AND i.item_type = 'PRODUCT') AS items
      FROM orders o WHERE o.store_id = $1 AND o.kitchen_status IN ('NEW','PREPARING','READY') ORDER BY o.created_at`, [storeId]);
  });
  app.post('/api/kitchen/orders/:id/status', { preHandler: requirePerm('kitchen.manage') }, async (req) => {
    const b = parse(z.object({ status: z.enum(['PREPARING', 'READY', 'COMPLETED', 'CANCELLED']) }), req.body);
    const FLOW: Record<string, string[]> = { NEW: ['PREPARING', 'READY', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'], READY: ['COMPLETED', 'PREPARING'], COMPLETED: [] };
    return withTx(async (tx, after) => {
      const o = await one(tx, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [(req.params as any).id]);
      if (!o?.kitchen_status) throw notFound('Kitchen order');
      if (!FLOW[o.kitchen_status]?.includes(b.status)) throw conflict('INVALID_KITCHEN_STATUS', `${o.kitchen_status} → ${b.status} not allowed`);
      await tx.query('UPDATE orders SET kitchen_status = $2 WHERE id = $1', [o.id, b.status]);
      await audit(tx, req.actor, { action: 'KITCHEN_STATUS', entityType: 'order', entityId: o.order_no, after: { status: b.status } });
      if (b.status === 'READY' && o.account_id) {
        const { notify } = await import('../services/notify.js');
        await notify({ audience: 'ACCOUNT', accountId: o.account_id, memberId: o.member_id, type: 'ORDER_READY', title: `อาหารพร้อมแล้ว ${o.queue_no}`, message: 'กรุณารับอาหารที่เคาน์เตอร์', data: { orderId: o.id } }, tx, after);
      }
      after(() => {
        publish([rooms.kds(o.store_id), `kdsready:${o.store_id}`], 'kitchen.order', { orderId: o.id, queueNo: o.queue_no, status: b.status });
        publish([rooms.account(o.account_id)], 'order.kitchen', { orderId: o.id, queueNo: o.queue_no, status: b.status });
      });
      return { ok: true };
    });
  });

  // ============================ bookings (counter / back office) ============================
  app.get('/api/bookings', { preHandler: requirePerm('booking.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), filter: z.string().optional(), q: z.string().optional(), date: zDate.optional(),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return listBookings(pool, branchOf(req, q.branchId), q);
  });
  app.get('/api/bookings/calendar', { preHandler: requirePerm('booking.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), month: z.string().regex(/^\d{4}-\d{2}$/) }), req.query);
    return bookingCalendar(pool, branchOf(req, q.branchId), q.month);
  });
  app.post('/api/bookings/scan', { preHandler: requirePerm('booking.view') }, async (req) => bookingFromScan(pool, parse(z.object({ scan: z.string().min(3) }), req.body).scan));
  app.get('/api/bookings/:id', { preHandler: requirePerm('booking.view') }, async (req) => bookingDetail(pool, (req.params as any).id));
  app.post('/api/bookings/quote', { preHandler: requirePerm('ticket.sell') }, async (req) => {
    const b = parse(z.object({ branchId: zUuid.optional(), packageId: zUuid, visitDate: zDate, guests: z.array(z.object({ ticketTypeId: zUuid, qty: z.number().int().min(0) })).optional(),
      bundles: z.number().int().min(1).optional(), addons: z.array(z.object({ productId: zUuid, qty: z.number().int().min(1) })).optional(), memberId: zUuid.nullish(), couponCode: z.string().nullish() }), req.body);
    return quote({ ...b, branchId: branchOf(req, b.branchId), channel: 'COUNTER' });
  });
  /** Counter / box-office sale → booking (channel COUNTER), paid immediately via /api/orders/:id/payments */
  app.post('/api/bookings', { preHandler: requirePerm('ticket.sell') }, async (req) => {
    const b = parse(z.object({ branchId: zUuid.optional(), packageId: zUuid, visitDate: zDate, guests: z.array(z.object({ ticketTypeId: zUuid, qty: z.number().int().min(0) })).optional(),
      bundles: z.number().int().min(1).optional(), addons: z.array(z.object({ productId: zUuid, qty: z.number().int().min(1) })).optional(), memberId: zUuid.nullish(), couponCode: z.string().nullish(),
      customerName: z.string().trim().min(1).default('Walk-in'), phone: z.string().default('-'), email: z.string().email().nullish(),
      guestDetails: z.array(z.object({ name: z.string().optional(), birthday: zDate.optional(), heightCm: z.number().int().optional() })).optional() }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    const branchId = branchOf(req, b.branchId);
    return withIdempotency(`counter-booking:${req.actor.staffId}`, key, b, () => withTx((tx, after) =>
      createBooking(tx, req.actor, { ...b, branchId, channel: 'COUNTER', paymentMode: 'PAY_NOW', idempotencyKey: key ?? null }, after)));
  });
  app.post('/api/bookings/:id/checkin', { preHandler: requirePerm('booking.checkin') }, async (req) => {
    const b = parse(z.object({ assignments: z.array(z.object({ ticketId: zUuid, mode: z.enum(['GENERATE', 'SCAN', 'MEMBER_CARD']), scan: z.string().optional(),
      heightCm: z.number().int().min(40).max(250).optional(), guestName: z.string().max(120).optional() })).min(1) }), req.body);
    return withTx((tx, after) => checkinBooking(tx, req.actor, (req.params as any).id, b.assignments, after));
  });
  app.post('/api/bookings/:id/cancel', { preHandler: requirePerm('booking.cancel') }, async (req) =>
    withTx((tx) => cancelBooking(tx, req.actor, (req.params as any).id, parse(z.object({ reason: z.string().min(2) }), req.body).reason)).then(() => ({ ok: true })));

  // ============================ members (staff) ============================
  app.get('/api/members', { preHandler: requirePerm('member.view') }, async (req) => {
    const q = (req.query as any).q?.trim();
    return query(pool, `SELECT m.id, m.member_code, m.first_name, m.last_name, m.phone, m.email, m.points, m.visit_count, m.total_spend, m.status, m.join_date, t.name AS tier_name, t.color AS tier_color,
        w.balance AS wallet_balance FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id LEFT JOIN customer_accounts a ON a.member_id = m.id LEFT JOIN wallet_accounts w ON w.account_id = a.id
       WHERE $1::text IS NULL OR m.phone ILIKE '%' || $1 || '%' OR m.email ILIKE '%' || $1 || '%' OR m.member_code ILIKE '%' || $1 || '%' OR (m.first_name || ' ' || m.last_name) ILIKE '%' || $1 || '%'
       ORDER BY m.created_at DESC LIMIT 100`, [q || null]);
  });
  app.post('/api/members', { preHandler: requirePerm('member.create') }, async (req) => {
    const b = parse(z.object({ phone: zPhone, firstName: z.string().trim().min(1), lastName: z.string().trim().default(''), birthday: zDate.nullish(), email: z.string().email().nullish(),
      password: z.string().min(8).nullish(), gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']).nullish(), address: z.string().nullish(), emergencyContact: z.string().nullish() }), req.body);
    return withTx((tx) => registerMember(tx, req.actor, { ...b, branchId: req.actor.branchId, via: req.actor.deviceType === 'KIOSK' ? 'KIOSK' : 'COUNTER' }));
  });
  // scan a card the customer already holds → it becomes this member's card
  app.post('/api/members/:id/link-card', { preHandler: requireAnyPerm('credential.issue', 'credential.manage') }, async (req) => {
    const b = parse(z.object({ scan: z.string().trim().min(1).max(512) }), req.body);
    const r = await withTx((tx, after) => linkCardToMember(tx, req.actor, (req.params as any).id, b.scan, after));
    return { created: r.created, credential: { id: r.credential.id, code: r.credential.code, type: r.credential.type, status: r.credential.status, physicalSerial: r.credential.physical_serial } };
  });
  app.get('/api/members/:id', { preHandler: requirePerm('member.view') }, async (req) => {
    const id = (req.params as any).id;
    const s = await memberSummary(pool, id);
    const [tickets, orders, points, rides] = await Promise.all([
      query(pool, `SELECT t.ticket_code, t.status, t.visit_date, t.presence, p.name AS package_name FROM tickets t JOIN packages p ON p.id = t.package_id WHERE t.member_id = $1 ORDER BY t.visit_date DESC LIMIT 50`, [id]),
      query(pool, `SELECT id, order_no, type, status, total, created_at FROM orders WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
      query(pool, `SELECT * FROM points_ledger WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
      s.account_id ? query(pool, `SELECT l.result, l.scanned_at, r.name AS ride_name FROM ride_access_logs l JOIN rides r ON r.id = l.ride_id WHERE l.account_id = $1 ORDER BY l.scanned_at DESC LIMIT 50`, [s.account_id]) : [],
    ]);
    return { ...s, tickets, orders, pointsHistory: points, rides };
  });
  app.patch('/api/members/:id', { preHandler: requirePerm('member.edit') }, async (req) => {
    const b = parse(z.object({ firstName: z.string().min(1).optional(), lastName: z.string().optional(), phone: zPhone.optional(), email: z.string().email().nullish(), birthday: zDate.nullish(),
      gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']).nullish(), address: z.string().nullish(), status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional() }), req.body);
    const id = (req.params as any).id;
    return withTx(async (tx) => {
      const before = await one(tx, 'SELECT first_name, last_name, phone, email, birthday, gender, address, status FROM members WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw notFound('Member');
      if (b.status && b.status !== 'ACTIVE' && !can(req.actor, 'member.delete')) throw forbidden('Missing permission: member.delete');
      await tx.query(`UPDATE members SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), phone = COALESCE($4, phone), email = COALESCE($5, email),
          birthday = COALESCE($6, birthday), gender = COALESCE($7, gender), address = COALESCE($8, address), status = COALESCE($9, status) WHERE id = $1`,
        [id, b.firstName ?? null, b.lastName ?? null, b.phone ?? null, b.email ?? null, b.birthday ?? null, b.gender ?? null, b.address ?? null, b.status ?? null]);
      await audit(tx, req.actor, { action: 'MEMBER_UPDATE', entityType: 'member', entityId: id, before, after: b });
      return memberSummary(tx, id);
    });
  });
  app.post('/api/members/:id/points', { preHandler: requirePerm('points.adjust') }, async (req) => {
    const b = parse(z.object({ points: z.number().int().refine((v) => v !== 0), reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body);
    return withTx(async (tx, after) => {
      const approval = await consumeApproval(tx, req.actor, b.approvalId, 'POINTS_ADJUST');
      const r = await postPoints(tx, { memberId: (req.params as any).id, type: 'ADJUST', points: b.points, staffId: req.actor.staffId, note: b.reason, referenceType: 'ADJUSTMENT', referenceId: approval ?? undefined }, after);
      await audit(tx, req.actor, { action: 'POINTS_ADJUST', entityType: 'member', entityId: (req.params as any).id, reason: b.reason, after: { points: b.points } });
      return r;
    });
  });
  /** Counter membership sale: order + payments in one go. */
  app.post('/api/members/:id/membership', { preHandler: requirePerm('member.create') }, async (req) => {
    const b = parse(z.object({ membershipProductId: zUuid, mode: z.enum(['NEW', 'RENEWAL', 'UPGRADE']), physicalCard: z.boolean().default(false), payments: z.array(paymentSchema).min(1) }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`membership:${req.actor.staffId}`, key, b, () => withTx(async (tx, after) => {
      const memberId = (req.params as any).id;
      const branchId = branchOf(req, null);
      const mctx = await memberContext(tx, memberId);
      const lines = await priceItems(tx, branchId, [{ type: 'MEMBERSHIP', membershipProductId: b.membershipProductId, mode: b.mode, physicalCard: b.physicalCard }], mctx);
      const { order } = await createOrder(tx, req.actor, { branchId, type: 'MEMBERSHIP', channel: 'COUNTER', lines, memberCtx: mctx, applyPromotions: false, idempotencyKey: key ? `order:${key}` : null });
      for (const [i, p] of (await paymentsFromInput(tx, b.payments)).entries()) await capturePayment(tx, req.actor, order.id, { ...p, idempotencyKey: key ? `${key}:p${i}` : null }, after);
      return { order: await orderDetail(tx, order.id), member: await memberSummary(tx, memberId) };
    }));
  });

  // ============================ shifts ============================
  app.get('/api/shifts/current', { preHandler: requirePerm('shift.open') }, async (req) => {
    const s = await one(pool, `SELECT id FROM shifts WHERE staff_id = $1 AND status = 'OPEN'`, [req.actor.staffId]);
    return s ? shiftSummary(pool, s.id) : null;
  });
  app.post('/api/shifts/open', { preHandler: requirePerm('shift.open') }, async (req) => {
    const b = parse(z.object({ openingCash: zMoney, storeId: zUuid.nullish() }), req.body);
    return withTx((tx) => openShift(tx, req.actor, { ...b, branchId: branchOf(req, null) }));
  });
  app.post('/api/shifts/cash-movement', { preHandler: requirePerm('shift.cash_movement') }, async (req) =>
    withTx((tx) => cashMovement(tx, req.actor, parse(z.object({ type: z.enum(['CASH_IN', 'CASH_OUT']), amount: zPositiveMoney, reason: z.string().min(2), approvalId: zUuid.nullish() }), req.body))));
  app.post('/api/shifts/:id/close', { preHandler: requirePerm('shift.open') }, async (req) =>
    withTx((tx) => closeShift(tx, req.actor, (req.params as any).id, parse(z.object({ actualCash: zMoney, note: z.string().max(300).optional(), approvalId: zUuid.nullish() }), req.body))));
  app.get('/api/shifts/:id', { preHandler: requireAnyPerm('shift.open', 'shift.manage') }, async (req) => {
    const s = await shiftSummary(pool, (req.params as any).id);
    if (s.shift.staff_id !== req.actor.staffId && !can(req.actor, 'shift.manage')) throw forbidden();
    return s;
  });
  app.get('/api/shifts', { preHandler: requirePerm('shift.manage') }, async (req) =>
    query(pool, `SELECT s.*, st.first_name, st.employee_code, so.name AS store_name FROM shifts s JOIN staff st ON st.id = s.staff_id LEFT JOIN stores so ON so.id = s.store_id
      WHERE s.branch_id = $1 ORDER BY s.opened_at DESC LIMIT 200`, [branchOf(req, (req.query as any).branchId)]));

  /** Dynamic PromptPay QR for an amount (counter / POS shows it to the customer, staff confirms receipt). */
  app.get('/api/promptpay-qr', { preHandler: requirePerm('payment.accept') }, async (req) => {
    const q = parse(z.object({ amount: z.coerce.number().int().positive() }), req.query);
    const { promptPayPayload } = await import('../lib/promptpay.js');
    const { config } = await import('../config.js');
    return { payload: promptPayPayload(config.promptpayId, q.amount), amount: q.amount };
  });

  // ============================ transaction center ============================
  app.get('/api/transactions', { preHandler: requirePerm('transaction.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), q: z.string().optional(), type: z.string().optional(), category: z.string().optional(), staffId: zUuid.optional(),
      storeId: zUuid.optional(), from: zDate.optional(), to: zDate.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const branchId = branchOf(req, q.branchId);
    const params: unknown[] = [branchId];
    const where = ['t.branch_id = $1'];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
    if (q.type) add('t.type = ?', q.type);
    if (q.category) add('t.category = ?', q.category);
    if (q.staffId) add('t.staff_id = ?', q.staffId);
    if (q.storeId) add('t.store_id = ?', q.storeId);
    if (q.from) add(`t.created_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Bangkok'`, q.from);
    if (q.to) add(`t.created_at < ((?::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'`, q.to);
    if (q.q) add(`(t.txn_no ILIKE '%' || ? || '%' OR o.order_no ILIKE '%' || ? || '%' OR c.code ILIKE '%' || ? || '%' OR c.physical_serial ILIKE '%' || ? || '%' OR m.member_code ILIKE '%' || ? || '%'
                   OR m.phone ILIKE '%' || ? || '%' OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.order_id = t.order_id AND tk.ticket_code ILIKE '%' || ? || '%') OR st.employee_code ILIKE '%' || ? || '%')`, q.q.trim());
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const rows = await query(pool, `SELECT t.*, o.order_no, c.code AS credential_code, m.member_code, st.first_name AS staff_name, s.name AS store_name, COUNT(*) OVER() AS total_count
        FROM transactions t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN credentials c ON c.id = t.credential_id LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN staff st ON st.id = t.staff_id LEFT JOIN stores s ON s.id = t.store_id
       WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total: rows[0]?.total_count ?? 0 };
  });
  app.get('/api/refunds', { preHandler: requirePerm('transaction.view') }, async (req) =>
    query(pool, `SELECT r.*, o.order_no, st.first_name AS staff_name FROM refunds r JOIN orders o ON o.id = r.order_id LEFT JOIN staff st ON st.id = r.staff_id
      WHERE o.branch_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [branchOf(req, (req.query as any).branchId)]));
  app.get('/api/settings/runtime', async (req) => {
    if (req.actor.type === 'PUBLIC' || req.actor.type === 'MEMBER') throw forbidden();
    const b = req.actor.branchId;
    const [offline, approvals, gate, wallet, payments, receipt, printer, fonts, park, queueCfg, shift] = await Promise.all([
      getSetting('offline', b), getSetting('approvals', b), getSetting('gate', b), getSetting('wallet', b), getSetting('payments', b), getSetting('receipt', b),
      getSetting('printer', b), getSetting('fonts', b), getSetting('park.info', b), getSetting('queue', b), getSetting('shift', b)]);
    return { offline, approvals, gate, wallet, payments, receipt, printer, fonts, park, queue: queueCfg, shift };
  });
}
