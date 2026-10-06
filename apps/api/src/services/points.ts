import { one, type Db } from '../db/pool.js';
import { unprocessable } from '../lib/errors.js';
import { publish, rooms } from '../realtime/hub.js';
import { getSetting } from './settings.js';

/** Signed points movement with row lock and ledger (idempotent by key). */
export async function postPoints(tx: Db, input: {
  memberId: string; type: 'EARN' | 'REDEEM' | 'ADJUST' | 'EXPIRE' | 'REVERSAL'; points: number; referenceType?: string; referenceId?: string;
  staffId?: string | null; note?: string | null; idempotencyKey?: string | null;
}, afterCommit?: (cb: () => void) => void) {
  if (!input.points) return null;
  if (input.idempotencyKey) {
    const dup = await one(tx, 'SELECT * FROM points_ledger WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (dup) return dup;
  }
  const m = await one(tx, 'SELECT id, points FROM members WHERE id = $1 FOR UPDATE', [input.memberId]);
  const after = m.points + input.points;
  if (after < 0) throw unprocessable('INSUFFICIENT_POINTS', `แต้มไม่พอ (มี ${m.points})`, { points: m.points });
  await tx.query('UPDATE members SET points = $2 WHERE id = $1', [m.id, after]);
  const row = await one(tx, `INSERT INTO points_ledger(member_id, type, points, balance_before, balance_after, reference_type, reference_id, staff_id, note, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [m.id, input.type, input.points, m.points, after, input.referenceType ?? null, input.referenceId ?? null, input.staffId ?? null, input.note ?? null, input.idempotencyKey ?? null]);
  const push = () => publish([rooms.member(m.id)], 'points.updated', { memberId: m.id, points: after });
  if (afterCommit) afterCommit(push); else push();
  return row;
}

/** Points earned for a paid order according to admin earn rules + tier multiplier. */
export async function computeEarnedPoints(tx: Db, order: { branch_id: string; member_id: string | null }, items: Array<{ total: number; points_category: string | null }>): Promise<number> {
  if (!order.member_id) return 0;
  const cfg = await getSetting('points', order.branch_id, tx);
  if (!cfg.enabled || cfg.earnAmount <= 0) return 0;
  const cats = cfg.categories as Record<string, boolean>;
  const eligible = items.reduce((s, i) => s + (i.points_category && cats[i.points_category] ? i.total : 0), 0);
  const m = await one(tx, `SELECT COALESCE(mp.point_multiplier, t.point_multiplier, 1) AS mult
      FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id
      LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'ACTIVE' LEFT JOIN membership_products mp ON mp.id = ms.product_id
     WHERE m.id = $1`, [order.member_id]);
  return Math.floor((eligible / cfg.earnAmount) * cfg.earnPoints * Number(m?.mult ?? 1));
}
