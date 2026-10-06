import { one, query, type Db } from '../db/pool.js';
import { conflict, notFound, unprocessable, forbidden } from '../lib/errors.js';
import { codes } from '../lib/codes.js';
import type { Actor } from '../middleware/auth.js';
import { can } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { consumeApproval } from './approvals.js';
import { journal } from './transactions.js';

export async function openShift(tx: Db, actor: Actor, input: { openingCash: number; storeId?: string | null; branchId: string }) {
  const existing = await one(tx, `SELECT shift_no FROM shifts WHERE staff_id = $1 AND status = 'OPEN'`, [actor.staffId]);
  if (existing) throw conflict('SHIFT_ALREADY_OPEN', `Shift ${existing.shift_no} is already open`);
  const no = await codes.shift(tx);
  const s = await one(tx, `INSERT INTO shifts(shift_no, branch_id, store_id, staff_id, device_id, opening_cash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [no, input.branchId, input.storeId ?? null, actor.staffId, actor.deviceId ?? null, input.openingCash]);
  await audit(tx, actor, { action: 'SHIFT_OPEN', entityType: 'shift', entityId: no, after: { openingCash: input.openingCash }, branchId: input.branchId });
  return s;
}

/** Expected Cash = Opening + Cash Sales + Cash Top-up + Cash In − Refunds − Cash Out */
export async function shiftSummary(db: Db, shiftId: string) {
  const s = await one(db, `SELECT s.*, st.first_name, st.employee_code, so.name AS store_name FROM shifts s JOIN staff st ON st.id = s.staff_id LEFT JOIN stores so ON so.id = s.store_id WHERE s.id = $1`, [shiftId]);
  if (!s) throw notFound('Shift');
  const t = await one(db, `SELECT
      COALESCE(SUM(amount) FILTER (WHERE type = 'SALE' AND method = 'CASH'), 0) AS cash_sales,
      COALESCE(SUM(amount) FILTER (WHERE type = 'TOPUP' AND method = 'CASH'), 0) AS cash_topups,
      COALESCE(SUM(amount) FILTER (WHERE type IN ('REFUND','VOID','WALLET_CASH_OUT') AND method = 'CASH'), 0) AS cash_refunds,
      COALESCE(SUM(amount) FILTER (WHERE type = 'CASH_IN'), 0) AS cash_in,
      COALESCE(SUM(amount) FILTER (WHERE type = 'CASH_OUT'), 0) AS cash_out,
      COALESCE(SUM(amount) FILTER (WHERE type IN ('SALE','TOPUP') AND direction = 'IN'), 0) AS total_collected,
      COUNT(*) FILTER (WHERE type IN ('SALE','TOPUP')) AS txn_count
    FROM transactions WHERE shift_id = $1`, [shiftId]);
  const byMethod = await query(db, `SELECT method, type, COUNT(*)::int AS count, SUM(amount) AS amount FROM transactions WHERE shift_id = $1 GROUP BY method, type ORDER BY method`, [shiftId]);
  const expected = s.opening_cash + t.cash_sales + t.cash_topups + t.cash_in - t.cash_refunds - t.cash_out;
  return { shift: s, ...t, expected_cash: expected, by_method: byMethod };
}

export async function cashMovement(tx: Db, actor: Actor, input: { type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; approvalId?: string | null }) {
  const s = await one(tx, `SELECT * FROM shifts WHERE staff_id = $1 AND status = 'OPEN' FOR UPDATE`, [actor.staffId]);
  if (!s) throw unprocessable('SHIFT_REQUIRED', 'No open shift');
  const approval = input.type === 'CASH_OUT' ? await consumeApproval(tx, actor, input.approvalId, 'TRANSACTION_EDIT', s.branch_id).catch((e) => { if (e.code === 'APPROVAL_REQUIRED') return null; throw e; }) : null;
  const mv = await one(tx, `INSERT INTO cash_movements(shift_id, type, amount, reason, staff_id, approval_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [s.id, input.type, input.amount, input.reason, actor.staffId, approval]);
  await journal(tx, { branchId: s.branch_id, type: input.type, category: 'CASH', method: 'CASH', direction: input.type === 'CASH_IN' ? 'IN' : 'OUT', amount: input.amount,
    staffId: actor.staffId, shiftId: s.id, storeId: s.store_id, reference: input.reason });
  await audit(tx, actor, { action: input.type, entityType: 'shift', entityId: s.shift_no, reason: input.reason, after: { amount: input.amount }, branchId: s.branch_id });
  return mv;
}

export async function closeShift(tx: Db, actor: Actor, shiftId: string, input: { actualCash: number; note?: string; approvalId?: string | null }) {
  const s = await one(tx, 'SELECT * FROM shifts WHERE id = $1 FOR UPDATE', [shiftId]);
  if (!s) throw notFound('Shift');
  if (s.status !== 'OPEN') throw conflict('SHIFT_CLOSED', 'Shift already closed');
  if (s.staff_id !== actor.staffId && !can(actor, 'shift.manage')) throw forbidden('Only the shift owner or a manager can close this shift');
  const sum = await shiftSummary(tx, shiftId);
  const overShort = input.actualCash - sum.expected_cash;
  const cfg = await getSetting('approvals', s.branch_id);
  let approval: string | null = null;
  if (Math.abs(overShort) > cfg.overShortTolerance) approval = await consumeApproval(tx, actor, input.approvalId, 'SHIFT_OVER_SHORT', s.branch_id);
  const closed = await one(tx, `UPDATE shifts SET status = 'CLOSED', closed_at = now(), closed_by = $2, cash_sales = $3, cash_topups = $4, cash_refunds = $5, cash_in = $6,
      cash_out = $7, expected_cash = $8, actual_cash = $9, over_short = $10, note = $11, approval_id = $12 WHERE id = $1 RETURNING *`,
    [shiftId, actor.staffId, sum.cash_sales, sum.cash_topups, sum.cash_refunds, sum.cash_in, sum.cash_out, sum.expected_cash, input.actualCash, overShort, input.note ?? null, approval]);
  await audit(tx, actor, { action: 'SHIFT_CLOSE', entityType: 'shift', entityId: s.shift_no, branchId: s.branch_id,
    after: { expected: sum.expected_cash, actual: input.actualCash, overShort }, reason: input.note });
  return { ...closed, summary: sum };
}
