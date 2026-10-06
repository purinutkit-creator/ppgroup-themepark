import { one, query, type Db } from '../db/pool.js';
import { businessDate } from '../lib/codes.js';

export interface TicketRow {
  id: string; ticket_code: string; branch_id: string; booking_id: string | null; package_id: string; ticket_type_id: string | null;
  account_id: string | null; member_id: string | null; guest_name: string | null; guest_birthday: string | null; guest_height_cm: number | null;
  visit_date: string; valid_from: string; valid_to: string; days_allowed: number; status: string; presence: string;
  entry_count: number; first_entry_at: string | null; last_entry_at: string | null; last_gate_id: string | null;
  package_name?: string; ticket_type_name?: string; valid_time_start: string | null; valid_time_end: string | null; [k: string]: any;
}

const TICKET_SELECT = `
  SELECT t.*, p.name AS package_name, p.code AS package_code, p.reentry_allowed, p.entries_per_day, p.valid_time_start, p.valid_time_end,
         p.zone_access, p.multi_day_mode, p.member_card_entry, p.days AS package_days, p.valid_days_of_week, p.min_age AS pkg_min_age,
         p.max_age AS pkg_max_age, p.min_height_cm AS pkg_min_height, p.max_height_cm AS pkg_max_height,
         tt.name AS ticket_type_name, tt.code AS ticket_type_code,
         (SELECT COUNT(*)::int FROM ticket_day_usage u WHERE u.ticket_id = t.id) AS days_used,
         (SELECT u.entries FROM ticket_day_usage u WHERE u.ticket_id = t.id AND u.usage_date = $2::date) AS entries_today
    FROM tickets t JOIN packages p ON p.id = t.package_id LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id`;

/**
 * All tickets a credential grants access to (server-side truth):
 *  - tickets directly linked to the credential (wristband ↔ ticket, QR ticket)
 *  - tickets of a linked booking (booking barcode)
 *  - tickets owned by the member, when the credential is a member card and the package allows member-card entry
 */
export async function ticketsForCredential(db: Db, cred: { id: string; type: string; member_id: string | null }, date = businessDate(), opts: { lock?: boolean; memberCardEntry?: boolean } = {}): Promise<TicketRow[]> {
  const memberCard = (cred.type === 'MEMBER_CARD' || cred.type === 'DIGITAL_CARD') && cred.member_id && opts.memberCardEntry !== false;
  const rows = await query<TicketRow>(db, `${TICKET_SELECT}
    WHERE t.id IN (
      SELECT cl.ticket_id FROM credential_links cl WHERE cl.credential_id = $1 AND cl.unlinked_at IS NULL AND cl.ticket_id IS NOT NULL
      UNION SELECT t2.id FROM credential_links cl JOIN tickets t2 ON t2.booking_id = cl.booking_id
             WHERE cl.credential_id = $1 AND cl.unlinked_at IS NULL AND cl.booking_id IS NOT NULL
      UNION SELECT t3.id FROM tickets t3 JOIN packages p3 ON p3.id = t3.package_id
             WHERE $3::boolean AND t3.member_id = $4 AND p3.member_card_entry
               AND NOT EXISTS (SELECT 1 FROM credential_links x JOIN credentials c ON c.id = x.credential_id
                                WHERE x.ticket_id = t3.id AND x.unlinked_at IS NULL AND c.type IN ('WRISTBAND','PRINTED_WRISTBAND','TEMP_CARD') AND c.status = 'ACTIVE')
    )
    ORDER BY (t.valid_from <= $2::date AND t.valid_to >= $2::date) DESC, t.visit_date, t.ticket_code
    ${opts.lock ? 'FOR UPDATE OF t' : ''}`,
    [cred.id, date, !!memberCard, cred.member_id]);
  return rows;
}

export async function ticketById(db: Db, id: string, date = businessDate(), lock = false) {
  return one<TicketRow>(db, `${TICKET_SELECT} WHERE t.id = $1 ${lock ? 'FOR UPDATE OF t' : ''}`, [id, date]);
}

