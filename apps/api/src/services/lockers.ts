import { one, query, withTx, type Db } from '../db/pool.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { businessDate } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { lockerController } from '../hardware/locker/index.js';
import { audit } from './audit.js';
import { resolveScan, STATUS_MESSAGES } from './credentials.js';
import { capturePayment, createOrder, memberContext, priceItems } from './orders.js';
import { endOfDay } from './tickets.js';

/** Rent a locker: scan wristband → choose locker / size + duration → pay (wallet default) → session + unlock. */
export async function rentLocker(actor: Actor, input: { scan: string; rateId: string; lockerId?: string | null; method?: 'WALLET' | 'CASH' | 'CARD' | 'PROMPTPAY'; tendered?: number; idempotencyKey?: string | null }) {
  return withTx(async (tx, after) => {
    const { credential: cred } = await resolveScan(tx, input.scan, { allowCode: actor.type === 'STAFF' });
    if (cred.status !== 'ACTIVE') throw unprocessable(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status]);
    const rate = await one(tx, 'SELECT * FROM locker_rates WHERE id = $1 AND is_active', [input.rateId]);
    if (!rate) throw notFound('Locker rate');
    const active = await one(tx, `SELECT s.id, l.code FROM locker_sessions s JOIN lockers l ON l.id = s.locker_id WHERE s.credential_id = $1 AND s.status = 'ACTIVE'`, [cred.id]);
    if (active) throw conflict('LOCKER_ALREADY_RENTED', `มี Locker ${active.code} อยู่แล้ว`);
    const mctx = await memberContext(tx, cred.member_id);
    const lines = await priceItems(tx, rate.branch_id, [{ type: 'LOCKER', rateId: rate.id, lockerId: input.lockerId ?? null }], mctx);
    const { order, duplicate } = await createOrder(tx, actor, { branchId: rate.branch_id, type: 'LOCKER', channel: actor.type === 'STAFF' ? 'COUNTER' : 'KIOSK', lines, memberCtx: mctx,
      accountId: cred.account_id, credentialId: cred.id, idempotencyKey: input.idempotencyKey ?? null, applyPromotions: false });
    if (duplicate) return { orderNo: order.order_no, duplicate: true };
    // free locker benefit (membership)
    const method = input.method ?? 'WALLET';
    if (order.total > 0) {
      await capturePayment(tx, actor, order.id, { method, amount: order.total, tendered: input.tendered, credentialId: cred.id, idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:pay` : null }, after);
    } else {
      const { fulfillOrder } = await import('./orders.js');
      await tx.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [order.id]);
      await fulfillOrder(tx, actor, order.id, after);
    }
    const session = await one(tx, `SELECT s.*, l.code AS locker_code FROM locker_sessions s JOIN lockers l ON l.id = s.locker_id WHERE s.order_id = $1`, [order.id]);
    return { orderNo: order.order_no, session };
  });
}

/** Fulfillment handler for LOCKER items (called inside the payment transaction). */
export async function startLockerSession(tx: Db, actor: Actor, order: any, item: any, after: (cb: () => void) => void) {
  const meta = item.metadata ?? {};
  let locker: any;
  if (meta.lockerId) {
    locker = await one(tx, `SELECT * FROM lockers WHERE id = $1 AND branch_id = $2 FOR UPDATE`, [meta.lockerId, order.branch_id]);
    if (!locker || locker.status !== 'AVAILABLE') throw conflict('LOCKER_UNAVAILABLE', 'Locker is not available');
  } else {
    locker = await one(tx, `SELECT * FROM lockers WHERE branch_id = $1 AND size = $2 AND status = 'AVAILABLE' ORDER BY code LIMIT 1 FOR UPDATE SKIP LOCKED`, [order.branch_id, meta.size]);
    if (!locker) throw conflict('NO_LOCKER_AVAILABLE', `ไม่มี Locker ขนาด ${meta.size} ว่าง`);
  }
  const expireAt = meta.durationMinutes ? new Date(Date.now() + meta.durationMinutes * 60_000) : endOfDay(businessDate());
  const cred = order.credential_id ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [order.credential_id]) : null;
  if (!cred) throw unprocessable('CREDENTIAL_REQUIRED', 'Locker requires a card / wristband');
  const session = await one(tx, `INSERT INTO locker_sessions(locker_id, account_id, credential_id, member_id, rate_id, order_id, amount, expire_at, staff_id, open_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING *`,
    [locker.id, order.account_id, cred.id, order.member_id, meta.rateId, order.id, item.total, expireAt, actor.staffId ?? null]);
  await tx.query(`UPDATE lockers SET status = 'OCCUPIED' WHERE id = $1`, [locker.id]);
  after(async () => {
    await lockerController(locker.controller_type, locker.controller_config).unlock(locker.code).catch((e) => console.error('locker unlock failed', e));
    publish([rooms.account(order.account_id), rooms.branch(order.branch_id)], 'locker.updated', { lockerId: locker.id, code: locker.code, status: 'OCCUPIED', sessionId: session!.id });
  });
  return session;
}

/** Same wristband opens the locker. */
export async function openLocker(actor: Actor, input: { scan: string; lockerCode?: string }) {
  return withTx(async (tx) => {
    const { credential: cred } = await resolveScan(tx, input.scan, { allowCode: actor.type === 'STAFF' });
    if (cred.status !== 'ACTIVE') throw unprocessable(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status]);
    const s = await one(tx, `SELECT s.*, l.code, l.controller_type, l.controller_config FROM locker_sessions s JOIN lockers l ON l.id = s.locker_id
        WHERE s.account_id = $1 AND s.status = 'ACTIVE' AND ($2::text IS NULL OR l.code = $2) ORDER BY s.start_at DESC LIMIT 1 FOR UPDATE OF s`, [cred.account_id, input.lockerCode ?? null]);
    if (!s) throw notFound('Active locker for this card');
    if (new Date(s.expire_at) < new Date()) throw unprocessable('LOCKER_EXPIRED', 'Locker rental expired — please see staff');
    await lockerController(s.controller_type, s.controller_config).unlock(s.code);
    await tx.query('UPDATE locker_sessions SET open_count = open_count + 1 WHERE id = $1', [s.id]);
    await audit(tx, actor, { action: 'LOCKER_OPEN', entityType: 'locker', entityId: s.code });
    return { lockerCode: s.code, expireAt: s.expire_at };
  });
}

export async function endLockerSession(actor: Actor, sessionId: string) {
  return withTx(async (tx) => {
    const s = await one(tx, 'SELECT * FROM locker_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!s) throw notFound('Locker session');
    if (s.status === 'ENDED') return s;
    await tx.query(`UPDATE locker_sessions SET status = 'ENDED', ended_at = now() WHERE id = $1`, [sessionId]);
    const l = await one(tx, `UPDATE lockers SET status = 'AVAILABLE' WHERE id = $1 RETURNING *`, [s.locker_id]);
    await audit(tx, actor, { action: 'LOCKER_END', entityType: 'locker', entityId: l.code });
    publish([rooms.account(s.account_id), rooms.branch(l.branch_id)], 'locker.updated', { lockerId: l.id, code: l.code, status: 'AVAILABLE' });
    return { ok: true };
  });
}

export async function lockerBoard(db: Db, branchId: string) {
  return query(db, `SELECT l.*, z.name AS zone_name, s.id AS session_id, s.expire_at, s.start_at, c.code AS credential_code,
      (s.expire_at < now()) AS overdue
    FROM lockers l LEFT JOIN zones z ON z.id = l.zone_id
    LEFT JOIN locker_sessions s ON s.locker_id = l.id AND s.status IN ('ACTIVE','EXPIRED')
    LEFT JOIN credentials c ON c.id = s.credential_id
   WHERE l.branch_id = $1 ORDER BY l.bank NULLS LAST, l.code`, [branchId]);
}
