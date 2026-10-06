import { one, query, type Db } from '../db/pool.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes, businessDate } from '../lib/codes.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { postPoints } from './points.js';
import { postLedger, walletForAccount } from './wallet.js';
import { ensureMemberAccount } from './accounts.js';
import { endOfDay, startOfDay, addDays } from './tickets.js';

export async function rewardStore(db: Db, memberId: string | null, branchId?: string | null) {
  const rank = memberId ? (await one(db, `SELECT COALESCE(t.rank, 0) AS rank FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id WHERE m.id = $1`, [memberId]))?.rank ?? 0 : 0;
  const rows = await query(db, `SELECT * FROM rewards WHERE is_active AND (branch_id IS NULL OR branch_id = $1) AND (start_at IS NULL OR start_at <= now()) AND (end_at IS NULL OR end_at >= now())
      ORDER BY points_required`, [branchId ?? null]);
  return rows.map((r: any) => ({ ...r, eligible: r.min_tier_rank <= rank, inStock: r.stock === null || r.stock > 0 }));
}

/** Redeem points → voucher in member account (or instant wallet credit / ride pass / personal coupon). */
export async function redeemReward(tx: Db, actor: Actor, memberId: string, rewardId: string, after: (cb: () => void) => void) {
  const r = await one(tx, 'SELECT * FROM rewards WHERE id = $1 FOR UPDATE', [rewardId]);
  if (!r || !r.is_active) throw notFound('Reward');
  const now = new Date();
  if ((r.start_at && new Date(r.start_at) > now) || (r.end_at && new Date(r.end_at) < now)) throw unprocessable('REWARD_NOT_AVAILABLE', 'Reward not available now');
  if (r.stock !== null && r.stock <= 0) throw conflict('OUT_OF_STOCK', 'Reward out of stock');
  const m = await one(tx, `SELECT m.id, COALESCE(t.rank, 0) AS rank FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id WHERE m.id = $1`, [memberId]);
  if (m.rank < r.min_tier_rank) throw unprocessable('TIER_REQUIRED', 'Your membership tier is not eligible for this reward');
  const voucher = codes.voucher();
  await postPoints(tx, { memberId, type: 'REDEEM', points: -r.points_required, referenceType: 'REWARD', referenceId: voucher, staffId: actor.staffId }, after);
  if (r.stock !== null) await tx.query('UPDATE rewards SET stock = stock - 1 WHERE id = $1', [r.id]);
  const expiresAt = endOfDay(addDays(businessDate(), r.voucher_valid_days));
  let couponId: string | null = null;
  let status = 'ISSUED';
  const cfg = r.config ?? {};
  if ((r.type === 'DISCOUNT' || r.type === 'COUPON') && cfg.promotion_id) {
    const c = await one(tx, `INSERT INTO coupons(promotion_id, code, usage_limit, member_id, expires_at, source) VALUES ($1,$2,1,$3,$4,'REWARD') RETURNING id`, [cfg.promotion_id, voucher, memberId, expiresAt]);
    couponId = c!.id;
  }
  if (r.type === 'WALLET_CREDIT' && cfg.amount) {
    const accountId = await ensureMemberAccount(tx, memberId);
    const w = await walletForAccount(tx, accountId);
    await postLedger(tx, { walletId: w.id, type: 'BONUS', credit: Number(cfg.amount), referenceType: 'REWARD', referenceId: voucher, memberId, staffId: actor.staffId, idempotencyKey: `reward:${voucher}` }, after);
    status = 'USED';
  }
  if (r.type === 'RIDE_PASS' && cfg.ride_id) {
    const accountId = await ensureMemberAccount(tx, memberId);
    const ride = await one(tx, 'SELECT branch_id FROM rides WHERE id = $1', [cfg.ride_id]);
    const uses = Number(cfg.uses ?? 1);
    await tx.query(`INSERT INTO ride_entitlements(account_id, ride_id, branch_id, source, type, uses_total, uses_remaining, valid_from, valid_until)
        VALUES ($1,$2,$3,'REWARD',$4,$5,$5,$6,$7)`, [accountId, cfg.ride_id, ride.branch_id, uses > 1 ? 'MULTI_USE' : 'ONE_TIME', uses, startOfDay(businessDate()), expiresAt]);
    status = 'USED';
  }
  const red = await one(tx, `INSERT INTO reward_redemptions(reward_id, member_id, points, voucher_code, status, expires_at, coupon_id, used_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5 = 'USED' THEN now() END) RETURNING *`, [r.id, memberId, r.points_required, voucher, status, expiresAt, couponId]);
  await audit(tx, actor, { action: 'REWARD_REDEEM', entityType: 'reward', entityId: r.id, after: { voucher, points: r.points_required } });
  return { ...red, reward: { name: r.name, type: r.type } };
}

export async function memberVouchers(db: Db, memberId: string) {
  return query(db, `SELECT rr.*, r.name, r.type, r.image_url FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE rr.member_id = $1 ORDER BY rr.created_at DESC`, [memberId]);
}