/** Is the ticket valid on `date` (validity window + multi-day usage) */
export function dateCheck(t: TicketRow, date: string): { ok: boolean; code?: string; detail?: string } {
  if (date < t.valid_from) return { ok: false, code: 'WRONG_DATE', detail: `ใช้ได้ตั้งแต่ ${t.valid_from}` };
  if (date > t.valid_to) return { ok: false, code: 'EXPIRED', detail: `หมดอายุ ${t.valid_to}` };
  const usedToday = (t.entries_today ?? 0) > 0;
  if (!usedToday && (t.days_used ?? 0) >= t.days_allowed) return { ok: false, code: 'DAYS_EXHAUSTED', detail: `ใช้ครบ ${t.days_allowed} วันแล้ว` };
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (Array.isArray(t.valid_days_of_week) && !t.valid_days_of_week.includes(dow)) return { ok: false, code: 'WRONG_DAY', detail: 'ไม่สามารถใช้ในวันนี้' };
  return { ok: true };
}

export function timeCheck(t: { valid_time_start: string | null; valid_time_end: string | null }, nowTime: string): { ok: boolean; detail?: string } {
  if (t.valid_time_start && nowTime < t.valid_time_start) return { ok: false, detail: `ใช้ได้ตั้งแต่ ${t.valid_time_start.slice(0, 5)}` };
  if (t.valid_time_end && nowTime > t.valid_time_end) return { ok: false, detail: `ใช้ได้ถึง ${t.valid_time_end.slice(0, 5)}` };
  return { ok: true };
}

export function ageOn(birthday: string | null | undefined, date: string): number | null {
  if (!birthday) return null;
  const [by, bm, bd] = birthday.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** End of business day in branch timezone, as a JS Date (UTC) */
export function endOfDay(date: string, tzOffset = '+07:00'): Date {
  return new Date(`${date}T23:59:59${tzOffset}`);
}
export function startOfDay(date: string, tzOffset = '+07:00'): Date {
  return new Date(`${date}T00:00:00${tzOffset}`);
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Materialise ride entitlements from the package definition when a ticket becomes ACTIVE. */
export async function createPackageEntitlements(tx: Db, ticket: { id: string; account_id: string; branch_id: string; valid_from: string; valid_to: string; package_id: string }, orderId?: string | null) {
  const pkg = await one(tx, 'SELECT * FROM packages WHERE id = $1', [ticket.package_id]);
  const from = startOfDay(ticket.valid_from);
  const until = endOfDay(ticket.valid_to);
  const existing = await one(tx, `SELECT 1 FROM ride_entitlements WHERE ticket_id = $1 AND source = 'PACKAGE' LIMIT 1`, [ticket.id]);
  if (existing) return;
  if (pkg.ride_access === 'ALL') {
    const counted = pkg.ride_access_type === 'ONE_TIME' || pkg.ride_access_type === 'MULTI_USE';
    const uses = counted ? (pkg.ride_access_type === 'ONE_TIME' ? 1 : pkg.ride_access_uses ?? 1) : null;
    await tx.query(`INSERT INTO ride_entitlements(account_id, ticket_id, ride_id, branch_id, source, type, uses_total, uses_remaining, valid_from, valid_until, order_id, package_id)
      VALUES ($1,$2,NULL,$3,'PACKAGE',$4,$5,$5,$6,$7,$8,$9)`, [ticket.account_id, ticket.id, ticket.branch_id, pkg.ride_access_type, uses, from, until, orderId ?? null, pkg.id]);
    return;
  }
  if (pkg.ride_access === 'SELECT') {
    const rides = await query(tx, 'SELECT * FROM package_rides WHERE package_id = $1', [pkg.id]);
    for (const r of rides) {
      const counted = r.entitlement_type === 'ONE_TIME' || r.entitlement_type === 'MULTI_USE';
      const uses = counted ? (r.entitlement_type === 'ONE_TIME' ? 1 : r.uses ?? 1) : null;
      let validUntil = until;
      if (r.entitlement_type === 'TIME_BASED' && r.valid_until_time) validUntil = new Date(`${ticket.valid_to}T${r.valid_until_time}+07:00`);
      await tx.query(`INSERT INTO ride_entitlements(account_id, ticket_id, ride_id, branch_id, source, type, uses_total, uses_remaining, valid_from, valid_until, order_id, package_id)
        VALUES ($1,$2,$3,$4,'PACKAGE',$5,$6,$6,$7,$8,$9,$10)`, [ticket.account_id, ticket.id, r.ride_id, ticket.branch_id, r.entitlement_type, uses, from, validUntil, orderId ?? null, pkg.id]);
    }
  }
}
