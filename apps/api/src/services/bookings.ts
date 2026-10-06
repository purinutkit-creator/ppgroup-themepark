import { pool, one, query, type Db } from '../db/pool.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes, businessDate } from '../lib/codes.js';
import { randomToken } from '../lib/crypto.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { createGuestAccount, ensureMemberAccount } from './accounts.js';
import { createOrder, memberContext, priceItems, type MemberCtx, type PricedLine } from './orders.js';
import { issueCredential, credentialPayloads, linkTicket, resolveScan, wristbandExpiry } from './credentials.js';
import { addDays, endOfDay } from './tickets.js';

export interface GuestQty { ticketTypeId: string; qty: number }
export interface QuoteInput {
  branchId: string;
  packageId: string;
  visitDate: string;
  guests?: GuestQty[];        // PER_GUEST packages
  bundles?: number;           // BUNDLE packages
  addons?: Array<{ productId: string; qty: number }>;
  memberId?: string | null;
  couponCode?: string | null;
  channel: 'ONLINE' | 'COUNTER' | 'KIOSK';
}

export async function listSellablePackages(db: Db, branchId: string, channel: string, visitDate?: string | null, memberId?: string | null) {
  const pkgs = await query(db, `SELECT p.* FROM packages p WHERE p.is_active AND (p.branch_id IS NULL OR p.branch_id = $1) AND $2 = ANY(p.channels)
      AND (p.sale_start IS NULL OR p.sale_start <= now()) AND (p.sale_end IS NULL OR p.sale_end >= now()) ORDER BY p.sort, p.name`, [branchId, channel]);
  const out = [];
  for (const p of pkgs) {
    const prices = await query(db, `SELECT pp.*, tt.code AS ticket_type_code, tt.name AS ticket_type_name, tt.name_en AS ticket_type_name_en, tt.min_age, tt.max_age
        FROM package_prices pp JOIN ticket_types tt ON tt.id = pp.ticket_type_id WHERE pp.package_id = $1 AND tt.is_active ORDER BY tt.sort`, [p.id]);
    const rides = await query(db, `SELECT r.id, r.name, r.code, pr.entitlement_type, pr.uses FROM package_rides pr JOIN rides r ON r.id = pr.ride_id WHERE pr.package_id = $1 ORDER BY r.sort, r.name`, [p.id]);
    const benefits = await query(db, `SELECT type, value, label FROM package_benefits WHERE package_id = $1`, [p.id]);
    let available: { ok: boolean; reason?: string; remaining?: number | null } = { ok: true };
    if (visitDate) {
      try { available = { ok: true, remaining: await checkAvailability(db, p, branchId, visitDate, 1, channel) }; }
      catch (e: any) { available = { ok: false, reason: e.message }; }
    }
    out.push({ ...p, prices, rides, benefits, available, memberPricing: !!memberId });
  }
  return out;
}

