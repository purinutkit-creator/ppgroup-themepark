import { one, query, type Db } from '../db/pool.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes, businessDate } from '../lib/codes.js';
import { hashSecret } from '../lib/crypto.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { ensureMemberAccount } from './accounts.js';
import { issueCredential } from './credentials.js';
import { addDays } from './tickets.js';
import { getSetting } from './settings.js';

function addValidity(start: string, unit: string, value: number): string | null {
  if (unit === 'LIFETIME') return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (unit === 'DAY') d.setUTCDate(d.getUTCDate() + value);
  if (unit === 'MONTH') d.setUTCMonth(d.getUTCMonth() + value);
  if (unit === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + value);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Price for NEW / RENEWAL / UPGRADE according to the product's admin rules. */
export async function priceMembership(db: Db, productId: string, mode: 'NEW' | 'RENEWAL' | 'UPGRADE', memberId: string | null) {
  const p = await one(db, `SELECT mp.*, t.rank, t.name AS tier_name FROM membership_products mp JOIN member_tiers t ON t.id = mp.tier_id WHERE mp.id = $1`, [productId]);
  if (!p || !p.is_active) throw notFound('Membership product');
  const current = memberId ? await one(db, `SELECT ms.*, mp.annual_fee, mp.tier_id, t.rank FROM memberships ms JOIN membership_products mp ON mp.id = ms.product_id
      JOIN member_tiers t ON t.id = mp.tier_id WHERE ms.member_id = $1 AND ms.status = 'ACTIVE'`, [memberId]) : null;
  const today = businessDate();
  const breakdown: Record<string, number> = {};
  let price = 0;
  if (mode === 'NEW') {
    if (current) throw conflict('MEMBERSHIP_ACTIVE', 'Member already has an active membership — renew or upgrade');
    const lapsed = memberId ? await one(db, `SELECT 1 FROM memberships WHERE member_id = $1 LIMIT 1`, [memberId]) : null;
    breakdown.annualFee = Number(p.annual_fee);
    breakdown.registrationFee = lapsed ? 0 : Number(p.registration_fee);
    price = breakdown.annualFee + breakdown.registrationFee;
  } else if (mode === 'RENEWAL') {
    const last = current ?? (memberId ? await one(db, `SELECT * FROM memberships WHERE member_id = $1 AND product_id = $2 ORDER BY end_date DESC NULLS FIRST LIMIT 1`, [memberId, productId]) : null);
    if (!last) throw badRequest('NOTHING_TO_RENEW', 'No membership to renew');
    if (last.product_id !== productId) throw badRequest('RENEW_SAME_PRODUCT', 'Renewal must be for the same membership product (use upgrade)');
    if (!last.end_date) throw badRequest('LIFETIME', 'Lifetime membership does not need renewal');
    const graceEnd = addDays(last.end_date, p.grace_period_days);
    if (today > graceEnd) throw unprocessable('GRACE_PERIOD_PASSED', 'Grace period has passed — purchase as new membership');
    price = Number(p.renewal_price ?? p.annual_fee);
    breakdown.renewalPrice = price;
    const daysLeft = (Date.parse(last.end_date) - Date.parse(today)) / 86_400_000;
    if (daysLeft >= 0 && daysLeft <= p.early_renewal_days && Number(p.early_renewal_discount_pct) > 0) {
      breakdown.earlyRenewalDiscount = -Math.round((price * Number(p.early_renewal_discount_pct)) / 100);
      price += breakdown.earlyRenewalDiscount;
    }
  } else {
    if (!current) throw badRequest('NOTHING_TO_UPGRADE', 'No active membership to upgrade');
    if (p.rank <= current.rank) throw badRequest('NOT_AN_UPGRADE', 'Target tier must be higher than current tier');
    if (p.upgrade_price != null) price = Number(p.upgrade_price);
    else if (p.upgrade_mode === 'FULL') price = Number(p.annual_fee);
    else {
      const diff = Math.max(0, Number(p.annual_fee) - Number(current.annual_fee));
      if (p.upgrade_mode === 'PRORATED' && current.end_date) {
        const total = Math.max(1, (Date.parse(current.end_date) - Date.parse(current.start_date)) / 86_400_000 + 1);
        const left = Math.max(0, (Date.parse(current.end_date) - Date.parse(today)) / 86_400_000 + 1);
        price = Math.round((diff * left) / total);
      } else price = diff;
    }
    breakdown.upgradePrice = price;
  }
  return { name: `${p.name} (${mode === 'NEW' ? 'New' : mode === 'RENEWAL' ? 'Renewal' : 'Upgrade'})`, price: Math.max(0, price), breakdown, physicalCardFee: Number(p.physical_card_fee) };
}

/** Fulfillment: create / renew / upgrade membership, set tier, issue digital (and optional physical) card. */
export async function activateMembership(tx: Db, actor: Actor, order: any, item: any, physicalCard: boolean, after: (cb: () => void) => void) {
  if (!order.member_id) throw unprocessable('MEMBER_REQUIRED', 'Membership order requires a member');
  const p = await one(tx, 'SELECT * FROM membership_products WHERE id = $1', [item.membership_product_id]);
  const mode = item.metadata?.mode ?? 'NEW';
  const today = businessDate();
  const current = await one(tx, `SELECT * FROM memberships WHERE member_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [order.member_id]);
  let start = today;
  let previous: string | null = null;
  if (mode === 'RENEWAL') {
    const last = current ?? await one(tx, `SELECT * FROM memberships WHERE member_id = $1 AND product_id = $2 ORDER BY end_date DESC LIMIT 1`, [order.member_id, p.id]);
    if (last?.end_date) start = addDays(last.end_date, 1); // continuity (early renewal or within grace period)
    previous = last?.id ?? null;
  }
  let end = addValidity(start, p.validity_unit, p.validity_value);
  if (mode === 'UPGRADE' && current) { end = current.end_date ?? end; start = today; previous = current.id; }
  if (current) await tx.query(`UPDATE memberships SET status = 'SUPERSEDED' WHERE id = $1`, [current.id]);
  // renewal starting in the future keeps the current one active until then → we simply extend: new ACTIVE row covers start..end
  const ms = await one(tx, `INSERT INTO memberships(member_id, product_id, status, start_date, end_date, order_id, previous_id, change_type)
      VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7) RETURNING *`,
    [order.member_id, p.id, mode === 'RENEWAL' && current ? current.start_date : start, end, order.id, previous, mode]);
  await tx.query('UPDATE members SET tier_id = $2 WHERE id = $1', [order.member_id, p.tier_id]);
  const accountId = await ensureMemberAccount(tx, order.member_id);
  const digital = await one(tx, `SELECT id FROM credentials WHERE member_id = $1 AND type = 'DIGITAL_CARD' AND status = 'ACTIVE'`, [order.member_id]);
  if (!digital) await issueCredential(tx, { type: 'DIGITAL_CARD', memberId: order.member_id, accountId, branchId: order.branch_id, issuedBy: actor.staffId });
  else await tx.query('UPDATE membership_cards SET membership_id = $2 WHERE credential_id = $1', [digital.id, ms!.id]);
  await tx.query(`UPDATE membership_cards SET membership_id = $2 WHERE credential_id IN (SELECT id FROM credentials WHERE member_id = $1 AND type = 'MEMBER_CARD' AND status = 'ACTIVE')`, [order.member_id, ms!.id]);
  if (physicalCard) {
    await issueCredential(tx, { type: 'MEMBER_CARD', memberId: order.member_id, accountId, branchId: order.branch_id, status: actor.type === 'STAFF' ? 'ACTIVE' : 'NEW', issuedBy: actor.staffId });
  }
  await audit(tx, actor, { action: `MEMBERSHIP_${mode}`, entityType: 'member', entityId: order.member_id, after: { product: p.code, start, end } });
  after(() => publish([rooms.member(order.member_id)], 'membership.updated', { memberId: order.member_id, product: p.name, end }));
  return ms;
}

export interface RegisterInput {
  phone: string; firstName: string; lastName: string; birthday?: string | null; email?: string | null; password?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED' | null; address?: string | null; emergencyContact?: string | null;
  branchId?: string | null; via: 'ONLINE' | 'COUNTER' | 'KIOSK';
}

export async function registerMember(tx: Db, actor: Actor, input: RegisterInput) {
  const sec = await getSetting('security', input.branchId);
  if (input.password && input.password.length < sec.passwordMinLength) throw badRequest('WEAK_PASSWORD', `Password must be at least ${sec.passwordMinLength} characters`);
  if (input.via === 'ONLINE' && !input.password) throw badRequest('PASSWORD_REQUIRED', 'Password is required');
  const dupPhone = await one(tx, 'SELECT 1 FROM members WHERE phone = $1', [input.phone]);
  if (dupPhone) throw conflict('PHONE_EXISTS', 'เบอร์โทรนี้ถูกใช้สมัครสมาชิกแล้ว / Phone already registered');
  if (input.email) {
    const dupEmail = await one(tx, 'SELECT 1 FROM members WHERE lower(email) = lower($1)', [input.email]);
    if (dupEmail) throw conflict('EMAIL_EXISTS', 'อีเมลนี้ถูกใช้แล้ว / Email already registered');
  }
  const code = await codes.member(tx);
  const m = await one(tx, `INSERT INTO members(member_code, first_name, last_name, phone, email, password_hash, birthday, gender, address, emergency_contact, home_branch_id, registered_via)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, member_code, first_name, last_name, phone, email`,
    [code, input.firstName.trim(), input.lastName.trim(), input.phone, input.email?.trim() || null, input.password ? await hashSecret(input.password) : null,
     input.birthday ?? null, input.gender ?? null, input.address ?? null, input.emergencyContact ?? null, input.branchId ?? null, input.via]);
  const accountId = await ensureMemberAccount(tx, m!.id);
  const mcfg = await getSetting('membership', input.branchId);
  const card = mcfg.digitalCardEnabled ? await issueCredential(tx, { type: 'DIGITAL_CARD', memberId: m!.id, accountId, branchId: input.branchId, issuedBy: actor.staffId }) : null;
  await audit(tx, actor, { action: 'MEMBER_REGISTER', entityType: 'member', entityId: m!.id, after: { memberCode: code, via: input.via } });
  return { member: m!, accountId, digitalCard: card ? { id: card.id, code: card.code } : null };
}

export async function memberSummary(db: Db, memberId: string) {
  const m = await one(db, `SELECT m.id, m.member_code, m.first_name, m.last_name, m.phone, m.email, m.birthday, m.gender, m.address, m.emergency_contact, m.points, m.total_spend,
        m.visit_count, m.join_date, m.status, m.registered_via, t.code AS tier_code, t.name AS tier_name, t.color AS tier_color, a.id AS account_id,
        w.balance AS wallet_balance
      FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id LEFT JOIN customer_accounts a ON a.member_id = m.id LEFT JOIN wallet_accounts w ON w.account_id = a.id
     WHERE m.id = $1`, [memberId]);
  if (!m) throw notFound('Member');
  const membership = await one(db, `SELECT ms.*, mp.name AS product_name, mp.code AS product_code, mp.card_design, mp.renewal_price, mp.annual_fee, mp.grace_period_days,
        mp.early_renewal_days, mp.early_renewal_discount_pct, mp.tier_id, t.name AS tier_name, t.color AS tier_color,
        CASE WHEN ms.end_date IS NULL THEN NULL ELSE (ms.end_date - CURRENT_DATE) END AS days_remaining
      FROM memberships ms JOIN membership_products mp ON mp.id = ms.product_id JOIN member_tiers t ON t.id = mp.tier_id
     WHERE ms.member_id = $1 ORDER BY (ms.status = 'ACTIVE') DESC, ms.created_at DESC LIMIT 1`, [memberId]);
  const benefits = membership?.status === 'ACTIVE' ? await query(db, 'SELECT type, value, label, config FROM membership_benefits WHERE product_id = $1', [membership.product_id]) : [];
  const credentials = await query(db, `SELECT id, code, type, status, physical_serial, issued_at, expires_at FROM credentials WHERE member_id = $1 ORDER BY issued_at DESC`, [memberId]);
  return { ...m, wallet_balance: Number(m.wallet_balance ?? 0), membership, benefits, credentials };
}

/** Job: expire memberships, drop tier, send renewal reminders. */
export async function membershipMaintenance(db: Db) {
  const expired = await query(db, `UPDATE memberships SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date IS NOT NULL AND end_date < CURRENT_DATE RETURNING member_id`);
  for (const e of expired) await db.query('UPDATE members SET tier_id = NULL WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE member_id = $1 AND status = $2)', [e.member_id, 'ACTIVE']);
  const cfg = await getSetting('membership');
  const { notify } = await import('./notify.js');
  for (const days of cfg.expiryReminderDays) {
    const due = await query(db, `SELECT ms.id, ms.member_id, ms.end_date, mp.name FROM memberships ms JOIN membership_products mp ON mp.id = ms.product_id
        WHERE ms.status = 'ACTIVE' AND ms.end_date = CURRENT_DATE + $1::int AND (ms.expiry_notified_at IS NULL OR ms.expiry_notified_at < now() - interval '20 hours')`, [days]);
    for (const d of due) {
      await notify({ audience: 'MEMBER', memberId: d.member_id, type: 'MEMBERSHIP_EXPIRING', title: 'RENEW MEMBERSHIP', message: `${d.name} หมดอายุในอีก ${days} วัน (${d.end_date})`, data: { membershipId: d.id } }, db);
      await db.query('UPDATE memberships SET expiry_notified_at = now() WHERE id = $1', [d.id]);
    }
  }
  return { expired: expired.length };
}
