import { pool, one, query, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { businessDate, businessTime } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { resolveScan, ScanError, STATUS_MESSAGES, credentialProfile } from './credentials.js';
import { ticketsForCredential, dateCheck, timeCheck, ageOn, endOfDay, startOfDay } from './tickets.js';
import { capturePayment, createOrder, memberContext, priceItems, rideAddonPrice, confirmExternalPayment } from './orders.js';
import { initiatePayment, chargeOnTerminal } from './payments.js';
import { consumeApproval } from './approvals.js';

export const RIDE_REASONS: Record<string, { th: string; en: string }> = {
  NOT_FOUND: { th: 'ไม่พบบัตรในระบบ', en: 'Card not found' },
  FORGED_QR: { th: 'QR ไม่ถูกต้อง', en: 'Invalid QR code' },
  QR_EXPIRED: { th: 'QR หมดอายุ กรุณาเปิดใหม่', en: 'QR expired — refresh your card' },
  MALFORMED: { th: 'อ่าน QR ไม่ได้', en: 'Unreadable code' },
  RIDE_CLOSED: { th: 'เครื่องเล่นปิดให้บริการ', en: 'Ride closed' },
  RIDE_MAINTENANCE: { th: 'เครื่องเล่นปิดปรับปรุง', en: 'Ride under maintenance' },
  ENTRY_PAUSED: { th: 'หยุดรับผู้เล่นชั่วคราว', en: 'Entry paused' },
  NO_TICKET: { th: 'ไม่พบตั๋วเข้าสวนสนุกที่ใช้ได้', en: 'No valid admission' },
  NOT_INSIDE: { th: 'กรุณาเข้าสวนสนุกผ่านประตูก่อน', en: 'Please enter the park first' },
  TOO_YOUNG: { th: 'อายุไม่ถึงเกณฑ์', en: 'Below minimum age' },
  TOO_OLD: { th: 'อายุเกินเกณฑ์', en: 'Above maximum age' },
  TOO_SHORT: { th: 'ส่วนสูงไม่ถึงเกณฑ์', en: 'Below minimum height' },
  TOO_TALL: { th: 'ส่วนสูงเกินเกณฑ์', en: 'Above maximum height' },
  OUTSIDE_TIME: { th: 'ไม่อยู่ในช่วงเวลาที่ใช้ได้', en: 'Outside valid time' },
  NOT_INCLUDED: { th: 'แพ็กเกจของคุณไม่รวมเครื่องเล่นนี้', en: 'Ride not included in your package' },
  EXHAUSTED: { th: 'คุณใช้สิทธิ์ครบแล้ว', en: 'All rides used' },
  OPERATOR_DENIED: { th: 'เจ้าหน้าที่ไม่อนุญาต', en: 'Denied by operator' },
};

function reason(code: string) {
  if (code.startsWith('CREDENTIAL_')) {
    const st = code.replace('CREDENTIAL_', '');
    return { th: STATUS_MESSAGES[st]?.split(' (')[0] ?? 'บัตรใช้งานไม่ได้', en: `Card ${st.toLowerCase()}` };
  }
  return RIDE_REASONS[code] ?? { th: code, en: code };
}

export async function rideById(db: Db, id: string) {
  const r = await one(db, 'SELECT * FROM rides WHERE id = $1', [id]);
  if (!r) throw notFound('Ride');
  return r;
}

async function resolveScanPoint(db: Db, rideId: string, scanPointId?: string | null) {
  if (!scanPointId) return null;
  const sp = await one(db, 'SELECT * FROM ride_scan_points WHERE id::text = $1 OR code = $1', [scanPointId]);
  if (!sp || sp.ride_id !== rideId) throw badRequest('BAD_SCAN_POINT', 'Scan point does not belong to this ride');
  if (sp.status !== 'ACTIVE') throw unprocessable('SCAN_POINT_INACTIVE', 'Scan point inactive');
  return sp;
}

/** Pick the entitlement to consume: non-consuming (unlimited/time/date) first, then counted by earliest expiry. */
async function findEntitlement(tx: Db, ride: any, ticketIds: string[], accountId: string | null, lock: boolean) {
  const rows = await query(tx, `SELECT * FROM ride_entitlements
     WHERE status = 'ACTIVE' AND valid_from <= now() AND valid_until > now() AND branch_id = $1
       AND (ride_id = $2 OR ride_id IS NULL)
       AND (ticket_id = ANY($3::uuid[]) OR (ticket_id IS NULL AND account_id = $4))
     ORDER BY (type IN ('UNLIMITED','TIME_BASED','DATE_BASED')) DESC, (ride_id IS NOT NULL) DESC, valid_until, created_at
     ${lock ? 'FOR UPDATE' : ''}`, [ride.branch_id, ride.id, ticketIds, accountId]);
  const usable = rows.find((e: any) => e.uses_remaining === null || e.uses_remaining > 0);
  const exhausted = rows.find((e: any) => e.uses_remaining === 0);
  if (!usable && !exhausted) {
    const ex = await one(tx, `SELECT 1 FROM ride_entitlements WHERE status = 'EXHAUSTED' AND branch_id = $1 AND (ride_id = $2 OR ride_id IS NULL)
        AND (ticket_id = ANY($3::uuid[]) OR (ticket_id IS NULL AND account_id = $4)) AND valid_until > now() LIMIT 1`, [ride.branch_id, ride.id, ticketIds, accountId]);
    return { usable: null, exhausted: !!ex };
  }
  return { usable: usable ?? null, exhausted: !usable && !!exhausted };
}

export interface RideScanResult {
  result: 'GRANTED' | 'DENIED' | 'NOT_INCLUDED';
  reasonCode?: string;
  reason?: { th: string; en: string };
  checks: Array<{ code: string; label: string; ok: boolean; detail?: string; warn?: boolean }>;
  ride: { id: string; name: string; code: string };
  customer?: string | null;
  credentialId?: string;
  credentialCode?: string;
  accessLogId?: string;
  entitlement?: { type: string; usesRemaining: number | null; usesTotal: number | null; validUntil: string } | null;
  purchase?: { available: boolean; price: number; methods: string[]; entitlementType: string; uses: number } | null;
  walletBalance?: number | null;
}

/**
 * Ride Entitlement Engine. Validates credential → ticket → package/entitlement → ride → time → usage → age/height,
 * consumes one use atomically (row lock) and logs every scan.
 */
export async function scanAtRide(actor: Actor, rideId: string, raw: string, opts: { scanPointId?: string | null; consume?: boolean } = {}): Promise<RideScanResult> {
  return withTx(async (tx, after) => {
    const ride = await one(tx, 'SELECT * FROM rides WHERE id = $1 FOR SHARE', [rideId]);
    if (!ride) throw notFound('Ride');
    const sp = await resolveScanPoint(tx, rideId, opts.scanPointId);
    const date = businessDate();
    const gcfg = await getSetting('gate', ride.branch_id, tx);
    const checks: RideScanResult['checks'] = [];
    let cred: any = null;
    let code: string | undefined;
    let ticket: any = null;
    let ent: any = null;
    let exhausted = false;
    let tickets: any[] = [];
    try {
      cred = (await resolveScan(tx, raw)).credential;
      if (cred.status === 'ACTIVE' && cred.expires_at && new Date(cred.expires_at) < new Date()) {
        await tx.query(`UPDATE credentials SET status = 'EXPIRED' WHERE id = $1`, [cred.id]);
        cred.status = 'EXPIRED';
      }
      checks.push({ code: 'CREDENTIAL', label: 'Card Status', ok: cred.status === 'ACTIVE', detail: cred.status });
      if (cred.status !== 'ACTIVE') throw new ScanError(`CREDENTIAL_${cred.status}`, cred.status, cred);
      const rideOpen = ride.status === 'OPEN';
      checks.push({ code: 'RIDE_STATUS', label: 'Ride Open', ok: rideOpen && !ride.entry_paused, detail: ride.entry_paused ? 'PAUSED' : ride.status });
      if (!rideOpen) throw new ScanError(ride.status === 'MAINTENANCE' ? 'RIDE_MAINTENANCE' : 'RIDE_CLOSED', ride.status, cred);
      if (ride.entry_paused) throw new ScanError('ENTRY_PAUSED', 'paused', cred);

      tickets = (await ticketsForCredential(tx, cred, date, { memberCardEntry: gcfg.memberCardEntry }))
        .filter((t) => t.branch_id === ride.branch_id && t.status === 'ACTIVE' && dateCheck(t, date).ok);
      ticket = tickets.find((t) => t.presence === 'INSIDE') ?? tickets[0] ?? null;
      const hasAccountRights = !!(await one(tx, `SELECT 1 FROM ride_entitlements WHERE account_id = $1 AND ticket_id IS NULL AND status = 'ACTIVE' AND valid_until > now() LIMIT 1`, [cred.account_id]));
      checks.push({ code: 'TICKET', label: 'Valid Admission', ok: !!ticket || hasAccountRights, detail: ticket ? ticket.ticket_code : undefined });
      if (!ticket && !hasAccountRights) throw new ScanError('NO_TICKET', 'no ticket', cred);
      if (ticket && gcfg.requireInsideForRides) {
        const inside = tickets.some((t) => t.presence === 'INSIDE');
        checks.push({ code: 'INSIDE', label: 'Inside Park', ok: inside });
        if (!inside) throw new ScanError('NOT_INSIDE', 'not inside', cred);
      }
      if (ticket) {
        const tc = timeCheck(ticket, businessTime());
        checks.push({ code: 'TIME', label: 'Valid Time', ok: tc.ok, detail: tc.detail });
        if (!tc.ok) throw new ScanError('OUTSIDE_TIME', tc.detail ?? 'time', cred);
      }
      // age / height
      const member = cred.member_id ? await one(tx, 'SELECT birthday FROM members WHERE id = $1', [cred.member_id]) : null;
      const age = ageOn(ticket?.guest_birthday ?? member?.birthday ?? null, date);
      if (ride.min_age != null || ride.max_age != null) {
        const ok = age == null || ((ride.min_age == null || age >= ride.min_age) && (ride.max_age == null || age <= ride.max_age));
        checks.push({ code: 'AGE', label: 'Age', ok, warn: age == null, detail: age == null ? 'Unknown — verify' : `${age} yrs` });
        if (!ok) throw new ScanError(ride.min_age != null && age! < ride.min_age ? 'TOO_YOUNG' : 'TOO_OLD', 'age', cred);
      }
      if (ride.min_height_cm != null || ride.max_height_cm != null) {
        const h = ticket?.guest_height_cm ?? null;
        const ok = h == null || ((ride.min_height_cm == null || h >= ride.min_height_cm) && (ride.max_height_cm == null || h <= ride.max_height_cm));
        checks.push({ code: 'HEIGHT', label: 'Height', ok, warn: h == null, detail: h == null ? `Verify ${ride.min_height_cm ?? 0}–${ride.max_height_cm ?? '∞'} cm` : `${h} cm` });
        if (!ok) throw new ScanError(ride.min_height_cm != null && h! < ride.min_height_cm ? 'TOO_SHORT' : 'TOO_TALL', 'height', cred);
      }
      const found = await findEntitlement(tx, ride, tickets.map((t) => t.id), cred.account_id, true);
      ent = found.usable;
      exhausted = found.exhausted;
      checks.push({ code: 'ENTITLEMENT', label: 'Ride Entitlement', ok: !!ent, detail: ent ? (ent.uses_remaining == null ? ent.type : `${ent.uses_remaining} left`) : exhausted ? 'Used up' : 'Not included' });
      if (!ent) code = exhausted ? 'EXHAUSTED' : 'NOT_INCLUDED';
    } catch (e) {
      if (!(e instanceof ScanError)) throw e;
      code = e.reasonCode;
      cred = e.credential ?? cred;
    }

    const notIncluded = code === 'NOT_INCLUDED' || code === 'EXHAUSTED';
    const result: RideScanResult['result'] = !code ? 'GRANTED' : notIncluded ? 'NOT_INCLUDED' : 'DENIED';
    let usesAfter: number | null = ent?.uses_remaining ?? null;
    const log = await one(tx, `INSERT INTO ride_access_logs(ride_id, branch_id, scan_point_id, credential_id, ticket_id, account_id, member_id, entitlement_id, result, reason_code, reason,
        checks, operator_staff_id, device_id, entered_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $9 = 'GRANTED' THEN now() END) RETURNING *`,
      [ride.id, ride.branch_id, sp?.id ?? null, cred?.id ?? null, ticket?.id ?? null, cred?.account_id ?? null, cred?.member_id ?? null, ent?.id ?? null, result,
       code ?? null, code ? reason(code).en : null, JSON.stringify(checks), actor.staffId ?? null, actor.deviceId ?? null]);

    if (result === 'GRANTED' && opts.consume !== false) {
      if (ent.uses_remaining != null) {
        usesAfter = ent.uses_remaining - 1;
        await tx.query(`UPDATE ride_entitlements SET uses_remaining = $2, status = CASE WHEN $2 = 0 THEN 'EXHAUSTED' ELSE status END WHERE id = $1`, [ent.id, usesAfter]);
      }
      await tx.query(`INSERT INTO ride_entitlement_usage(entitlement_id, ride_id, credential_id, access_log_id, uses_before, uses_after, staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ent.id, ride.id, cred.id, log!.id, ent.uses_remaining, usesAfter, actor.staffId ?? null]);
      if (ticket) await tx.query('UPDATE tickets SET current_zone_id = $2 WHERE id = $1', [ticket.id, ride.zone_id]);
      await tx.query('UPDATE credentials SET last_used_at = now() WHERE id = $1', [cred.id]);
      // virtual queue: called guest boards
      await tx.query(`UPDATE ride_queues SET status = 'BOARDED', boarded_at = now() WHERE ride_id = $1 AND account_id = $2 AND status IN ('CALLED','WAITING')`, [ride.id, cred.account_id]);
    }
    await audit(tx, actor, { action: 'RIDE_ACCESS', entityType: 'ride', entityId: ride.code, branchId: ride.branch_id, after: { result, code, credential: cred?.code, ticket: ticket?.ticket_code } });

    // purchase offer
    let purchase: RideScanResult['purchase'] = null;
    let walletBalance: number | null = null;
    if (cred?.account_id) {
      const w = await one(tx, 'SELECT balance FROM wallet_accounts WHERE account_id = $1', [cred.account_id]);
      walletBalance = w ? Number(w.balance) : 0;
    }
    if (notIncluded && ride.addon_enabled && (sp?.payment_enabled ?? true) && cred) {
      const mctx = await memberContext(tx, cred.member_id);
      purchase = { available: true, price: await rideAddonPrice(tx, ride, mctx), methods: sp?.payment_methods ?? ['WALLET', 'PROMPTPAY', 'CARD', 'CASH'],
        entitlementType: ride.addon_entitlement_type, uses: ride.addon_uses };
    }
    const memberName = cred?.member_id ? await one(tx, `SELECT first_name || ' ' || last_name AS n FROM members WHERE id = $1`, [cred.member_id]) : null;
    const out: RideScanResult = {
      result, reasonCode: code, reason: code ? reason(code) : undefined, checks, ride: { id: ride.id, name: ride.name, code: ride.code },
      customer: memberName?.n ?? ticket?.guest_name ?? null, credentialId: cred?.id, credentialCode: cred?.code, accessLogId: log!.id,
      entitlement: ent ? { type: ent.type, usesRemaining: usesAfter, usesTotal: ent.uses_total, validUntil: ent.valid_until } : null, purchase, walletBalance,
    };
    after(() => {
      publish([rooms.ride(ride.id)], 'ride.scan', { ...out, scannedAt: log!.scanned_at, scanPointId: sp?.id ?? null });
      if (result === 'GRANTED') publish([rooms.account(cred.account_id)], 'entitlements.updated', { accountId: cred.account_id, rideId: ride.id });
      publish([rooms.branch(ride.branch_id)], 'dashboard.changed', { reason: 'ride' });
    });
    return out;
  });
}

/** Called from order fulfillment: create an add-on entitlement on the ticket/account. */
export async function grantAddonEntitlement(tx: Db, input: { order: any; ride: any; entitlementType: string; uses: number; ticketId?: string | null }) {
  const { order, ride } = input;
  if (!order.account_id) throw unprocessable('ACCOUNT_REQUIRED', 'Ride purchase requires a card / wristband');
  const date = businessDate();
  let ticketId = input.ticketId ?? null;
  if (!ticketId && order.credential_id) {
    const cred = await one(tx, 'SELECT * FROM credentials WHERE id = $1', [order.credential_id]);
    const ts = cred ? (await ticketsForCredential(tx, cred, date)).filter((t) => t.status === 'ACTIVE' && dateCheck(t, date).ok && t.branch_id === ride.branch_id) : [];
    ticketId = (ts.find((t) => t.presence === 'INSIDE') ?? ts[0])?.id ?? null;
  }
  const counted = input.entitlementType === 'ONE_TIME' || input.entitlementType === 'MULTI_USE';
  const uses = counted ? (input.entitlementType === 'ONE_TIME' ? 1 : input.uses) : null;
  // stack onto an existing active counted add-on of the same ride (keeps one row per ride)
  if (counted) {
    const existing = await one(tx, `SELECT id FROM ride_entitlements WHERE ride_id = $1 AND account_id = $2 AND source = 'ADDON' AND type IN ('ONE_TIME','MULTI_USE')
        AND ticket_id IS NOT DISTINCT FROM $3 AND valid_until > now() AND status IN ('ACTIVE','EXHAUSTED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [ride.id, order.account_id, ticketId]);
    if (existing) {
      await tx.query(`UPDATE ride_entitlements SET uses_remaining = uses_remaining + $2, uses_total = uses_total + $2, status = 'ACTIVE' WHERE id = $1`, [existing.id, uses]);
      return existing.id;
    }
  }
  const row = await one(tx, `INSERT INTO ride_entitlements(account_id, ticket_id, ride_id, branch_id, source, type, uses_total, uses_remaining, valid_from, valid_until, order_id)
      VALUES ($1,$2,$3,$4,'ADDON',$5,$6,$6,$7,$8,$9) RETURNING id`,
    [order.account_id, ticketId, ride.id, ride.branch_id, input.entitlementType, uses, startOfDay(date), endOfDay(date), order.id]);
  return row!.id;
}

/**
 * Buy ride access at the scanner. WALLET → instant (payment + entitlement + revalidation);
 * PROMPTPAY → dynamic QR, confirmed by gateway; CARD → EDC terminal; CASH → waits for operator confirmation.
 */
export async function purchaseAtRide(actor: Actor, rideId: string, input: { scan: string; method: 'WALLET' | 'PROMPTPAY' | 'CARD' | 'CASH'; scanPointId?: string | null; idempotencyKey?: string | null }) {
  const created = await withTx(async (tx, after) => {
    const ride = await rideById(tx, rideId);
    const sp = await resolveScanPoint(tx, rideId, input.scanPointId);
    if (sp && !sp.payment_enabled) throw unprocessable('PAYMENT_DISABLED', 'Payment not enabled at this scan point');
    if (sp && !sp.payment_methods.includes(input.method)) throw unprocessable('PAYMENT_METHOD_DISABLED', `${input.method} not accepted here`);
    const { credential: cred } = await resolveScan(tx, input.scan);
    if (cred.status !== 'ACTIVE') throw unprocessable(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status] ?? cred.status);
    if (!cred.account_id) throw unprocessable('ACCOUNT_REQUIRED', 'Card has no account');
    const mctx = await memberContext(tx, cred.member_id);
    const lines = await priceItems(tx, ride.branch_id, [{ type: 'RIDE_ADDON', rideId }], mctx);
    const { order, duplicate } = await createOrder(tx, actor, {
      branchId: ride.branch_id, type: 'RIDE_ADDON', channel: 'SCANNER', lines, memberCtx: mctx, accountId: cred.account_id, credentialId: cred.id,
      idempotencyKey: input.idempotencyKey ?? null, applyPromotions: false,
    });
    if (duplicate) return { order, cred, ride, sp, request: await one(tx, 'SELECT * FROM ride_purchase_requests WHERE order_id = $1', [order.id]) };
    if (input.method === 'WALLET') {
      await capturePayment(tx, actor, order.id, { method: 'WALLET', amount: order.total, credentialId: cred.id, channel: 'SCANNER', idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:pay` : null }, after);
      return { order, cred, ride, sp, request: null };
    }
    const request = await one(tx, `INSERT INTO ride_purchase_requests(ride_id, scan_point_id, credential_id, order_id, method, amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ride.id, sp?.id ?? null, cred.id, order.id, input.method, order.total]);
    let payment: any = null;
    if (input.method === 'PROMPTPAY') payment = await initiatePayment(tx, actor, order.id, 'PROMPTPAY', 'counter');
    if (input.method === 'CARD') {
      const { codes } = await import('../lib/codes.js');
      payment = await one(tx, `INSERT INTO payments(payment_no, order_id, method, provider, status, amount, channel, device_id) VALUES ($1,$2,'CARD','terminal','PENDING',$3,'SCANNER',$4) RETURNING *`,
        [await codes.payment(tx), order.id, order.total, actor.deviceId ?? null]);
    }
    if (payment) await tx.query('UPDATE ride_purchase_requests SET payment_id = $2 WHERE id = $1', [request!.id, payment.id]);
    after(() => publish([rooms.ride(ride.id)], 'ride.purchase.request', {
      requestId: request!.id, method: input.method, amount: order.total, credentialCode: cred.code, rideName: ride.name, status: 'PENDING',
    }));
    return { order, cred, ride, sp, request: { ...request, payment } };
  });

  if (input.method === 'WALLET') {
    // revalidate & consume on the same screen → "PURCHASE SUCCESSFUL / ACCESS GRANTED"
    const access = await scanAtRide(actor, rideId, input.scan, { scanPointId: input.scanPointId });
    const profile = await credentialProfile(pool, created.cred.id);
    return { status: 'PAID', orderNo: created.order.order_no, amount: created.order.total, access, walletBalance: profile.wallet?.balance ?? null };
  }
  if (input.method === 'CARD' && created.request?.payment) {
    // EDC terminal charge runs in background; result arrives via realtime "ride.purchase.updated"
    chargeOnTerminal(actor, created.request.payment.id).catch(async (err) => {
      await pool.query(`UPDATE ride_purchase_requests SET status = 'FAILED' WHERE id = $1`, [created.request.id]);
      publish([rooms.ride(rideId)], 'ride.purchase.updated', { requestId: created.request.id, status: 'FAILED', message: String(err?.message ?? err), credentialId: created.cred.id });
    });
  }
  return {
    status: 'PENDING', requestId: created.request?.id, orderNo: created.order.order_no, amount: created.order.total, method: input.method,
    qrPayload: created.request?.payment?.provider_payload?.qrPayload ?? null, paymentId: created.request?.payment?.id ?? null,
    message: input.method === 'CASH' ? 'WAITING FOR CASH PAYMENT' : input.method === 'CARD' ? 'กรุณาแตะ / เสียบบัตรที่เครื่อง EDC' : 'สแกน QR เพื่อชำระเงิน',
  };
}

/** Ride operator / cashier confirms cash received for a pending scanner purchase. */
export async function confirmCashAtRide(actor: Actor, requestId: string) {
  return withTx(async (tx, after) => {
    const req = await one(tx, 'SELECT * FROM ride_purchase_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!req) throw notFound('Purchase request');
    if (req.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', `Request is ${req.status}`);
    if (req.method !== 'CASH') throw badRequest('NOT_CASH', 'Not a cash request');
    await capturePayment(tx, actor, req.order_id, { method: 'CASH', amount: req.amount, tendered: req.amount, credentialId: req.credential_id, channel: 'SCANNER', idempotencyKey: `ridecash:${req.id}` }, after);
    await tx.query(`UPDATE ride_purchase_requests SET confirmed_by = $2 WHERE id = $1`, [requestId, actor.staffId]);
    return { ok: true, requestId };
  });
}

export async function cancelRidePurchase(actor: Actor, requestId: string) {
  return withTx(async (tx) => {
    const req = await one(tx, 'SELECT * FROM ride_purchase_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!req) throw notFound('Purchase request');
    if (req.status !== 'PENDING') throw conflict('REQUEST_NOT_PENDING', `Request is ${req.status}`);
    const { cancelOrder } = await import('./orders.js');
    await cancelOrder(tx, actor, req.order_id, 'Customer cancelled at scanner');
    publish([rooms.ride(req.ride_id)], 'ride.purchase.updated', { requestId, status: 'CANCELLED', credentialId: req.credential_id });
    return { ok: true };
  });
}

/** Operator manual approve (override a failed check) */
export async function manualRideApprove(actor: Actor, rideId: string, input: { scan?: string; accessLogId?: string; reason: string; approvalId?: string | null }) {
  return withTx(async (tx, after) => {
    const ride = await rideById(tx, rideId);
    const approval = await consumeApproval(tx, actor, input.approvalId, 'RIDE_OVERRIDE', ride.branch_id);
    let credId: string | null = null;
    if (input.accessLogId) credId = (await one(tx, 'SELECT credential_id FROM ride_access_logs WHERE id = $1 AND ride_id = $2', [input.accessLogId, rideId]))?.credential_id ?? null;
    else if (input.scan) credId = (await resolveScan(tx, input.scan, { allowCode: true })).credential.id;
    const cred = credId ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [credId]) : null;
    const log = await one(tx, `INSERT INTO ride_access_logs(ride_id, branch_id, credential_id, account_id, member_id, result, reason_code, reason, manual, operator_staff_id, device_id, entered_at)
        VALUES ($1,$2,$3,$4,$5,'GRANTED','MANUAL_APPROVE',$6,true,$7,$8,now()) RETURNING *`,
      [ride.id, ride.branch_id, cred?.id ?? null, cred?.account_id ?? null, cred?.member_id ?? null, input.reason, actor.staffId, actor.deviceId ?? null]);
    await audit(tx, actor, { action: 'RIDE_MANUAL_APPROVE', entityType: 'ride', entityId: ride.code, reason: input.reason, branchId: ride.branch_id, metadata: { approvalId: approval, credential: cred?.code } });
    after(() => publish([rooms.ride(ride.id)], 'ride.scan', { result: 'GRANTED', manual: true, ride: { id: ride.id, name: ride.name }, credentialCode: cred?.code, accessLogId: log!.id, reason: { th: 'อนุมัติโดยเจ้าหน้าที่', en: 'Manual approve' } }));
    return { ok: true, accessLogId: log!.id };
  });
}

/** Operator manual deny after a GRANTED scan (e.g. failed visual height check) → refunds the consumed use. */
export async function manualRideDeny(actor: Actor, rideId: string, accessLogId: string, reasonText: string) {
  return withTx(async (tx, after) => {
    const log = await one(tx, 'SELECT * FROM ride_access_logs WHERE id = $1 AND ride_id = $2 FOR UPDATE', [accessLogId, rideId]);
    if (!log) throw notFound('Access log');
    if (log.result !== 'GRANTED') throw conflict('NOT_GRANTED', 'Only granted scans can be denied');
    const usage = await one(tx, 'SELECT * FROM ride_entitlement_usage WHERE access_log_id = $1', [accessLogId]);
    if (usage && usage.uses_before != null) {
      await tx.query(`UPDATE ride_entitlements SET uses_remaining = uses_remaining + 1, status = 'ACTIVE' WHERE id = $1`, [usage.entitlement_id]);
    }
    await tx.query(`UPDATE ride_access_logs SET result = 'DENIED', reason_code = 'OPERATOR_DENIED', reason = $2, manual = true, operator_staff_id = $3, entered_at = NULL WHERE id = $1`,
      [accessLogId, reasonText, actor.staffId]);
    await audit(tx, actor, { action: 'RIDE_MANUAL_DENY', entityType: 'ride_access_log', entityId: accessLogId, reason: reasonText, branchId: log.branch_id });
    after(() => {
      publish([rooms.ride(rideId)], 'ride.scan', { result: 'DENIED', manual: true, accessLogId, reason: { th: reasonText, en: reasonText } });
      publish([rooms.account(log.account_id)], 'entitlements.updated', { accountId: log.account_id });
    });
    return { ok: true, useRestored: !!usage?.uses_before };
  });
}

export async function setRideStatus(actor: Actor, rideId: string, input: { status?: 'OPEN' | 'CLOSED' | 'MAINTENANCE' | 'TEMPORARILY_CLOSED'; entryPaused?: boolean; reason?: string }) {
  return withTx(async (tx, after) => {
    const ride = await one(tx, 'SELECT * FROM rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!ride) throw notFound('Ride');
    const updated = await one(tx, `UPDATE rides SET status = COALESCE($2, status), entry_paused = COALESCE($3, entry_paused) WHERE id = $1 RETURNING *`,
      [rideId, input.status ?? null, input.entryPaused ?? null]);
    await audit(tx, actor, { action: 'RIDE_STATUS', entityType: 'ride', entityId: ride.code, reason: input.reason, branchId: ride.branch_id,
      before: { status: ride.status, entryPaused: ride.entry_paused }, after: { status: updated!.status, entryPaused: updated!.entry_paused } });
    if (input.status && input.status !== 'OPEN' && ride.status === 'OPEN') {
      await notify({ branchId: ride.branch_id, type: 'RIDE_CLOSED', severity: 'WARNING', title: `${ride.name} ${input.status}`, message: input.reason ?? 'Ride status changed', data: { rideId } }, tx, after);
    }
    after(() => publish([rooms.ride(rideId), rooms.branch(ride.branch_id)], 'ride.status', { rideId, status: updated!.status, entryPaused: updated!.entry_paused }));
    return updated;
  });
}

export async function rideOperatorSnapshot(db: Db, rideId: string) {
  const ride = await rideById(db, rideId);
  const [queue, lastScans, pending, today] = await Promise.all([
    one(db, `SELECT COUNT(*) FILTER (WHERE status = 'WAITING')::int AS waiting, COUNT(*) FILTER (WHERE status = 'CALLED')::int AS called,
                    COALESCE(SUM(party_size) FILTER (WHERE status = 'WAITING'), 0)::int AS guests_waiting
               FROM ride_queues WHERE ride_id = $1 AND queue_date = $2`, [rideId, businessDate()]),
    query(db, `SELECT l.*, c.code AS credential_code, m.first_name || ' ' || m.last_name AS member_name, t.guest_name
                 FROM ride_access_logs l LEFT JOIN credentials c ON c.id = l.credential_id LEFT JOIN members m ON m.id = l.member_id LEFT JOIN tickets t ON t.id = l.ticket_id
                WHERE l.ride_id = $1 ORDER BY l.scanned_at DESC LIMIT 15`, [rideId]),
    query(db, `SELECT r.*, c.code AS credential_code FROM ride_purchase_requests r JOIN credentials c ON c.id = r.credential_id
                WHERE r.ride_id = $1 AND r.status = 'PENDING' ORDER BY r.created_at`, [rideId]),
    one(db, `SELECT COUNT(*) FILTER (WHERE result = 'GRANTED')::int AS guests_today,
                    COUNT(*) FILTER (WHERE result = 'GRANTED' AND scanned_at > now() - make_interval(mins => $2::int))::int AS current_cycle
               FROM ride_access_logs WHERE ride_id = $1 AND scanned_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`, [rideId, Math.ceil(Number(ride.cycle_minutes))]),
  ]);
  const waitMin = Math.ceil((queue!.guests_waiting / ride.capacity_per_cycle)) * Number(ride.cycle_minutes);
  return { ride, queue: { ...queue, estimatedWaitMin: waitMin }, lastScans, pendingPurchases: pending, guestsToday: today!.guests_today, currentCycle: today!.current_cycle };
}

export async function ridesDashboard(db: Db, branchId: string) {
  return query(db, `SELECT r.id, r.code, r.name, r.status, r.entry_paused, r.capacity_per_cycle, r.cycle_minutes, z.name AS zone_name,
      s.first_name AS operator_name,
      (SELECT COALESCE(SUM(party_size), 0)::int FROM ride_queues q WHERE q.ride_id = r.id AND q.status = 'WAITING' AND q.queue_date = $2) AS queue_guests,
      (SELECT COUNT(*)::int FROM ride_access_logs l WHERE l.ride_id = r.id AND l.result = 'GRANTED' AND l.scanned_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok') AS guests_today
    FROM rides r LEFT JOIN zones z ON z.id = r.zone_id LEFT JOIN staff s ON s.id = r.operator_staff_id
   WHERE r.branch_id = $1 ORDER BY r.sort, r.name`, [branchId, businessDate()]).then((rows) => rows.map((r: any) => ({
    ...r, wait_min: Math.ceil(r.queue_guests / r.capacity_per_cycle) * Number(r.cycle_minutes),
  })));
}

export async function rideHistory(db: Db, accountId: string, limit = 100) {
  return query(db, `SELECT l.id, l.result, l.reason, l.scanned_at, l.entered_at, l.manual, r.name AS ride_name, r.code AS ride_code, c.code AS credential_code, st.first_name AS operator
      FROM ride_access_logs l JOIN rides r ON r.id = l.ride_id LEFT JOIN credentials c ON c.id = l.credential_id LEFT JOIN staff st ON st.id = l.operator_staff_id
     WHERE l.account_id = $1 ORDER BY l.scanned_at DESC LIMIT $2`, [accountId, limit]);
}

export { confirmExternalPayment };
