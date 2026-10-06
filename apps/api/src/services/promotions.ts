import { query, one, type Db } from '../db/pool.js';
import { businessDate, businessTime } from '../lib/codes.js';
import { pct } from '../lib/money.js';
import { unprocessable } from '../lib/errors.js';
import { getSetting } from './settings.js';

export interface PromoItem {
  key: string;
  itemType: string;           // PACKAGE, PRODUCT, TOPUP, ...
  category: 'TICKET' | 'FOOD' | 'RETAIL' | 'OTHER';
  packageId?: string | null;
  productId?: string | null;
  ticketTypeCode?: string | null;
  unitPrice: number;
  qty: number;
  discount: number;           // accumulated discount
  discountable: boolean;      // top-ups / memberships are never discounted
}

export interface PromoContext {
  branchId: string;
  channel: string;
  memberId?: string | null;
  tier?: { id: string; code: string; name: string; rank: number; ticket_discount_pct: number; food_discount_pct: number; retail_discount_pct: number } | null;
  memberBirthday?: string | null;
  visitDate?: string | null;
  couponCode?: string | null;
  now?: Date;
}

export interface AppliedPromo {
  promotionId: string | null;   // null for tier benefit
  couponId?: string | null;
  name: string;
  discount: number;
  stackable: boolean;
}

/**
 * Conditions (promotions.conditions JSON), all optional:
 *   min_qty, min_spend, member_only, member_tier_codes[], channels[], package_ids[], product_ids[],
 *   ticket_type_codes[], min_days_before_visit, days_of_week[], time_start, time_end, birthday ('DAY'|'MONTH'), max_items
 */
function eligibleItems(p: any, items: PromoItem[]): PromoItem[] {
  const c = p.conditions ?? {};
  return items.filter((i) => {
    if (!i.discountable) return false;
    if (p.applies_to === 'TICKET' && i.category !== 'TICKET') return false;
    if (p.applies_to === 'FOOD' && i.category !== 'FOOD') return false;
    if (p.applies_to === 'RETAIL' && i.category !== 'RETAIL') return false;
    if (Array.isArray(c.package_ids) && c.package_ids.length && !c.package_ids.includes(i.packageId)) return false;
    if (Array.isArray(c.product_ids) && c.product_ids.length && !c.product_ids.includes(i.productId)) return false;
    if (Array.isArray(c.ticket_type_codes) && c.ticket_type_codes.length && !c.ticket_type_codes.includes(i.ticketTypeCode)) return false;
    return true;
  });
}

function conditionsMet(p: any, ctx: PromoContext, eligible: PromoItem[], usageByMember: number): { ok: boolean; why?: string } {
  const c = p.conditions ?? {};
  const now = ctx.now ?? new Date();
  const qty = eligible.reduce((s, i) => s + i.qty, 0);
  const spend = eligible.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0);
  if (!eligible.length) return { ok: false, why: 'No eligible items' };
  if (c.min_qty && qty < c.min_qty) return { ok: false, why: `Minimum ${c.min_qty} items` };
  if (c.min_spend && spend < c.min_spend) return { ok: false, why: `Minimum spend ${c.min_spend / 100}` };
  if (c.member_only && !ctx.memberId) return { ok: false, why: 'Members only' };
  if (Array.isArray(c.member_tier_codes) && c.member_tier_codes.length && !c.member_tier_codes.includes(ctx.tier?.code)) return { ok: false, why: 'Tier not eligible' };
  if (Array.isArray(c.channels) && c.channels.length && !c.channels.includes(ctx.channel)) return { ok: false, why: 'Channel not eligible' };
  if (c.min_days_before_visit && ctx.visitDate) {
    const days = Math.floor((Date.parse(ctx.visitDate) - Date.parse(businessDate(now))) / 86_400_000);
    if (days < c.min_days_before_visit) return { ok: false, why: `Book ${c.min_days_before_visit} days in advance` };
  }
  const refDate = ctx.visitDate ?? businessDate(now);
  if (Array.isArray(c.days_of_week) && c.days_of_week.length && !c.days_of_week.includes(new Date(`${refDate}T00:00:00Z`).getUTCDay())) return { ok: false, why: 'Not valid today' };
  const t = businessTime(now);
  if (c.time_start && t < c.time_start) return { ok: false, why: 'Outside happy hour' };
  if (c.time_end && t > c.time_end) return { ok: false, why: 'Outside happy hour' };
  if (c.birthday) {
    if (!ctx.memberBirthday) return { ok: false, why: 'Birthday promotion requires member birthday' };
    const [, bm, bd] = ctx.memberBirthday.split('-');
    const [, vm, vd] = refDate.split('-');
    if (bm !== vm || (c.birthday === 'DAY' && bd !== vd)) return { ok: false, why: 'Not birthday' };
  }
  if (p.usage_limit != null && p.used_count >= p.usage_limit) return { ok: false, why: 'Usage limit reached' };
  if (p.usage_per_member != null && ctx.memberId && usageByMember >= p.usage_per_member) return { ok: false, why: 'Per-member limit reached' };
  return { ok: true };
}