/** Validate package rules + capacity for a visit date. Returns remaining capacity (null = unlimited). */
export async function checkAvailability(db: Db, pkg: any, branchId: string, visitDate: string, guests: number, channel: string): Promise<number | null> {
  const today = businessDate();
  const bcfg = await getSetting('booking', branchId, db);
  if (!pkg.is_active) throw unprocessable('PACKAGE_INACTIVE', 'Package not available');
  if (pkg.branch_id && pkg.branch_id !== branchId) throw unprocessable('WRONG_BRANCH', 'Package not sold at this branch');
  if (!pkg.channels.includes(channel)) throw unprocessable('CHANNEL_NOT_ALLOWED', `Package not sold via ${channel}`);
  if (visitDate < today) throw unprocessable('PAST_DATE', 'Visit date is in the past');
  if (visitDate > addDays(today, bcfg.advanceDays)) throw unprocessable('TOO_FAR', `Bookings open ${bcfg.advanceDays} days in advance`);
  if (pkg.valid_from && visitDate < pkg.valid_from) throw unprocessable('NOT_YET_VALID', `Package valid from ${pkg.valid_from}`);
  if (pkg.valid_to && visitDate > pkg.valid_to) throw unprocessable('PACKAGE_EXPIRED', `Package valid until ${pkg.valid_to}`);
  const dow = new Date(`${visitDate}T00:00:00Z`).getUTCDay();
  if (!pkg.valid_days_of_week.includes(dow)) throw unprocessable('WRONG_DAY', 'Package not valid on this day of week');
  if (await one(db, 'SELECT 1 FROM package_blackout_dates WHERE package_id = $1 AND date = $2', [pkg.id, visitDate])) {
    throw unprocessable('BLACKOUT_DATE', 'Package not available on this date (blackout)');
  }
  const branch = await one(db, 'SELECT capacity FROM branches WHERE id = $1', [branchId]);
  const soldBranch = await one(db, `SELECT COUNT(*)::int AS n FROM tickets WHERE branch_id = $1 AND visit_date = $2 AND status NOT IN ('CANCELLED','REFUNDED','EXPIRED')`, [branchId, visitDate]);
  let remaining: number | null = branch.capacity - soldBranch.n;
  if (pkg.daily_capacity) {
    const soldPkg = await one(db, `SELECT COUNT(*)::int AS n FROM tickets WHERE package_id = $1 AND visit_date = $2 AND status NOT IN ('CANCELLED','REFUNDED','EXPIRED')`, [pkg.id, visitDate]);
    remaining = Math.min(remaining, pkg.daily_capacity - soldPkg.n);
  }
  const cap = await getSetting('capacity', branchId, db);
  if (channel === 'ONLINE' && cap.stopOnlineSalesWhenFull) {
    if (remaining < guests) throw unprocessable('SOLD_OUT', 'ขออภัย บัตรสำหรับวันที่เลือกเต็มแล้ว / Sold out for this date');
    if (visitDate === today) {
      const inside = await one(db, `SELECT COUNT(*)::int AS n FROM tickets WHERE branch_id = $1 AND presence = 'INSIDE'`, [branchId]);
      if (inside.n >= branch.capacity) throw unprocessable('PARK_FULL', 'สวนสนุกเต็มความจุแล้ว / Park at full capacity');
    }
  } else if (remaining < guests && channel !== 'COUNTER') {
    throw unprocessable('SOLD_OUT', 'Sold out for this date');
  }
  return remaining;
}

interface TicketPlan { ticketTypeId: string; ticketTypeCode: string; ticketTypeName: string; price: number }

async function planTickets(db: Db, pkg: any, input: QuoteInput, mctx: MemberCtx): Promise<{ lines: PricedLine[]; plan: TicketPlan[] }> {
  const lines: PricedLine[] = [];
  const plan: TicketPlan[] = [];
  if (pkg.pricing_mode === 'BUNDLE') {
    const bundles = input.bundles ?? 1;
    if (!Number.isInteger(bundles) || bundles < 1) throw badRequest('INVALID_QTY', 'Bundle quantity must be ≥ 1');
    const price = mctx.member && pkg.bundle_member_price != null ? Number(pkg.bundle_member_price) : Number(pkg.bundle_price ?? 0);
    const comp: Array<{ ticket_type_code: string; qty: number }> = pkg.bundle_guests ?? [];
    const guestsPer = comp.reduce((s, c) => s + c.qty, 0) || 1;
    lines.push({ itemType: 'PACKAGE', name: pkg.name, qty: bundles, unitPrice: price, category: 'TICKET', pointsCategory: 'PACKAGE', discountable: true, packageId: pkg.id });
    for (let b = 0; b < bundles; b++) {
      let first = true;
      for (const c of comp) {
        const tt = await one(db, 'SELECT id, code, name FROM ticket_types WHERE code = $1', [c.ticket_type_code]);
        if (!tt) throw unprocessable('BAD_BUNDLE', `Bundle references unknown ticket type ${c.ticket_type_code}`);
        for (let i = 0; i < c.qty; i++) {
          const share = Math.floor(price / guestsPer) + (first ? price % guestsPer : 0);
          first = false;
          plan.push({ ticketTypeId: tt.id, ticketTypeCode: tt.code, ticketTypeName: tt.name, price: share });
        }
      }
    }
  } else {
    const guests = (input.guests ?? []).filter((g) => g.qty > 0);
    if (!guests.length) throw badRequest('NO_GUESTS', 'Select at least one guest');
    for (const g of guests) {
      if (!Number.isInteger(g.qty) || g.qty < 1) throw badRequest('INVALID_QTY', 'Guest quantity must be ≥ 1');
      const pp = await one(db, `SELECT pp.*, tt.code, tt.name FROM package_prices pp JOIN ticket_types tt ON tt.id = pp.ticket_type_id
          WHERE pp.package_id = $1 AND pp.ticket_type_id = $2`, [pkg.id, g.ticketTypeId]);
      if (!pp) throw unprocessable('TICKET_TYPE_NOT_SOLD', 'Ticket type not available for this package');
      const price = mctx.member && pp.member_price != null ? Number(pp.member_price) : Number(pp.price);
      lines.push({ itemType: 'PACKAGE', name: `${pkg.name} — ${pp.name}`, qty: g.qty, unitPrice: price, category: 'TICKET', pointsCategory: 'PACKAGE',
        discountable: true, packageId: pkg.id, ticketTypeId: pp.ticket_type_id, ticketTypeCode: pp.code });
      for (let i = 0; i < g.qty; i++) plan.push({ ticketTypeId: pp.ticket_type_id, ticketTypeCode: pp.code, ticketTypeName: pp.name, price });
    }
  }
  return { lines, plan };
}

