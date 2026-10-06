import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { registerCrud } from '../lib/crud.js';
import { parse, zDate, zMoney, zPin, zUuid } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { hashSecret, randomBase32 } from '../lib/crypto.js';
import { branchOf, invalidateAuthCache, requirePerm } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { PERMISSIONS } from '../services/permissions.js';
import { getAllSettings, putSetting, SETTING_DEFAULTS } from '../services/settings.js';
import { issueDeviceKey } from '../services/devices.js';
import { moveStock, stockLevels, transferStock } from '../services/inventory.js';
import { listVerificationRequests, reviewVerification } from '../services/payments.js';

const ENT = z.enum(['ONE_TIME', 'MULTI_USE', 'UNLIMITED', 'TIME_BASED', 'DATE_BASED']);
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable();

export async function adminRoutes(app: FastifyInstance) {
  // ---------------- branches / zones ----------------
  registerCrud(app, {
    path: '/api/admin/branches', table: 'branches', permission: 'branch.manage', viewPermission: 'dashboard.view', orderBy: 't.code',
    schema: z.object({ code: z.string().min(2).max(20), name: z.string().min(1), nameEn: z.string().nullish(), timezone: z.string().default('Asia/Bangkok'),
      address: z.string().nullish(), phone: z.string().nullish(), capacity: z.number().int().positive(), openTime: time.optional(), closeTime: time.optional(),
      status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') }),
  });
  registerCrud(app, {
    path: '/api/admin/zones', table: 'zones', permission: 'zone.manage', viewPermission: 'dashboard.view', branchScoped: 'required', orderBy: 't.code',
    schema: z.object({ branchId: zUuid.optional(), code: z.string().min(1), name: z.string().min(1), capacity: z.number().int().positive(), color: z.string().default('#6366f1'),
      mapX: z.number().min(0).max(100).default(0), mapY: z.number().min(0).max(100).default(0), mapW: z.number().min(1).max(100).default(20), mapH: z.number().min(1).max(100).default(20),
      status: z.enum(['ACTIVE', 'CLOSED']).default('ACTIVE') }),
  });

  // ---------------- ticket types & packages ----------------
  registerCrud(app, {
    path: '/api/admin/ticket-types', table: 'ticket_types', permission: 'package.manage', viewPermission: 'ticket.view', orderBy: 't.sort, t.code',
    schema: z.object({ code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1), nameEn: z.string().nullish(), minAge: z.number().int().nullish(),
      maxAge: z.number().int().nullish(), minHeightCm: z.number().int().nullish(), maxHeightCm: z.number().int().nullish(), requiresId: z.boolean().default(false),
      sort: z.number().int().default(0), isActive: z.boolean().default(true) }),
  });
  const packageSchema = z.object({
    branchId: zUuid.nullish(), code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1), nameEn: z.string().nullish(), nameZh: z.string().nullish(),
    description: z.string().nullish(), imageUrl: z.string().nullish(),
    category: z.enum(['ADMISSION', 'DAY_PASS', 'HALF_DAY', 'EVENING', 'UNLIMITED', 'VIP', 'GROUP', 'SCHOOL', 'CORPORATE', 'BIRTHDAY', 'FAMILY', 'MULTI_DAY', 'RIDE_PASS', 'OTHER']).default('ADMISSION'),
    pricingMode: z.enum(['PER_GUEST', 'BUNDLE']).default('PER_GUEST'), bundlePrice: zMoney.nullish(), bundleMemberPrice: zMoney.nullish(),
    bundleGuests: z.array(z.object({ ticket_type_code: z.string(), qty: z.number().int().positive() })).default([]),
    days: z.number().int().positive().default(1), multiDayMode: z.enum(['CONSECUTIVE', 'ANY_WITHIN']).default('CONSECUTIVE'), anyWithinDays: z.number().int().positive().nullish(),
    validFrom: zDate.nullish(), validTo: zDate.nullish(), validDaysOfWeek: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
    validTimeStart: time.optional(), validTimeEnd: time.optional(), saleStart: z.string().nullish(), saleEnd: z.string().nullish(),
    minAge: z.number().int().nullish(), maxAge: z.number().int().nullish(), minHeightCm: z.number().int().nullish(), maxHeightCm: z.number().int().nullish(),
    entriesPerDay: z.number().int().positive().nullish(), reentryAllowed: z.boolean().default(true), transferable: z.boolean().default(false),
    rideAccess: z.enum(['ALL', 'SELECT', 'NONE']).default('SELECT'), rideAccessType: ENT.default('UNLIMITED'), rideAccessUses: z.number().int().positive().nullish(),
    zoneAccess: z.enum(['ALL', 'SELECT']).default('ALL'),
    refundPolicy: z.enum(['NON_REFUNDABLE', 'FULL_BEFORE_VISIT', 'PARTIAL_BEFORE_VISIT', 'ANYTIME']).default('NON_REFUNDABLE'), refundPercent: z.number().min(0).max(100).default(100),
    refundCutoffHours: z.number().int().min(0).default(24), dailyCapacity: z.number().int().positive().nullish(), walletCredit: zMoney.default(0),
    memberCardEntry: z.boolean().default(true), earnPoints: z.boolean().default(true), channels: z.array(z.enum(['ONLINE', 'COUNTER', 'KIOSK'])).default(['ONLINE', 'COUNTER', 'KIOSK']),
    isActive: z.boolean().default(true), sort: z.number().int().default(0),
  });
  registerCrud(app, {
    path: '/api/admin/packages', table: 'packages', permission: 'package.manage', viewPermission: 'ticket.view', branchScoped: 'optional', orderBy: 't.sort, t.name',
    schema: packageSchema, jsonColumns: ['bundle_guests'], searchColumns: ['code', 'name'],
  });
  /** Full package composition (prices, rides, zones, benefits, blackout dates) in one call — no code changes needed for new packages. */
  app.get('/api/admin/packages/:id/composition', { preHandler: requirePerm('ticket.view') }, async (req) => {
    const { id } = req.params as { id: string };
    const [prices, rides, zones, benefits, blackout] = await Promise.all([
      query(pool, 'SELECT pp.*, tt.code, tt.name FROM package_prices pp JOIN ticket_types tt ON tt.id = pp.ticket_type_id WHERE package_id = $1 ORDER BY tt.sort', [id]),
      query(pool, 'SELECT pr.*, r.name, r.code FROM package_rides pr JOIN rides r ON r.id = pr.ride_id WHERE package_id = $1 ORDER BY r.name', [id]),
      query(pool, 'SELECT zone_id FROM package_zones WHERE package_id = $1', [id]),
      query(pool, 'SELECT * FROM package_benefits WHERE package_id = $1', [id]),
      query(pool, 'SELECT date, note FROM package_blackout_dates WHERE package_id = $1 ORDER BY date', [id]),
    ]);
    return { prices, rides, zones: zones.map((z: any) => z.zone_id), benefits, blackout };
  });
  app.put('/api/admin/packages/:id/composition', { preHandler: requirePerm('package.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({
      prices: z.array(z.object({ ticketTypeId: zUuid, price: zMoney, memberPrice: zMoney.nullish(), peakPrice: zMoney.nullish() })).default([]),
      rides: z.array(z.object({ rideId: zUuid, entitlementType: ENT.default('UNLIMITED'), uses: z.number().int().positive().nullish(), validUntilTime: time.optional() })).default([]),
      zones: z.array(zUuid).default([]),
      benefits: z.array(z.object({ type: z.enum(['FOOD_VOUCHER', 'LOCKER', 'FAST_PASS', 'WALLET_CREDIT', 'PHOTO', 'CUSTOM']), value: zMoney.default(0), label: z.string().nullish() })).default([]),
      blackout: z.array(z.object({ date: zDate, note: z.string().nullish() })).default([]),
    }), req.body);
    await withTx(async (tx) => {
      const pkg = await one(tx, 'SELECT * FROM packages WHERE id = $1 FOR UPDATE', [id]);
      if (!pkg) throw notFound('Package');
      await tx.query('DELETE FROM package_prices WHERE package_id = $1', [id]);
      for (const p of body.prices) await tx.query('INSERT INTO package_prices(package_id, ticket_type_id, price, member_price, peak_price) VALUES ($1,$2,$3,$4,$5)', [id, p.ticketTypeId, p.price, p.memberPrice ?? null, p.peakPrice ?? null]);
      await tx.query('DELETE FROM package_rides WHERE package_id = $1', [id]);
      for (const r of body.rides) await tx.query('INSERT INTO package_rides(package_id, ride_id, entitlement_type, uses, valid_until_time) VALUES ($1,$2,$3,$4,$5)', [id, r.rideId, r.entitlementType, r.uses ?? null, r.validUntilTime ?? null]);
      await tx.query('DELETE FROM package_zones WHERE package_id = $1', [id]);
      for (const z of body.zones) await tx.query('INSERT INTO package_zones(package_id, zone_id) VALUES ($1,$2)', [id, z]);
      await tx.query('DELETE FROM package_benefits WHERE package_id = $1', [id]);
      for (const b of body.benefits) await tx.query('INSERT INTO package_benefits(package_id, type, value, label) VALUES ($1,$2,$3,$4)', [id, b.type, b.value, b.label ?? null]);
      await tx.query('DELETE FROM package_blackout_dates WHERE package_id = $1', [id]);
      for (const d of body.blackout) await tx.query('INSERT INTO package_blackout_dates(package_id, date, note) VALUES ($1,$2,$3)', [id, d.date, d.note ?? null]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'package_composition', entityId: id, after: body });
    });
    return { ok: true };
  });

  // ---------------- rides / scan points ----------------
  registerCrud(app, {
    path: '/api/admin/rides', table: 'rides', permission: 'ride.manage', viewPermission: 'ride.view', branchScoped: 'required', orderBy: 't.sort, t.name',
    searchColumns: ['code', 'name'],
    schema: z.object({ branchId: zUuid.optional(), zoneId: zUuid.nullish(), code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1), nameEn: z.string().nullish(),
      description: z.string().nullish(), imageUrl: z.string().nullish(), minHeightCm: z.number().int().nullish(), maxHeightCm: z.number().int().nullish(),
      minAge: z.number().int().nullish(), maxAge: z.number().int().nullish(), capacityPerCycle: z.number().int().positive().default(10), cycleMinutes: z.number().positive().default(5),
      status: z.enum(['OPEN', 'CLOSED', 'MAINTENANCE', 'TEMPORARILY_CLOSED']).default('OPEN'), addonEnabled: z.boolean().default(true), addonPrice: zMoney.default(0),
      addonMemberPrice: zMoney.nullish(), addonPeakPrice: zMoney.nullish(), addonEntitlementType: ENT.default('ONE_TIME'), addonUses: z.number().int().positive().default(1),
      pointRequirement: z.number().int().min(0).default(0), queueEnabled: z.boolean().default(true), queuePrefix: z.string().min(1).max(3).default('A'),
      queueCallWindowMin: z.number().int().positive().default(10), operatorStaffId: zUuid.nullish(), sort: z.number().int().default(0) }),
  });
  app.put('/api/admin/rides/:id/tier-prices', { preHandler: requirePerm('ride.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.array(z.object({ tierId: zUuid, price: zMoney })), req.body);
    await withTx(async (tx) => {
      await tx.query('DELETE FROM ride_tier_prices WHERE ride_id = $1', [id]);
      for (const p of body) await tx.query('INSERT INTO ride_tier_prices(ride_id, tier_id, price) VALUES ($1,$2,$3)', [id, p.tierId, p.price]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'ride_tier_prices', entityId: id, after: body });
    });
    return { ok: true };
  });
  app.get('/api/admin/rides/:id/tier-prices', { preHandler: requirePerm('ride.view') }, async (req) =>
    query(pool, 'SELECT tp.*, t.name FROM ride_tier_prices tp JOIN member_tiers t ON t.id = tp.tier_id WHERE ride_id = $1', [(req.params as any).id]));
  registerCrud(app, {
    path: '/api/admin/scan-points', table: 'ride_scan_points', permission: 'ride.manage', viewPermission: 'ride.view', orderBy: 't.code',
    select: `SELECT t.*, r.name AS ride_name, r.branch_id FROM ride_scan_points t JOIN rides r ON r.id = t.ride_id`,
    schema: z.object({ code: z.string().min(1).transform((s) => s.toUpperCase()), rideId: zUuid, zoneId: zUuid.nullish(), deviceId: zUuid.nullish(), name: z.string().min(1),
      location: z.string().nullish(), paymentEnabled: z.boolean().default(true), paymentMethods: z.array(z.enum(['WALLET', 'PROMPTPAY', 'CARD', 'CASH'])).default(['WALLET', 'PROMPTPAY', 'CARD', 'CASH']),
      operatorStaffId: zUuid.nullish(), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') }),
  });

  // ---------------- gates / devices ----------------
  registerCrud(app, {
    path: '/api/admin/gates', table: 'gates', permission: 'gate.manage', viewPermission: 'gate.view', branchScoped: 'required', orderBy: 't.number',
    schema: z.object({ branchId: zUuid.optional(), zoneId: zUuid.nullish(), code: z.string().min(1), name: z.string().min(1), number: z.number().int().positive(),
      direction: z.enum(['ENTRY', 'EXIT', 'BOTH']).default('ENTRY'), mode: z.enum(['AUTO', 'MANUAL']).default('MANUAL'),
      controllerType: z.enum(['SIMULATOR', 'TURNSTILE', 'FLAP_BARRIER', 'SWING_GATE', 'RELAY', 'GPIO', 'NETWORK']).default('SIMULATOR'),
      controllerConfig: z.record(z.string(), z.unknown()).default({}), openDurationMs: z.number().int().min(1000).max(60000).default(5000), isEnabled: z.boolean().default(true),
      blockNewEntry: z.boolean().default(false), operatorStaffId: zUuid.nullish() }),
    jsonColumns: ['controller_config'],
  });
  registerCrud(app, {
    path: '/api/admin/devices', table: 'devices', permission: 'device.manage', viewPermission: 'device.manage', branchScoped: 'required', orderBy: 't.type, t.code',
    select: `SELECT t.id, t.branch_id, t.code, t.name, t.type, t.location, t.zone_id, t.ip, t.mac, t.status, t.last_seen_at, t.firmware, t.config, t.created_at,
               (t.api_key_hash IS NOT NULL) AS has_key, t.api_key_prefix FROM devices t`,
    searchColumns: ['code', 'name', 'location'],
    schema: z.object({ branchId: zUuid.optional(), code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1),
      type: z.enum(['GATE_SCANNER', 'GATE_CONTROLLER', 'GATE_DISPLAY', 'POS', 'KIOSK', 'RIDE_SCANNER', 'KITCHEN_DISPLAY', 'QUEUE_DISPLAY', 'LOCKER_CONTROLLER', 'PRINTER', 'PAYMENT_TERMINAL', 'CUSTOMER_DISPLAY', 'WRISTBAND_PRINTER']),
      location: z.string().nullish(), zoneId: zUuid.nullish(), ip: z.string().nullish(), mac: z.string().nullish(), status: z.enum(['ONLINE', 'OFFLINE', 'ERROR', 'DISABLED']).optional(),
      config: z.record(z.string(), z.unknown()).default({}) }),
    jsonColumns: ['config'],
  });
  app.post('/api/admin/devices/:id/key', { preHandler: requirePerm('device.manage') }, async (req) => issueDeviceKey(pool, req.actor, (req.params as any).id));
  app.put('/api/admin/gates/:id/devices', { preHandler: requirePerm('gate.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.array(z.object({ deviceId: zUuid, role: z.enum(['SCANNER', 'CONTROLLER', 'DISPLAY', 'CAMERA']) })), req.body);
    await withTx(async (tx) => {
      await tx.query('DELETE FROM gate_devices WHERE gate_id = $1', [id]);
      for (const d of body) await tx.query('INSERT INTO gate_devices(gate_id, device_id, role) VALUES ($1,$2,$3)', [id, d.deviceId, d.role]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'gate_devices', entityId: id, after: body });
    });
    return { ok: true };
  });

  // ---------------- stores / catalog / inventory ----------------
  registerCrud(app, {
    path: '/api/admin/stores', table: 'stores', permission: 'product.manage', viewPermission: 'pos.sell', branchScoped: 'required', orderBy: 't.type, t.name',
    schema: z.object({ branchId: zUuid.optional(), zoneId: zUuid.nullish(), code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1),
      type: z.enum(['TICKET', 'RESTAURANT', 'RETAIL', 'KIOSK', 'LOCKER', 'WAREHOUSE', 'RIDE', 'SERVICE']), isActive: z.boolean().default(true), settings: z.record(z.string(), z.unknown()).default({}) }),
    jsonColumns: ['settings'],
  });
  registerCrud(app, {
    path: '/api/admin/categories', table: 'categories', permission: 'product.manage', viewPermission: 'pos.sell', orderBy: 't.sort, t.name',
    schema: z.object({ branchId: zUuid.nullish(), parentId: zUuid.nullish(), code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1),
      type: z.enum(['FOOD', 'DRINK', 'SOUVENIR', 'MERCHANDISE', 'PHOTO', 'LOCKER', 'SERVICE', 'ADDON']),
      pointsCategory: z.enum(['TICKET', 'FOOD', 'RETAIL', 'TOPUP', 'PACKAGE', 'NONE']).default('RETAIL'), sort: z.number().int().default(0) }),
  });
  const modifiers = z.array(z.object({ group: z.string(), required: z.boolean().default(false), max: z.number().int().positive().optional(),
    options: z.array(z.object({ name: z.string(), price: zMoney.default(0) })) }));
  registerCrud(app, {
    path: '/api/admin/products', table: 'products', permission: 'product.manage', viewPermission: 'pos.sell', branchScoped: 'optional', orderBy: 't.sort, t.name',
    searchColumns: ['sku', 'barcode', 'name'],
    select: `SELECT t.*, c.name AS category_name, c.type AS category_type, ARRAY(SELECT store_id FROM product_stores ps WHERE ps.product_id = t.id) AS store_ids FROM products t LEFT JOIN categories c ON c.id = t.category_id`,
    schema: z.object({ branchId: zUuid.nullish(), sku: z.string().min(1).transform((s) => s.toUpperCase()), barcode: z.string().nullish(), name: z.string().min(1), nameEn: z.string().nullish(),
      description: z.string().nullish(), imageUrl: z.string().nullish(), categoryId: zUuid.nullish(), price: zMoney, memberPrice: zMoney.nullish(), cost: zMoney.default(0),
      taxIncluded: z.boolean().default(true), trackStock: z.boolean().default(false), lowStockThreshold: z.number().int().min(0).default(10), modifiers: modifiers.default([]),
      sendToKitchen: z.boolean().default(false), sellableOnline: z.boolean().default(false), isActive: z.boolean().default(true), sort: z.number().int().default(0) }),
    jsonColumns: ['modifiers'],
  });
  app.put('/api/admin/products/:id/stores', { preHandler: requirePerm('product.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.array(zUuid), req.body);
    await withTx(async (tx) => {
      await tx.query('DELETE FROM product_stores WHERE product_id = $1', [id]);
      for (const s of body) await tx.query('INSERT INTO product_stores(product_id, store_id) VALUES ($1,$2)', [id, s]);
    });
    return { ok: true };
  });
  app.get('/api/inventory', { preHandler: requirePerm('inventory.view') }, async (req) => {
    const q = req.query as any;
    return stockLevels(pool, branchOf(req, q.branchId), q.storeId || null);
  });
  app.get('/api/inventory/movements', { preHandler: requirePerm('inventory.view') }, async (req) => {
    const q = req.query as any;
    return query(pool, `SELECT m.*, p.sku, p.name AS product_name, s.name AS store_name, st.first_name AS staff_name FROM stock_movements m JOIN products p ON p.id = m.product_id
        JOIN stores s ON s.id = m.store_id LEFT JOIN staff st ON st.id = m.staff_id WHERE s.branch_id = $1 AND ($2::uuid IS NULL OR m.product_id = $2) ORDER BY m.created_at DESC LIMIT 300`,
      [branchOf(req, q.branchId), q.productId || null]);
  });
  app.post('/api/inventory/move', { preHandler: requirePerm('inventory.manage') }, async (req) => {
    const b = parse(z.object({ productId: zUuid, storeId: zUuid, type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'WASTE']), qty: z.number().int(), reason: z.string().min(1) }), req.body);
    const delta = b.type === 'IN' ? Math.abs(b.qty) : b.type === 'ADJUSTMENT' ? b.qty : -Math.abs(b.qty);
    return withTx(async (tx, after) => {
      const store = await one(tx, 'SELECT branch_id FROM stores WHERE id = $1', [b.storeId]);
      if (!store) throw notFound('Store');
      branchOf(req, store.branch_id);
      const mv = await moveStock(tx, { productId: b.productId, storeId: b.storeId, delta, type: b.type, reason: b.reason, staffId: req.actor.staffId, branchId: store.branch_id }, after);
      await audit(tx, req.actor, { action: 'STOCK_ADJUSTMENT', entityType: 'product', entityId: b.productId, after: mv, reason: b.reason, branchId: store.branch_id });
      return mv;
    });
  });
  app.post('/api/inventory/transfer', { preHandler: requirePerm('inventory.manage') }, async (req) => {
    const b = parse(z.object({ productId: zUuid, fromStoreId: zUuid, toStoreId: zUuid, qty: z.number().int().positive(), reason: z.string().nullish() }), req.body);
    if (b.fromStoreId === b.toStoreId) throw badRequest('SAME_STORE', 'Choose different stores');
    return withTx(async (tx) => {
      const r = await transferStock(tx, { ...b, staffId: req.actor.staffId, branchId: req.actor.branchId });
      await audit(tx, req.actor, { action: 'STOCK_TRANSFER', entityType: 'product', entityId: b.productId, after: b, reason: b.reason });
      return r;
    });
  });

  // ---------------- membership configuration ----------------
  registerCrud(app, {
    path: '/api/admin/tiers', table: 'member_tiers', permission: 'membership.manage', viewPermission: 'member.view', orderBy: 't.rank',
    schema: z.object({ code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1), rank: z.number().int().default(0), color: z.string().default('#64748b'),
      pointMultiplier: z.number().min(0).default(1), ticketDiscountPct: z.number().min(0).max(100).default(0), foodDiscountPct: z.number().min(0).max(100).default(0),
      retailDiscountPct: z.number().min(0).max(100).default(0), isActive: z.boolean().default(true) }),
  });
  registerCrud(app, {
    path: '/api/admin/membership-products', table: 'membership_products', permission: 'membership.manage', viewPermission: 'member.view', orderBy: 't.sort, t.annual_fee',
    select: `SELECT t.*, mt.name AS tier_name, mt.color AS tier_color, (SELECT json_agg(b) FROM membership_benefits b WHERE b.product_id = t.id) AS benefits
               FROM membership_products t JOIN member_tiers mt ON mt.id = t.tier_id`,
    schema: z.object({ branchId: zUuid.nullish(), tierId: zUuid, code: z.string().min(1).transform((s) => s.toUpperCase()), name: z.string().min(1), description: z.string().nullish(),
      imageUrl: z.string().nullish(), cardDesign: z.record(z.string(), z.unknown()).default({}), registrationFee: zMoney.default(0), annualFee: zMoney.default(0),
      renewalPrice: zMoney.nullish(), upgradePrice: zMoney.nullish(), upgradeMode: z.enum(['FULL', 'DIFFERENCE', 'PRORATED']).default('DIFFERENCE'),
      validityUnit: z.enum(['DAY', 'MONTH', 'YEAR', 'LIFETIME']).default('YEAR'), validityValue: z.number().int().positive().default(1),
      earlyRenewalDays: z.number().int().min(0).default(30), earlyRenewalDiscountPct: z.number().min(0).max(100).default(0), gracePeriodDays: z.number().int().min(0).default(15),
      pointMultiplier: z.number().min(0).nullish(), visitLimit: z.number().int().nullish(), guestBenefits: z.record(z.string(), z.unknown()).default({}),
      freeItems: z.array(z.unknown()).default([]), rideRights: z.array(z.unknown()).default([]), physicalCardFee: zMoney.default(0), isActive: z.boolean().default(true), sort: z.number().int().default(0) }),
    jsonColumns: ['card_design', 'guest_benefits', 'free_items', 'ride_rights'],
  });
  app.put('/api/admin/membership-products/:id/benefits', { preHandler: requirePerm('membership.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.array(z.object({
      type: z.enum(['TICKET_DISCOUNT', 'FOOD_DISCOUNT', 'RETAIL_DISCOUNT', 'FREE_RIDE', 'FREE_LOCKER', 'BIRTHDAY_REWARD', 'PRIORITY_QUEUE', 'FAST_PASS', 'FREE_ADMISSION',
        'GUEST_DISCOUNT', 'POINT_MULTIPLIER', 'PARKING', 'SPECIAL_EVENT', 'MEMBER_LOUNGE', 'CUSTOM']), value: z.number().default(0), label: z.string().nullish(),
      config: z.record(z.string(), z.unknown()).default({}),
    })), req.body);
    await withTx(async (tx) => {
      const p = await one(tx, 'SELECT tier_id FROM membership_products WHERE id = $1', [id]);
      if (!p) throw notFound('Membership product');
      await tx.query('DELETE FROM membership_benefits WHERE product_id = $1', [id]);
      for (const b of body) await tx.query('INSERT INTO membership_benefits(product_id, type, value, label, config) VALUES ($1,$2,$3,$4,$5)', [id, b.type, b.value, b.label ?? null, JSON.stringify(b.config)]);
      // keep tier discount columns in sync with discount benefits (used by promotion engine)
      const get = (t: string) => body.find((b) => b.type === t)?.value ?? 0;
      await tx.query('UPDATE member_tiers SET ticket_discount_pct = $2, food_discount_pct = $3, retail_discount_pct = $4 WHERE id = $1',
        [p.tier_id, get('TICKET_DISCOUNT'), get('FOOD_DISCOUNT'), get('RETAIL_DISCOUNT')]);
      const mult = body.find((b) => b.type === 'POINT_MULTIPLIER');
      if (mult) await tx.query('UPDATE membership_products SET point_multiplier = $2 WHERE id = $1', [id, mult.value]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'membership_benefits', entityId: id, after: body });
    });
    return { ok: true };
  });

  // ---------------- promotions / coupons / rewards ----------------
  registerCrud(app, {
    path: '/api/admin/promotions', table: 'promotions', permission: 'promotion.manage', viewPermission: 'pos.sell', branchScoped: 'optional', orderBy: 't.priority, t.created_at DESC',
    schema: z.object({ branchId: zUuid.nullish(), name: z.string().min(1), description: z.string().nullish(), type: z.enum(['PERCENT', 'AMOUNT', 'BUY_X_PAY_Y', 'FIXED_PRICE']),
      value: z.number().min(0).default(0), buyQty: z.number().int().positive().nullish(), payQty: z.number().int().min(0).nullish(), maxDiscount: zMoney.nullish(),
      appliesTo: z.enum(['ORDER', 'TICKET', 'FOOD', 'RETAIL', 'PACKAGE', 'PRODUCT']).default('ORDER'),
      conditions: z.object({ min_qty: z.number().int().optional(), min_spend: zMoney.optional(), member_only: z.boolean().optional(), member_tier_codes: z.array(z.string()).optional(),
        channels: z.array(z.string()).optional(), package_ids: z.array(zUuid).optional(), product_ids: z.array(zUuid).optional(), ticket_type_codes: z.array(z.string()).optional(),
        min_days_before_visit: z.number().int().optional(), days_of_week: z.array(z.number().int().min(0).max(6)).optional(), time_start: z.string().optional(),
        time_end: z.string().optional(), birthday: z.enum(['DAY', 'MONTH']).optional(), max_items: z.number().int().positive().optional() }).default({}),
      stackable: z.boolean().default(false), priority: z.number().int().default(100), startAt: z.string().nullish(), endAt: z.string().nullish(),
      usageLimit: z.number().int().positive().nullish(), usagePerMember: z.number().int().positive().nullish(), requiresCoupon: z.boolean().default(false), isActive: z.boolean().default(true) }),
    jsonColumns: ['conditions'],
  });
  registerCrud(app, {
    path: '/api/admin/coupons', table: 'coupons', permission: 'promotion.manage', orderBy: 't.created_at DESC', searchColumns: ['code'],
    select: `SELECT t.*, p.name AS promotion_name FROM coupons t JOIN promotions p ON p.id = t.promotion_id`,
    schema: z.object({ promotionId: zUuid, code: z.string().min(3).transform((s) => s.toUpperCase()), usageLimit: z.number().int().positive().default(1), memberId: zUuid.nullish(),
      expiresAt: z.string().nullish(), status: z.enum(['ACTIVE', 'USED', 'EXPIRED', 'DISABLED']).default('ACTIVE'), source: z.enum(['MANUAL', 'REWARD', 'BIRTHDAY', 'CAMPAIGN']).default('MANUAL') }),
  });
  app.post('/api/admin/coupons/generate', { preHandler: requirePerm('promotion.manage') }, async (req) => {
    const b = parse(z.object({ promotionId: zUuid, count: z.number().int().min(1).max(5000), prefix: z.string().max(8).default(''), usageLimit: z.number().int().positive().default(1), expiresAt: z.string().nullish() }), req.body);
    return withTx(async (tx) => {
      const codes: string[] = [];
      for (let i = 0; i < b.count; i++) {
        const code = `${b.prefix.toUpperCase()}${randomBase32(8)}`;
        await tx.query(`INSERT INTO coupons(promotion_id, code, usage_limit, expires_at, source) VALUES ($1,$2,$3,$4,'CAMPAIGN')`, [b.promotionId, code, b.usageLimit, b.expiresAt ?? null]);
        codes.push(code);
      }
      await audit(tx, req.actor, { action: 'COUPONS_GENERATED', entityType: 'promotion', entityId: b.promotionId, after: { count: b.count } });
      return { codes };
    });
  });
  registerCrud(app, {
    path: '/api/admin/rewards', table: 'rewards', permission: 'reward.manage', viewPermission: 'member.view', branchScoped: 'optional', orderBy: 't.points_required',
    schema: z.object({ branchId: zUuid.nullish(), name: z.string().min(1), description: z.string().nullish(), imageUrl: z.string().nullish(),
      type: z.enum(['DISCOUNT', 'FREE_TICKET', 'FOOD', 'DRINK', 'SOUVENIR', 'RIDE_PASS', 'LOCKER', 'UPGRADE', 'COUPON', 'WALLET_CREDIT']), pointsRequired: z.number().int().positive(),
      stock: z.number().int().min(0).nullish(), minTierRank: z.number().int().min(0).default(0), startAt: z.string().nullish(), endAt: z.string().nullish(),
      config: z.record(z.string(), z.unknown()).default({}), voucherValidDays: z.number().int().positive().default(30), isActive: z.boolean().default(true) }),
    jsonColumns: ['config'],
  });

  // ---------------- lockers ----------------
  registerCrud(app, {
    path: '/api/admin/lockers', table: 'lockers', permission: 'locker.manage', viewPermission: 'locker.use', branchScoped: 'required', orderBy: 't.code',
    schema: z.object({ branchId: zUuid.optional(), zoneId: zUuid.nullish(), code: z.string().min(1).transform((s) => s.toUpperCase()), bank: z.string().nullish(),
      size: z.enum(['S', 'M', 'L', 'XL']).default('M'), status: z.enum(['AVAILABLE', 'OCCUPIED', 'OUT_OF_SERVICE', 'RESERVED']).default('AVAILABLE'),
      controllerType: z.string().default('SIMULATOR'), controllerConfig: z.record(z.string(), z.unknown()).default({}), deviceId: zUuid.nullish() }),
    jsonColumns: ['controller_config'],
  });
  registerCrud(app, {
    path: '/api/admin/locker-rates', table: 'locker_rates', permission: 'locker.manage', viewPermission: 'locker.use', branchScoped: 'required', orderBy: 't.size, t.sort',
    schema: z.object({ branchId: zUuid.optional(), size: z.enum(['S', 'M', 'L', 'XL']), name: z.string().min(1), durationMinutes: z.number().int().positive().nullish(),
      price: zMoney, isActive: z.boolean().default(true), sort: z.number().int().default(0) }),
  });

  // ---------------- staff & roles ----------------
  registerCrud(app, {
    path: '/api/admin/staff', table: 'staff', permission: 'staff.manage', branchScoped: 'optional', orderBy: 't.employee_code', searchColumns: ['employee_code', 'first_name', 'last_name', 'nickname'],
    select: `SELECT t.id, t.employee_code, t.first_name, t.last_name, t.nickname, t.role_id, t.branch_id, t.phone, t.email, t.status, t.last_login_at, t.created_at,
               r.name AS role_name, r.code AS role_code, b.name AS branch_name FROM staff t JOIN roles r ON r.id = t.role_id LEFT JOIN branches b ON b.id = t.branch_id`,
    schema: z.object({ employeeCode: z.string().min(2).transform((s) => s.toUpperCase()), firstName: z.string().min(1), lastName: z.string().default(''), nickname: z.string().nullish(),
      roleId: zUuid, branchId: zUuid.nullish(), phone: z.string().nullish(), email: z.string().email().nullish(), status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).default('ACTIVE'),
      pin: zPin.optional() }),
    beforeWrite: async (data, _req, existing) => {
      const { pin, ...rest } = data as any;
      if (pin) rest.pinHash = await hashSecret(pin);
      else if (!existing) throw badRequest('PIN_REQUIRED', 'PIN is required for new staff');
      return rest;
    },
    afterWrite: (row) => invalidateAuthCache(`staff:${row.id}`),
  });
  registerCrud(app, {
    path: '/api/admin/roles', table: 'roles', permission: 'role.manage', viewPermission: 'staff.manage', orderBy: 't.approval_level DESC, t.name',
    select: `SELECT t.*, ARRAY(SELECT permission_key FROM role_permissions rp WHERE rp.role_id = t.id ORDER BY 1) AS permissions, (SELECT COUNT(*)::int FROM staff s WHERE s.role_id = t.id) AS staff_count FROM roles t`,
    schema: z.object({ code: z.string().min(2).transform((s) => s.toUpperCase()), name: z.string().min(1), description: z.string().nullish(), approvalLevel: z.number().int().min(0).max(100).default(0) }),
  });
  app.put('/api/admin/roles/:id/permissions', { preHandler: requirePerm('role.manage') }, async (req) => {
    const { id } = req.params as { id: string };
    const perms = parse(z.array(z.string()), req.body);
    for (const p of perms) if (p !== '*' && !(p in PERMISSIONS)) throw badRequest('UNKNOWN_PERMISSION', p);
    await withTx(async (tx) => {
      const role = await one(tx, 'SELECT * FROM roles WHERE id = $1', [id]);
      if (!role) throw notFound('Role');
      if (role.code === 'OWNER' && !perms.includes('*')) throw badRequest('OWNER_LOCKED', 'Owner role must keep all permissions');
      const before = await query(tx, 'SELECT permission_key FROM role_permissions WHERE role_id = $1', [id]);
      await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
      for (const p of perms) await tx.query('INSERT INTO role_permissions(role_id, permission_key) VALUES ($1,$2)', [id, p]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'role_permissions', entityId: id, before: before.map((b: any) => b.permission_key), after: perms });
    });
    invalidateAuthCache('staff:');
    return { ok: true };
  });
  app.get('/api/admin/permissions', { preHandler: requirePerm('staff.manage') }, async () => query(pool, 'SELECT * FROM permissions ORDER BY module, action'));

  // ---------------- settings / fonts / print templates ----------------
  app.get('/api/admin/settings', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const q = req.query as any;
    const branchId = q.scope === 'global' ? null : q.branchId || req.actor.branchId || null;
    return { scope: branchId ? 'branch' : 'global', branchId, settings: await getAllSettings(branchId), keys: Object.keys(SETTING_DEFAULTS) };
  });
  app.put('/api/admin/settings/:key', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { key } = req.params as { key: string };
    if (!(key in SETTING_DEFAULTS)) throw badRequest('UNKNOWN_SETTING', key);
    const b = parse(z.object({ value: z.record(z.string(), z.unknown()), branchId: zUuid.nullish() }), req.body);
    const branchId = b.branchId ? branchOf(req, b.branchId) : req.actor.branchId ? branchOf(req, req.actor.branchId) : null;
    return withTx(async (tx) => {
      const before = await putSetting(tx, key, b.value, branchId, req.actor.staffId);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'settings', entityId: key, before, after: b.value, branchId });
      return { ok: true };
    });
  });
  app.post('/api/admin/fonts', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('FILE_REQUIRED', 'Upload a font file');
    const ext = path.extname(file.filename).toLowerCase();
    if (!['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) throw badRequest('BAD_FONT', 'Font must be TTF / OTF / WOFF / WOFF2');
    const family = String((file.fields as any)?.family?.value ?? path.basename(file.filename, ext)).replace(/[^\w \-]/g, '').slice(0, 60);
    const dir = path.resolve(config.uploadDir, 'fonts');
    await fs.mkdir(dir, { recursive: true });
    const name = `${randomBase32(10)}${ext}`;
    await fs.writeFile(path.join(dir, name), await file.toBuffer());
    const row = await one(pool, `INSERT INTO font_assets(family, file_path, mime) VALUES ($1,$2,$3) ON CONFLICT (family) DO UPDATE SET file_path = EXCLUDED.file_path RETURNING *`, [family, name, file.mimetype]);
    await audit(pool, req.actor, { action: 'SETTINGS_CHANGE', entityType: 'font_assets', entityId: row.id, after: { family } });
    return row;
  });
  registerCrud(app, {
    path: '/api/admin/print-templates', table: 'print_templates', permission: 'settings.manage', viewPermission: 'pos.sell', branchScoped: 'optional', orderBy: 't.type, t.name',
    schema: z.object({ branchId: zUuid.nullish(), type: z.enum(['RECEIPT', 'TICKET', 'WRISTBAND', 'MEMBER_CARD', 'KITCHEN']), paper: z.enum(['58MM', '80MM', 'A4', 'WRISTBAND', 'CR80']),
      name: z.string().min(1), layout: z.record(z.string(), z.unknown()).default({}), isDefault: z.boolean().default(false) }),
    jsonColumns: ['layout'],
  });

  // ---------------- payment verification center ----------------
  app.get('/api/payment-verifications', { preHandler: requirePerm('payment.verify') }, async (req) => {
    const q = req.query as any;
    return listVerificationRequests(pool, branchOf(req, q.branchId), q.status ?? 'WAITING');
  });
  app.post('/api/payment-verifications/:id/review', { preHandler: requirePerm('payment.verify') }, async (req) => {
    const b = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_NEW_SLIP']), note: z.string().nullish() }), req.body);
    return reviewVerification(req.actor, (req.params as any).id, b.decision, b.note ?? undefined);
  });
  app.get('/api/payment-verifications/:id/slip', { preHandler: requirePerm('payment.verify') }, async (req, reply) => {
    const r = await one(pool, 'SELECT slip_path FROM payment_verification_requests WHERE id = $1', [(req.params as any).id]);
    if (!r?.slip_path) throw notFound('Slip');
    const file = path.resolve(config.uploadDir, 'slips', path.basename(r.slip_path));
    const buf = await fs.readFile(file);
    reply.header('content-type', r.slip_path.endsWith('.png') ? 'image/png' : r.slip_path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    return reply.send(buf);
  });
}