function computeDiscount(p: any, eligible: PromoItem[]): number {
  const base = eligible.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0);
  if (base <= 0) return 0;
  const c = p.conditions ?? {};
  let d = 0;
  // limit number of discounted units (e.g. "birthday child free" = 1 ticket)
  const units = eligible.flatMap((i) => Array.from({ length: i.qty }, () => i.unitPrice - Math.floor(i.discount / i.qty))).sort((a, b) => a - b);
  const capUnits = c.max_items ? units.slice(-c.max_items) : units;
  const capBase = capUnits.reduce((s, u) => s + u, 0);
  switch (p.type) {
    case 'PERCENT': d = pct(c.max_items ? capBase : base, Number(p.value)); break;
    case 'AMOUNT': d = Math.round(Number(p.value) * 100); break;
    case 'FIXED_PRICE': d = Math.max(0, base - Math.round(Number(p.value) * 100)); break;
    case 'BUY_X_PAY_Y': {
      const buy = p.buy_qty ?? 0, pay = p.pay_qty ?? 0;
      if (buy > pay && buy > 0) {
        const free = Math.floor(units.length / buy) * (buy - pay);
        d = units.slice(0, free).reduce((s, u) => s + u, 0);   // cheapest units free
      }
      break;
    }
  }
  if (p.max_discount != null) d = Math.min(d, Number(p.max_discount));
  return Math.max(0, Math.min(d, base));
}

function allocate(eligible: PromoItem[], discount: number) {
  const base = eligible.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0);
  let left = discount;
  eligible.forEach((i, idx) => {
    const room = i.unitPrice * i.qty - i.discount;
    const share = idx === eligible.length - 1 ? Math.min(left, room) : Math.min(room, Math.round((room / base) * discount));
    i.discount += share;
    left -= share;
  });
}

/**
 * Rule-based promotion engine with priority + stackable semantics:
 *  candidates are evaluated in ascending priority; a NON-STACKABLE promotion only applies if nothing has
 *  been applied yet and then stops evaluation; STACKABLE promotions apply on the remaining amount.
 *  Member tier discounts take part as a pseudo-promotion (priority / stackability from settings).
 */