async function loadPackage(db: Db, id: string) {
  const pkg = await one(db, 'SELECT * FROM packages WHERE id = $1', [id]);
  if (!pkg) throw notFound('Package');
  return pkg;
}

async function addonLines(db: Db, branchId: string, addons: QuoteInput['addons'], mctx: MemberCtx) {
  if (!addons?.length) return [];
  for (const a of addons) {
    const p = await one(db, 'SELECT sellable_online FROM products WHERE id = $1', [a.productId]);
    if (!p?.sellable_online) throw unprocessable('ADDON_NOT_AVAILABLE', 'Add-on not available for booking');
  }
  return priceItems(db, branchId, addons.map((a) => ({ type: 'PRODUCT' as const, productId: a.productId, qty: a.qty })), mctx);
}

/** Price preview without persisting (used by website / counter / kiosk before checkout). */
export async function quote(input: QuoteInput) {
  const db = await pool.connect();
  try { return await quoteWith(db, input); } finally { db.release(); }
}

async function quoteWith(db: Db, input: QuoteInput) {
  const pkg = await loadPackage(db, input.packageId);
  const mctx = await memberContext(db, input.memberId);
  const { lines, plan } = await planTickets(db, pkg, input, mctx);
  await checkAvailability(db, pkg, input.branchId, input.visitDate, plan.length, input.channel);
  const all = [...lines, ...(await addonLines(db, input.branchId, input.addons, mctx))];
  // dry-run promotions on a savepoint so nothing is written
  await db.query('BEGIN');
  try {
    const actor: Actor = { type: 'PUBLIC', permissions: new Set(), ip: 'quote' };
    const { order, items, rejectedCoupon } = await createOrder(db, actor, {
      branchId: input.branchId, type: 'BOOKING', channel: input.channel, lines: all, memberCtx: mctx, couponCode: input.couponCode, visitDate: input.visitDate,
    });
    return {
      package: { id: pkg.id, name: pkg.name, days: pkg.days }, visitDate: input.visitDate, guests: plan.length,
      items: items.map((i: any) => ({ name: i.name, qty: i.qty, unitPrice: i.unit_price, discount: i.discount, total: i.total })),
      subtotal: order.subtotal, discount: order.discount_total, total: order.total, tax: order.tax_total, promotions: order.promotions, rejectedCoupon,
      memberPricing: !!mctx.member,
    };
  } finally {
    await db.query('ROLLBACK');
  }
}

export interface CreateBookingInput extends QuoteInput {
  customerName: string;
  phone: string;
  email?: string | null;
  paymentMode: 'PAY_NOW' | 'PAY_AT_PARK';
  guestDetails?: Array<{ name?: string; birthday?: string; heightCm?: number }>;
  notes?: string | null;
  accountId?: string | null;
  idempotencyKey?: string | null;
}

