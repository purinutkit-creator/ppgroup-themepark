import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { parse, zDate, zUuid } from '../lib/http.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { withIdempotency } from '../lib/idempotency.js';
import { branchOf, can, requireAnyPerm, requirePerm } from '../middleware/auth.js';
import {
  closeGate, decideScan, gateStatus, gatesSnapshot, ingestHardwareEvent, manualOpen, occupancy, overrideScan, resetGate, scanAtGate, setEmergency,
} from '../services/gates.js';
import {
  cancelRidePurchase, confirmCashAtRide, manualRideApprove, manualRideDeny, purchaseAtRide, rideOperatorSnapshot, ridesDashboard, scanAtRide, setRideStatus,
} from '../services/rides.js';
import { callNext, cancelQueue, joinQueue, rideQueue } from '../services/queue.js';
import { endLockerSession, lockerBoard, openLocker, rentLocker } from '../services/lockers.js';
import { consolidated, dashboard, zoneOccupancy } from '../services/dashboard.js';
import { REPORT_LIST, runReport, toCsv, toPdf, toXlsx } from '../services/reports.js';
import { heartbeat } from '../services/devices.js';
import { audit } from '../services/audit.js';
import { credentialProfile, resolveScan } from '../services/credentials.js';
import { capturePayment, createOrder, memberContext, priceItems } from '../services/orders.js';
import { initiatePayment } from '../services/payments.js';