export async function applyPromotions(db: Db, items: PromoItem[], ctx: PromoContext): Promise<{ applied: AppliedPromo[]; rejectedCoupon?: string }> {
  const now = ctx.now ?? new Date();
  const promos = await query(db, `SELECT * FROM promotions WHERE is_active AND (branch_id IS NULL OR branch_id = $1)
      AND (start_at IS NULL OR start_at <= $2) AND (end_at IS NULL OR end_at >= $2)`, [ctx.branchId, now]);
  let coupon: any = null;
  let rejectedCoupon: string | undefined;
  if (ctx.couponCode) {
    coupon = await one(db, `SELECT * FROM coupons WHERE upper(code) = upper($1)`, [ctx.couponCode.trim()]);
    if (!coupon || coupon.status !== 'ACTIVE' || coupon.used_count >= coupon.usage_limit || (coupon.expires_at && new Date(coupon.expires_at) < now)
        || (coupon.member_id && coupon.member_id !== ctx.memberId)) {
      rejectedCoupon = 'คูปองไม่ถูกต้องหรือหมดอายุ / Invalid or expired coupon';
      coupon = null;
    }
  }
  const usage = ctx.memberId ? await query(db, `SELECT promotion_id, COUNT(*)::int AS n FROM promotion_usages WHERE member_id = $1 GROUP BY promotion_id`, [ctx.memberId]) : [];
  const usageMap = new Map(usage.map((u: any) => [u.promotion_id, u.n]));

  type Cand = { kind: 'promo'; p: any; couponId?: string } | { kind: 'tier' };
  const cands: Array<Cand & { priority: number; stackable: boolean }> = [];
  for (const p of promos) {
    if (p.requires_coupon && (!coupon || coupon.promotion_id !== p.id)) continue;
    cands.push({ kind: 'promo', p, couponId: p.requires_coupon ? coupon.id : undefined, priority: p.priority, stackable: p.stackable });
  }
  const promoCfg = await getSetting('promotions', ctx.branchId);
  if (ctx.tier && (ctx.tier.ticket_discount_pct || ctx.tier.food_discount_pct || ctx.tier.retail_discount_pct)) {
    cands.push({ kind: 'tier', priority: promoCfg.tierDiscountPriority, stackable: promoCfg.tierDiscountStackable });
  }
  cands.sort((a, b) => a.priority - b.priority);

  const applied: AppliedPromo[] = [];
  let exclusive = false;
  for (const c of cands) {
    if (exclusive) break;
    if (!c.stackable && applied.length) continue;
    if (c.kind === 'tier') {
      const t = ctx.tier!;
      let total = 0;
      for (const [cat, rate] of [['TICKET', t.ticket_discount_pct], ['FOOD', t.food_discount_pct], ['RETAIL', t.retail_discount_pct]] as const) {
        if (!rate) continue;
        const el = items.filter((i) => i.discountable && i.category === cat);
        const base = el.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0);
        const d = pct(base, Number(rate));
        if (d > 0) { allocate(el, d); total += d; }
      }
      if (total > 0) {
        applied.push({ promotionId: null, name: `Member ${t.name}`, discount: total, stackable: c.stackable });
        if (!c.stackable) exclusive = true;
      }
      continue;
    }
    const el = eligibleItems(c.p, items);
    if (!conditionsMet(c.p, ctx, el, usageMap.get(c.p.id) ?? 0).ok) continue;
    const d = computeDiscount(c.p, el);
    if (d <= 0) continue;
    allocate(el, d);
    applied.push({ promotionId: c.p.id, couponId: c.couponId ?? null, name: c.p.name, discount: d, stackable: c.stackable });
    if (!c.stackable) exclusive = true;
  }
  if (coupon && !applied.some((a) => a.couponId === coupon.id)) rejectedCoupon = 'คูปองไม่ตรงเงื่อนไข / Coupon conditions not met';
  return { applied, rejectedCoupon };
}

/** Record usage when an order is paid (locks promotion rows to enforce usage limits). */
export async function recordPromotionUsage(tx: Db, order: { id: string; member_id: string | null; promotions: AppliedPromo[] }) {
  for (const a of order.promotions ?? []) {
    if (!a.promotionId) continue;
    const p = await one(tx, 'SELECT id, usage_limit, used_count FROM promotions WHERE id = $1 FOR UPDATE', [a.promotionId]);
    if (p && p.usage_limit != null && p.used_count >= p.usage_limit) throw unprocessable('PROMOTION_EXHAUSTED', `Promotion "${a.name}" is fully used`);
    await tx.query('UPDATE promotions SET used_count = used_count + 1 WHERE id = $1', [a.promotionId]);
    if (a.couponId) {
      const c = await one(tx, 'UPDATE coupons SET used_count = used_count + 1, status = CASE WHEN used_count + 1 >= usage_limit THEN \'USED\' ELSE status END WHERE id = $1 AND used_count < usage_limit RETURNING id', [a.couponId]);
      if (!c) throw unprocessable('COUPON_USED', 'Coupon already used');
      await tx.query(`UPDATE reward_redemptions SET status = 'USED', used_at = now(), used_order_id = $2 WHERE coupon_id = $1`, [a.couponId, order.id]);
    }
    await tx.query('INSERT INTO promotion_usages(promotion_id, coupon_id, order_id, member_id, discount) VALUES ($1,$2,$3,$4,$5)',
      [a.promotionId, a.couponId ?? null, order.id, order.member_id, a.discount]);
  }
}
