import { one, type Db } from '../db/pool.js';
import { verifySecret } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import type { Actor } from '../middleware/auth.js';
import { getSetting } from './settings.js';
import { audit } from './audit.js';

export type ApprovalAction = 'REFUND' | 'VOID' | 'MANUAL_GATE_OPEN' | 'GATE_OVERRIDE' | 'TICKET_OVERRIDE' | 'WALLET_ADJUST'
  | 'DISCOUNT_OVER_LIMIT' | 'TRANSACTION_EDIT' | 'POINTS_ADJUST' | 'SHIFT_OVER_SHORT' | 'CARD_REPLACE' | 'RIDE_OVERRIDE';

export async function approvalRequired(action: ApprovalAction, branchId?: string | null): Promise<boolean> {
  const s = await getSetting('approvals', branchId);
  return s.required.includes(action);
}

/**
 * Manager PIN check → creates a single-use, short-lived approval record.
 * The returned id is passed as `approvalId` to the protected operation.
 */
export async function grantApproval(db: Db, actor: Actor, input: {
  employeeCode: string; pin: string; action: ApprovalAction; reason: string; referenceType?: string; referenceId?: string;
}) {
  if (!actor.staffId) throw unauthorized();
  const mgr = await one(db, `SELECT s.id, s.pin_hash, s.status, s.branch_id, r.approval_level,
      EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id = s.role_id AND rp.permission_key IN ('approval.grant','*')) AS can_approve
    FROM staff s JOIN roles r ON r.id = s.role_id WHERE s.employee_code = $1`, [input.employeeCode]);
  const ok = mgr && mgr.status === 'ACTIVE' && (await verifySecret(input.pin, mgr.pin_hash));
  if (!ok) {
    await audit(db, actor, { action: 'APPROVAL_FAILED', entityType: input.referenceType, entityId: input.referenceId, reason: input.reason, metadata: { action: input.action, manager: input.employeeCode } });
    throw new AppError(401, 'INVALID_MANAGER_PIN', 'Invalid manager credentials');
  }
  if (!mgr.can_approve) throw forbidden('This staff member cannot approve', 'NOT_A_MANAGER');
  if (mgr.branch_id && actor.branchId && mgr.branch_id !== actor.branchId) throw forbidden('Manager belongs to another branch');
  const cfg = await getSetting('approvals', actor.branchId);
  const row = await one(db, `INSERT INTO manager_approvals(action, reason, requested_by, approved_by, reference_type, reference_id, device_id, branch_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9)) RETURNING id, expires_at`,
    [input.action, input.reason, actor.staffId, mgr.id, input.referenceType ?? null, input.referenceId ?? null, actor.deviceId ?? null, actor.branchId ?? null, cfg.approvalValidMinutes]);
  await audit(db, actor, { action: 'APPROVAL_GRANTED', entityType: 'manager_approval', entityId: row!.id, reason: input.reason, metadata: { action: input.action, approvedBy: mgr.id } });
  return row!;
}

/** Consume an approval inside the protected operation's transaction (single use). */
export async function consumeApproval(db: Db, actor: Actor, approvalId: string | undefined | null, action: ApprovalAction, branchId?: string | null): Promise<string | null> {
  const required = await approvalRequired(action, branchId ?? actor.branchId);
  if (!approvalId) {
    if (required) throw new AppError(403, 'APPROVAL_REQUIRED', `Manager approval required for ${action}`, { action });
    return null;
  }
  const a = await one(db, `SELECT * FROM manager_approvals WHERE id = $1 FOR UPDATE`, [approvalId]);
  if (!a || a.action !== action) throw new AppError(403, 'APPROVAL_INVALID', 'Approval does not match this action');
  if (a.consumed_at) throw new AppError(403, 'APPROVAL_USED', 'Approval already used');
  if (new Date(a.expires_at) < new Date()) throw new AppError(403, 'APPROVAL_EXPIRED', 'Approval expired');
  if (a.requested_by !== actor.staffId) throw new AppError(403, 'APPROVAL_INVALID', 'Approval was granted to another staff member');
  await db.query('UPDATE manager_approvals SET consumed_at = now() WHERE id = $1', [approvalId]);
  return approvalId;
}
