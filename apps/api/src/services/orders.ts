import { pool, one, query, withTx, type Db } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { codes, businessDate, businessTime } from '../lib/codes.js';
import { pct } from '../lib/money.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { can } from '../middleware/auth.js';
import { audit, SYSTEM_ACTOR } from './audit.js';
import { getSetting } from './settings.js';
import { applyPromotions, recordPromotionUsage, type AppliedPromo, type PromoItem } from './promotions.js';
import { postLedger, walletForAccount } from './wallet.js';
import { journal, categoryOfOrder } from './transactions.js';
import { postPoints, computeEarnedPoints } from './points.js';
import { moveStock } from './inventory.js';
import { consumeApproval } from './approvals.js';
import { notify } from './notify.js';
import { createPackageEntitlements } from './tickets.js';

// ---------------------------------------------------------------------
// Item pricing (server side — client prices are never trusted)
// ---------------------------------------------------------------------
export type ItemInput =
  | { type: 'PRODUCT'; productId: string; qty: number; modifiers?: Array<{ group: string; option: string }>; notes?: string; voucherCode?: string }
  | { type: 'TOPUP'; amount: number }
  | { type: 'MEMBERSHIP'; membershipProductId: string; mode: 'NEW' | 'RENEWAL' | 'UPGRADE'; physicalCard?: boolean }
  | { type: 'RIDE_ADDON'; rideId: string; qty?: number }
  | { type: 'LOCKER'; rateId: string; lockerId?: string | null };

export interface PricedLine {
  itemType: 'PRODUCT' | 'PACKAGE' | 'TOPUP' | 'MEMBERSHIP' | 'RIDE_ADDON' | 'LOCKER' | 'PHYSICAL_CARD';
  name: string;
  qty: number;
  unitPrice: number;
  category: PromoItem['category'];
  pointsCategory: string | null;
  discountable: boolean;
  productId?: string | null; packageId?: string | null; ticketTypeId?: string | null; ticketTypeCode?: string | null;
  rideId?: string | null; membershipProductId?: string | null;
  modifiers?: unknown[]; notes?: string | null; metadata?: Record<string, unknown>;
  sendToKitchen?: boolean; trackStock?: boolean;
}

export interface MemberCtx {
  member: any | null;
  tier: any | null;            // only when membership ACTIVE
  accountId: string | null;
}

export async function memberContext(db: Db, memberId?: string | null): Promise<MemberCtx> {
  if (!memberId) return { member: null, tier: null, accountId: null };
  const m = await one(db, `SELECT m.*, a.id AS account_id FROM members m LEFT JOIN customer_accounts a ON a.member_id = m.id WHERE m.id = $1`, [memberId]);
  if (!m) throw notFound('Member');
  const tier = await one(db, `SELECT t.* FROM memberships ms JOIN membership_products mp ON mp.id = ms.product_id JOIN member_tiers t ON t.id = mp.tier_id
     WHERE ms.member_id = $1 AND ms.status = 'ACTIVE' AND (ms.end_date IS NULL OR ms.end_date >= CURRENT_DATE) LIMIT 1`, [memberId]);
  return { member: m, tier, accountId: m.account_id };
}

function categoryOfProduct(catType?: string | null): PromoItem['category'] {
  if (catType === 'FOOD' || catType === 'DRINK') return 'FOOD';
  if (catType === 'SOUVENIR' || catType === 'MERCHANDISE' || catType === 'PHOTO') return 'RETAIL';
  return 'OTHER';
}

export async function isPeak(branchId: string, at = new Date()) {
  const cfg = await getSetting('ride', branchId);
  const dow = new Date(`${businessDate(at)}T00:00:00Z`).getUTCDay();
  const t = businessTime(at).slice(0, 5);
  return cfg.peakDays.includes(dow) || (t >= cfg.peakHours.start && t <= cfg.peakHours.end);
}

export async function rideAddonPrice(db: Db, ride: any, ctx: MemberCtx): Promise<number> {
  let price = (await isPeak(ride.branch_id)) && ride.addon_peak_price != null ? Number(ride.addon_peak_price) : Number(ride.addon_price);
  if (ctx.member) {
    if (ride.addon_member_price != null) price = Math.min(price, Number(ride.addon_member_price));
    if (ctx.tier) {
      const tp = await one(db, 'SELECT price FROM ride_tier_prices WHERE ride_id = $1 AND tier_id = $2', [ride.id, ctx.tier.id]);
      if (tp) price = Math.min(price, Number(tp.price));
    }
  }
  return price;
}

