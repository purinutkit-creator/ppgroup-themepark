import { one, query, type Db } from '../db/pool.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { gateway } from '../hardware/payment/index.js';
import { audit } from './audit.js';
import { consumeApproval } from './approvals.js';
import { postLedger, walletForAccount } from './wallet.js';
import { journal, categoryOfOrder } from './transactions.js';
import { postPoints } from './points.js';
import { moveStock } from './inventory.js';
import { openShiftId } from './orders.js';
import { getSetting } from './settings.js';
import { resolveScan } from './credentials.js';

export interface RefundInput {
  orderId: string;
  amount?: number;                  // partial amount; default = full refundable
  items?: Array<{ orderItemId: string; qty: number }>;
  method: 'CASH' | 'ORIGINAL' | 'WALLET' | 'BANK_TRANSFER';
  reason: string;
  approvalId?: string | null;
  void?: boolean;                   // same-day void (reverses everything)
  idempotencyKey?: string | null;
}

/**
 * Refund / void a paid order. Reverses entitlements (tickets, ride rights, top-ups, memberships),
 * returns stock, reverses points proportionally and pays back via cash / wallet / original method.
 */
export async function refundOrder(tx: Db, actor: Actor, input: RefundInput, after: (cb: () => void) => void) {
  if (input.idempotencyKey) {
    const dup = await one(tx, 'SELECT * FROM refunds WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (dup) return dup;
  }
  const order = await one(tx, 'SELECT o.*, s.type AS store_type FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE o.id = $1 FOR UPDATE OF o', [input.orderId]);
  if (!order) throw notFound('Order');
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.status)) throw conflict('NOT_REFUNDABLE', `Order is ${order.status}`);
  const approval = await consumeApproval(tx, actor, input.approvalId, input.void ? 'VOID' : 'REFUND', order.branch_id);
  const items = await query(tx, 'SELECT * FROM order_items WHERE order_id = $1 FOR UPDATE', [order.id]);
  const refundable = order.paid_total - order.refunded_total;

  // item-level selection
  let amount = input.amount ?? refundable;
  const affected: Array<{ item: any; qty: number }> = [];
  if (input.items?.length) {
    amount = 0;
    for (const sel of input.items) {
      const it = items.find((i: any) => i.id === sel.orderItemId);
      if (!it) throw badRequest('BAD_ITEM', 'Item not in order');
      if (sel.qty <= 0 || sel.qty > it.qty - it.refunded_qty) throw badRequest('BAD_QTY', `Cannot refund ${sel.qty} × ${it.name}`);
      affected.push({ item: it, qty: sel.qty });
      amount += Math.round((it.total / it.qty) * sel.qty);
    }
  } else if (!input.amount || input.amount >= refundable) {
    for (const it of items) if (it.qty - it.refunded_qty > 0) affected.push({ item: it, qty: it.qty - it.refunded_qty });
  }
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('INVALID_AMOUNT', 'Refund amount must be positive');
  if (amount > refundable) throw unprocessable('REFUND_EXCEEDS', `Maximum refundable ${refundable / 100} THB`);

  // ticket policy (only enforced for non-void refunds)
  if (!input.void && (order.type === 'BOOKING' || order.type === 'TICKET')) {
    const pk = await query(tx, `SELECT DISTINCT p.refund_policy, p.refund_cutoff_hours, t.visit_date, t.entry_count FROM tickets t JOIN packages p ON p.id = t.package_id WHERE t.order_id = $1`, [order.id]);
    for (const p of pk) {
      if (p.entry_count > 0) throw unprocessable('TICKET_USED', 'Used tickets cannot be refunded');
      if (p.refund_policy === 'NON_REFUNDABLE' && !approval) throw unprocessable('NON_REFUNDABLE', 'Package is non-refundable (manager approval required to override)');
      if (p.refund_policy.endsWith('BEFORE_VISIT')) {
        const cutoff = new Date(`${p.visit_date}T00:00:00+07:00`).getTime() - p.refund_cutoff_hours * 3600_000;
        if (Date.now() > cutoff && !approval) throw unprocessable('REFUND_WINDOW_CLOSED', `Refunds close ${p.refund_cutoff_hours}h before visit`);
      }
    }
  }

  // ---- reverse what was granted ----
  for (const { item, qty } of affected) {
    await tx.query('UPDATE order_items SET refunded_qty = refunded_qty + $2 WHERE id = $1', [item.id, qty]);
    if (item.item_type === 'PRODUCT' && item.metadata?.trackStock && order.store_id) {
      await moveStock(tx, { productId: item.product_id, storeId: order.store_id, delta: qty, type: 'RETURN', orderId: order.id, staffId: actor.staffId, reason: input.reason, branchId: order.branch_id }, after);
    }
    if (item.item_type === 'TOPUP' && order.account_id) {
      const w = await walletForAccount(tx, order.account_id);
      await postLedger(tx, { walletId: w.id, type: 'REVERSAL', debit: Math.round((item.total / item.qty) * qty), referenceType: 'REFUND', referenceId: order.order_no, orderId: order.id,
        staffId: actor.staffId, branchId: order.branch_id, note: input.reason, idempotencyKey: `topup-rev:${item.id}:${item.refunded_qty + qty}` }, after);
    }
    if (item.item_type === 'RIDE_ADDON') {
      await tx.query(`UPDATE ride_entitlements SET status = 'REVOKED' WHERE order_id = $1 AND ride_id = $2 AND status IN ('ACTIVE','EXHAUSTED')`, [order.id, item.ride_id]);
    }
    if (item.item_type === 'MEMBERSHIP') {
      await tx.query(`UPDATE memberships SET status = 'CANCELLED' WHERE order_id = $1`, [order.id]);
      if (order.member_id) await tx.query(`UPDATE members SET tier_id = NULL WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE member_id = $1 AND status = 'ACTIVE')`, [order.member_id]);
    }
    if (item.item_type === 'LOCKER') {
      const s = await one(tx, `UPDATE locker_sessions SET status = 'ENDED', ended_at = now() WHERE order_id = $1 AND status = 'ACTIVE' RETURNING locker_id`, [order.id]);
      if (s) await tx.query(`UPDATE lockers SET status = 'AVAILABLE' WHERE id = $1`, [s.locker_id]);
    }
  }
  const fullRefund = order.refunded_total + amount >= order.paid_total;
  if ((order.type === 'BOOKING' || order.type === 'TICKET') && (fullRefund || affected.some((a) => a.item.item_type === 'PACKAGE'))) {
    // cancel unused tickets (proportional to refunded package qty, or all on full refund)
    const pkgQty = fullRefund ? 10_000 : affected.filter((a) => a.item.item_type === 'PACKAGE').reduce((s, a) => s + a.qty, 0);
    const ts = await query(tx, `SELECT id FROM tickets WHERE order_id = $1 AND status IN ('ACTIVE','PAID','UNPAID') AND entry_count = 0 ORDER BY ticket_code DESC LIMIT $2`, [order.id, pkgQty]);
    for (const t of ts) {
      await tx.query(`UPDATE tickets SET status = 'REFUNDED' WHERE id = $1`, [t.id]);
      await tx.query(`UPDATE ride_entitlements SET status = 'REVOKED' WHERE ticket_id = $1`, [t.id]);
      await tx.query(`UPDATE credentials SET status = 'CLOSED', status_reason = 'Ticket refunded' WHERE type = 'QR_TICKET' AND id IN (SELECT credential_id FROM credential_links WHERE ticket_id = $1)`, [t.id]);
    }
    if (fullRefund) await tx.query(`UPDATE bookings SET status = 'REFUNDED' WHERE order_id = $1`, [order.id]);
  }

  // ---- pay back ----
  const shiftId = await openShiftId(tx, actor);
  if (input.method === 'CASH' && !shiftId && actor.type === 'STAFF' && (await getSetting('shift', order.branch_id)).requireForCash) {
    throw unprocessable('SHIFT_REQUIRED', 'Open a shift to pay out cash');
  }
  let methodUsed = input.method;
  let payment: any = null;
  if (input.method === 'ORIGINAL') {
    payment = await one(tx, `SELECT * FROM payments WHERE order_id = $1 AND status IN ('PAID','PARTIALLY_REFUNDED') AND amount - refunded_amount >= $2 ORDER BY amount DESC LIMIT 1`, [order.id, amount]);
    if (!payment) throw unprocessable('NO_SINGLE_PAYMENT', 'No single payment covers this amount — choose CASH / WALLET');
    if (payment.method === 'WALLET') methodUsed = 'WALLET';
    else if (payment.method === 'CASH') methodUsed = 'CASH';
    else if (payment.method === 'POINTS') {
      const cfg = await getSetting('points', order.branch_id);
      await postPoints(tx, { memberId: order.member_id, type: 'REVERSAL', points: Math.floor(amount / cfg.redeemValue), referenceType: 'REFUND', referenceId: order.order_no, staffId: actor.staffId }, after);
    } else if (payment.provider && !['counter', 'terminal'].includes(payment.provider) && payment.reference) {
      const res = await gateway(payment.provider === 'promptpay-manual' ? 'promptpay-manual' : undefined).refund(payment.reference, amount);
      if (!res.ok) throw unprocessable('GATEWAY_REFUND_FAILED', 'Payment gateway refund failed');
    }
    await tx.query(`UPDATE payments SET refunded_amount = refunded_amount + $2, status = CASE WHEN refunded_amount + $2 >= amount THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END WHERE id = $1`, [payment.id, amount]);
  }
  let ledgerId: string | null = null;
  if (methodUsed === 'WALLET') {
    if (!order.account_id) throw unprocessable('NO_WALLET', 'Order has no customer account for wallet refund');
    const w = await walletForAccount(tx, order.account_id);
    const { entry } = await postLedger(tx, { walletId: w.id, type: 'REFUND', credit: amount, referenceType: 'REFUND', referenceId: order.order_no, orderId: order.id,
      staffId: actor.staffId, branchId: order.branch_id, note: input.reason, idempotencyKey: input.idempotencyKey ? `refund:${input.idempotencyKey}` : null }, after);
    ledgerId = entry.id;
  }
  // points earned on the refunded part
  if (order.member_id && order.points_earned > 0) {
    const back = Math.floor((order.points_earned * amount) / order.paid_total);
    if (back > 0) {
      const m = await one(tx, 'SELECT points FROM members WHERE id = $1', [order.member_id]);
      const take = Math.min(back, m.points);
      if (take > 0) await postPoints(tx, { memberId: order.member_id, type: 'REVERSAL', points: -take, referenceType: 'REFUND', referenceId: order.order_no, staffId: actor.staffId }, after);
    }
  }
  const refundNo = await codes.refund(tx);
  const refund = await one(tx, `INSERT INTO refunds(refund_no, order_id, payment_id, type, scope, amount, method, reason, status, items, staff_id, shift_id, approval_id, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',$9,$10,$11,$12,$13) RETURNING *`,
    [refundNo, order.id, payment?.id ?? null, fullRefund ? 'FULL' : 'PARTIAL', order.type === 'BOOKING' || order.type === 'TICKET' ? 'TICKET' : order.type === 'TOPUP' ? 'WALLET' : 'POS',
     amount, input.method, input.reason, JSON.stringify(affected.map((a) => ({ orderItemId: a.item.id, name: a.item.name, qty: a.qty }))), actor.staffId ?? null, shiftId, approval, input.idempotencyKey ?? null]);
  const status = fullRefund ? (input.void ? 'VOID' : 'REFUNDED') : 'PARTIALLY_REFUNDED';
  await tx.query(`UPDATE orders SET refunded_total = refunded_total + $2, status = $3, voided_at = CASE WHEN $3 = 'VOID' THEN now() ELSE voided_at END,
      void_reason = CASE WHEN $3 = 'VOID' THEN $4 ELSE void_reason END, kitchen_status = CASE WHEN $3 IN ('VOID','REFUNDED') AND kitchen_status IN ('NEW','PREPARING') THEN 'CANCELLED' ELSE kitchen_status END
      WHERE id = $1`, [order.id, amount, status, input.reason]);
  await journal(tx, { branchId: order.branch_id, type: input.void ? 'VOID' : 'REFUND', category: categoryOfOrder(order.type, order.store_type), method: methodUsed === 'ORIGINAL' ? payment?.method : methodUsed,
    direction: methodUsed === 'WALLET' ? 'NONE' : 'OUT', amount, orderId: order.id, refundId: refund!.id, walletLedgerId: ledgerId, accountId: order.account_id, memberId: order.member_id,
    staffId: actor.staffId, storeId: order.store_id, shiftId, reference: order.order_no, metadata: { reason: input.reason } });
  await audit(tx, actor, { action: input.void ? 'ORDER_VOID' : 'REFUND', entityType: 'order', entityId: order.order_no, reason: input.reason, branchId: order.branch_id,
    before: { status: order.status, refunded: order.refunded_total }, after: { status, amount, method: input.method, refundNo }, metadata: { approvalId: approval } });
  after(() => publish([rooms.branch(order.branch_id), rooms.account(order.account_id)], 'order.refunded', { orderId: order.id, orderNo: order.order_no, amount, status }));
  return refund;
}

