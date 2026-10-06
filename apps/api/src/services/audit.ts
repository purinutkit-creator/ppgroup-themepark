import type { Db } from '../db/pool.js';
import type { Actor } from '../middleware/auth.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  branchId?: string | null;
}

/** Append-only audit trail. Call inside the business transaction so audit and change commit together. */
export async function audit(db: Db, actor: Actor | null, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs(branch_id, staff_id, member_id, role, device_id, ip, user_agent, action, entity_type, entity_id, before, after, reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      e.branchId ?? actor?.branchId ?? null, actor?.staffId ?? null, actor?.memberId ?? null,
      actor?.roleCode ?? (actor?.type === 'MEMBER' ? 'MEMBER' : actor?.type === 'DEVICE' ? `DEVICE:${actor.deviceType}` : null),
      actor?.deviceId ?? null, actor?.ip ?? null, actor?.userAgent?.slice(0, 300) ?? null,
      e.action, e.entityType ?? null, e.entityId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after),
      e.reason ?? null, e.metadata ? JSON.stringify(e.metadata) : null,
    ]);
}

export const SYSTEM_ACTOR: Actor = { type: 'PUBLIC', permissions: new Set(['*']), ip: 'system', name: 'SYSTEM' };