export async function priceItems(db: Db, branchId: string, items: ItemInput[], ctx: MemberCtx): Promise<PricedLine[]> {
  const lines: PricedLine[] = [];
  for (const it of items) {
    switch (it.type) {
      case 'PRODUCT': {
        if (!Number.isInteger(it.qty) || it.qty <= 0) throw badRequest('INVALID_QTY', 'Quantity must be positive');
        const p = await one(db, `SELECT p.*, c.type AS category_type, c.points_category FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1 AND p.is_active AND (p.branch_id IS NULL OR p.branch_id = $2)`, [it.productId, branchId]);
        if (!p) throw notFound('Product');
        let unit = ctx.member && p.member_price != null ? Number(p.member_price) : Number(p.price);
        const chosen: Array<{ group: string; option: string; price: number }> = [];
        const groups: any[] = Array.isArray(p.modifiers) ? p.modifiers : [];
        for (const g of groups) {
          const picks = (it.modifiers ?? []).filter((m) => m.group === g.group);
          if (g.required && picks.length === 0) throw badRequest('MODIFIER_REQUIRED', `${p.name}: เลือก ${g.group}`);
          if (g.max && picks.length > g.max) throw badRequest('MODIFIER_LIMIT', `${p.name}: ${g.group} max ${g.max}`);
          for (const pick of picks) {
            const opt = (g.options ?? []).find((o: any) => o.name === pick.option);
            if (!opt) throw badRequest('MODIFIER_INVALID', `${p.name}: invalid option ${pick.option}`);
            unit += Number(opt.price ?? 0);
            chosen.push({ group: g.group, option: opt.name, price: Number(opt.price ?? 0) });
          }
        }
        for (const m of it.modifiers ?? []) if (!groups.some((g) => g.group === m.group)) throw badRequest('MODIFIER_INVALID', `Unknown modifier group ${m.group}`);
        lines.push({ itemType: 'PRODUCT', name: p.name, qty: it.qty, unitPrice: unit, category: categoryOfProduct(p.category_type), pointsCategory: p.points_category ?? 'RETAIL',
          discountable: true, productId: p.id, modifiers: chosen, notes: it.notes ?? null, sendToKitchen: p.send_to_kitchen, trackStock: p.track_stock,
          metadata: it.voucherCode ? { voucherCode: it.voucherCode } : {} });
        break;
      }
      case 'TOPUP': {
        const cfg = await getSetting('wallet', branchId, db);
        if (!Number.isInteger(it.amount) || it.amount < cfg.minTopup || it.amount > cfg.maxTopup) {
          throw badRequest('INVALID_TOPUP', `Top-up must be between ${cfg.minTopup / 100} and ${cfg.maxTopup / 100} THB`);
        }
        lines.push({ itemType: 'TOPUP', name: 'Wallet Top-up', qty: 1, unitPrice: it.amount, category: 'OTHER', pointsCategory: 'TOPUP', discountable: false });
        break;
      }
      case 'RIDE_ADDON': {
        const r = await one(db, 'SELECT * FROM rides WHERE id = $1 AND branch_id = $2', [it.rideId, branchId]);
        if (!r) throw notFound('Ride');
        if (!r.addon_enabled) throw unprocessable('ADDON_DISABLED', 'Ride add-on is not for sale');
        lines.push({ itemType: 'RIDE_ADDON', name: `Ride: ${r.name}`, qty: it.qty ?? 1, unitPrice: await rideAddonPrice(db, r, ctx), category: 'TICKET', pointsCategory: 'RIDE',
          discountable: false, rideId: r.id, metadata: { entitlementType: r.addon_entitlement_type, uses: r.addon_uses } });
        break;
      }
      case 'LOCKER': {
        const rate = await one(db, 'SELECT * FROM locker_rates WHERE id = $1 AND branch_id = $2 AND is_active', [it.rateId, branchId]);
        if (!rate) throw notFound('Locker rate');
        lines.push({ itemType: 'LOCKER', name: `Locker ${rate.size} — ${rate.name}`, qty: 1, unitPrice: Number(rate.price), category: 'OTHER', pointsCategory: 'LOCKER',
          discountable: false, metadata: { rateId: rate.id, lockerId: it.lockerId ?? null, durationMinutes: rate.duration_minutes, size: rate.size } });
        break;
      }
      case 'MEMBERSHIP': {
        const { priceMembership } = await import('./membership.js');
        const priced = await priceMembership(db, it.membershipProductId, it.mode, ctx.member?.id ?? null);
        lines.push({ itemType: 'MEMBERSHIP', name: priced.name, qty: 1, unitPrice: priced.price, category: 'OTHER', pointsCategory: 'MEMBERSHIP', discountable: false,
          membershipProductId: it.membershipProductId, metadata: { mode: it.mode, breakdown: priced.breakdown } });
        if (it.physicalCard && priced.physicalCardFee >= 0) {
          lines.push({ itemType: 'PHYSICAL_CARD', name: 'Physical member card', qty: 1, unitPrice: priced.physicalCardFee, category: 'OTHER', pointsCategory: null, discountable: false,
            membershipProductId: it.membershipProductId });
        }
        break;
      }
    }
  }
  return lines;
}

