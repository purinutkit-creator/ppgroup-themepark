/**
 * Initial configuration for a fresh installation (one demo branch fully configured).
 * Everything created here is ordinary configuration that admins edit from the back office —
 * nothing is hard-coded in business logic. Safe to run once; refuses to run twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, one, withTx, type Tx } from './pool.js';
import { migrate } from './migrate.js';
import { hashSecret, newDeviceApiKey } from '../lib/crypto.js';
import { PERMISSIONS } from '../services/permissions.js';
import { ensureMemberAccount } from '../services/accounts.js';
import { issueCredential } from '../services/credentials.js';
import { postLedger, walletForAccount } from '../services/wallet.js';
import { businessDate, codes } from '../lib/codes.js';

const THB = (n: number) => Math.round(n * 100);

const ROLE_PERMS: Record<string, { name: string; level: number; perms: string[] }> = {
  OWNER: { name: 'Owner', level: 100, perms: ['*'] },
  ADMIN: { name: 'Admin', level: 90, perms: Object.keys(PERMISSIONS) },
  PARK_MANAGER: { name: 'Park Manager', level: 80, perms: Object.keys(PERMISSIONS).filter((p) => !['role.manage', 'branch.manage', 'dashboard.consolidated'].includes(p)) },
  SUPERVISOR: { name: 'Supervisor', level: 60, perms: ['dashboard.view', 'approval.grant', 'gate.view', 'gate.scan', 'gate.approve', 'gate.open', 'gate.override', 'gate.emergency', 'ride.view', 'ride.scan', 'ride.operate', 'ride.manual_entry', 'queue.manage',
    'booking.view', 'booking.checkin', 'booking.cancel', 'ticket.view', 'ticket.sell', 'ticket.override', 'member.view', 'member.create', 'member.edit', 'credential.view', 'credential.issue', 'credential.manage', 'credential.lookup_code',
    'wallet.view', 'wallet.topup', 'wallet.cashout', 'payment.accept', 'payment.verify', 'pos.sell', 'pos.discount', 'pos.void', 'refund.create', 'transaction.view', 'shift.open', 'shift.manage', 'shift.cash_movement',
    'locker.use', 'kitchen.manage', 'inventory.view', 'report.view', 'notification.view', 'audit.view'] },
  TICKET_CASHIER: { name: 'Ticket Cashier', level: 10, perms: ['ticket.view', 'ticket.sell', 'booking.view', 'booking.create', 'booking.checkin', 'member.view', 'member.create', 'credential.view', 'credential.issue', 'credential.lookup_code',
    'wallet.view', 'wallet.topup', 'payment.accept', 'shift.open', 'locker.use', 'notification.view'] },
  POS_CASHIER: { name: 'POS Cashier', level: 10, perms: ['pos.sell', 'payment.accept', 'wallet.view', 'wallet.topup', 'credential.view', 'member.view', 'shift.open', 'notification.view'] },
  GATE_OPERATOR: { name: 'Gate Operator', level: 10, perms: ['gate.view', 'gate.scan', 'gate.approve', 'credential.view', 'notification.view'] },
  RIDE_OPERATOR: { name: 'Ride Operator', level: 10, perms: ['ride.view', 'ride.scan', 'ride.operate', 'queue.manage', 'credential.view', 'payment.accept', 'shift.open', 'notification.view'] },
  RESTAURANT_STAFF: { name: 'Restaurant Staff', level: 10, perms: ['pos.sell', 'payment.accept', 'kitchen.manage', 'credential.view', 'shift.open', 'member.view'] },
  KITCHEN_STAFF: { name: 'Kitchen Staff', level: 5, perms: ['kitchen.manage'] },
  RETAIL_STAFF: { name: 'Retail Staff', level: 10, perms: ['pos.sell', 'payment.accept', 'inventory.view', 'credential.view', 'shift.open', 'member.view'] },
  LOCKER_STAFF: { name: 'Locker Staff', level: 10, perms: ['locker.use', 'credential.view', 'payment.accept', 'shift.open'] },
  CUSTOMER_SERVICE: { name: 'Customer Service', level: 20, perms: ['member.view', 'member.create', 'member.edit', 'credential.view', 'credential.issue', 'credential.manage', 'credential.lookup_code', 'booking.view', 'booking.edit',
    'booking.checkin', 'booking.cancel', 'wallet.view', 'wallet.topup', 'wallet.cashout', 'refund.create', 'payment.accept', 'payment.verify', 'transaction.view', 'shift.open', 'notification.view', 'ticket.view', 'ticket.sell'] },
  SECURITY: { name: 'Security', level: 20, perms: ['gate.view', 'gate.emergency', 'notification.view', 'dashboard.view'] },
  FINANCE: { name: 'Finance', level: 50, perms: ['dashboard.view', 'transaction.view', 'report.view', 'report.export', 'refund.create', 'payment.verify', 'shift.manage', 'audit.view', 'wallet.view', 'approval.grant'] },
};

export async function seed(tx: Tx) {
  // ---------------- permissions & roles ----------------
  await tx.query(`INSERT INTO permissions(key, module, action, description) VALUES ('*','*','*','All permissions') ON CONFLICT DO NOTHING`);
  for (const [key, desc] of Object.entries(PERMISSIONS)) {
    const [module, action] = key.split('.');
    await tx.query('INSERT INTO permissions(key, module, action, description) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description', [key, module, action, desc]);
  }
  const roles: Record<string, string> = {};
  for (const [code, r] of Object.entries(ROLE_PERMS)) {
    const row = await one(tx, `INSERT INTO roles(code, name, is_system, approval_level) VALUES ($1,$2,true,$3) RETURNING id`, [code, r.name, r.level]);
    roles[code] = row!.id;
    for (const p of r.perms) await tx.query('INSERT INTO role_permissions(role_id, permission_key) VALUES ($1,$2)', [row!.id, p]);
  }

  // ---------------- branch & zones ----------------
  const branch = (await one(tx, `INSERT INTO branches(code, name, name_en, capacity, address, phone) VALUES ('BKK01','พีพี กรุ๊ป ธีมพาร์ค บางนา','PP Group Theme Park Bangna',2000,'Bangna-Trad Rd, Bangkok','02-123-4567') RETURNING id`))!.id;
  const zone = async (code: string, name: string, cap: number, color: string, x: number, y: number, w: number, h: number) =>
    (await one(tx, `INSERT INTO zones(branch_id, code, name, capacity, color, map_x, map_y, map_w, map_h) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [branch, code, name, cap, color, x, y, w, h]))!.id;
  const zEntrance = await zone('E', 'Entrance Plaza', 400, '#0ea5e9', 2, 70, 30, 26);
  const zAdventure = await zone('A', 'Adventure Land', 500, '#22c55e', 2, 4, 44, 62);
  const zKids = await zone('B', 'Kids Kingdom', 400, '#f59e0b', 50, 4, 46, 36);
  const zThrill = await zone('C', 'Thrill Zone', 400, '#ef4444', 50, 44, 46, 30);
  const zFood = await zone('D', 'Food Court', 300, '#a855f7', 36, 78, 60, 18);

  // ---------------- staff ----------------
  const staff = async (code: string, first: string, role: string, pin: string, nick?: string, branchId: string | null = branch) =>
    (await one(tx, `INSERT INTO staff(employee_code, first_name, last_name, nickname, role_id, branch_id, pin_hash) VALUES ($1,$2,'',$3,$4,$5,$6) RETURNING id`,
      [code, first, nick ?? first, roles[role], branchId, await hashSecret(pin)]))!.id;
  await staff('OWNER', 'Owner', 'OWNER', '000000', 'Boss', null);
  await staff('EMP001', 'Admin', 'ADMIN', '1111', 'Admin');
  await staff('EMP002', 'Manager', 'PARK_MANAGER', '2222', 'Mgr');
  await staff('EMP003', 'Supervisor', 'SUPERVISOR', '3333', 'Sup');
  await staff('EMP010', 'Ticket', 'TICKET_CASHIER', '1010', 'Box');
  await staff('EMP020', 'Gate', 'GATE_OPERATOR', '2020', 'Gate');
  const rideOp = await staff('EMP030', 'Ride', 'RIDE_OPERATOR', '3030', 'Ride');
  await staff('EMP040', 'Food', 'RESTAURANT_STAFF', '4040', 'Food');
  await staff('EMP041', 'Kitchen', 'KITCHEN_STAFF', '4141', 'Chef');
  await staff('EMP050', 'Retail', 'RETAIL_STAFF', '5050', 'Shop');
  await staff('EMP060', 'Locker', 'LOCKER_STAFF', '6060', 'Lock');
  await staff('EMP070', 'Service', 'CUSTOMER_SERVICE', '7070', 'CS');
  await staff('EMP080', 'Finance', 'FINANCE', '8080', 'Fin');
  await staff('EMP090', 'Security', 'SECURITY', '9090', 'Sec');

  // ---------------- tiers & membership ----------------
  const tier = async (code: string, name: string, rank: number, color: string, mult: number, t: number, f: number, r: number) =>
    (await one(tx, `INSERT INTO member_tiers(code, name, rank, color, point_multiplier, ticket_discount_pct, food_discount_pct, retail_discount_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [code, name, rank, color, mult, t, f, r]))!.id;
  const tStd = await tier('STANDARD', 'Standard', 10, '#64748b', 1, 5, 0, 0);
  const tGold = await tier('GOLD', 'Gold', 20, '#eab308', 1.5, 10, 5, 5);
  const tPlat = await tier('PLATINUM', 'Platinum', 30, '#6366f1', 1.75, 12, 10, 8);
  const tVip = await tier('VIP', 'VIP', 40, '#0f172a', 2, 15, 15, 10);
  const mprod = async (code: string, name: string, tierId: string, fee: number, reg: number, benefits: Array<[string, number, string]>, sort: number) => {
    const id = (await one(tx, `INSERT INTO membership_products(tier_id, code, name, description, annual_fee, registration_fee, renewal_price, upgrade_mode, early_renewal_discount_pct, physical_card_fee, sort, card_design)
        VALUES ($1,$2,$3,$4,$5,$6,$5,'PRORATED',10,$7,$8,$9) RETURNING id`,
      [tierId, code, name, `${name} membership — 1 year`, THB(fee), THB(reg), THB(50), sort, JSON.stringify({ gradient: ['#0f172a', '#334155'] })]))!.id;
    for (const [type, value, label] of benefits) await tx.query('INSERT INTO membership_benefits(product_id, type, value, label) VALUES ($1,$2,$3,$4)', [id, type, value, label]);
    return id;
  };
  await mprod('STANDARD_1Y', 'STANDARD', tStd, 299, 0, [['TICKET_DISCOUNT', 5, 'Ticket -5%'], ['BIRTHDAY_REWARD', 0, 'Birthday gift']], 1);
  const goldProd = await mprod('GOLD_1Y', 'GOLD', tGold, 599, 0, [['TICKET_DISCOUNT', 10, 'Ticket -10%'], ['FOOD_DISCOUNT', 5, 'Food -5%'], ['RETAIL_DISCOUNT', 5, 'Retail -5%'], ['BIRTHDAY_REWARD', 1, 'Birthday free ticket'], ['POINT_MULTIPLIER', 1.5, 'Points x1.5']], 2);
  await mprod('PLATINUM_1Y', 'PLATINUM', tPlat, 1299, 0, [['TICKET_DISCOUNT', 12, 'Ticket -12%'], ['FOOD_DISCOUNT', 10, 'Food -10%'], ['RETAIL_DISCOUNT', 8, 'Retail -8%'], ['PRIORITY_QUEUE', 1, 'Priority queue'], ['FREE_LOCKER', 1, 'Free locker'], ['POINT_MULTIPLIER', 1.75, 'Points x1.75']], 3);
  await mprod('VIP_1Y', 'VIP', tVip, 2999, 0, [['TICKET_DISCOUNT', 15, 'Ticket -15%'], ['FOOD_DISCOUNT', 15, 'Food -15%'], ['RETAIL_DISCOUNT', 10, 'Retail -10%'], ['FAST_PASS', 1, 'Fast Pass'], ['MEMBER_LOUNGE', 1, 'VIP Lounge'], ['POINT_MULTIPLIER', 2, 'Points x2']], 4);

  // ---------------- rides & scan points ----------------
  const ride = async (code: string, name: string, zoneId: string, o: Partial<Record<string, any>> = {}) =>
    (await one(tx, `INSERT INTO rides(branch_id, zone_id, code, name, name_en, description, min_height_cm, max_height_cm, min_age, capacity_per_cycle, cycle_minutes, addon_price, addon_member_price,
        addon_peak_price, addon_entitlement_type, addon_uses, queue_prefix, operator_staff_id, sort)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [branch, zoneId, code, name, o.nameEn ?? name, o.desc ?? null, o.minH ?? null, o.maxH ?? null, o.minAge ?? null, o.cap ?? 12, o.cycle ?? 5, THB(o.price ?? 60),
       o.memberPrice != null ? THB(o.memberPrice) : null, o.peak != null ? THB(o.peak) : null, o.ent ?? 'ONE_TIME', o.uses ?? 1, o.prefix ?? 'A', o.op ?? null, o.sort ?? 0]))!.id;
  const rCarousel = await ride('R01', 'ม้าหมุน Carousel', zKids, { nameEn: 'Carousel', cap: 24, cycle: 4, price: 50, prefix: 'C', sort: 1 });
  const rBumper = await ride('R02', 'รถบั๊มพ์ Bumper Car', zAdventure, { nameEn: 'Bumper Car', minH: 110, cap: 16, cycle: 5, price: 80, prefix: 'B', op: rideOp, sort: 2 });
  const rPlay = await ride('R03', 'สนามเด็กเล่น Playground', zKids, { nameEn: 'Playground', maxH: 140, cap: 40, cycle: 30, price: 100, prefix: 'P', ent: 'DATE_BASED', sort: 3 });
  const rVR = await ride('R04', 'VR Adventure', zThrill, { nameEn: 'VR Adventure', minAge: 8, cap: 6, cycle: 8, price: 120, memberPrice: 100, peak: 150, prefix: 'V', sort: 4 });
  const rKart = await ride('R05', 'โกคาร์ท Go Kart', zThrill, { nameEn: 'Go Kart', minH: 130, minAge: 10, cap: 8, cycle: 7, price: 180, memberPrice: 160, ent: 'MULTI_USE', uses: 3, prefix: 'K', sort: 5 });
  const rHaunted = await ride('R06', 'บ้านผีสิง Haunted House', zAdventure, { nameEn: 'Haunted House', minAge: 7, cap: 10, cycle: 6, price: 80, prefix: 'H', sort: 6 });
  const rCoaster = await ride('R07', 'รถไฟเหาะ Roller Coaster', zThrill, { nameEn: 'Roller Coaster', minH: 120, maxH: 195, cap: 20, cycle: 3, price: 150, prefix: 'R', sort: 7 });
  const rTramp = await ride('R08', 'แทรมโพลีน Trampoline', zAdventure, { nameEn: 'Trampoline Park', cap: 30, cycle: 20, price: 120, prefix: 'T', sort: 8 });
  const rFerris = await ride('R09', 'ชิงช้าสวรรค์ Ferris Wheel', zAdventure, { nameEn: 'Ferris Wheel', cap: 32, cycle: 10, price: 60, prefix: 'F', sort: 9 });
  const rSplash = await ride('R10', 'Water Splash', zKids, { nameEn: 'Water Splash', minH: 100, cap: 18, cycle: 4, price: 70, prefix: 'W', sort: 10 });
  const allRides = [rCarousel, rBumper, rPlay, rVR, rKart, rHaunted, rCoaster, rTramp, rFerris, rSplash];
  for (const [i, r] of allRides.entries()) {
    await tx.query(`INSERT INTO ride_scan_points(code, ride_id, name, location) VALUES ($1,$2,$3,$4)`, [`SCAN-RIDE-${String(i + 1).padStart(3, '0')}`, r, `Entrance R${String(i + 1).padStart(2, '0')}`, 'Ride entrance']);
  }
  await tx.query('INSERT INTO ride_tier_prices(ride_id, tier_id, price) VALUES ($1,$2,$3),($1,$4,$5)', [rVR, tVip, THB(60), tPlat, THB(80)]);

  // ---------------- ticket types & packages ----------------
  const tt = async (code: string, name: string, en: string, minAge: number | null, maxAge: number | null, sort: number) =>
    (await one(tx, 'INSERT INTO ticket_types(code, name, name_en, min_age, max_age, sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [code, name, en, minAge, maxAge, sort]))!.id;
  const ttAdult = await tt('ADULT', 'ผู้ใหญ่', 'Adult', 13, 59, 1);
  const ttChild = await tt('CHILD', 'เด็ก', 'Child', 3, 12, 2);
  const ttSenior = await tt('SENIOR', 'ผู้สูงอายุ', 'Senior', 60, null, 3);
  const ttStudent = await tt('STUDENT', 'นักเรียน/นักศึกษา', 'Student', 13, 25, 4);
  const pkg = async (code: string, name: string, o: Record<string, any>, prices: Array<[string, number, number?]>, rides: Array<[string, string, number?]> = []) => {
    const id = (await one(tx, `INSERT INTO packages(code, name, name_en, description, category, pricing_mode, bundle_price, bundle_member_price, bundle_guests, days, multi_day_mode, any_within_days,
        valid_time_start, valid_time_end, reentry_allowed, ride_access, ride_access_type, refund_policy, wallet_credit, sort, entries_per_day)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [code, name, o.en ?? name, o.desc ?? null, o.category ?? 'DAY_PASS', o.bundle ? 'BUNDLE' : 'PER_GUEST', o.bundle ? THB(o.bundle) : null, o.bundleMember ? THB(o.bundleMember) : null,
       JSON.stringify(o.bundleGuests ?? []), o.days ?? 1, o.multi ?? 'CONSECUTIVE', o.within ?? null, o.from ?? null, o.to ?? null, o.reentry ?? true, o.rideAccess ?? 'SELECT',
       o.rideType ?? 'UNLIMITED', o.refund ?? 'FULL_BEFORE_VISIT', THB(o.credit ?? 0), o.sort ?? 0, o.entries ?? null]))!.id;
    const ids: Record<string, string> = { ADULT: ttAdult, CHILD: ttChild, SENIOR: ttSenior, STUDENT: ttStudent };
    for (const [code2, price, member] of prices) await tx.query('INSERT INTO package_prices(package_id, ticket_type_id, price, member_price) VALUES ($1,$2,$3,$4)', [id, ids[code2], THB(price), member != null ? THB(member) : null]);
    for (const [rideId, type, uses] of rides) await tx.query('INSERT INTO package_rides(package_id, ride_id, entitlement_type, uses) VALUES ($1,$2,$3,$4)', [id, rideId, type, uses ?? null]);
    return id;
  };
  await pkg('DAY_PASS', '1 DAY PASS', { en: '1 Day Pass — unlimited rides', desc: 'เล่นเครื่องเล่นได้ไม่จำกัดทั้งวัน (ยกเว้น VR / Go Kart)', sort: 1 },
    [['ADULT', 590, 550], ['CHILD', 390, 360], ['SENIOR', 290, 270], ['STUDENT', 450, 420]],
    [rCarousel, rBumper, rPlay, rHaunted, rCoaster, rTramp, rFerris, rSplash].map((r) => [r, 'UNLIMITED'] as [string, string]));
  await pkg('BASIC', 'BASIC PASS', { en: 'Basic Pass', desc: 'Carousel, Bumper Car, Playground', category: 'ADMISSION', sort: 2 },
    [['ADULT', 350, 320], ['CHILD', 250, 230]], [[rCarousel, 'UNLIMITED'], [rBumper, 'UNLIMITED'], [rPlay, 'DATE_BASED']]);
  await pkg('PREMIUM', 'PREMIUM PASS', { en: 'Premium Pass — ALL rides', desc: 'ทุกเครื่องเล่นไม่จำกัด รวม VR และ Go Kart', category: 'VIP', rideAccess: 'ALL', sort: 3, credit: 100 },
    [['ADULT', 990, 920], ['CHILD', 790, 740]]);
  await pkg('AFTER4', 'AFTER 4 PM', { en: 'Evening Pass (after 4 PM)', category: 'EVENING', from: '16:00', to: '21:00', sort: 4 },
    [['ADULT', 390], ['CHILD', 290]], [rCarousel, rBumper, rHaunted, rCoaster, rFerris].map((r) => [r, 'UNLIMITED'] as [string, string]));
  await pkg('ADMISSION', 'ADMISSION ONLY', { en: 'Admission Only', category: 'ADMISSION', rideAccess: 'NONE', sort: 5 }, [['ADULT', 150], ['CHILD', 100], ['SENIOR', 50]]);
  await pkg('FAMILY', 'FAMILY PACKAGE', { en: 'Family 2 Adults + 2 Kids', category: 'FAMILY', bundle: 1690, bundleMember: 1590, bundleGuests: [{ ticket_type_code: 'ADULT', qty: 2 }, { ticket_type_code: 'CHILD', qty: 2 }], sort: 6 },
    [], [rCarousel, rBumper, rPlay, rHaunted, rFerris, rSplash].map((r) => [r, 'UNLIMITED'] as [string, string]));
  await pkg('2DAY', '2 DAY PASS', { en: '2 Day Pass (consecutive)', category: 'MULTI_DAY', days: 2, sort: 7 }, [['ADULT', 990], ['CHILD', 690]],
    [rCarousel, rBumper, rPlay, rHaunted, rCoaster, rTramp, rFerris, rSplash].map((r) => [r, 'UNLIMITED'] as [string, string]));
  await pkg('ANY2IN7', 'ANY 2 DAYS IN 7', { en: 'Any 2 days within 7 days', category: 'MULTI_DAY', days: 2, multi: 'ANY_WITHIN', within: 7, sort: 8 }, [['ADULT', 1090], ['CHILD', 790]],
    [rCarousel, rBumper, rPlay, rHaunted, rCoaster, rFerris].map((r) => [r, 'UNLIMITED'] as [string, string]));
  await pkg('KART3', 'GO KART 3 ROUNDS + ADMISSION', { en: 'Go Kart x3 + Admission', category: 'RIDE_PASS', sort: 9, reentry: false }, [['ADULT', 450]], [[rKart, 'MULTI_USE', 3]]);

  // ---------------- gates (10 entrance + 2 exit) & devices ----------------
  const deviceKeys: Record<string, string> = {};
  const device = async (code: string, name: string, type: string, location: string, zoneId: string | null = null) => {
    const k = newDeviceApiKey();
    deviceKeys[code] = k.key;
    return (await one(tx, `INSERT INTO devices(branch_id, code, name, type, location, zone_id, api_key_hash, api_key_prefix, status, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OFFLINE',$9) RETURNING id`,
      [branch, code, name, type, location, zoneId, k.hash, k.prefix, null]))!.id;
  };
  for (let n = 1; n <= 12; n++) {
    const exit = n > 10;
    const code = exit ? `X0${n - 10}` : `G${String(n).padStart(2, '0')}`;
    const name = exit ? `Exit ${String(n - 10).padStart(2, '0')}` : `Gate ${String(n).padStart(2, '0')}`;
    const gate = (await one(tx, `INSERT INTO gates(branch_id, zone_id, code, name, number, direction, mode, controller_type, controller_config) VALUES ($1,$2,$3,$4,$5,$6,$7,'SIMULATOR',$8) RETURNING id`,
      [branch, zEntrance, code, name, n, exit ? 'EXIT' : 'ENTRY', exit || n >= 9 ? 'AUTO' : 'MANUAL', JSON.stringify({ simulatePassageMs: 1200 })]))!.id;
    const scanner = await device(`${code}-SCN`, `${name} Scanner`, 'GATE_SCANNER', name, zEntrance);
    const ctrl = await device(`${code}-CTL`, `${name} Controller`, 'GATE_CONTROLLER', name, zEntrance);
    const disp = await device(`${code}-DSP`, `${name} Customer Display`, 'GATE_DISPLAY', name, zEntrance);
    await tx.query(`INSERT INTO gate_devices(gate_id, device_id, role) VALUES ($1,$2,'SCANNER'),($1,$3,'CONTROLLER'),($1,$4,'DISPLAY')`, [gate, scanner, ctrl, disp]);
  }
  for (const [i, r] of allRides.entries()) {
    const d = await device(`RIDE-SCN-${String(i + 1).padStart(2, '0')}`, `Ride Scanner R${String(i + 1).padStart(2, '0')}`, 'RIDE_SCANNER', `Ride R${String(i + 1).padStart(2, '0')}`);
    await tx.query('UPDATE ride_scan_points SET device_id = $2 WHERE ride_id = $1', [r, d]);
  }
  await device('POS-01', 'Ticket Counter 1', 'POS', 'Box Office', zEntrance);
  await device('POS-02', 'Food Court POS', 'POS', 'Food Court', zFood);
  await device('POS-03', 'Souvenir Shop POS', 'POS', 'Souvenir Shop', zEntrance);
  await device('KIOSK-01', 'Entrance Kiosk 1', 'KIOSK', 'Entrance Plaza', zEntrance);
  await device('KIOSK-02', 'Food Court Kiosk', 'KIOSK', 'Food Court', zFood);
  await device('KDS-01', 'Kitchen Display', 'KITCHEN_DISPLAY', 'Food Court Kitchen', zFood);
  await device('QDS-01', 'Order Ready Display', 'QUEUE_DISPLAY', 'Food Court', zFood);
  await device('LCK-01', 'Locker Bank A Controller', 'LOCKER_CONTROLLER', 'Entrance Plaza', zEntrance);
  await device('PRN-01', 'Wristband Printer', 'WRISTBAND_PRINTER', 'Box Office', zEntrance);

  // ---------------- stores, catalog, inventory ----------------
  const store = async (code: string, name: string, type: string, zoneId: string) =>
    (await one(tx, 'INSERT INTO stores(branch_id, zone_id, code, name, type) VALUES ($1,$2,$3,$4,$5) RETURNING id', [branch, zoneId, code, name, type]))!.id;
  const sTicket = await store('BOX', 'Box Office', 'TICKET', zEntrance);
  const sFood = await store('FC', 'Food Court', 'RESTAURANT', zFood);
  const sCafe = await store('CAFE', 'Kids Café', 'RESTAURANT', zKids);
  const sShop = await store('SHOP', 'Souvenir Shop', 'RETAIL', zEntrance);
  const sWh = await store('WH', 'Central Warehouse', 'WAREHOUSE', zEntrance);
  const cat = async (code: string, name: string, type: string, pc: string, sort: number) =>
    (await one(tx, 'INSERT INTO categories(code, name, type, points_category, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id', [code, name, type, pc, sort]))!.id;
  const cMain = await cat('FOOD', 'อาหาร Food', 'FOOD', 'FOOD', 1);
  const cSnack = await cat('SNACK', 'ของว่าง Snacks', 'FOOD', 'FOOD', 2);
  const cDrink = await cat('DRINK', 'เครื่องดื่ม Drinks', 'DRINK', 'FOOD', 3);
  const cMerch = await cat('MERCH', 'ของที่ระลึก Souvenir', 'SOUVENIR', 'RETAIL', 4);
  const cPhoto = await cat('PHOTO', 'ภาพถ่าย Photo', 'PHOTO', 'RETAIL', 5);
  const cAddon = await cat('ADDON', 'Add-on', 'ADDON', 'RETAIL', 6);
  const product = async (sku: string, name: string, catId: string, price: number, stores: string[], o: Record<string, any> = {}) => {
    const id = (await one(tx, `INSERT INTO products(sku, barcode, name, name_en, category_id, price, member_price, cost, track_stock, low_stock_threshold, modifiers, send_to_kitchen, sellable_online, sort)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [sku, o.barcode ?? null, name, o.en ?? name, catId, THB(price), o.member != null ? THB(o.member) : null, THB(o.cost ?? price * 0.4), !!o.stock, o.low ?? 10,
       JSON.stringify(o.modifiers ?? []), !!o.kitchen, !!o.online, o.sort ?? 0]))!.id;
    for (const s of stores) await tx.query('INSERT INTO product_stores(product_id, store_id) VALUES ($1,$2)', [id, s]);
    if (o.stock) for (const [s, q] of Object.entries(o.stock as Record<string, number>)) {
      await tx.query('INSERT INTO inventory(product_id, store_id, qty) VALUES ($1,$2,$3)', [id, s, q]);
      await tx.query(`INSERT INTO stock_movements(product_id, store_id, type, qty, qty_before, qty_after, reason) VALUES ($1,$2,'IN',$3,0,$3,'Opening stock')`, [id, s, q]);
    }
    return id;
  };
  const spicy = [{ group: 'ความเผ็ด Spicy', required: true, max: 1, options: [{ name: 'ไม่เผ็ด Mild', price: 0 }, { name: 'เผ็ดน้อย Medium', price: 0 }, { name: 'เผ็ดมาก Hot', price: 0 }] }];
  const burgerMods = [{ group: 'Size', required: true, max: 1, options: [{ name: 'Regular', price: 0 }, { name: 'Large', price: THB(30) }] },
    { group: 'Extra', required: false, max: 3, options: [{ name: 'Cheese', price: THB(15) }, { name: 'Bacon', price: THB(25) }, { name: 'Egg', price: THB(10) }] }];
  await product('F001', 'ผัดไทยกุ้ง Pad Thai', cMain, 120, [sFood], { en: 'Pad Thai with Shrimp', kitchen: true, modifiers: spicy, member: 110, sort: 1 });
  await product('F002', 'ข้าวกะเพราไก่ Basil Chicken Rice', cMain, 89, [sFood], { en: 'Basil Chicken Rice', kitchen: true, modifiers: spicy, sort: 2 });
  await product('F003', 'เบอร์เกอร์ Burger', cMain, 149, [sFood, sCafe], { en: 'Classic Burger', kitchen: true, modifiers: burgerMods, sort: 3 });
  await product('F004', 'ไก่ทอด Fried Chicken', cSnack, 99, [sFood], { en: 'Fried Chicken (4 pcs)', kitchen: true, sort: 4 });
  await product('F005', 'เฟรนช์ฟรายส์ French Fries', cSnack, 59, [sFood, sCafe], { en: 'French Fries', kitchen: true, sort: 5 });
  await product('F006', 'ไอศกรีม Ice Cream', cSnack, 45, [sFood, sCafe], { en: 'Ice Cream Cone', sort: 6 });
  await product('F007', 'ป๊อปคอร์น Popcorn', cSnack, 69, [sFood, sCafe, sShop], { en: 'Popcorn', sort: 7 });
  await product('D001', 'น้ำดื่ม Water', cDrink, 20, [sFood, sCafe, sShop], { en: 'Drinking Water', barcode: '8850999220017', stock: { [sFood]: 200, [sCafe]: 100, [sShop]: 100, [sWh]: 1000 }, sort: 10 });
  await product('D002', 'โค้ก Coke', cDrink, 35, [sFood, sCafe], { en: 'Coca-Cola', barcode: '8851959132012', stock: { [sFood]: 150, [sCafe]: 80, [sWh]: 600 }, sort: 11 });
  await product('D003', 'ชาไทยเย็น Thai Iced Tea', cDrink, 55, [sFood, sCafe], { en: 'Thai Iced Tea', kitchen: true, sort: 12 });
  await product('M001', 'เสื้อยืด T-Shirt', cMerch, 390, [sShop], { en: 'Park T-Shirt', barcode: '2000000000011', stock: { [sShop]: 60, [sWh]: 300 }, member: 350, sort: 20 });
  await product('M002', 'ตุ๊กตามาสคอต Mascot Plush', cMerch, 290, [sShop], { en: 'Mascot Plush', barcode: '2000000000028', stock: { [sShop]: 40, [sWh]: 200 }, sort: 21 });
  await product('M003', 'พวงกุญแจ Keychain', cMerch, 99, [sShop], { en: 'Keychain', barcode: '2000000000035', stock: { [sShop]: 120, [sWh]: 500 }, sort: 22 });
  await product('M004', 'หมวก Cap', cMerch, 250, [sShop], { en: 'Cap', barcode: '2000000000042', stock: { [sShop]: 8, [sWh]: 100 }, low: 10, sort: 23 });
  await product('P001', 'Photo Package', cPhoto, 199, [sShop], { en: 'Photo Package (digital)', sort: 30 });
  await product('A001', 'ถุงเท้ากันลื่น Grip Socks', cAddon, 49, [sTicket, sShop], { en: 'Grip Socks', online: true, stock: { [sTicket]: 300, [sShop]: 100 }, sort: 40 });
  await product('A002', 'Meal Voucher', cAddon, 150, [sTicket], { en: 'Meal Voucher ฿150', online: true, sort: 41 });

  // ---------------- promotions / coupons / rewards ----------------
  const promo = async (name: string, type: string, value: number, appliesTo: string, conditions: Record<string, unknown>, o: Record<string, any> = {}) =>
    (await one(tx, `INSERT INTO promotions(name, description, type, value, buy_qty, pay_qty, max_discount, applies_to, conditions, stackable, priority, requires_coupon, usage_per_member)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [name, o.desc ?? null, type, value, o.buy ?? null, o.pay ?? null, o.max != null ? THB(o.max) : null, appliesTo, JSON.stringify(conditions), o.stackable ?? false, o.priority ?? 100, !!o.coupon, o.perMember ?? null]))!.id;
  await promo('มา 4 จ่าย 3 (Come 4 Pay 3)', 'BUY_X_PAY_Y', 0, 'TICKET', {}, { buy: 4, pay: 3, priority: 10 });
  await promo('ซื้อ 3 ใบลด 10% (Buy 3 save 10%)', 'PERCENT', 10, 'TICKET', { min_qty: 3 }, { priority: 20 });
  await promo('เด็กวันเกิดเข้าฟรี (Birthday free)', 'PERCENT', 100, 'TICKET', { birthday: 'DAY', member_only: true, max_items: 1 }, { priority: 5, perMember: 1 });
  await promo('ซื้อออนไลน์ลด 100 บาท (Online -฿100)', 'AMOUNT', 100, 'ORDER', { channels: ['ONLINE'], min_spend: THB(1000) }, { stackable: true, priority: 60 });
  await promo('Early Bird จองก่อน 7 วันลด 10%', 'PERCENT', 10, 'TICKET', { min_days_before_visit: 7, channels: ['ONLINE'] }, { stackable: true, priority: 40 });
  await promo('Happy Hour อาหารลด 15% (14:00–16:00)', 'PERCENT', 15, 'FOOD', { time_start: '14:00', time_end: '16:00' }, { stackable: true, priority: 30 });
  const studentPromo = await promo('Student Discount 20%', 'PERCENT', 20, 'TICKET', { ticket_type_codes: ['STUDENT'] }, { coupon: true, priority: 15 });
  const welcomePromo = await promo('WELCOME ฿100 off', 'AMOUNT', 100, 'ORDER', { min_spend: THB(500) }, { coupon: true, stackable: true, priority: 70 });
  const coupon10 = await promo('Member coupon 10% (reward)', 'PERCENT', 10, 'ORDER', {}, { coupon: true, stackable: true, priority: 80, max: 300 });
  await tx.query(`INSERT INTO coupons(promotion_id, code, usage_limit) VALUES ($1,'STUDENT20',100000),($2,'WELCOME100',1000)`, [studentPromo, welcomePromo]);
  const reward = async (name: string, type: string, points: number, config: Record<string, unknown>, stock: number | null = null, minRank = 0) =>
    tx.query('INSERT INTO rewards(name, type, points_required, config, stock, min_tier_rank, description) VALUES ($1,$2,$3,$4,$5,$6,$7)', [name, type, points, JSON.stringify(config), stock, minRank, name]);
  await reward('ไอศกรีมฟรี Free Ice Cream', 'FOOD', 50, {});
  await reward('Locker ฟรี 1 วัน', 'LOCKER', 80, {});
  await reward('VR Adventure 1 รอบ', 'RIDE_PASS', 150, { ride_id: rVR, uses: 1 });
  await reward('เครดิต Wallet ฿100', 'WALLET_CREDIT', 250, { amount: THB(100) }, 500);
  await reward('คูปองลด 10%', 'COUPON', 120, { promotion_id: coupon10 });
  await reward('Free Day Pass (Gold+)', 'FREE_TICKET', 600, {}, 100, 20);

  // ---------------- lockers ----------------
  for (let i = 1; i <= 30; i++) {
    const size = i <= 12 ? 'S' : i <= 24 ? 'M' : 'L';
    await tx.query(`INSERT INTO lockers(branch_id, zone_id, code, bank, size) VALUES ($1,$2,$3,$4,$5)`, [branch, zEntrance, `L-${100 + i}`, i <= 15 ? 'A' : 'B', size]);
  }
  const rate = (size: string, name: string, mins: number | null, price: number, sort: number) =>
    tx.query('INSERT INTO locker_rates(branch_id, size, name, duration_minutes, price, sort) VALUES ($1,$2,$3,$4,$5,$6)', [branch, size, name, mins, THB(price), sort]);
  for (const [size, base] of [['S', 30], ['M', 50], ['L', 80]] as const) {
    await rate(size, '1 Hour', 60, base, 1);
    await rate(size, '3 Hours', 180, base * 2, 2);
    await rate(size, 'All Day', null, base * 3, 3);
  }

  // ---------------- print templates ----------------
  await tx.query(`INSERT INTO print_templates(type, paper, name, is_default, layout) VALUES
    ('RECEIPT','80MM','Receipt 80mm',true,'{}'), ('RECEIPT','58MM','Receipt 58mm',false,'{}'), ('TICKET','A4','Ticket A4',true,'{}'),
    ('WRISTBAND','WRISTBAND','Wristband 25x254mm',true,'{"showLogo":true,"showQr":true,"showBarcode":true}'), ('MEMBER_CARD','CR80','Member card CR80',true,'{}')`);

  // ---------------- demo member (Gold) ----------------
  const memberCode = await codes.member(tx);
  const member = (await one(tx, `INSERT INTO members(member_code, first_name, last_name, phone, email, password_hash, birthday, gender, tier_id, home_branch_id, phone_verified_at)
      VALUES ($1,'Somchai','Jaidee','0812345678','somchai@example.com',$2,'1990-05-15','MALE',$3,$4,now()) RETURNING id`,
    [memberCode, await hashSecret('member1234'), tGold, branch]))!.id;
  const account = await ensureMemberAccount(tx, member);
  const today = businessDate();
  await tx.query(`INSERT INTO memberships(member_id, product_id, status, start_date, end_date, change_type) VALUES ($1,$2,'ACTIVE',$3,($3::date + interval '1 year' - interval '1 day')::date,'NEW')`, [member, goldProd, today]);
  await issueCredential(tx, { type: 'DIGITAL_CARD', memberId: member, accountId: account, branchId: branch });
  await issueCredential(tx, { type: 'MEMBER_CARD', memberId: member, accountId: account, branchId: branch, physicalSerial: 'CARD-SERIAL-0001' });
  const w = await walletForAccount(tx, account);
  await postLedger(tx, { walletId: w.id, type: 'BONUS', credit: THB(500), referenceType: 'SEED', referenceId: 'welcome', note: 'Welcome credit', branchId: branch, idempotencyKey: 'seed-welcome' });
  await tx.query(`INSERT INTO points_ledger(member_id, type, points, balance_before, balance_after, note) VALUES ($1,'ADJUST',320,0,320,'Opening points')`, [member]);
  await tx.query('UPDATE members SET points = 320 WHERE id = $1', [member]);

  return { branch, deviceKeys };
}

async function main() {
  await migrate();
  const existing = await one(pool, 'SELECT 1 FROM branches LIMIT 1');
  if (existing) { console.log('Database already seeded — skipping.'); await pool.end(); return; }
  const r = await withTx((tx) => seed(tx));
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.device-keys.local.json');
  console.log(`✓ Seed complete. Branch ${r.branch}`);
  try {
    fs.writeFileSync(out, JSON.stringify({ branchId: r.branch, keys: r.deviceKeys }, null, 2));
    console.log(`  Device API keys written to ${out} (keep secret; re-issue from Admin → Devices).`);
  } catch {
    console.log('  Could not write the device key file (read-only filesystem). Issue device keys from Admin → Devices.');
  }
  console.log('  Staff logins: OWNER/000000, EMP001/1111 (Admin), EMP002/2222 (Manager), EMP003/3333 (Supervisor), EMP010/1010 (Ticket), EMP020/2020 (Gate), EMP030/3030 (Ride), EMP040/4040 (Food), EMP041/4141 (Kitchen), EMP050/5050 (Retail), EMP070/7070 (CS), EMP080/8080 (Finance)');
  console.log('  Demo member: 0812345678 / member1234');
  await pool.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