/** Remaining wallet balance at exit according to wallet policy (refund at counter / partial / transfer to member / keep). */
export async function walletCashOut(tx: Db, actor: Actor, input: { scan: string; amount?: number; method: 'CASH' | 'TRANSFER_TO_MEMBER'; memberId?: string; reason?: string }, after: (cb: () => void) => void) {
  const { credential: cred } = await resolveScan(tx, input.scan, { allowCode: true });
  if (!cred.account_id) throw unprocessable('NO_WALLET', 'Card has no wallet');
  const cfg = await getSetting('wallet', cred.branch_id ?? actor.branchId, tx);
  if (cfg.remainingBalancePolicy === 'NON_REFUNDABLE' || cfg.remainingBalancePolicy === 'KEEP_FOR_NEXT_VISIT') {
    throw unprocessable('WALLET_NON_REFUNDABLE', `Wallet policy: ${cfg.remainingBalancePolicy}`);
  }
  const w = await walletForAccount(tx, cred.account_id);
  const balance = Number(w.balance);
  const amount = input.amount ?? balance;
  if (amount <= 0 || amount > balance) throw unprocessable('INVALID_AMOUNT', `Balance is ${balance / 100} THB`);
  if (input.method === 'TRANSFER_TO_MEMBER') {
    if (!input.memberId) throw badRequest('MEMBER_REQUIRED', 'Select member');
    const { ensureMemberAccount } = await import('./accounts.js');
    const { transferAll } = await import('./wallet.js');
    const target = await ensureMemberAccount(tx, input.memberId);
    const moved = await transferAll(tx, cred.account_id, target, { staffId: actor.staffId, branchId: cred.branch_id, reason: input.reason ?? 'Transfer to member' }, after);
    await audit(tx, actor, { action: 'WALLET_TRANSFER_TO_MEMBER', entityType: 'credential', entityId: cred.code, after: { amount: moved, memberId: input.memberId } });
    return { method: 'TRANSFER_TO_MEMBER', amount: moved };
  }
  const fee = cfg.remainingBalancePolicy === 'PARTIAL_REFUND' ? Math.round((amount * cfg.refundFeePercent) / 100) : 0;
  const shiftId = await openShiftId(tx, actor);
  if (!shiftId && (await getSetting('shift', cred.branch_id)).requireForCash) throw unprocessable('SHIFT_REQUIRED', 'Open a shift to pay out cash');
  const { entry } = await postLedger(tx, { walletId: w.id, type: 'CASH_OUT', debit: amount, referenceType: 'CASH_OUT', referenceId: cred.code, credentialId: cred.id,
    memberId: cred.member_id, staffId: actor.staffId, branchId: cred.branch_id, note: fee ? `fee ${fee / 100}` : input.reason }, after);
  await journal(tx, { branchId: cred.branch_id ?? actor.branchId!, type: 'WALLET_CASH_OUT', category: 'WALLET', method: 'CASH', direction: 'OUT', amount: amount - fee,
    walletLedgerId: entry.id, accountId: cred.account_id, memberId: cred.member_id, credentialId: cred.id, staffId: actor.staffId, shiftId, metadata: { fee } });
  await audit(tx, actor, { action: 'WALLET_CASH_OUT', entityType: 'credential', entityId: cred.code, after: { amount, fee, paid: amount - fee } });
  return { method: 'CASH', amount, fee, paidOut: amount - fee, balanceAfter: entry.balance_after };
}