// ---------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------
export interface CreateOrderInput {
  branchId: string;
  storeId?: string | null;
  type: 'BOOKING' | 'TICKET' | 'POS' | 'FOOD' | 'RETAIL' | 'TOPUP' | 'MEMBERSHIP' | 'RIDE_ADDON' | 'LOCKER';
  channel: 'ONLINE' | 'COUNTER' | 'POS' | 'KIOSK' | 'MOBILE' | 'SCANNER' | 'QR_ORDER';
  lines: PricedLine[];
  memberCtx: MemberCtx;
  accountId?: string | null;
  credentialId?: string | null;
  customerName?: string | null;
  couponCode?: string | null;
  visitDate?: string | null;
  manualDiscount?: { percent?: number; amount?: number; reason: string; approvalId?: string | null } | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  applyPromotions?: boolean;
}

export async function createOrder(tx: Db, actor: Actor, input: CreateOrderInput) {
  if (!input.lines.length) throw badRequest('EMPTY_ORDER', 'Order has no items');
  if (input.idempotencyKey) {
    const dup = await one(tx, 'SELECT * FROM orders WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (dup) return { order: dup, items: await query(tx, 'SELECT * FROM order_items WHERE order_id = $1', [dup.id]), duplicate: true, rejectedCoupon: undefined };
  }
  const promoItems: PromoItem[] = input.lines.map((l, idx) => ({
    key: String(idx), itemType: l.itemType, category: l.category, packageId: l.packageId, productId: l.productId, ticketTypeCode: l.ticketTypeCode,
    unitPrice: l.unitPrice, qty: l.qty, discount: 0, discountable: l.discountable,
  }));
  // reward vouchers attached to POS lines → line becomes free
  for (const [idx, l] of input.lines.entries()) {
    const code = l.metadata?.voucherCode as string | undefined;
    if (code) {
      const v = await one(tx, `SELECT rr.*, r.type, r.config FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE rr.voucher_code = $1 FOR UPDATE`, [code]);
      if (!v || v.status !== 'ISSUED' || new Date(v.expires_at) < new Date()) throw unprocessable('VOUCHER_INVALID', 'Voucher invalid / used / expired');
      if (input.memberCtx.member && v.member_id !== input.memberCtx.member.id) throw unprocessable('VOUCHER_OWNER', 'Voucher belongs to another member');
      promoItems[idx].discount = l.unitPrice; // one unit free
      promoItems[idx].discountable = false;
    }
  }
  let applied: AppliedPromo[] = [];
  let rejectedCoupon: string | undefined;
  if (input.applyPromotions !== false) {
    const r = await applyPromotions(tx, promoItems, {
      branchId: input.branchId, channel: input.channel, memberId: input.memberCtx.member?.id, tier: input.memberCtx.tier,
      memberBirthday: input.memberCtx.member?.birthday, visitDate: input.visitDate, couponCode: input.couponCode,
    });
    applied = r.applied;
    rejectedCoupon = r.rejectedCoupon;
  }
  const subtotal = promoItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  let discount = promoItems.reduce((s, i) => s + i.discount, 0);
  // manual discount (POS)
  let approvalId: string | null = null;
  if (input.manualDiscount && (input.manualDiscount.percent || input.manualDiscount.amount)) {
    if (!can(actor, 'pos.discount')) throw forbidden('Missing permission: pos.discount');
    const remaining = subtotal - discount;
    const md = input.manualDiscount.percent ? pct(remaining, input.manualDiscount.percent) : Math.min(input.manualDiscount.amount ?? 0, remaining);
    const limit = (await getSetting('approvals', input.branchId)).discountLimitPercent;
    if (remaining > 0 && (md / remaining) * 100 > limit) {
      approvalId = await consumeApproval(tx, actor, input.manualDiscount.approvalId, 'DISCOUNT_OVER_LIMIT', input.branchId);
      if (!approvalId) throw new AppError(403, 'APPROVAL_REQUIRED', `Discount above ${limit}% requires manager approval`, { action: 'DISCOUNT_OVER_LIMIT' });
    }
    const el = promoItems.filter((i) => i.discountable);
    const base = el.reduce((s, i) => s + i.unitPrice * i.qty - i.discount, 0);
    let left = md;
    el.forEach((i, idx) => {
      const room = i.unitPrice * i.qty - i.discount;
      const share = idx === el.length - 1 ? Math.min(left, room) : Math.min(room, Math.round((room / Math.max(base, 1)) * md));
      i.discount += share; left -= share;
    });
    const applied2 = md - left;
    discount += applied2;
    applied.push({ promotionId: null, name: `Manual discount: ${input.manualDiscount.reason}`, discount: applied2, stackable: true });
    await audit(tx, actor, { action: 'DISCOUNT_MANUAL', entityType: 'order', reason: input.manualDiscount.reason, metadata: { amount: applied2, approvalId } });
  }
  const total = subtotal - discount;
  const tax = (await getSetting('park.info', input.branchId)).taxRate;
  const taxTotal = Math.round(total - total / (1 + tax / 100)); // VAT included
  const orderNo = await codes.order(tx);
  let queueNo: string | null = null;
  const order = await one(tx, `INSERT INTO orders(order_no, branch_id, store_id, type, channel, status, account_id, member_id, credential_id, staff_id, shift_id, device_id,
       customer_name, subtotal, discount_total, tax_total, total, promotions, queue_no, notes, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [orderNo, input.branchId, input.storeId ?? null, input.type, input.channel, input.accountId ?? input.memberCtx.accountId ?? null,
     input.memberCtx.member?.id ?? null, input.credentialId ?? null, actor.staffId ?? null, await openShiftId(tx, actor), actor.deviceId ?? null,
     input.customerName ?? (input.memberCtx.member ? `${input.memberCtx.member.first_name} ${input.memberCtx.member.last_name}`.trim() : null),
     subtotal, discount, taxTotal, total, JSON.stringify(applied), queueNo, input.notes ?? null, input.idempotencyKey ?? null, JSON.stringify(input.metadata ?? {})]);
  const items: any[] = [];
  for (const [idx, l] of input.lines.entries()) {
    const pi = promoItems[idx];
    items.push(await one(tx, `INSERT INTO order_items(order_id, item_type, product_id, package_id, ticket_type_id, ride_id, membership_product_id, name, qty, unit_price,
         discount, total, points_category, modifiers, notes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [order!.id, l.itemType, l.productId ?? null, l.packageId ?? null, l.ticketTypeId ?? null, l.rideId ?? null, l.membershipProductId ?? null, l.name, l.qty,
       l.unitPrice, pi.discount, l.unitPrice * l.qty - pi.discount, l.pointsCategory, JSON.stringify(l.modifiers ?? []), l.notes ?? null,
       JSON.stringify({ ...(l.metadata ?? {}), sendToKitchen: !!l.sendToKitchen, trackStock: !!l.trackStock })]));
  }
  // stock availability pre-check (final deduction happens at payment)
  if (input.storeId) {
    for (const l of input.lines) {
      if (l.itemType !== 'PRODUCT' || !l.trackStock) continue;
      const inv = await one(tx, 'SELECT qty FROM inventory WHERE product_id = $1 AND store_id = $2', [l.productId, input.storeId]);
      const allowNeg = (await getSetting('inventory', input.branchId)).allowNegative;
      if (!allowNeg && (inv?.qty ?? 0) < l.qty) throw unprocessable('OUT_OF_STOCK', `สินค้าไม่พอ: ${l.name} (คงเหลือ ${inv?.qty ?? 0})`);
    }
  }
  return { order: order!, items, duplicate: false, rejectedCoupon };
}

