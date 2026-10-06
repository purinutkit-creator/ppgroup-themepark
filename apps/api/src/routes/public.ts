import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { parse, zDate, zPhone, zUuid } from '../lib/http.js';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { randomBase32 } from '../lib/crypto.js';
import { withIdempotency } from '../lib/idempotency.js';
import { gateway, simulatorEnabled } from '../hardware/payment/index.js';
import { bookingDetail, createBooking, listSellablePackages, quote } from '../services/bookings.js';
import { initiatePayment, submitSlip } from '../services/payments.js';
import { confirmExternalPayment, createOrder, memberContext, priceItems } from '../services/orders.js';
import { getSetting } from '../services/settings.js';
import { SYSTEM_ACTOR } from '../services/audit.js';
import { occupancy } from '../services/gates.js';

const guestsSchema = z.array(z.object({ ticketTypeId: zUuid, qty: z.number().int().min(0).max(50) })).optional();
const addonsSchema = z.array(z.object({ productId: zUuid, qty: z.number().int().min(1).max(50) })).optional();

export async function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/config', async (req) => {
    const branchId = (req.query as any).branchId ?? null;
    const [park, fonts, payments, booking, membership, wallet] = await Promise.all([
      getSetting('park.info', branchId), getSetting('fonts', branchId), getSetting('payments', branchId), getSetting('booking', branchId), getSetting('membership', branchId), getSetting('wallet', branchId),
    ]);
    const customFonts = await query(pool, 'SELECT family, file_path FROM font_assets ORDER BY family');
    return {
      park, fonts, customFonts: customFonts.map((f: any) => ({ family: f.family, url: `/api/public/fonts/${f.file_path}` })),
      paymentMethods: Object.entries(payments.methods).filter(([, m]) => m.enabled).map(([k, m]) => ({ method: k, online: m.online, counter: m.counter })),
      booking: { payAtParkEnabled: booking.payAtParkEnabled, maxGuests: booking.maxGuests, advanceDays: booking.advanceDays, guestCheckout: booking.guestCheckout },
      membership: { digitalCardEnabled: membership.digitalCardEnabled }, wallet: { topupPresets: wallet.topupPresets, minTopup: wallet.minTopup, maxTopup: wallet.maxTopup },
      simulator: simulatorEnabled(),
    };
  });
  app.get('/api/public/fonts/:file', async (req, reply) => {
    const file = path.basename((req.params as any).file);
    const buf = await fs.readFile(path.resolve(config.uploadDir, 'fonts', file)).catch(() => null);
    if (!buf) throw notFound('Font');
    reply.header('cache-control', 'public, max-age=86400');
    reply.header('content-type', file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.woff') ? 'font/woff' : file.endsWith('.otf') ? 'font/otf' : 'font/ttf');
    return reply.send(buf);
  });
  app.get('/api/public/branches', async () => query(pool, `SELECT id, code, name, name_en, address, phone, capacity, open_time, close_time FROM branches WHERE status = 'ACTIVE' ORDER BY code`));
  app.get('/api/public/ticket-types', async () => query(pool, 'SELECT id, code, name, name_en, min_age, max_age FROM ticket_types WHERE is_active ORDER BY sort'));
  app.get('/api/public/packages', async (req) => {
    const q = parse(z.object({ branchId: zUuid, date: zDate.optional(), channel: z.enum(['ONLINE', 'KIOSK', 'COUNTER']).default('ONLINE') }), req.query);
    if (q.channel === 'COUNTER' && req.actor.type !== 'STAFF') throw forbidden();
    return listSellablePackages(pool, q.branchId, q.channel, q.date, req.actor.memberId);
  });
  app.get('/api/public/addons', async (req) => {
    const q = parse(z.object({ branchId: zUuid }), req.query);
    return query(pool, `SELECT id, sku, name, name_en, description, image_url, price, member_price FROM products WHERE sellable_online AND is_active AND (branch_id IS NULL OR branch_id = $1) ORDER BY sort, name`, [q.branchId]);
  });
  app.get('/api/public/availability', async (req) => {
    const q = parse(z.object({ branchId: zUuid, month: z.string().regex(/^\d{4}-\d{2}$/) }), req.query);
    const branch = await one(pool, 'SELECT capacity FROM branches WHERE id = $1', [q.branchId]);
    const rows = await query(pool, `SELECT visit_date AS date, COUNT(*)::int AS sold FROM tickets WHERE branch_id = $1 AND to_char(visit_date, 'YYYY-MM') = $2 AND status NOT IN ('CANCELLED','REFUNDED','EXPIRED') GROUP BY 1`, [q.branchId, q.month]);
    return { capacity: branch?.capacity, days: rows.map((r: any) => ({ date: r.date, sold: r.sold, level: r.sold / branch.capacity >= 1 ? 'FULL' : r.sold / branch.capacity >= 0.85 ? 'LIMITED' : 'AVAILABLE' })) };
  });
  app.get('/api/public/occupancy', async (req) => {
    const q = parse(z.object({ branchId: zUuid }), req.query);
    const o = await occupancy(pool, q.branchId);
    return { percent: o.percent, level: o.percent >= 90 ? 'CROWDED' : o.percent >= 70 ? 'BUSY' : 'NORMAL' };
  });
  app.get('/api/public/rides', async (req) => {
    const q = parse(z.object({ branchId: zUuid }), req.query);
    return query(pool, `SELECT r.id, r.code, r.name, r.name_en, r.description, r.image_url, r.status, r.entry_paused, r.min_height_cm, r.max_height_cm, r.min_age, r.addon_price, r.queue_enabled, z.name AS zone_name,
        (SELECT COALESCE(SUM(party_size), 0)::int FROM ride_queues q WHERE q.ride_id = r.id AND q.status = 'WAITING') AS queue_guests, r.capacity_per_cycle, r.cycle_minutes
      FROM rides r LEFT JOIN zones z ON z.id = r.zone_id WHERE r.branch_id = $1 ORDER BY r.sort, r.name`, [q.branchId])
      .then((rows) => rows.map((r: any) => ({ ...r, wait_min: Math.ceil(r.queue_guests / r.capacity_per_cycle) * Number(r.cycle_minutes) })));
  });
  app.get('/api/public/membership-products', async () =>
    query(pool, `SELECT mp.id, mp.code, mp.name, mp.description, mp.image_url, mp.card_design, mp.registration_fee, mp.annual_fee, mp.renewal_price, mp.validity_unit, mp.validity_value,
        mp.physical_card_fee, t.name AS tier_name, t.color AS tier_color, t.rank, (SELECT json_agg(json_build_object('type', b.type, 'value', b.value, 'label', b.label)) FROM membership_benefits b WHERE b.product_id = mp.id) AS benefits
      FROM membership_products mp JOIN member_tiers t ON t.id = mp.tier_id WHERE mp.is_active ORDER BY mp.sort, mp.annual_fee`));
  app.get('/api/public/menu', async (req) => {
    const q = parse(z.object({ storeId: zUuid }), req.query);
    const store = await one(pool, `SELECT id, name, code, type, branch_id FROM stores WHERE id = $1 AND is_active`, [q.storeId]);
    if (!store) throw notFound('Store');
    const products = await query(pool, `SELECT p.id, p.sku, p.name, p.name_en, p.description, p.image_url, p.price, p.member_price, p.modifiers, c.name AS category, c.type AS category_type,
        CASE WHEN p.track_stock THEN COALESCE(i.qty, 0) END AS stock
      FROM products p JOIN product_stores ps ON ps.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN inventory i ON i.product_id = p.id AND i.store_id = ps.store_id
      WHERE ps.store_id = $1 AND p.is_active ORDER BY c.sort, p.sort, p.name`, [q.storeId]);
    return { store, products };
  });
  app.get('/api/public/stores', async (req) => {
    const q = parse(z.object({ branchId: zUuid, type: z.string().optional() }), req.query);
    return query(pool, `SELECT id, code, name, type FROM stores WHERE branch_id = $1 AND is_active AND ($2::text IS NULL OR type = $2) ORDER BY name`, [q.branchId, q.type ?? null]);
  });
  /** Kitchen "order ready" board (queue numbers only — no personal data). */
  app.get('/api/public/kitchen/:storeId/board', async (req) =>
    query(pool, `SELECT queue_no, kitchen_status, updated_at FROM orders WHERE store_id = $1 AND kitchen_status IN ('PREPARING','READY') AND created_at > now() - interval '12 hours' ORDER BY updated_at DESC LIMIT 60`,
      [(req.params as any).storeId]));

  // --------------------------- booking flow ---------------------------
  app.post('/api/public/quote', async (req) => {
    const b = parse(z.object({ branchId: zUuid, packageId: zUuid, visitDate: zDate, guests: guestsSchema, bundles: z.number().int().min(1).max(20).optional(), addons: addonsSchema,
      couponCode: z.string().trim().max(40).nullish(), channel: z.enum(['ONLINE', 'KIOSK']).default('ONLINE') }), req.body);
    return quote({ ...b, memberId: req.actor.memberId ?? null });
  });
  app.post('/api/public/bookings', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({
      branchId: zUuid, packageId: zUuid, visitDate: zDate, guests: guestsSchema, bundles: z.number().int().min(1).max(20).optional(), addons: addonsSchema,
      couponCode: z.string().trim().max(40).nullish(), customerName: z.string().trim().min(2).max(120), phone: zPhone, email: z.string().email().nullish(),
      paymentMode: z.enum(['PAY_NOW', 'PAY_AT_PARK']), channel: z.enum(['ONLINE', 'KIOSK']).default('ONLINE'), notes: z.string().max(500).nullish(),
      guestDetails: z.array(z.object({ name: z.string().max(120).optional(), birthday: zDate.optional(), heightCm: z.number().int().min(40).max(250).optional() })).optional(),
    }), req.body);
    if (b.channel === 'KIOSK' && req.actor.deviceType !== 'KIOSK' && req.actor.type !== 'STAFF') throw forbidden('Kiosk channel requires a kiosk device');
    const key = req.headers['idempotency-key'] as string | undefined;
    const d: any = await withIdempotency('booking', key, b, () => withTx((tx, after) => createBooking(tx, req.actor, { ...b, memberId: req.actor.memberId ?? null, idempotencyKey: key ?? null }, after)));
    const t = await one(pool, 'SELECT public_token FROM bookings WHERE id = $1', [d.id]);
    return { ...d, token: t?.public_token };
  });
  /** Guest booking view (requires the secret booking token from the confirmation link) or member owner. */
  app.get('/api/public/bookings/:no', async (req) => {
    const { no } = req.params as { no: string };
    const token = (req.query as any).token as string | undefined;
    const b = await one(pool, 'SELECT id, public_token, member_id FROM bookings WHERE booking_no = $1', [no.toUpperCase()]);
    if (!b || !((token && token === b.public_token) || (req.actor.memberId && req.actor.memberId === b.member_id))) throw notFound('Booking');
    return bookingDetail(pool, b.id);
  });
  app.post('/api/public/bookings/:no/pay', async (req) => {
    const { no } = req.params as { no: string };
    const body = parse(z.object({ token: z.string().optional(), method: z.enum(['PROMPTPAY', 'CARD', 'DEBIT', 'MOBILE_BANKING', 'BANK_TRANSFER']) }), req.body);
    const b = await one(pool, 'SELECT * FROM bookings WHERE booking_no = $1', [no.toUpperCase()]);
    if (!b || !((body.token && body.token === b.public_token) || (req.actor.memberId && req.actor.memberId === b.member_id))) throw notFound('Booking');
    if (!['PENDING_PAYMENT', 'RESERVED', 'PENDING_VERIFICATION'].includes(b.status)) throw unprocessable('NOT_PAYABLE', `Booking is ${b.status}`);
    return withTx(async (tx) => {
      const p = await initiatePayment(tx, req.actor, b.order_id, body.method);
      if (b.payment_mode === 'PAY_AT_PARK') await tx.query(`UPDATE bookings SET payment_mode = 'PAY_NOW' WHERE id = $1`, [b.id]);
      return { paymentId: p.id, paymentNo: p.payment_no, method: p.method, amount: p.amount, status: p.status, expiresAt: p.expires_at,
        qrPayload: p.provider_payload?.qrPayload ?? null, checkoutUrl: p.provider_payload?.checkoutUrl ?? null };
    });
  });
  /** Upload transfer slip / "ตรวจสอบการชำระเงิน" → realtime to Payment Verification Center */
  app.post('/api/public/payments/:id/slip', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    let slipPath: string | null = null;
    let fields: Record<string, string> = {};
    if (req.isMultipart()) {
      const file = await req.file();
      if (file) {
        fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]: any) => [k, v?.value]));
        const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' } as Record<string, string>)[file.mimetype];
        if (!ext) throw badRequest('BAD_FILE', 'Slip must be JPG, PNG or PDF');
        const dir = path.resolve(config.uploadDir, 'slips');
        await fs.mkdir(dir, { recursive: true });
        slipPath = `${randomBase32(16)}${ext}`;
        await fs.writeFile(path.join(dir, slipPath), await file.toBuffer());
      }
    } else fields = (req.body ?? {}) as any;
    const pay = await one(pool, `SELECT p.id, b.public_token, b.member_id FROM payments p JOIN orders o ON o.id = p.order_id LEFT JOIN bookings b ON b.order_id = o.id WHERE p.id = $1`, [id]);
    if (!pay) throw notFound('Payment');
    const owner = (fields.token && fields.token === pay.public_token) || (req.actor.memberId && req.actor.memberId === pay.member_id) || req.actor.type === 'STAFF';
    if (!owner) throw notFound('Payment');
    return withTx((tx, after) => submitSlip(tx, req.actor, id, { slipPath, slipReference: fields.reference ?? null, paidTime: fields.paidTime || null, note: fields.note ?? null }, after));
  });
  /** Card checkout simulator (development only) — stands in for a hosted payment page. */
  app.post('/api/public/payments/:id/simulate', async (req) => {
    if (!simulatorEnabled()) throw forbidden('Payment simulator disabled');
    const b = parse(z.object({ outcome: z.enum(['SUCCESS', 'FAIL']).default('SUCCESS') }), req.body);
    const { id } = req.params as { id: string };
    if (b.outcome === 'FAIL') {
      await pool.query(`UPDATE payments SET status = 'FAILED' WHERE id = $1 AND status = 'PENDING'`, [id]);
      return { status: 'FAILED' };
    }
    const r = await confirmExternalPayment(SYSTEM_ACTOR, id, { payload: { simulator: true } });
    return { status: r.payment.status };
  });
  app.get('/api/public/payments/:id', async (req) => {
    const p = await one(pool, 'SELECT id, payment_no, method, status, amount, expires_at, provider_payload FROM payments WHERE id = $1', [(req.params as any).id]);
    if (!p) throw notFound('Payment');
    return { ...p, qrPayload: p.provider_payload?.qrPayload ?? null, provider_payload: undefined };
  });
  /** Payment gateway webhook (signature verified by provider adapter). */
  app.post('/api/payments/webhook/:provider', async (req, reply) => {
    const g = gateway((req.params as any).provider);
    let evt;
    try { evt = g.verifyWebhook(req.headers as any, (req as any).rawBody ?? JSON.stringify(req.body)); }
    catch { return reply.status(401).send({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } }); }
    const pay = await one(pool, 'SELECT id, amount, status FROM payments WHERE provider = $1 AND reference = $2', [g.name, evt.reference]);
    if (!pay) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown reference' } });
    if (evt.status === 'PAID') {
      if (evt.amount !== pay.amount) return reply.status(422).send({ error: { code: 'AMOUNT_MISMATCH', message: 'Amount mismatch' } });
      if (pay.status !== 'PAID') await confirmExternalPayment(SYSTEM_ACTOR, pay.id, { payload: { webhook: evt.raw } });
    } else await pool.query(`UPDATE payments SET status = 'FAILED', provider_payload = provider_payload || $2 WHERE id = $1 AND status = 'PENDING'`, [pay.id, JSON.stringify({ webhook: evt.raw })]);
    return { ok: true };
  });

  // ---------------- QR / mobile food ordering (member wallet or online payment) ----------------
  app.post('/api/public/food-orders', async (req) => {
    const b = parse(z.object({ storeId: zUuid, items: z.array(z.object({ productId: zUuid, qty: z.number().int().min(1).max(20), modifiers: z.array(z.object({ group: z.string(), option: z.string() })).optional(), notes: z.string().max(200).optional() })).min(1),
      payWith: z.enum(['WALLET', 'PROMPTPAY', 'CARD']), couponCode: z.string().nullish(), table: z.string().max(20).nullish() }), req.body);
    if (req.actor.type !== 'MEMBER') throw forbidden('Please log in to order from your phone');
    return withIdempotency(`food:${req.actor.memberId}`, req.headers['idempotency-key'] as string, b, () => withTx(async (tx, after) => {
      const store = await one(tx, 'SELECT * FROM stores WHERE id = $1 AND is_active', [b.storeId]);
      if (!store) throw notFound('Store');
      const mctx = await memberContext(tx, req.actor.memberId);
      const lines = await priceItems(tx, store.branch_id, b.items.map((i) => ({ type: 'PRODUCT' as const, ...i })), mctx);
      const { order } = await createOrder(tx, req.actor, { branchId: store.branch_id, storeId: store.id, type: 'FOOD', channel: 'QR_ORDER', lines, memberCtx: mctx, accountId: req.actor.accountId,
        couponCode: b.couponCode, notes: b.table ? `Table ${b.table}` : null });
      if (b.payWith === 'WALLET') {
        const { capturePayment } = await import('../services/orders.js');
        const r = await capturePayment(tx, req.actor, order.id, { method: 'WALLET', amount: order.total, channel: 'ONLINE' }, after);
        return { order: { id: order.id, orderNo: order.order_no, total: order.total, queueNo: r.order.queue_no, status: r.order.status } };
      }
      const p = await initiatePayment(tx, req.actor, order.id, b.payWith);
      return { order: { id: order.id, orderNo: order.order_no, total: order.total }, payment: { id: p.id, qrPayload: p.provider_payload?.qrPayload, checkoutUrl: p.provider_payload?.checkoutUrl } };
    }));
  });
}
