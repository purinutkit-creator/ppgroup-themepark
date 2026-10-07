import { pool, query, type Db } from '../db/pool.js';

/**
 * Dynamic configuration. Values below are only fallbacks for a fresh install —
 * every key is editable from Admin → Settings (global or per-branch override).
 */
export const SETTING_DEFAULTS = {
  'park.info': {
    name: 'PP Group Theme Park', logoUrl: null as string | null, currency: 'THB', taxRate: 7, taxIncluded: true,
    defaultLanguage: 'th', languages: ['th', 'en', 'zh'], supportPhone: '02-000-0000', website: '',
  },
  // staff screens language + text size (%) per surface; each device can still nudge its own size (A− / A+)
  display: {
    staffLanguage: 'th',
    textSize: { customer: 100, admin: 100, pos: 100, kiosk: 100, gate: 100 },
  },
  capacity: { warnPercents: [80, 90, 100], stopOnlineSalesWhenFull: true, blockEntryWhenFull: true },
  gate: {
    approvalTimeoutSec: 60, displayResultMs: 2500, antiPassback: true, requireInsideForRides: true,
    memberCardEntry: true, bookingCredentialAtGate: true, notifyDuplicate: true,
  },
  wallet: {
    remainingBalancePolicy: 'REFUND_AT_COUNTER' as 'NON_REFUNDABLE' | 'REFUNDABLE' | 'PARTIAL_REFUND' | 'REFUND_AT_COUNTER' | 'TRANSFER_TO_MEMBER' | 'KEEP_FOR_NEXT_VISIT',
    refundFeePercent: 0, topupPresets: [10000, 30000, 50000, 100000], minTopup: 2000, maxTopup: 2000000, maxBalance: 5000000,
  },
  points: {
    enabled: true, earnAmount: 10000, earnPoints: 1, redeemValue: 100,
    categories: { TICKET: true, FOOD: true, RETAIL: true, TOPUP: false, PACKAGE: true, MEMBERSHIP: false, RIDE: true, LOCKER: false },
  },
  approvals: {
    required: ['REFUND', 'VOID', 'MANUAL_GATE_OPEN', 'GATE_OVERRIDE', 'TICKET_OVERRIDE', 'WALLET_ADJUST', 'DISCOUNT_OVER_LIMIT', 'POINTS_ADJUST', 'SHIFT_OVER_SHORT', 'CARD_REPLACE'],
    discountLimitPercent: 10, overShortTolerance: 10000, approvalValidMinutes: 5,
  },
  offline: {
    allowedActions: ['pos.cash_sale', 'kds.status', 'gate.exit'],
    blockedActions: ['gate.manual_open', 'refund', 'wallet.adjust', 'wallet.payment', 'void'],
  },
  payments: {
    methods: {
      PROMPTPAY: { enabled: true, online: true, counter: true },
      CARD: { enabled: true, online: true, counter: true },
      DEBIT: { enabled: true, online: true, counter: true },
      MOBILE_BANKING: { enabled: true, online: true, counter: false },
      BANK_TRANSFER: { enabled: true, online: true, counter: false },
      EWALLET: { enabled: true, online: false, counter: true },
      CASH: { enabled: true, online: false, counter: true },
      WALLET: { enabled: true, online: true, counter: true },
      POINTS: { enabled: true, online: false, counter: true },
    } as Record<string, { enabled: boolean; online: boolean; counter: boolean }>,
    slipVerification: true, onlinePaymentTimeoutMin: 30,
  },
  booking: { maxGuests: 30, advanceDays: 120, payAtParkEnabled: true, sharedWalletOnCheckin: false, guestCheckout: true },
  queue: { maxActivePerAccount: 3, longQueueAlertMin: 45 },
  ride: { peakDays: [0, 6], peakHours: { start: '12:00', end: '16:00' } },
  membership: { digitalCardEnabled: true, dynamicQr: true, digitalCardEntry: true, expiryReminderDays: [30, 7, 1] },
  wristband: { defaultExpiration: 'END_OF_DAY', template: { showLogo: true, showQr: true, showBarcode: true } },
  shift: { requireForCash: true },
  inventory: { allowNegative: false },
  receipt: { paper: '80MM', header: 'PP Group Theme Park', footer: 'ขอบคุณที่ใช้บริการ / Thank you!', showQr: true, taxId: '' },
  printer: { receiptConnection: 'BROWSER', ticketConnection: 'BROWSER', wristbandConnection: 'BROWSER', networkHost: '', networkPort: 9100 },
  fonts: {
    customer: 'Prompt', admin: 'IBM Plex Sans Thai', pos: 'Sarabun', kiosk: 'Prompt', gate: 'Kanit', receipt: 'Sarabun', ticket: 'Kanit',
  },
  security: { maxLoginAttempts: 5, lockMinutes: 15, otpEnabled: true, passwordMinLength: 8 },
  promotions: { tierDiscountStackable: true, tierDiscountPriority: 50 },
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

const cache = new Map<string, { at: number; value: any }>();
const TTL = 10_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base: any, over: any): any {
  if (!isObj(base) || !isObj(over)) return over ?? base;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export async function getSetting<K extends SettingKey>(key: K, branchId?: string | null, db: Db = pool): Promise<SettingValue<K>> {
  const ck = `${branchId ?? '*'}:${key}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const rows = await query(db, `SELECT branch_id, value FROM settings WHERE key = $1 AND (branch_id IS NULL OR branch_id = $2)
                                ORDER BY branch_id NULLS FIRST`, [key, branchId ?? null]);
  let value: any = SETTING_DEFAULTS[key];
  for (const r of rows) value = deepMerge(value, r.value);
  cache.set(ck, { at: Date.now(), value });
  return value;
}

export async function getAllSettings(branchId?: string | null) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(SETTING_DEFAULTS) as SettingKey[]) out[k] = await getSetting(k, branchId);
  return out;
}

export async function putSetting(db: Db, key: string, value: unknown, branchId: string | null, staffId?: string) {
  if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting ${key}`);
  const before = (await query(db, `SELECT value FROM settings WHERE key = $1 AND branch_id IS NOT DISTINCT FROM $2`, [key, branchId]))[0]?.value ?? null;
  await db.query(
    `INSERT INTO settings(branch_id, key, value, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
     DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [branchId, key, JSON.stringify(value), staffId ?? null]);
  cache.clear();
  return before;
}

export function clearSettingsCache() { cache.clear(); }