export async function openShiftId(db: Db, actor: Actor): Promise<string | null> {
  if (!actor.staffId) return null;
  const s = await one(db, `SELECT id FROM shifts WHERE staff_id = $1 AND status = 'OPEN'`, [actor.staffId]);
  return s?.id ?? null;
}

// ---------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------
export interface PaymentInput {
  method: 'CASH' | 'PROMPTPAY' | 'CARD' | 'DEBIT' | 'BANK_TRANSFER' | 'EWALLET' | 'WALLET' | 'POINTS' | 'MOBILE_BANKING';
  amount: number;
  tendered?: number;
  reference?: string | null;
  credentialId?: string | null;     // WALLET: which credential paid (account resolved server-side)
  points?: number;                  // POINTS
  idempotencyKey?: string | null;
  channel?: 'COUNTER' | 'ONLINE' | 'KIOSK' | 'SCANNER' | 'POS';
}

async function assertMethodEnabled(branchId: string, method: string, channel: 'online' | 'counter') {
  const cfg = await getSetting('payments', branchId);
  const m = cfg.methods[method];
  if (!m || !m.enabled || !m[channel]) throw unprocessable('PAYMENT_METHOD_DISABLED', `Payment method ${method} is not enabled for ${channel}`);
}

/**
 * Record a staff-confirmed or wallet / points payment that is captured immediately.
 * Supports split payments: call repeatedly until the order is fully paid.
 * Double-payment protection: order row lock + remaining-amount check + payment idempotency key.
 */
