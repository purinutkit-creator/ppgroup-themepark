import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { parse, zDate, zPhone, zPin, zUuid } from '../lib/http.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { withIdempotency } from '../lib/idempotency.js';
import { requireMember } from '../middleware/auth.js';
import { changePassword, issueMemberSession, logout, memberLogin, requestPasswordReset, resetPassword, staffLogin } from '../services/auth.js';
import { registerMember, memberSummary } from '../services/membership.js';
import { credentialPayloads } from '../services/credentials.js';
import { ticketsForCredential } from '../services/tickets.js';
import { ledgerHistory, walletForAccount } from '../services/wallet.js';
import { rideHistory } from '../services/rides.js';
import { accountQueues, cancelQueue, joinQueue } from '../services/queue.js';
import { memberVouchers, redeemReward, rewardStore } from '../services/rewards.js';
import { createOrder, memberContext, priceItems } from '../services/orders.js';
import { initiatePayment } from '../services/payments.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { businessDate } from '../lib/codes.js';

const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance) {
  // ------------------------------- staff -------------------------------
  app.post('/api/auth/staff/login', authLimit, async (req) => {
    const b = parse(z.object({ employeeCode: z.string().min(1).optional(), staffId: zUuid.optional(), pin: zPin }).refine((x) => x.employeeCode || x.staffId, 'employeeCode or staffId required'), req.body);
    return staffLogin(req.actor, b);
  });
  /** "Select Staff + PIN" picker: only for authenticated devices of the branch (never public). */
  app.get('/api/auth/staff-directory', async (req) => {
    if (req.actor.type !== 'DEVICE' && req.actor.type !== 'STAFF') throw unauthorized('Device key required');
    return query(pool, `SELECT s.id, s.employee_code, s.first_name, s.nickname, r.name AS role_name FROM staff s JOIN roles r ON r.id = s.role_id
        WHERE s.status = 'ACTIVE' AND (s.branch_id = $1 OR s.branch_id IS NULL) ORDER BY s.first_name`, [req.actor.branchId]);
  });
  app.get('/api/auth/me', async (req) => {
    const a = req.actor;
    if (a.type === 'STAFF') {
      const s = await one(pool, `SELECT s.id, s.employee_code, s.first_name, s.last_name, s.nickname, s.branch_id, b.name AS branch_name, r.code AS role_code, r.name AS role_name
          FROM staff s JOIN roles r ON r.id = s.role_id LEFT JOIN branches b ON b.id = s.branch_id WHERE s.id = $1`, [a.staffId]);
      return { type: 'STAFF', staff: s, permissions: [...a.permissions], deviceId: a.deviceId ?? null };
    }
    if (a.type === 'MEMBER') return { type: 'MEMBER', member: await memberSummary(pool, a.memberId!) };
    if (a.type === 'DEVICE') {
      const d = await one(pool, 'SELECT id, code, name, type, branch_id, config FROM devices WHERE id = $1', [a.deviceId]);
      return { type: 'DEVICE', device: d, permissions: [...a.permissions] };
    }
    throw unauthorized();
  });
  app.post('/api/auth/logout', async (req) => { await logout(req.actor, false); return { ok: true }; });
  app.post('/api/auth/logout-all', async (req) => { await logout(req.actor, true); return { ok: true }; });

  // ------------------------------- member -------------------------------
  app.post('/api/member/register', authLimit, async (req) => {
    const b = parse(z.object({
      phone: zPhone, firstName: z.string().trim().min(1), lastName: z.string().trim().min(1), birthday: zDate.nullish(), email: z.string().email().nullish(),
      password: z.string().min(8), gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']).nullish(), address: z.string().nullish(), emergencyContact: z.string().nullish(),
      branchId: zUuid.nullish(),
    }), req.body);
    const r = await withTx((tx) => registerMember(tx, req.actor, { ...b, via: 'ONLINE' }));
    const session = await issueMemberSession(req.actor, r.member.id);
    return { token: session.token, expiresAt: session.expiresAt, member: r.member };
  });
  app.post('/api/member/login', authLimit, async (req) => memberLogin(req.actor, parse(z.object({ identifier: z.string().min(3), password: z.string().min(1) }), req.body)));
  app.post('/api/member/password/forgot', authLimit, async (req) => requestPasswordReset(req.actor, parse(z.object({ identifier: z.string().min(3) }), req.body).identifier));
  app.post('/api/member/password/reset', authLimit, async (req) => resetPassword(req.actor, parse(z.object({ identifier: z.string(), code: z.string().length(6), newPassword: z.string().min(8) }), req.body)));
  app.post('/api/member/password/change', { preHandler: requireMember }, async (req) => {
    const b = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }), req.body);
    return changePassword(req.actor, b.currentPassword, b.newPassword);
  });

  app.get('/api/member/me', { preHandler: requireMember }, async (req) => memberSummary(pool, req.actor.memberId!));
  app.patch('/api/member/me', { preHandler: requireMember }, async (req) => {
    const b = parse(z.object({ firstName: z.string().min(1).optional(), lastName: z.string().min(1).optional(), email: z.string().email().nullish(), gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']).nullish(),
      address: z.string().nullish(), emergencyContact: z.string().nullish() }), req.body);
    await withTx(async (tx) => {
      const before = await one(tx, 'SELECT first_name, last_name, email, gender, address, emergency_contact FROM members WHERE id = $1 FOR UPDATE', [req.actor.memberId]);
      await tx.query(`UPDATE members SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), email = COALESCE($4, email), gender = COALESCE($5, gender),
          address = COALESCE($6, address), emergency_contact = COALESCE($7, emergency_contact) WHERE id = $1`,
        [req.actor.memberId, b.firstName ?? null, b.lastName ?? null, b.email ?? null, b.gender ?? null, b.address ?? null, b.emergencyContact ?? null]);
      await audit(tx, req.actor, { action: 'MEMBER_UPDATE', entityType: 'member', entityId: req.actor.memberId, before, after: b });
    });
    return memberSummary(pool, req.actor.memberId!);
  });

  /** Digital member card: rotating (dynamic) QR to prevent screenshot sharing. */
  app.get('/api/member/card', { preHandler: requireMember }, async (req) => {
    const cfg = await getSetting('membership');
    const c = await one(pool, `SELECT * FROM credentials WHERE member_id = $1 AND type = 'DIGITAL_CARD' AND status = 'ACTIVE' ORDER BY issued_at DESC LIMIT 1`, [req.actor.memberId]);
    if (!c) throw notFound('Digital card');
    const s = await memberSummary(pool, req.actor.memberId!);
    return { code: c.code, credentialId: c.id, member: { name: `${s.first_name} ${s.last_name}`, memberCode: s.member_code, tier: s.tier_name, tierColor: s.tier_color,
      expiresAt: s.membership?.end_date ?? null, status: s.membership?.status ?? 'BASIC' }, ...credentialPayloads(c, cfg.dynamicQr) };
  });
  app.get('/api/member/tickets', { preHandler: requireMember }, async (req) => {
    return query(pool, `SELECT t.id, t.ticket_code, t.status, t.presence, t.visit_date, t.valid_from, t.valid_to, t.guest_name, p.name AS package_name, tt.name AS ticket_type,
        b.booking_no, c.token
      FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id LEFT JOIN bookings b ON b.id = t.booking_id
      LEFT JOIN credentials c ON c.code = t.ticket_code AND c.type = 'QR_TICKET'
      WHERE t.member_id = $1 OR t.account_id = $2 ORDER BY t.visit_date DESC LIMIT 100`, [req.actor.memberId, req.actor.accountId])
      .then((rows) => rows.map(({ token, ...t }: any) => ({ ...t, qr: token && ['ACTIVE', 'PAID', 'UNPAID'].includes(t.status) ? credentialPayloads({ token, type: 'QR_TICKET' }).qr : null })));
  });
  app.get('/api/member/bookings', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT b.id, b.booking_no, b.visit_date, b.guests, b.status, b.payment_mode, o.total, o.paid_total, b.public_token FROM bookings b JOIN orders o ON o.id = b.order_id
      WHERE b.member_id = $1 ORDER BY b.visit_date DESC LIMIT 100`, [req.actor.memberId]));
  app.post('/api/member/tickets/attach', { preHandler: requireMember }, async (req) => {
    const b = parse(z.object({ bookingNo: z.string().min(5), phone: zPhone }), req.body);
    return withTx(async (tx) => {
      const bk = await one(tx, 'SELECT * FROM bookings WHERE booking_no = $1 AND phone = $2 FOR UPDATE', [b.bookingNo.toUpperCase(), b.phone]);
      if (!bk) throw notFound('Booking (check booking number and phone)');
      if (bk.member_id && bk.member_id !== req.actor.memberId) throw forbidden('Booking belongs to another member');
      await tx.query('UPDATE bookings SET member_id = $2 WHERE id = $1', [bk.id, req.actor.memberId]);
      await tx.query('UPDATE tickets SET member_id = $2 WHERE booking_id = $1 AND member_id IS NULL', [bk.id, req.actor.memberId]);
      await audit(tx, req.actor, { action: 'TICKET_ATTACH_MEMBER', entityType: 'booking', entityId: bk.booking_no });
      return { ok: true };
    });
  });
  app.get('/api/member/wallet', { preHandler: requireMember }, async (req) => {
    const w = await walletForAccount(pool, req.actor.accountId!);
    return { balance: Number(w.balance), status: w.status, ledger: await ledgerHistory(pool, w.id, 100) };
  });
  app.get('/api/member/transactions', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT o.id, o.order_no, o.type, o.status, o.total, o.created_at, o.paid_at, o.points_earned, s.name AS store_name,
        (SELECT json_agg(json_build_object('name', name, 'qty', qty, 'total', total)) FROM order_items WHERE order_id = o.id) AS items
      FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE (o.member_id = $1 OR o.account_id = $2) AND o.status <> 'CANCELLED' ORDER BY o.created_at DESC LIMIT 100`,
      [req.actor.memberId, req.actor.accountId]));
  app.get('/api/member/points', { preHandler: requireMember }, async (req) =>
    query(pool, 'SELECT * FROM points_ledger WHERE member_id = $1 ORDER BY created_at DESC LIMIT 100', [req.actor.memberId]));
  app.get('/api/member/rides', { preHandler: requireMember }, async (req) => rideHistory(pool, req.actor.accountId!));
  app.get('/api/member/entitlements', { preHandler: requireMember }, async (req) => {
    const cred = await one(pool, `SELECT * FROM credentials WHERE member_id = $1 AND type = 'DIGITAL_CARD' AND status = 'ACTIVE' LIMIT 1`, [req.actor.memberId]);
    const tickets = cred ? await ticketsForCredential(pool, cred, businessDate()) : [];
    return query(pool, `SELECT e.*, r.name AS ride_name FROM ride_entitlements e LEFT JOIN rides r ON r.id = e.ride_id
        WHERE (e.account_id = $1 OR e.ticket_id = ANY($2::uuid[])) AND e.status = 'ACTIVE' AND e.valid_until > now() ORDER BY e.valid_until`, [req.actor.accountId, tickets.map((t) => t.id)]);
  });
  app.get('/api/member/queues', { preHandler: requireMember }, async (req) => accountQueues(pool, req.actor.accountId!));
  app.post('/api/member/queues/:rideId/join', { preHandler: requireMember }, async (req) =>
    joinQueue(req.actor, (req.params as any).rideId, { accountId: req.actor.accountId, partySize: parse(z.object({ partySize: z.number().int().min(1).max(10).default(1) }), req.body).partySize }));
  app.post('/api/member/queues/entry/:id/cancel', { preHandler: requireMember }, async (req) => cancelQueue(req.actor, (req.params as any).id, req.actor.accountId));
  app.get('/api/member/orders', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT o.id, o.order_no, o.queue_no, o.kitchen_status, o.total, o.created_at, s.name AS store_name FROM orders o JOIN stores s ON s.id = o.store_id
      WHERE o.account_id = $1 AND o.kitchen_status IS NOT NULL ORDER BY o.created_at DESC LIMIT 30`, [req.actor.accountId]));
  app.get('/api/member/lockers', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT s.*, l.code AS locker_code, l.size FROM locker_sessions s JOIN lockers l ON l.id = s.locker_id WHERE s.account_id = $1 ORDER BY s.start_at DESC LIMIT 20`, [req.actor.accountId]));
  app.get('/api/member/coupons', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT c.code, c.expires_at, c.status, c.used_count, c.usage_limit, p.name, p.description FROM coupons c JOIN promotions p ON p.id = c.promotion_id
      WHERE c.member_id = $1 ORDER BY c.created_at DESC`, [req.actor.memberId]));
  app.get('/api/member/vouchers', { preHandler: requireMember }, async (req) => memberVouchers(pool, req.actor.memberId!));
  app.get('/api/member/rewards', { preHandler: requireMember }, async (req) => rewardStore(pool, req.actor.memberId!));
  app.post('/api/member/rewards/:id/redeem', { preHandler: requireMember }, async (req) =>
    withIdempotency(`redeem:${req.actor.memberId}`, req.headers['idempotency-key'] as string, req.params, () =>
      withTx((tx, after) => redeemReward(tx, req.actor, req.actor.memberId!, (req.params as any).id, after))));
  app.get('/api/member/notifications', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT * FROM notifications WHERE (member_id = $1 OR account_id = $2) ORDER BY created_at DESC LIMIT 50`, [req.actor.memberId, req.actor.accountId]));
  app.post('/api/member/notifications/read', { preHandler: requireMember }, async (req) => {
    await pool.query('UPDATE notifications SET read_at = now() WHERE (member_id = $1 OR account_id = $2) AND read_at IS NULL', [req.actor.memberId, req.actor.accountId]);
    return { ok: true };
  });
  app.get('/api/member/sessions', { preHandler: requireMember }, async (req) =>
    query(pool, `SELECT id, ip, user_agent, created_at, last_used_at, (id = $2) AS current FROM sessions WHERE principal_type = 'MEMBER' AND principal_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [req.actor.memberId, req.actor.sessionId]));

  /** Online membership purchase / renewal / upgrade, top-up → creates an order and starts an online payment. */
  app.post('/api/member/checkout', { preHandler: requireMember }, async (req) => {
    const b = parse(z.object({
      kind: z.enum(['MEMBERSHIP', 'TOPUP']), branchId: zUuid, membershipProductId: zUuid.optional(), mode: z.enum(['NEW', 'RENEWAL', 'UPGRADE']).default('NEW'),
      amount: z.number().int().positive().optional(), method: z.enum(['PROMPTPAY', 'CARD', 'DEBIT', 'MOBILE_BANKING', 'BANK_TRANSFER']),
    }), req.body);
    return withIdempotency(`member-checkout:${req.actor.memberId}`, req.headers['idempotency-key'] as string, b, () => withTx(async (tx) => {
      const mctx = await memberContext(tx, req.actor.memberId);
      const items = b.kind === 'MEMBERSHIP' ? [{ type: 'MEMBERSHIP' as const, membershipProductId: b.membershipProductId!, mode: b.mode }] : [{ type: 'TOPUP' as const, amount: b.amount! }];
      const lines = await priceItems(tx, b.branchId, items, mctx);
      const { order } = await createOrder(tx, req.actor, { branchId: b.branchId, type: b.kind, channel: 'ONLINE', lines, memberCtx: mctx, accountId: req.actor.accountId, applyPromotions: false });
      if (order.total === 0) {
        const { fulfillOrder } = await import('../services/orders.js');
        await tx.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [order.id]);
        await fulfillOrder(tx, req.actor, order.id, () => {});
        return { order, payment: null };
      }
      const payment = await initiatePayment(tx, req.actor, order.id, b.method);
      return { order: { id: order.id, orderNo: order.order_no, total: order.total }, payment };
    }));
  });
  app.get('/api/member/orders/:id/status', { preHandler: requireMember }, async (req) => {
    const o = await one(pool, 'SELECT id, order_no, status, total, paid_total FROM orders WHERE id = $1 AND (member_id = $2 OR account_id = $3)', [(req.params as any).id, req.actor.memberId, req.actor.accountId]);
    if (!o) throw notFound('Order');
    const payments = await query(pool, 'SELECT id, payment_no, method, status, amount, provider_payload, expires_at FROM payments WHERE order_id = $1 ORDER BY created_at DESC', [o.id]);
    return { ...o, payments };
  });
}
