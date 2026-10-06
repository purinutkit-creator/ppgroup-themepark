import type { Db } from '../db/pool.js';
import { randomDigits } from './crypto.js';

/** Atomically increment a counter (row-level lock via UPSERT). */
export async function nextCounter(db: Db, prefix: string, period = ''): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO code_counters(prefix, period, value) VALUES ($1, $2, 1)
     ON CONFLICT (prefix, period) DO UPDATE SET value = code_counters.value + 1
     RETURNING value`, [prefix, period]);
  return Number(rows[0].value);
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Business date in Asia/Bangkok (or provided tz) as YYYY-MM-DD */
export function businessDate(d = new Date(), tz = 'Asia/Bangkok'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function businessTime(d = new Date(), tz = 'Asia/Bangkok'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
const compact = (date: string) => date.replaceAll('-', '');

export const codes = {
  async ticket(db: Db, date = businessDate()) {           // TK-20261006-001928
    return `TK-${compact(date)}-${pad(await nextCounter(db, 'TK', date), 6)}`;
  },
  booking(date = businessDate()) {                          // BK-261006-82931 (random → not enumerable)
    return `BK-${compact(date).slice(2)}-${randomDigits(5)}`;
  },
  async order(db: Db, date = businessDate()) {
    return `ORD-${compact(date)}-${pad(await nextCounter(db, 'ORD', date), 6)}`;
  },
  async payment(db: Db, date = businessDate()) {
    return `PAY-${compact(date)}-${pad(await nextCounter(db, 'PAY', date), 6)}`;
  },
  async txn(db: Db, date = businessDate()) {
    return `TXN-${compact(date)}-${pad(await nextCounter(db, 'TXN', date), 7)}`;
  },
  async walletTxn(db: Db, date = businessDate()) {
    return `WL-${compact(date)}-${pad(await nextCounter(db, 'WL', date), 7)}`;
  },
  async refund(db: Db, date = businessDate()) {
    return `RF-${compact(date)}-${pad(await nextCounter(db, 'RF', date), 5)}`;
  },
  async shift(db: Db, date = businessDate()) {
    return `SH-${compact(date)}-${pad(await nextCounter(db, 'SH', date), 4)}`;
  },
  async member(db: Db) { return `MB${pad(await nextCounter(db, 'MB'), 6)}`; },
  async card(db: Db) { return `CARD-${pad(await nextCounter(db, 'CARD'), 8)}`; },
  async wristband(db: Db) { return `WB-${pad(await nextCounter(db, 'WB'), 8)}`; },
  async digitalCard(db: Db) { return `DMC-${pad(await nextCounter(db, 'DMC'), 8)}`; },
  async foodQueue(db: Db, storeCode: string, date = businessDate()) { // F102
    return `F${pad(await nextCounter(db, `FQ:${storeCode}`, date), 3)}`;
  },
  voucher() { return `RV-${randomDigits(10)}`; },
};