export async function capturePayment(tx: Db, actor: Actor, orderId: string, p: PaymentInput, afterCommit: (cb: () => void) => void) {
  if (p.idempotencyKey) {
    const dup = await one(tx, 'SELECT * FROM payments WHERE idempotency_key = $1', [p.idempotencyKey]);
    if (dup) {
      if (dup.order_id !== orderId) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key used for another order');
      return { payment: dup, order: await one(tx, 'SELECT * FROM orders WHERE id = $1', [orderId]), duplicate: true };
    }
  }
  const order = await one(tx, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw notFound('Order');
  if (!['PENDING', 'PARTIALLY_PAID'].includes(order.status)) throw conflict('ORDER_NOT_PAYABLE', `Order is ${order.status}`);
  const remaining = order.total - order.paid_total;
  if (remaining <= 0) throw conflict('ALREADY_PAID', 'Order already fully paid');
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw badRequest('INVALID_AMOUNT', 'Amount must be a positive integer (satang)');
  if (p.amount > remaining) throw unprocessable('OVERPAYMENT', `Amount exceeds outstanding balance (${remaining / 100} THB)`, { remaining });
  const channel = p.channel ?? (actor.type === 'STAFF' ? 'COUNTER' : 'ONLINE');
  await assertMethodEnabled(order.branch_id, p.method, channel === 'ONLINE' ? 'online' : 'counter');

  let shiftId: string | null = await openShiftId(tx, actor);
  let change = 0;
  if (p.method === 'CASH') {
    if (actor.type === 'STAFF' && (await getSetting('shift', order.branch_id)).requireForCash && !shiftId) {
      throw unprocessable('SHIFT_REQUIRED', 'กรุณาเปิดกะก่อนรับเงินสด / Open a shift before accepting cash');
    }
    const tendered = p.tendered ?? p.amount;
    if (tendered < p.amount) throw unprocessable('INSUFFICIENT_TENDER', 'Tendered amount is less than payment amount');
    change = tendered - p.amount;
  }
  const paymentNo = await codes.payment(tx);
  let payment = await one(tx, `INSERT INTO payments(payment_no, order_id, method, provider, status, amount, tendered, change_amount, reference, channel, staff_id, shift_id, device_id, credential_id, idempotency_key)
     VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [paymentNo, order.id, p.method, p.method === 'WALLET' ? 'wallet' : p.method === 'POINTS' ? 'points' : 'counter', p.amount,
     p.method === 'CASH' ? p.tendered ?? p.amount : null, p.method === 'CASH' ? change : null, p.reference ?? null, channel,
     actor.staffId ?? null, shiftId, actor.deviceId ?? null, p.credentialId ?? null, p.idempotencyKey ?? null]);

  if (p.method === 'WALLET') {
    const cred = p.credentialId ? await one(tx, 'SELECT * FROM credentials WHERE id = $1', [p.credentialId]) : null;
    const accountId = cred?.account_id ?? order.account_id;
    if (!accountId) throw badRequest('WALLET_ACCOUNT_REQUIRED', 'Scan a card / wristband to pay with wallet');
    if (cred && cred.status !== 'ACTIVE') throw unprocessable('CREDENTIAL_NOT_ACTIVE', `Card is ${cred.status}`);
    const wallet = await walletForAccount(tx, accountId);
    const { entry } = await postLedger(tx, {
      walletId: wallet.id, type: 'PAYMENT', debit: p.amount, referenceType: 'ORDER', referenceId: order.order_no, orderId: order.id, paymentId: payment!.id,
      credentialId: cred?.id ?? null, memberId: order.member_id, storeId: order.store_id, deviceId: actor.deviceId, staffId: actor.staffId, branchId: order.branch_id,
      idempotencyKey: `pay:${payment!.id}`,
    }, afterCommit);
    payment = await one(tx, `UPDATE payments SET reference = $2 WHERE id = $1 RETURNING *`, [payment!.id, entry.txn_no]);
    if (!order.account_id) await tx.query('UPDATE orders SET account_id = $2, credential_id = COALESCE(credential_id, $3) WHERE id = $1', [order.id, accountId, cred?.id ?? null]);
  }
  if (p.method === 'POINTS') {
    if (!order.member_id) throw badRequest('MEMBER_REQUIRED', 'Points payment requires a member');
    const cfg = await getSetting('points', order.branch_id);
    const pointsNeeded = Math.ceil(p.amount / cfg.redeemValue);
    await postPoints(tx, { memberId: order.member_id, type: 'REDEEM', points: -pointsNeeded, referenceType: 'ORDER', referenceId: order.order_no, staffId: actor.staffId, idempotencyKey: `redeem:${payment!.id}` }, afterCommit);
    await tx.query('UPDATE orders SET points_redeemed = points_redeemed + $2 WHERE id = $1', [order.id, pointsNeeded]);
  }
  return markPaymentPaid(tx, actor, payment!.id, { reference: payment!.reference }, afterCommit);
}

/** Transition a payment to PAID, update the order and fulfil when fully paid. */
export async function markPaymentPaid(tx: Db, actor: Actor, paymentId: string, extra: { reference?: string | null; payload?: unknown }, afterCommit: (cb: () => void) => void) {
  const pay = await one(tx, 'SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
  if (!pay) throw notFound('Payment');
  if (pay.status === 'PAID') return { payment: pay, order: await one(tx, 'SELECT * FROM orders WHERE id = $1', [pay.order_id]), duplicate: true };
  if (!['PENDING', 'WAITING_VERIFICATION'].includes(pay.status)) throw conflict('PAYMENT_NOT_PENDING', `Payment is ${pay.status}`);
  const order = await one(tx, 'SELECT o.*, s.type AS store_type FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE o.id = $1 FOR UPDATE OF o', [pay.order_id]);
  if (!['PENDING', 'PARTIALLY_PAID'].includes(order.status)) throw conflict('ORDER_NOT_PAYABLE', `Order is ${order.status}`);
  if (order.paid_total + pay.amount > order.total) throw conflict('OVERPAYMENT', 'Payment would exceed order total (duplicate payment prevented)');
  const updatedPay = await one(tx, `UPDATE payments SET status = 'PAID', paid_at = now(), reference = COALESCE($2, reference),
      provider_payload = provider_payload || $3::jsonb WHERE id = $1 RETURNING *`, [pay.id, extra.reference ?? null, JSON.stringify(extra.payload ?? {})]);
  const paidTotal = order.paid_total + pay.amount;
  const status = paidTotal >= order.total ? 'PAID' : 'PARTIALLY_PAID';
  let updatedOrder = await one(tx, `UPDATE orders SET paid_total = $2, status = $3, paid_at = CASE WHEN $3 = 'PAID' THEN now() ELSE paid_at END WHERE id = $1 RETURNING *`,
    [order.id, paidTotal, status]);
  await journal(tx, {
    branchId: order.branch_id, type: order.type === 'TOPUP' ? 'TOPUP' : 'SALE', category: categoryOfOrder(order.type, order.store_type), method: pay.method,
    direction: pay.method === 'WALLET' || pay.method === 'POINTS' ? 'NONE' : 'IN', amount: pay.amount, orderId: order.id, paymentId: pay.id,
    accountId: order.account_id, memberId: order.member_id, credentialId: pay.credential_id ?? order.credential_id, staffId: pay.staff_id ?? actor.staffId,
    storeId: order.store_id, deviceId: pay.device_id ?? actor.deviceId, shiftId: pay.shift_id, reference: order.order_no,
  });
  if (status === 'PAID') updatedOrder = await fulfillOrder(tx, actor, order.id, afterCommit);
  afterCommit(() => publish([rooms.branch(order.branch_id)], 'order.paid', { orderId: order.id, orderNo: order.order_no, type: order.type, total: order.total, status }));
  return { payment: updatedPay, order: updatedOrder, duplicate: false };
}

// ---------------------------------------------------------------------
// Fulfillment: everything a paid order grants, in the SAME transaction as the payment
// ---------------------------------------------------------------------
export async function fulfillOrder(tx: Db, actor: Actor, orderId: string, afterCommit: (cb: () => void) => void) {
  const order = await one(tx, 'SELECT o.*, s.code AS store_code, s.type AS store_type FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE o.id = $1 FOR UPDATE OF o', [orderId]);
  if (order.fulfilled_at) return order;
  const items = await query(tx, 'SELECT * FROM order_items WHERE order_id = $1', [orderId]);

  // tickets (bookings / counter sales)
  if (order.type === 'BOOKING' || order.type === 'TICKET') {
    const tickets = await query(tx, `UPDATE tickets SET status = 'ACTIVE', activated_at = now() WHERE order_id = $1 AND status IN ('UNPAID','PAID') RETURNING *`, [orderId]);
    for (const t of tickets) {
      await createPackageEntitlements(tx, t, orderId);
      const pkg = await one(tx, 'SELECT wallet_credit, name FROM packages WHERE id = $1', [t.package_id]);
      if (pkg.wallet_credit > 0 && t.account_id) {
        const w = await walletForAccount(tx, t.account_id);
        await postLedger(tx, { walletId: w.id, type: 'BONUS', credit: Number(pkg.wallet_credit), referenceType: 'TICKET', referenceId: t.ticket_code, orderId, branchId: order.branch_id,
          note: `${pkg.name} wallet credit`, idempotencyKey: `pkgcredit:${t.id}` }, afterCommit);
      }
    }
    const b = await one(tx, `UPDATE bookings SET status = CASE WHEN status IN ('PENDING_PAYMENT','RESERVED','PENDING_VERIFICATION') THEN 'CONFIRMED' ELSE status END
        WHERE order_id = $1 RETURNING id, booking_no, status, branch_id`, [orderId]);
    if (b) afterCommit(() => publish([rooms.booking(b.id), rooms.branch(b.branch_id), rooms.account(order.account_id)], 'booking.updated', { bookingId: b.id, bookingNo: b.booking_no, status: b.status, paymentStatus: 'PAID' }));
  }

  for (const it of items) {
    switch (it.item_type) {
      case 'TOPUP': {
        if (!order.account_id) throw unprocessable('ACCOUNT_REQUIRED', 'Top-up requires a card / wristband');
        const w = await walletForAccount(tx, order.account_id);
        await postLedger(tx, { walletId: w.id, type: 'TOPUP', credit: it.total, referenceType: 'ORDER', referenceId: order.order_no, orderId, credentialId: order.credential_id,
          memberId: order.member_id, storeId: order.store_id, deviceId: order.device_id, staffId: order.staff_id, branchId: order.branch_id, idempotencyKey: `topup:${it.id}` }, afterCommit);
        break;
      }
      case 'RIDE_ADDON': {
        const ride = await one(tx, 'SELECT * FROM rides WHERE id = $1', [it.ride_id]);
        const meta = it.metadata ?? {};
        const { grantAddonEntitlement } = await import('./rides.js');
        for (let i = 0; i < it.qty; i++) await grantAddonEntitlement(tx, { order, ride, entitlementType: meta.entitlementType ?? ride.addon_entitlement_type, uses: meta.uses ?? ride.addon_uses, ticketId: meta.ticketId ?? null });
        await tx.query(`UPDATE ride_purchase_requests SET status = 'PAID', completed_at = now() WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
        afterCommit(() => publish([rooms.ride(ride.id), rooms.account(order.account_id)], 'ride.purchase.updated', { orderId, rideId: ride.id, status: 'PAID', credentialId: order.credential_id }));
        break;
      }
      case 'LOCKER': {
        const { startLockerSession } = await import('./lockers.js');
        await startLockerSession(tx, actor, order, it, afterCommit);
        break;
      }
      case 'MEMBERSHIP': {
        const { activateMembership } = await import('./membership.js');
        await activateMembership(tx, actor, order, it, items.some((x: any) => x.item_type === 'PHYSICAL_CARD'), afterCommit);
        break;
      }
      case 'PRODUCT': {
        if (it.metadata?.trackStock && order.store_id) {
          await moveStock(tx, { productId: it.product_id, storeId: order.store_id, delta: -it.qty, type: 'SALE', orderId, staffId: order.staff_id, branchId: order.branch_id }, afterCommit);
        }
        if (it.metadata?.voucherCode) {
          const v = await one(tx, `UPDATE reward_redemptions SET status = 'USED', used_at = now(), used_order_id = $2 WHERE voucher_code = $1 AND status = 'ISSUED' RETURNING id`, [it.metadata.voucherCode, orderId]);
          if (!v) throw unprocessable('VOUCHER_INVALID', 'Voucher already used');
        }
        break;
      }
    }
  }

  // kitchen
  const toKitchen = items.some((i: any) => i.item_type === 'PRODUCT' && i.metadata?.sendToKitchen);
  let queueNo = order.queue_no;
  if (toKitchen && order.store_id) {
    queueNo = await codes.foodQueue(tx, order.store_code ?? 'K');
    await tx.query(`UPDATE orders SET kitchen_status = 'NEW', queue_no = $2 WHERE id = $1`, [orderId, queueNo]);
    afterCommit(() => publish([rooms.kds(order.store_id)], 'kitchen.order', { orderId, queueNo, status: 'NEW' }));
  }

  await recordPromotionUsage(tx, order);

  // loyalty
  if (order.member_id) {
    const earned = await computeEarnedPoints(tx, order, items);
    if (earned > 0) {
      await postPoints(tx, { memberId: order.member_id, type: 'EARN', points: earned, referenceType: 'ORDER', referenceId: order.order_no, idempotencyKey: `earn:${orderId}` }, afterCommit);
    }
    const spend = items.filter((i: any) => i.item_type !== 'TOPUP').reduce((s: number, i: any) => s + i.total, 0);
    await tx.query('UPDATE members SET total_spend = total_spend + $2 WHERE id = $1', [order.member_id, spend]);
    await tx.query('UPDATE orders SET points_earned = $2 WHERE id = $1', [orderId, earned]);
  }

  const done = await one(tx, `UPDATE orders SET fulfilled_at = now(), fulfillment_error = NULL WHERE id = $1 RETURNING *`, [orderId]);
  await audit(tx, actor, { action: 'ORDER_PAID', entityType: 'order', entityId: order.order_no, branchId: order.branch_id, after: { total: order.total, type: order.type, queueNo } });
  afterCommit(() => publish([rooms.branch(order.branch_id), rooms.owner], 'dashboard.changed', { reason: 'order', type: order.type }));
  return done;
}