export async function parkRoutes(app: FastifyInstance) {
  // ============================ gates ============================
  app.get('/api/gates', { preHandler: requirePerm('gate.view') }, async (req) => gatesSnapshot(pool, branchOf(req, (req.query as any).branchId)));
  app.get('/api/gates/:gateId/status', { preHandler: requirePerm('gate.view') }, async (req) => gateStatus((req.params as any).gateId));
  app.get('/api/gates/:gateId', { preHandler: requirePerm('gate.view') }, async (req) => {
    const g = await one(pool, 'SELECT id, branch_id, code, name, number, direction, mode, state, emergency, is_enabled, zone_id FROM gates WHERE id = $1', [(req.params as any).gateId]);
    if (!g) throw notFound('Gate');
    branchOf(req, g.branch_id);
    return g;
  });
  app.post('/api/gates/:gateId/scan', { preHandler: requirePerm('gate.scan'), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) =>
    scanAtGate(req.actor, (req.params as any).gateId, parse(z.object({ code: z.string().min(1).max(500) }), req.body).code));
  app.post('/api/gates/:gateId/approve', { preHandler: requirePerm('gate.approve') }, async (req) =>
    decideScan(req.actor, (req.params as any).gateId, { ...parse(z.object({ scanId: zUuid.optional() }), req.body), decision: 'APPROVE' }));
  app.post('/api/gates/:gateId/deny', { preHandler: requirePerm('gate.approve') }, async (req) =>
    decideScan(req.actor, (req.params as any).gateId, { ...parse(z.object({ scanId: zUuid.optional(), reason: z.string().max(200).optional() }), req.body), decision: 'DENY' }));
  app.post('/api/gates/:gateId/open', { preHandler: requirePerm('gate.open') }, async (req) => {
    const b = parse(z.object({ reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body);
    return manualOpen(req.actor, (req.params as any).gateId, b.reason, b.approvalId);
  });
  app.post('/api/gates/:gateId/close', { preHandler: requirePerm('gate.open') }, async (req) => closeGate(req.actor, (req.params as any).gateId));
  app.post('/api/gates/:gateId/reset', { preHandler: requirePerm('gate.manage') }, async (req) => resetGate(req.actor, (req.params as any).gateId));
  app.post('/api/gates/:gateId/scans/:scanId/override', { preHandler: requirePerm('gate.override') }, async (req) => {
    const b = parse(z.object({ reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body);
    const p = req.params as any;
    return overrideScan(req.actor, p.gateId, p.scanId, b.reason, b.approvalId);
  });
  app.post('/api/gates/emergency', { preHandler: requirePerm('gate.emergency') }, async (req) => {
    const b = parse(z.object({ active: z.boolean(), reason: z.string().min(3), branchId: zUuid.optional() }), req.body);
    return setEmergency(req.actor, branchOf(req, b.branchId), b.active, b.reason);
  });
  app.patch('/api/gates/:gateId/mode', { preHandler: requirePerm('gate.manage') }, async (req) => {
    const b = parse(z.object({ mode: z.enum(['AUTO', 'MANUAL']).optional(), blockNewEntry: z.boolean().optional(), isEnabled: z.boolean().optional() }), req.body);
    return withTx(async (tx) => {
      const g = await one(tx, 'SELECT * FROM gates WHERE id = $1 FOR UPDATE', [(req.params as any).gateId]);
      if (!g) throw notFound('Gate');
      branchOf(req, g.branch_id);
      const r = await one(tx, `UPDATE gates SET mode = COALESCE($2, mode), block_new_entry = COALESCE($3, block_new_entry), is_enabled = COALESCE($4, is_enabled) WHERE id = $1 RETURNING *`,
        [g.id, b.mode ?? null, b.blockNewEntry ?? null, b.isEnabled ?? null]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'gate', entityId: g.code, before: { mode: g.mode, blockNewEntry: g.block_new_entry, isEnabled: g.is_enabled }, after: b, branchId: g.branch_id });
      const { publish, rooms } = await import('../realtime/hub.js');
      publish([rooms.gates(g.branch_id)], 'gate.config', { gateId: g.id, mode: r.mode, blockNewEntry: r.block_new_entry, isEnabled: r.is_enabled });
      return r;
    });
  });
  /** Gate controller / edge agent → backend (PASSAGE, FAULT, FIRE_ALARM …). Device key required. */
  app.post('/api/gates/:gateId/hardware-event', async (req) => {
    if (req.actor.type !== 'DEVICE' && !can(req.actor, 'gate.manage')) throw unauthorized('Device key required');
    const b = parse(z.object({ type: z.enum(['PASSAGE', 'NO_PASSAGE', 'CLOSED', 'OBSTRUCTION', 'FIRE_ALARM', 'EMERGENCY_RELEASE', 'FAULT', 'ONLINE', 'OFFLINE']),
      active: z.boolean().optional(), message: z.string().optional() }), req.body);
    const g = await one(pool, 'SELECT branch_id FROM gates WHERE id = $1', [(req.params as any).gateId]);
    if (!g) throw notFound('Gate');
    if (req.actor.type === 'DEVICE' && req.actor.branchId !== g.branch_id) throw forbidden();
    await ingestHardwareEvent((req.params as any).gateId, b as any);
    return { ok: true };
  });
  app.get('/api/gates/scans/log', { preHandler: requirePerm('gate.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), gateId: zUuid.optional(), result: z.string().optional(), date: zDate.optional(), q: z.string().optional() }), req.query);
    return query(pool, `SELECT s.*, g.name AS gate_name, c.code AS credential_code, t.ticket_code, m.member_code, m.first_name || ' ' || m.last_name AS member_name, st.first_name AS operator_name
        FROM gate_scans s JOIN gates g ON g.id = s.gate_id LEFT JOIN credentials c ON c.id = s.credential_id LEFT JOIN tickets t ON t.id = s.ticket_id
        LEFT JOIN members m ON m.id = s.member_id LEFT JOIN staff st ON st.id = s.operator_staff_id
       WHERE s.branch_id = $1 AND ($2::uuid IS NULL OR s.gate_id = $2) AND ($3::text IS NULL OR s.result = $3)
         AND ($4::date IS NULL OR (s.scanned_at AT TIME ZONE 'Asia/Bangkok')::date = $4)
         AND ($5::text IS NULL OR c.code ILIKE '%' || $5 || '%' OR t.ticket_code ILIKE '%' || $5 || '%' OR m.member_code ILIKE '%' || $5 || '%')
       ORDER BY s.scanned_at DESC LIMIT 300`, [branchOf(req, q.branchId), q.gateId ?? null, q.result ?? null, q.date ?? null, q.q ?? null]);
  });
  app.get('/api/occupancy', { preHandler: requireAnyPerm('dashboard.view', 'gate.view') }, async (req) => {
    const branchId = branchOf(req, (req.query as any).branchId);
    return { ...(await occupancy(pool, branchId)), zones: await zoneOccupancy(pool, branchId) };
  });
  app.get('/api/security-events', { preHandler: requirePerm('gate.view') }, async (req) =>
    query(pool, `SELECT e.*, g.name AS gate_name, c.code AS credential_code, t.ticket_code FROM security_events e LEFT JOIN gates g ON g.id = e.gate_id
      LEFT JOIN credentials c ON c.id = e.credential_id LEFT JOIN tickets t ON t.id = e.ticket_id WHERE e.branch_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [branchOf(req, (req.query as any).branchId)]));
  app.post('/api/security-events/:id/ack', { preHandler: requirePerm('gate.approve') }, async (req) => {
    await pool.query('UPDATE security_events SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1', [(req.params as any).id, req.actor.staffId]);
    return { ok: true };
  });

  // ============================ rides ============================
  app.get('/api/rides', { preHandler: requirePerm('ride.view') }, async (req) => ridesDashboard(pool, branchOf(req, (req.query as any).branchId)));
  app.get('/api/rides/:rideId/operator', { preHandler: requirePerm('ride.view') }, async (req) => rideOperatorSnapshot(pool, (req.params as any).rideId));
  app.get('/api/rides/:rideId/scan-points', { preHandler: requirePerm('ride.view') }, async (req) => query(pool, 'SELECT * FROM ride_scan_points WHERE ride_id = $1 ORDER BY code', [(req.params as any).rideId]));
  app.post('/api/rides/:rideId/scan', { preHandler: requirePerm('ride.scan'), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ code: z.string().min(1).max(500), scanPointId: z.string().optional() }), req.body);
    return scanAtRide(req.actor, (req.params as any).rideId, b.code, { scanPointId: b.scanPointId });
  });
  app.post('/api/rides/:rideId/purchase', { preHandler: requirePerm('ride.scan') }, async (req) => {
    const b = parse(z.object({ code: z.string().min(1), method: z.enum(['WALLET', 'PROMPTPAY', 'CARD', 'CASH']), scanPointId: z.string().optional() }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`ride-purchase:${req.actor.deviceId ?? req.actor.staffId}`, key, b, () => purchaseAtRide(req.actor, (req.params as any).rideId, { scan: b.code, method: b.method, scanPointId: b.scanPointId, idempotencyKey: key ?? null }));
  });
  app.post('/api/rides/purchase-requests/:id/confirm-cash', { preHandler: requireAnyPerm('ride.operate', 'payment.accept') }, async (req) => confirmCashAtRide(req.actor, (req.params as any).id));
  app.post('/api/rides/purchase-requests/:id/cancel', { preHandler: requirePerm('ride.scan') }, async (req) => cancelRidePurchase(req.actor, (req.params as any).id));
  app.get('/api/rides/purchase-requests/:id', { preHandler: requirePerm('ride.scan') }, async (req) => {
    const r = await one(pool, `SELECT r.*, p.status AS payment_status, p.provider_payload FROM ride_purchase_requests r LEFT JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`, [(req.params as any).id]);
    if (!r) throw notFound('Purchase request');
    return r;
  });
  app.post('/api/rides/:rideId/status', { preHandler: requirePerm('ride.operate') }, async (req) =>
    setRideStatus(req.actor, (req.params as any).rideId, parse(z.object({ status: z.enum(['OPEN', 'CLOSED', 'MAINTENANCE', 'TEMPORARILY_CLOSED']).optional(), entryPaused: z.boolean().optional(), reason: z.string().optional() }), req.body)));
  app.post('/api/rides/:rideId/manual-approve', { preHandler: requirePerm('ride.manual_entry') }, async (req) =>
    manualRideApprove(req.actor, (req.params as any).rideId, parse(z.object({ scan: z.string().optional(), accessLogId: zUuid.optional(), reason: z.string().min(3), approvalId: zUuid.nullish() }), req.body)));
  app.post('/api/rides/:rideId/manual-deny', { preHandler: requirePerm('ride.manual_entry') }, async (req) => {
    const b = parse(z.object({ accessLogId: zUuid, reason: z.string().min(3) }), req.body);
    return manualRideDeny(req.actor, (req.params as any).rideId, b.accessLogId, b.reason);
  });
  // virtual queue
  app.get('/api/rides/:rideId/queue', { preHandler: requirePerm('ride.view') }, async (req) => rideQueue(pool, (req.params as any).rideId));
  app.post('/api/rides/:rideId/queue/join', { preHandler: requireAnyPerm('ride.scan', 'queue.manage') }, async (req) => {
    const b = parse(z.object({ code: z.string().min(1), partySize: z.number().int().min(1).max(10).default(1) }), req.body);
    return joinQueue(req.actor, (req.params as any).rideId, { scan: b.code, partySize: b.partySize });
  });
  app.post('/api/rides/:rideId/queue/call', { preHandler: requireAnyPerm('queue.manage', 'ride.operate') }, async (req) =>
    callNext(req.actor, (req.params as any).rideId, parse(z.object({ count: z.number().int().min(1).max(100).optional() }), req.body).count));
  app.post('/api/queue/:entryId/cancel', { preHandler: requireAnyPerm('queue.manage', 'ride.operate') }, async (req) => cancelQueue(req.actor, (req.params as any).entryId));

  // ============================ lockers ============================
  app.get('/api/lockers', { preHandler: requirePerm('locker.use') }, async (req) => lockerBoard(pool, branchOf(req, (req.query as any).branchId)));
  app.get('/api/lockers/rates', async (req) => {
    const branchId = (req.query as any).branchId ?? req.actor.branchId;
    if (!branchId) throw forbidden('branchId required');
    return query(pool, `SELECT r.*, (SELECT COUNT(*)::int FROM lockers l WHERE l.branch_id = r.branch_id AND l.size = r.size AND l.status = 'AVAILABLE') AS available
      FROM locker_rates r WHERE r.branch_id = $1 AND r.is_active ORDER BY r.size, r.sort`, [branchId]);
  });
  app.post('/api/lockers/rent', { preHandler: requireAnyPerm('locker.use', 'ride.view') }, async (req) => {
    const b = parse(z.object({ code: z.string().min(1), rateId: zUuid, lockerId: zUuid.nullish(), method: z.enum(['WALLET', 'CASH', 'CARD', 'PROMPTPAY']).default('WALLET'), tendered: z.number().int().optional() }), req.body);
    if (b.method !== 'WALLET' && req.actor.type !== 'STAFF') throw forbidden('Kiosk lockers are paid with wallet');
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`locker:${req.actor.staffId ?? req.actor.deviceId}`, key, b, () => rentLocker(req.actor, { scan: b.code, rateId: b.rateId, lockerId: b.lockerId, method: b.method, tendered: b.tendered, idempotencyKey: key ?? null }));
  });
  app.post('/api/lockers/open', { preHandler: requireAnyPerm('locker.use', 'ride.view') }, async (req) => {
    const b = parse(z.object({ code: z.string().min(1), lockerCode: z.string().optional() }), req.body);
    return openLocker(req.actor, { scan: b.code, lockerCode: b.lockerCode });
  });
  app.post('/api/lockers/sessions/:id/end', { preHandler: requirePerm('locker.use') }, async (req) => endLockerSession(req.actor, (req.params as any).id));

  // ============================ kiosk (device) ============================
  /** Self-service card check: balance, tickets, rides, queue (no sensitive data) */
  app.post('/api/kiosk/card', async (req) => {
    if (req.actor.deviceType !== 'KIOSK' && req.actor.type !== 'STAFF') throw unauthorized('Kiosk device required');
    const { credential } = await resolveScan(pool, parse(z.object({ code: z.string().min(1) }), req.body).code);
    const p = await credentialProfile(pool, credential.id);
    return { credential: { code: p.credential.code, type: p.credential.type, status: p.credential.status, expiresAt: p.credential.expiresAt }, customerName: p.customerName,
      member: p.member ? { tier: p.member.tier_name, points: p.member.points, memberCode: p.member.member_code } : null, wallet: p.wallet, tickets: p.tickets, entitlements: p.entitlements,
      queues: p.queues, lockers: p.lockers };
  });
  app.post('/api/kiosk/topup', async (req) => {
    if (req.actor.deviceType !== 'KIOSK' && req.actor.type !== 'STAFF') throw unauthorized('Kiosk device required');
    const b = parse(z.object({ code: z.string().min(1), amount: z.number().int().positive(), method: z.enum(['PROMPTPAY', 'CARD']) }), req.body);
    return withTx(async (tx) => {
      const { credential: cred } = await resolveScan(tx, b.code);
      if (cred.status !== 'ACTIVE') throw forbidden(`Card is ${cred.status}`);
      const mctx = await memberContext(tx, cred.member_id);
      const lines = await priceItems(tx, cred.branch_id ?? req.actor.branchId!, [{ type: 'TOPUP', amount: b.amount }], mctx);
      const { order } = await createOrder(tx, req.actor, { branchId: cred.branch_id ?? req.actor.branchId!, type: 'TOPUP', channel: 'KIOSK', lines, memberCtx: mctx, accountId: cred.account_id, credentialId: cred.id, applyPromotions: false });
      const p = await initiatePayment(tx, req.actor, order.id, b.method === 'CARD' ? 'CARD' : 'PROMPTPAY', 'counter');
      return { orderId: order.id, orderNo: order.order_no, paymentId: p.id, amount: p.amount, qrPayload: p.provider_payload?.qrPayload ?? null, checkoutUrl: p.provider_payload?.checkoutUrl ?? null };
    });
  });
  app.post('/api/kiosk/food-order', async (req) => {
    if (req.actor.deviceType !== 'KIOSK' && req.actor.type !== 'STAFF') throw unauthorized('Kiosk device required');
    const b = parse(z.object({ storeId: zUuid, code: z.string().min(1), items: z.array(z.object({ productId: zUuid, qty: z.number().int().min(1).max(20), modifiers: z.array(z.object({ group: z.string(), option: z.string() })).optional() })).min(1) }), req.body);
    const key = req.headers['idempotency-key'] as string | undefined;
    return withIdempotency(`kiosk-food:${req.actor.deviceId ?? req.actor.staffId}`, key, b, () => withTx(async (tx, after) => {
      const { credential: cred } = await resolveScan(tx, b.code);
      if (cred.status !== 'ACTIVE') throw forbidden(`Card is ${cred.status}`);
      const store = await one(tx, 'SELECT * FROM stores WHERE id = $1', [b.storeId]);
      if (!store) throw notFound('Store');
      const mctx = await memberContext(tx, cred.member_id);
      const lines = await priceItems(tx, store.branch_id, b.items.map((i) => ({ type: 'PRODUCT' as const, ...i })), mctx);
      const { order } = await createOrder(tx, req.actor, { branchId: store.branch_id, storeId: store.id, type: 'FOOD', channel: 'KIOSK', lines, memberCtx: mctx, accountId: cred.account_id, credentialId: cred.id });
      const r = await capturePayment(tx, req.actor, order.id, { method: 'WALLET', amount: order.total, credentialId: cred.id, channel: 'KIOSK', idempotencyKey: key ? `${key}:pay` : null }, after);
      const w = await one(tx, 'SELECT balance FROM wallet_accounts WHERE account_id = $1', [cred.account_id]);
      return { orderNo: order.order_no, queueNo: r.order.queue_no, total: order.total, balance: Number(w.balance) };
    }));
  });

  // ============================ dashboard / reports ============================
  app.get('/api/dashboard', { preHandler: requirePerm('dashboard.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), date: zDate.optional() }), req.query);
    return dashboard(pool, branchOf(req, q.branchId), q.date);
  });
  app.get('/api/dashboard/consolidated', { preHandler: requirePerm('dashboard.consolidated') }, async (req) => consolidated(pool, parse(z.object({ date: zDate.optional() }), req.query).date));
  app.get('/api/reports', { preHandler: requirePerm('report.view') }, async () => REPORT_LIST);
  app.get('/api/reports/:key', { preHandler: requirePerm('report.view') }, async (req, reply) => {
    const q = parse(z.object({ branchId: zUuid.optional(), from: zDate, to: zDate, format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') }), req.query);
    const branchId = branchOf(req, q.branchId);
    const r = await runReport(pool, (req.params as any).key, branchId, q.from, q.to);
    if (q.format === 'json') return r;
    if (!can(req.actor, 'report.export')) throw forbidden('Missing permission: report.export');
    await audit(pool, req.actor, { action: 'REPORT_EXPORT', entityType: 'report', entityId: (req.params as any).key, metadata: { from: q.from, to: q.to, format: q.format } });
    const fname = `${(req.params as any).key}_${q.from}_${q.to}`;
    if (q.format === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${fname}.csv"`).send(toCsv(r));
    if (q.format === 'xlsx') return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${fname}.xlsx"`).send(await toXlsx(r));
    const b = await one(pool, 'SELECT name FROM branches WHERE id = $1', [branchId]);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${fname}.pdf"`).send(await toPdf(r, { branch: b?.name ?? '', from: q.from, to: q.to }));
  });

  // ============================ notifications / audit / devices ============================
  app.get('/api/notifications', { preHandler: requirePerm('notification.view') }, async (req) => {
    const q = req.query as any;
    return query(pool, `SELECT n.*, s.first_name AS acknowledged_by_name FROM notifications n LEFT JOIN staff s ON s.id = n.acknowledged_by
      WHERE n.audience = 'STAFF' AND (n.branch_id = $1 OR n.branch_id IS NULL) AND ($2::boolean IS NOT TRUE OR n.acknowledged_at IS NULL)
      ORDER BY n.created_at DESC LIMIT 200`, [branchOf(req, q.branchId), q.unread === 'true']);
  });
  app.post('/api/notifications/:id/ack', { preHandler: requirePerm('notification.view') }, async (req) => {
    await pool.query('UPDATE notifications SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1 AND acknowledged_at IS NULL', [(req.params as any).id, req.actor.staffId]);
    return { ok: true };
  });
  app.post('/api/notifications/ack-all', { preHandler: requirePerm('notification.view') }, async (req) => {
    await pool.query(`UPDATE notifications SET acknowledged_by = $2, acknowledged_at = now() WHERE audience = 'STAFF' AND (branch_id = $1 OR branch_id IS NULL) AND acknowledged_at IS NULL`, [branchOf(req, null), req.actor.staffId]);
    return { ok: true };
  });
  app.get('/api/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const q = parse(z.object({ branchId: zUuid.optional(), action: z.string().optional(), staffId: zUuid.optional(), entity: z.string().optional(), from: zDate.optional(), to: zDate.optional(),
      page: z.coerce.number().int().min(1).default(1) }), req.query);
    const branchId = req.actor.branchId ? branchOf(req, q.branchId) : q.branchId ?? null;
    return query(pool, `SELECT a.*, s.employee_code, s.first_name AS staff_name, d.code AS device_code FROM audit_logs a LEFT JOIN staff s ON s.id = a.staff_id LEFT JOIN devices d ON d.id = a.device_id
      WHERE ($1::uuid IS NULL OR a.branch_id = $1 OR a.branch_id IS NULL) AND ($2::text IS NULL OR a.action ILIKE '%' || $2 || '%') AND ($3::uuid IS NULL OR a.staff_id = $3)
        AND ($4::text IS NULL OR a.entity_type = $4 OR a.entity_id = $4) AND ($5::date IS NULL OR a.at >= ($5::date)::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND ($6::date IS NULL OR a.at < (($6::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
      ORDER BY a.at DESC LIMIT 200 OFFSET $7`, [branchId, q.action ?? null, q.staffId ?? null, q.entity ?? null, q.from ?? null, q.to ?? null, (q.page - 1) * 200]);
  });
  app.post('/api/devices/heartbeat', async (req) => {
    if (req.actor.type !== 'DEVICE') throw unauthorized('Device key required');
    return heartbeat(req.actor, parse(z.object({ firmware: z.string().optional(), status: z.enum(['ONLINE', 'ERROR']).optional(), detail: z.unknown().optional() }), req.body));
  });
}