export async function createBooking(tx: Db, actor: Actor, input: CreateBookingInput, afterCommit: (cb: () => void) => void) {
  const pkg = await loadPackage(tx, input.packageId);
  const bcfg = await getSetting('booking', input.branchId, tx);
  if (input.paymentMode === 'PAY_AT_PARK' && !bcfg.payAtParkEnabled && input.channel === 'ONLINE') throw unprocessable('PAY_AT_PARK_DISABLED', 'Pay at park is not available');
  if (!input.memberId && input.channel === 'ONLINE' && !bcfg.guestCheckout) throw unprocessable('LOGIN_REQUIRED', 'Please log in to book');
  if (input.idempotencyKey) {
    const dup = await one(tx, `SELECT b.* FROM bookings b JOIN orders o ON o.id = b.order_id WHERE o.idempotency_key = $1`, [input.idempotencyKey]);
    if (dup) return bookingDetail(tx, dup.id);
  }
  // serialise capacity checks for (branch, date)
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cap:${input.branchId}:${input.visitDate}`]);
  const mctx = await memberContext(tx, input.memberId);
  const { lines, plan } = await planTickets(tx, pkg, input, mctx);
  if (plan.length > bcfg.maxGuests) throw unprocessable('TOO_MANY_GUESTS', `Maximum ${bcfg.maxGuests} guests per booking`);
  await checkAvailability(tx, pkg, input.branchId, input.visitDate, plan.length, input.channel);
  const accountId = input.accountId ?? (mctx.member ? await ensureMemberAccount(tx, mctx.member.id)
    : await createGuestAccount(tx, { name: input.customerName, phone: input.phone, email: input.email, branchId: input.branchId }));
  const all = [...lines, ...(await addonLines(tx, input.branchId, input.addons, mctx))];
  const { order, rejectedCoupon } = await createOrder(tx, actor, {
    branchId: input.branchId, type: 'BOOKING', channel: input.channel, lines: all, memberCtx: mctx, accountId, couponCode: input.couponCode,
    visitDate: input.visitDate, customerName: input.customerName, idempotencyKey: input.idempotencyKey,
  });
  if (input.couponCode && rejectedCoupon) throw unprocessable('COUPON_INVALID', rejectedCoupon);
  const cfgPay = await getSetting('payments', input.branchId, tx);
  const bookingNo = await uniqueBookingNo(tx, input.visitDate);
  const status = order.total === 0 ? 'PENDING_PAYMENT' : input.paymentMode === 'PAY_AT_PARK' ? 'RESERVED' : 'PENDING_PAYMENT';
  const expiresAt = input.paymentMode === 'PAY_AT_PARK' ? endOfDay(input.visitDate) : new Date(Date.now() + cfgPay.onlinePaymentTimeoutMin * 60_000);
  const booking = await one(tx, `INSERT INTO bookings(booking_no, branch_id, account_id, member_id, order_id, customer_name, phone, email, visit_date, guests, status,
      payment_mode, channel, public_token, notes, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [bookingNo, input.branchId, accountId, mctx.member?.id ?? null, order.id, input.customerName, input.phone, input.email ?? null, input.visitDate, plan.length,
     status, input.paymentMode, input.channel, randomToken(24), input.notes ?? null, input.channel === 'COUNTER' ? null : expiresAt]);
  for (const l of all) {
    await tx.query(`INSERT INTO booking_items(booking_id, item_type, package_id, ticket_type_id, product_id, name, qty, unit_price, total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [booking!.id, l.itemType === 'PACKAGE' ? 'PACKAGE' : 'ADDON', l.packageId ?? null, l.ticketTypeId ?? null, l.productId ?? null, l.name, l.qty, l.unitPrice, l.unitPrice * l.qty]);
  }
  const validTo = pkg.multi_day_mode === 'ANY_WITHIN' && pkg.any_within_days ? addDays(input.visitDate, pkg.any_within_days - 1) : addDays(input.visitDate, pkg.days - 1);
  const discountRatio = order.subtotal > 0 ? order.discount_total / order.subtotal : 0;
  const tickets = [];
  for (const [i, t] of plan.entries()) {
    const gd = input.guestDetails?.[i];
    const code = await codes.ticket(tx);
    const ticket = await one(tx, `INSERT INTO tickets(ticket_code, branch_id, booking_id, order_id, package_id, ticket_type_id, account_id, member_id, guest_name, guest_birthday,
        guest_height_cm, visit_date, valid_from, valid_to, days_allowed, status, price, discount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,'UNPAID',$15,$16) RETURNING *`,
      [code, input.branchId, booking!.id, order.id, pkg.id, t.ticketTypeId, accountId, mctx.member?.id ?? null, gd?.name ?? (i === 0 ? input.customerName : null),
       gd?.birthday ?? null, gd?.heightCm ?? null, input.visitDate, validTo, pkg.days, t.price, Math.round(t.price * discountRatio)]);
    await tx.query(`INSERT INTO booking_guests(booking_id, ticket_type_id, name, birthday, height_cm, ticket_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [booking!.id, t.ticketTypeId, ticket!.guest_name, gd?.birthday ?? null, gd?.heightCm ?? null, ticket!.id]);
    const qr = await issueCredential(tx, { type: 'QR_TICKET', code, branchId: input.branchId, accountId, memberId: mctx.member?.id, expiresAt: endOfDay(validTo), expirationPolicy: 'PACKAGE' });
    await linkTicket(tx, actor, qr.id, ticket!.id);
    tickets.push(ticket);
  }
  const bcred = await issueCredential(tx, { type: 'BOOKING', code: bookingNo, branchId: input.branchId, accountId, memberId: mctx.member?.id, expiresAt: endOfDay(validTo), expirationPolicy: 'PACKAGE' });
  await tx.query(`INSERT INTO credential_links(credential_id, link_type, booking_id) VALUES ($1,'BOOKING',$2)`, [bcred.id, booking!.id]);
  await tx.query('UPDATE bookings SET credential_id = $2 WHERE id = $1', [booking!.id, bcred.id]);
  await audit(tx, actor, { action: 'BOOKING_CREATE', entityType: 'booking', entityId: bookingNo, branchId: input.branchId,
    after: { visitDate: input.visitDate, guests: plan.length, total: order.total, paymentMode: input.paymentMode, channel: input.channel } });
  // free bookings (100% promotion) are confirmed instantly
  if (order.total === 0) {
    const { fulfillOrder } = await import('./orders.js');
    await tx.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [order.id]);
    await fulfillOrder(tx, actor, order.id, afterCommit);
  }
  afterCommit(() => publish([rooms.branch(input.branchId)], 'booking.created', { bookingNo, visitDate: input.visitDate, guests: plan.length }));
  return bookingDetail(tx, booking!.id);
}