/**
 * External confirmation (gateway webhook / slip approval / payment terminal / cash at ride):
 * payment + fulfillment in one transaction. If fulfillment fails the money is still
 * recorded (payment PAID, order flagged) and the reconciliation job retries — the
 * customer is never charged without a recovery path.
 */
export async function confirmExternalPayment(actor: Actor, paymentId: string, extra: { reference?: string | null; payload?: unknown } = {}) {
  try {
    return await withTx((tx, after) => markPaymentPaid(tx, actor, paymentId, extra, after));
  } catch (err: any) {
    if (err instanceof AppError && ['PAYMENT_NOT_PENDING', 'ORDER_NOT_PAYABLE', 'OVERPAYMENT'].includes(err.code)) throw err;
    // capture the money, flag the order for reconciliation
    await withTx(async (tx) => {
      const pay = await one(tx, 'SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!pay || pay.status === 'PAID') return;
      await tx.query(`UPDATE payments SET status = 'PAID', paid_at = now(), reference = COALESCE($2, reference) WHERE id = $1`, [paymentId, extra.reference ?? null]);
      const order = await one(tx, `UPDATE orders SET paid_total = LEAST(total, paid_total + $2), status = CASE WHEN paid_total + $2 >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          paid_at = now(), fulfillment_error = $3, fulfillment_attempts = fulfillment_attempts + 1 WHERE id = $1 RETURNING *`, [pay.order_id, pay.amount, String(err?.message ?? err)]);
      await journal(tx, { branchId: order.branch_id, type: 'SALE', category: categoryOfOrder(order.type), method: pay.method, direction: 'IN', amount: pay.amount,
        orderId: order.id, paymentId: pay.id, accountId: order.account_id, memberId: order.member_id, reference: order.order_no, metadata: { fulfillmentPending: true } });
      await notify({ branchId: order.branch_id, type: 'FULFILLMENT_FAILED', severity: 'CRITICAL', title: 'Paid order needs attention',
        message: `${order.order_no}: payment captured but fulfillment failed (${err?.message}). Auto-retry scheduled.`, data: { orderId: order.id }, targetPermission: 'transaction.view' }, tx);
      await audit(tx, actor, { action: 'FULFILLMENT_FAILED', entityType: 'order', entityId: order.order_no, metadata: { error: String(err?.message ?? err) } });
    });
    throw err;
  }
}

/** Reconciliation: retry fulfillment of paid-but-unfulfilled orders. */
export async function retryUnfulfilled(limit = 20) {
  const rows = await query(pool, `SELECT id FROM orders WHERE status = 'PAID' AND fulfilled_at IS NULL AND fulfillment_attempts < 10 ORDER BY paid_at LIMIT $1`, [limit]);
  let ok = 0;
  for (const r of rows) {
    try {
      await withTx((tx, after) => fulfillOrder(tx, SYSTEM_ACTOR, r.id, after));
      ok++;
    } catch (err: any) {
      await pool.query('UPDATE orders SET fulfillment_attempts = fulfillment_attempts + 1, fulfillment_error = $2 WHERE id = $1', [r.id, String(err?.message ?? err)]);
    }
  }
  return { attempted: rows.length, fulfilled: ok };
}

export async function orderDetail(db: Db, idOrNo: string) {
  const o = await one(db, `SELECT o.*, s.name AS store_name, st.first_name AS staff_name, m.member_code, b.booking_no
      FROM orders o LEFT JOIN stores s ON s.id = o.store_id LEFT JOIN staff st ON st.id = o.staff_id LEFT JOIN members m ON m.id = o.member_id
      LEFT JOIN bookings b ON b.order_id = o.id
     WHERE o.id::text = $1 OR o.order_no = $1`, [idOrNo]);
  if (!o) throw notFound('Order');
  const items = await query(db, 'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
  const payments = await query(db, 'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [o.id]);
  const refunds = await query(db, 'SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at', [o.id]);
  return { ...o, items, payments, refunds };
}

/** Cancel an unpaid order (releases tickets / pending payments). */
export async function cancelOrder(tx: Db, actor: Actor, orderId: string, reason: string) {
  const o = await one(tx, 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o) throw notFound('Order');
  if (o.status !== 'PENDING') throw conflict('ORDER_NOT_CANCELLABLE', `Only unpaid orders can be cancelled (status ${o.status}); use void / refund`);
  await tx.query(`UPDATE orders SET status = 'CANCELLED', void_reason = $2, voided_at = now() WHERE id = $1`, [orderId, reason]);
  await tx.query(`UPDATE payments SET status = 'CANCELLED' WHERE order_id = $1 AND status IN ('PENDING','WAITING_VERIFICATION')`, [orderId]);
  await tx.query(`UPDATE tickets SET status = 'CANCELLED' WHERE order_id = $1 AND status = 'UNPAID'`, [orderId]);
  await tx.query(`UPDATE bookings SET status = 'CANCELLED' WHERE order_id = $1`, [orderId]);
  await tx.query(`UPDATE ride_purchase_requests SET status = 'CANCELLED' WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
  await audit(tx, actor, { action: 'ORDER_CANCEL', entityType: 'order', entityId: o.order_no, reason, branchId: o.branch_id });
}
