import { one, query, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { gateway, terminal } from '../hardware/payment/index.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { confirmExternalPayment } from './orders.js';

export type ExternalMethod = 'PROMPTPAY' | 'CARD' | 'DEBIT' | 'MOBILE_BANKING' | 'BANK_TRANSFER';

/**
 * Start an asynchronous payment for the outstanding amount of an order (online checkout,
 * PromptPay at ride scanner / kiosk). Returns QR payload or checkout URL. Re-uses an
 * existing pending payment of the same method (prevents duplicate charges on retries).
 */
export async function initiatePayment(tx: Db, actor: Actor, orderId: string, method: ExternalMethod, channel: 'online' | 'counter' = 'online') {
  const order = await one(tx, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw notFound('Order');
  if (!['PENDING', 'PARTIALLY_PAID'].includes(order.status)) throw conflict('ORDER_NOT_PAYABLE', `Order is ${order.status}`);
  const cfg = await getSetting('payments', order.branch_id);
  const m = cfg.methods[method];
  if (!m?.enabled || !m[channel]) throw unprocessable('PAYMENT_METHOD_DISABLED', `${method} is not available`);
  const amount = order.total - order.paid_total;
  if (amount <= 0) throw conflict('ALREADY_PAID', 'Order already paid');
  const existing = await one(tx, `SELECT * FROM payments WHERE order_id = $1 AND method = $2 AND status IN ('PENDING','WAITING_VERIFICATION')
      AND amount = $3 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`, [orderId, method, amount]);
  if (existing) return existing;
  // cancel stale pending payments of other methods (customer switched method)
  await tx.query(`UPDATE payments SET status = 'CANCELLED' WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
  const g = gateway(method === 'BANK_TRANSFER' ? 'promptpay-manual' : undefined);
  const paymentNo = await codes.payment(tx);
  const pay = await one(tx, `INSERT INTO payments(payment_no, order_id, method, provider, status, amount, channel, staff_id, device_id, expires_at)
      VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8, now() + make_interval(mins => $9)) RETURNING *`,
    [paymentNo, orderId, method, g.name, amount, channel.toUpperCase(), actor.staffId ?? null, actor.deviceId ?? null, cfg.onlinePaymentTimeoutMin]);
  const charge = await g.createCharge({ paymentId: pay!.id, paymentNo, amount, method, description: `${order.order_no}` });
  return one(tx, `UPDATE payments SET reference = $2, provider_payload = $3, expires_at = $4 WHERE id = $1 RETURNING *`,
    [pay!.id, charge.reference, JSON.stringify({ qrPayload: charge.qrPayload ?? null, checkoutUrl: charge.checkoutUrl ?? null }), charge.expiresAt]);
}

/** Customer uploaded a transfer slip / pressed "ตรวจสอบการชำระเงิน" → verification request (realtime to Verification Center). */
export async function submitSlip(tx: Db, actor: Actor, paymentId: string, input: { slipPath?: string | null; slipReference?: string | null; paidTime?: string | null; note?: string | null },
  afterCommit: (cb: () => void) => void) {
  const pay = await one(tx, 'SELECT p.*, o.branch_id, o.order_no FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 FOR UPDATE OF p', [paymentId]);
  if (!pay) throw notFound('Payment');
  if (!['PROMPTPAY', 'BANK_TRANSFER', 'MOBILE_BANKING'].includes(pay.method)) throw badRequest('SLIP_NOT_SUPPORTED', 'Slip verification only for PromptPay / transfer');
  if (pay.status === 'PAID') throw conflict('ALREADY_PAID', 'Payment already confirmed');
  if (!['PENDING', 'WAITING_VERIFICATION'].includes(pay.status)) throw conflict('PAYMENT_NOT_PENDING', `Payment is ${pay.status}`);
  await tx.query(`UPDATE payment_verification_requests SET status = 'NEW_SLIP_REQUESTED' WHERE payment_id = $1 AND status = 'WAITING'`, [paymentId]);
  const booking = await one(tx, 'SELECT id, booking_no, customer_name FROM bookings WHERE order_id = $1', [pay.order_id]);
  const req = await one(tx, `INSERT INTO payment_verification_requests(payment_id, order_id, booking_id, branch_id, amount_expected, method, slip_path, slip_reference, paid_time, customer_note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [paymentId, pay.order_id, booking?.id ?? null, pay.branch_id, pay.amount, pay.method, input.slipPath ?? null, input.slipReference ?? null, input.paidTime ?? null, input.note ?? null]);
  // a slip proves intent to pay → never let the payment expire while it is being verified
  await tx.query(`UPDATE payments SET status = 'WAITING_VERIFICATION', expires_at = NULL WHERE id = $1`, [paymentId]);
  if (booking) await tx.query(`UPDATE bookings SET status = 'PENDING_VERIFICATION', expires_at = NULL WHERE id = $1 AND status IN ('PENDING_PAYMENT','RESERVED')`, [booking.id]);
  await audit(tx, actor, { action: 'PAYMENT_SLIP_SUBMITTED', entityType: 'payment', entityId: pay.payment_no, branchId: pay.branch_id });
  afterCommit(() => {
    publish([rooms.payverify(pay.branch_id)], 'payverify.new', { requestId: req!.id, bookingNo: booking?.booking_no, customer: booking?.customer_name, amount: pay.amount, method: pay.method });
    if (booking) publish([rooms.booking(booking.id)], 'booking.updated', { bookingId: booking.id, status: 'PENDING_VERIFICATION', paymentStatus: 'WAITING_VERIFICATION' });
  });
  return req;
}

export async function listVerificationRequests(db: Db, branchId: string, status = 'WAITING') {
  return query(db, `SELECT r.*, b.booking_no, b.customer_name, b.phone, b.visit_date, p.payment_no, p.reference AS payment_reference, o.order_no
      FROM payment_verification_requests r JOIN payments p ON p.id = r.payment_id JOIN orders o ON o.id = r.order_id
      LEFT JOIN bookings b ON b.id = r.booking_id
     WHERE r.branch_id = $1 AND ($2 = 'ALL' OR r.status = $2) ORDER BY r.created_at DESC LIMIT 200`, [branchId, status]);
}

/** Verification Center decision. APPROVE → payment PAID → booking CONFIRMED → customer screen updates live. */
export async function reviewVerification(actor: Actor, requestId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_NEW_SLIP', note?: string) {
  const req = await withTx(async (tx) => {
    const r = await one(tx, 'SELECT * FROM payment_verification_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!r) throw notFound('Verification request');
    if (r.status !== 'WAITING') throw conflict('ALREADY_REVIEWED', `Request already ${r.status}`);
    const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'NEW_SLIP_REQUESTED';
    await tx.query(`UPDATE payment_verification_requests SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE id = $1`, [requestId, status, actor.staffId, note ?? null]);
    if (decision !== 'APPROVE') {
      await tx.query(`UPDATE payments SET status = $2 WHERE id = $1`, [r.payment_id, decision === 'REJECT' ? 'FAILED' : 'PENDING']);
      if (r.booking_id) await tx.query(`UPDATE bookings SET status = 'PENDING_PAYMENT' WHERE id = $1 AND status = 'PENDING_VERIFICATION'`, [r.booking_id]);
    }
    await audit(tx, actor, { action: `PAYMENT_VERIFY_${decision}`, entityType: 'payment_verification', entityId: requestId, reason: note, branchId: r.branch_id });
    return { ...r, status };
  });
  if (decision === 'APPROVE') {
    await confirmExternalPayment(actor, req.payment_id, { payload: { verifiedBy: actor.staffId, requestId } });
  } else {
    if (req.booking_id) publish([rooms.booking(req.booking_id)], 'booking.updated', { bookingId: req.booking_id, status: 'PENDING_PAYMENT', paymentStatus: decision === 'REJECT' ? 'REJECTED' : 'NEW_SLIP_REQUESTED', note });
    if (decision === 'REJECT') {
      await notify({ branchId: req.branch_id, type: 'PAYMENT_FAILED', severity: 'WARNING', title: 'Payment rejected', message: `Slip rejected for ${req.amount_expected / 100} THB`, data: { requestId } });
    }
  }
  publish([rooms.payverify(req.branch_id)], 'payverify.updated', { requestId, status: req.status });
  return req;
}

/** EDC card terminal flow (ride scanner / kiosk): charge asynchronously, then confirm. */
export async function chargeOnTerminal(actor: Actor, paymentId: string) {
  const pay = await one((await import('../db/pool.js')).pool, 'SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!pay) throw notFound('Payment');
  const res = await terminal().charge({ amount: pay.amount, paymentNo: pay.payment_no, deviceId: actor.deviceId });
  if (!res.approved) {
    await (await import('../db/pool.js')).pool.query(`UPDATE payments SET status = 'FAILED', provider_payload = provider_payload || $2 WHERE id = $1`, [paymentId, JSON.stringify({ terminal: res })]);
    throw unprocessable('CARD_DECLINED', res.message ?? 'Card declined');
  }
  return confirmExternalPayment(actor, paymentId, { reference: res.reference, payload: { terminal: res } });
}