async function uniqueBookingNo(db: Db, visitDate: string) {
  for (let i = 0; i < 10; i++) {
    const no = codes.booking(businessDate());
    if (!(await one(db, 'SELECT 1 FROM bookings WHERE booking_no = $1', [no]))) return no;
  }
  throw conflict('BOOKING_NO_EXHAUSTED', 'Could not allocate booking number, retry');
}

export async function bookingDetail(db: Db, idOrNo: string, opts: { includeToken?: boolean } = {}) {
  const b = await one(db, `SELECT b.*, o.order_no, o.subtotal, o.discount_total, o.total, o.paid_total, o.status AS order_status, o.promotions,
        br.name AS branch_name, c.token AS credential_token, m.member_code
      FROM bookings b JOIN orders o ON o.id = b.order_id JOIN branches br ON br.id = b.branch_id
      LEFT JOIN credentials c ON c.id = b.credential_id LEFT JOIN members m ON m.id = b.member_id
     WHERE b.id::text = $1 OR b.booking_no = $1`, [idOrNo]);
  if (!b) throw notFound('Booking');
  const items = await query(db, 'SELECT name, qty, unit_price, total, item_type FROM booking_items WHERE booking_id = $1', [b.id]);
  const tickets = await query(db, `SELECT t.id, t.ticket_code, t.status, t.presence, t.guest_name, t.visit_date, t.valid_to, t.price, tt.name AS ticket_type, p.name AS package_name,
        c.token, c.code AS credential_code,
        (SELECT json_agg(json_build_object('code', wc.code, 'type', wc.type, 'status', wc.status)) FROM credential_links wl JOIN credentials wc ON wc.id = wl.credential_id
           WHERE wl.ticket_id = t.id AND wl.unlinked_at IS NULL AND wc.type NOT IN ('QR_TICKET','BOOKING')) AS wristbands
      FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
      LEFT JOIN credentials c ON c.code = t.ticket_code AND c.type = 'QR_TICKET'
     WHERE t.booking_id = $1 ORDER BY t.ticket_code`, [b.id]);
  const payments = await query(db, `SELECT id, payment_no, method, status, amount, reference, paid_at, expires_at, provider_payload FROM payments WHERE order_id = $1 ORDER BY created_at`, [b.order_id]);
  const verification = await one(db, `SELECT id, status, review_note, created_at FROM payment_verification_requests WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [b.order_id]);
  const paymentStatus = b.paid_total >= b.total ? 'PAID' : b.status === 'PENDING_VERIFICATION' ? 'WAITING_VERIFICATION' : b.paid_total > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
  const payloads = b.credential_token ? credentialPayloads({ token: b.credential_token, type: 'BOOKING' }) : null;
  const { credential_token, public_token, ...rest } = b;
  return {
    ...rest, ...(opts.includeToken ? { public_token } : {}), paymentStatus, items, payments, verification,
    qr: payloads?.qr ?? null, barcode: payloads?.barcode ?? null,
    tickets: tickets.map(({ token, ...t }: any) => ({ ...t, qr: token ? credentialPayloads({ token, type: 'QR_TICKET' }).qr : null })),
  };
}

/** Counter scan of a booking barcode / ticket QR → open booking. */
export async function bookingFromScan(db: Db, raw: string) {
  const trimmed = raw.trim().toUpperCase();
  if (/^BK-\d{6}-\d{5}$/.test(trimmed)) return bookingDetail(db, trimmed);
  const { credential } = await resolveScan(db, raw, { allowCode: true });
  if (credential.type === 'BOOKING') return bookingDetail(db, credential.code);
  const t = await one(db, `SELECT t.booking_id FROM credential_links cl JOIN tickets t ON t.id = cl.ticket_id WHERE cl.credential_id = $1 AND cl.unlinked_at IS NULL AND t.booking_id IS NOT NULL ORDER BY t.visit_date DESC LIMIT 1`, [credential.id]);
  if (!t) throw notFound('Booking for this credential');
  return bookingDetail(db, t.booking_id);
}

export interface CheckinAssignment {
  ticketId: string;
  mode: 'GENERATE' | 'SCAN' | 'MEMBER_CARD';
  scan?: string;                   // pre-printed wristband / card payload or physical serial
  heightCm?: number;
  guestName?: string;
}

/**
 * Booking → wristband flow: verify payment, bind each ticket to a wristband (new printed band,
 * pre-printed stock band, or the member's card). Wristband inherits all rights of the ticket.
 */
export async function checkinBooking(tx: Db, actor: Actor, bookingId: string, assignments: CheckinAssignment[], afterCommit: (cb: () => void) => void) {
  const b = await one(tx, 'SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
  if (!b) throw notFound('Booking');
  if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status)) {
    throw unprocessable('PAYMENT_REQUIRED', b.status === 'RESERVED' || b.status === 'PENDING_PAYMENT' ? 'ยังไม่ได้ชำระเงิน กรุณารับชำระก่อน / Payment pending' : `Booking is ${b.status}`);
  }
  const today = businessDate();
  const bcfg = await getSetting('booking', b.branch_id, tx);
  const wcfg = await getSetting('wristband', b.branch_id, tx);
  const issued = [];
  for (const a of assignments) {
    const t = await one(tx, 'SELECT * FROM tickets WHERE id = $1 AND booking_id = $2 FOR UPDATE', [a.ticketId, bookingId]);
    if (!t) throw notFound('Ticket in booking');
    if (t.status !== 'ACTIVE') throw unprocessable('TICKET_NOT_ACTIVE', `Ticket ${t.ticket_code} is ${t.status}`);
    if (today > t.valid_to) throw unprocessable('TICKET_EXPIRED', `Ticket ${t.ticket_code} expired`);
    if (a.heightCm || a.guestName) await tx.query('UPDATE tickets SET guest_height_cm = COALESCE($2, guest_height_cm), guest_name = COALESCE($3, guest_name) WHERE id = $1', [t.id, a.heightCm ?? null, a.guestName ?? null]);
    // unlink previous wristbands of this ticket (re-issue)
    await tx.query(`UPDATE credential_links SET unlinked_at = now() WHERE ticket_id = $1 AND unlinked_at IS NULL
        AND credential_id IN (SELECT id FROM credentials WHERE type IN ('WRISTBAND','PRINTED_WRISTBAND','TEMP_CARD'))`, [t.id]);
    let accountId = t.account_id;
    if (!b.member_id && !bcfg.sharedWalletOnCheckin && assignments.length > 1) {
      accountId = await createGuestAccount(tx, { name: a.guestName ?? t.guest_name, branchId: b.branch_id });
      await tx.query('UPDATE tickets SET account_id = $2 WHERE id = $1', [t.id, accountId]);
      await tx.query('UPDATE ride_entitlements SET account_id = $2 WHERE ticket_id = $1', [t.id, accountId]);
    }
    const expires = wristbandExpiry(wcfg.defaultExpiration, t.valid_to);
    let cred: any;
    if (a.mode === 'MEMBER_CARD') {
      if (!a.scan) throw badRequest('SCAN_REQUIRED', 'Scan member card');
      const { credential } = await resolveScan(tx, a.scan, { allowCode: true, lock: true });
      if (!credential.member_id) throw unprocessable('NOT_MEMBER_CARD', 'Credential is not a member card');
      if (credential.status !== 'ACTIVE') throw unprocessable('CREDENTIAL_NOT_ACTIVE', `Card is ${credential.status}`);
      cred = credential;
    } else if (a.mode === 'SCAN') {
      if (!a.scan) throw badRequest('SCAN_REQUIRED', 'Scan wristband');
      let found: any = null;
      try { found = (await resolveScan(tx, a.scan, { allowCode: true, lock: true })).credential; } catch { found = null; }
      if (found) {
        if (!['NEW', 'ACTIVE'].includes(found.status)) throw unprocessable('CREDENTIAL_NOT_USABLE', `Wristband ${found.code} is ${found.status}`);
        if (found.status === 'ACTIVE' && found.account_id && found.account_id !== accountId) {
          const busy = await one(tx, `SELECT 1 FROM credential_links cl JOIN tickets tk ON tk.id = cl.ticket_id WHERE cl.credential_id = $1 AND cl.unlinked_at IS NULL AND tk.status = 'ACTIVE' AND tk.valid_to >= $2`, [found.id, today]);
          if (busy) throw conflict('WRISTBAND_IN_USE', `Wristband ${found.code} is already bound to another active ticket`);
        }
        cred = await one(tx, `UPDATE credentials SET status = 'ACTIVE', activated_at = COALESCE(activated_at, now()), account_id = $2, member_id = $3, branch_id = $4,
            expires_at = $5, expiration_policy = $6 WHERE id = $1 RETURNING *`, [found.id, accountId, b.member_id, b.branch_id, expires, wcfg.defaultExpiration]);
      } else {
        // unknown pre-printed serial → register it
        cred = await issueCredential(tx, { type: 'WRISTBAND', branchId: b.branch_id, accountId, memberId: b.member_id, physicalSerial: a.scan.trim().toUpperCase(),
          expirationPolicy: wcfg.defaultExpiration as any, expiresAt: expires, issuedBy: actor.staffId });
      }
    } else {
      cred = await issueCredential(tx, { type: 'PRINTED_WRISTBAND', branchId: b.branch_id, accountId, memberId: b.member_id,
        expirationPolicy: wcfg.defaultExpiration as any, expiresAt: expires, issuedBy: actor.staffId });
    }
    await linkTicket(tx, actor, cred.id, t.id);
    const tt = await one(tx, `SELECT p.name AS package_name, ty.name AS ticket_type FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types ty ON ty.id = t.ticket_type_id WHERE t.id = $1`, [t.id]);
    issued.push({ ticketId: t.id, ticketCode: t.ticket_code, credentialId: cred.id, code: cred.code, type: cred.type, packageName: tt.package_name, ticketType: tt.ticket_type,
      visitDate: t.visit_date, validTo: t.valid_to, guestName: a.guestName ?? t.guest_name, ...credentialPayloads(cred) });
  }
  await tx.query(`UPDATE bookings SET status = 'CHECKED_IN', checked_in_at = COALESCE(checked_in_at, now()) WHERE id = $1`, [bookingId]);
  await audit(tx, actor, { action: 'BOOKING_CHECKIN', entityType: 'booking', entityId: b.booking_no, branchId: b.branch_id, after: { wristbands: issued.map((i) => i.code) } });
  afterCommit(() => publish([rooms.booking(b.id), rooms.branch(b.branch_id)], 'booking.updated', { bookingId: b.id, status: 'CHECKED_IN' }));
  return issued;
}

export async function listBookings(db: Db, branchId: string, f: { filter?: string; q?: string; date?: string; page: number; pageSize: number }) {
  const today = businessDate();
  const where: string[] = ['b.branch_id = $1'];
  const params: unknown[] = [branchId];
  const add = (sql: string, v?: unknown) => { if (v !== undefined) params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  switch (f.filter) {
    case 'TODAY': add('b.visit_date = ?', today); break;
    case 'TOMORROW': add('b.visit_date = ?', addDays(today, 1)); break;
    case 'UPCOMING': add('b.visit_date >= ?', today); break;
    case 'UNPAID': add(`b.status IN ('PENDING_PAYMENT','RESERVED')`); break;
    case 'PAID': add(`o.paid_total >= o.total AND b.status NOT IN ('REFUNDED','CANCELLED')`); break;
    case 'PENDING_VERIFICATION': add(`b.status = 'PENDING_VERIFICATION'`); break;
    case 'CANCELLED': add(`b.status IN ('CANCELLED','EXPIRED')`); break;
    case 'REFUNDED': add(`b.status = 'REFUNDED'`); break;
    case 'CHECKED_IN': add(`b.status = 'CHECKED_IN'`); break;
    case 'NO_SHOW': add(`b.status = 'NO_SHOW'`); break;
  }
  if (f.date) add('b.visit_date = ?', f.date);
  if (f.q) {
    params.push(`%${f.q.trim()}%`);
    const i = params.length;
    where.push(`(b.booking_no ILIKE $${i} OR b.customer_name ILIKE $${i} OR b.phone ILIKE $${i} OR b.email ILIKE $${i} OR m.member_code ILIKE $${i}
      OR EXISTS (SELECT 1 FROM credentials c WHERE c.id = b.credential_id AND c.token = upper(trim($${i}, '%'))))`);
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const rows = await query(db, `SELECT b.id, b.booking_no, b.customer_name, b.phone, b.email, b.visit_date, b.guests, b.status, b.payment_mode, b.channel, b.created_at,
        o.total, o.paid_total, m.member_code, COUNT(*) OVER() AS total_count
      FROM bookings b JOIN orders o ON o.id = b.order_id LEFT JOIN members m ON m.id = b.member_id
     WHERE ${where.join(' AND ')} ORDER BY b.visit_date DESC, b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function bookingCalendar(db: Db, branchId: string, month: string) {
  const branch = await one(db, 'SELECT capacity FROM branches WHERE id = $1', [branchId]);
  const rows = await query(db, `SELECT t.visit_date AS date, COUNT(*)::int AS tickets, COUNT(DISTINCT t.booking_id)::int AS bookings
      FROM tickets t WHERE t.branch_id = $1 AND to_char(t.visit_date, 'YYYY-MM') = $2 AND t.status NOT IN ('CANCELLED','REFUNDED')
     GROUP BY t.visit_date ORDER BY t.visit_date`, [branchId, month]);
  return { capacity: branch?.capacity ?? 0, days: rows };
}

export async function cancelBooking(tx: Db, actor: Actor, bookingId: string, reason: string) {
  const b = await one(tx, 'SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
  if (!b) throw notFound('Booking');
  const o = await one(tx, 'SELECT * FROM orders WHERE id = $1', [b.order_id]);
  if (o.paid_total > 0) throw conflict('BOOKING_PAID', 'Booking is paid — use refund instead');
  const { cancelOrder } = await import('./orders.js');
  await cancelOrder(tx, actor, b.order_id, reason);
  await audit(tx, actor, { action: 'BOOKING_CANCEL', entityType: 'booking', entityId: b.booking_no, reason, branchId: b.branch_id });
  publish([rooms.booking(b.id)], 'booking.updated', { bookingId: b.id, status: 'CANCELLED' });
}