/** Manual wallet adjustment (requires permission + approval). */
export async function adjustWallet(tx: Db, actor: Actor, input: { credentialId: string; direction: 'CREDIT' | 'DEBIT'; amount: number; reason: string; approvalId?: string | null }, after: (cb: () => void) => void) {
  const cred = await one(tx, 'SELECT * FROM credentials WHERE id = $1', [input.credentialId]);
  if (!cred?.account_id) throw notFound('Credential wallet');
  const approval = await consumeApproval(tx, actor, input.approvalId, 'WALLET_ADJUST', cred.branch_id);
  const w = await walletForAccount(tx, cred.account_id);
  const { entry } = await postLedger(tx, { walletId: w.id, type: 'ADJUSTMENT', [input.direction === 'CREDIT' ? 'credit' : 'debit']: input.amount, referenceType: 'ADJUSTMENT',
    referenceId: approval ?? undefined, credentialId: cred.id, memberId: cred.member_id, staffId: actor.staffId, branchId: cred.branch_id ?? actor.branchId, note: input.reason }, after);
  await journal(tx, { branchId: cred.branch_id ?? actor.branchId!, type: 'WALLET_ADJUST', category: 'WALLET', method: 'ADJUSTMENT', direction: 'NONE', amount: input.amount,
    walletLedgerId: entry.id, accountId: cred.account_id, memberId: cred.member_id, credentialId: cred.id, staffId: actor.staffId, metadata: { direction: input.direction, reason: input.reason } });
  await audit(tx, actor, { action: 'WALLET_ADJUST', entityType: 'wallet', entityId: w.id, reason: input.reason, before: { balance: entry.balance_before }, after: { balance: entry.balance_after }, metadata: { approvalId: approval } });
  return entry;
}
