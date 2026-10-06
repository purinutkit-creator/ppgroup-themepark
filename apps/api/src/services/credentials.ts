import { one, query, type Db } from '../db/pool.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { codes, businessDate } from '../lib/codes.js';
import { dynamicQrPayload, newCredentialToken, parseScanPayload, staticQrPayload } from '../lib/crypto.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { createGuestAccount, ensureMemberAccount } from './accounts.js';
import { transferAll, walletForAccount } from './wallet.js';
import { ticketsForCredential, endOfDay } from './tickets.js';

export type CredentialType = 'MEMBER_CARD' | 'DIGITAL_CARD' | 'TEMP_CARD' | 'WRISTBAND' | 'PRINTED_WRISTBAND' | 'QR_TICKET' | 'BOOKING';
export type CredentialStatus = 'NEW' | 'ACTIVE' | 'SUSPENDED' | 'LOST' | 'BLOCKED' | 'EXPIRED' | 'REPLACED' | 'CLOSED';

export const STATUS_MESSAGES: Record<string, string> = {
  NEW: 'บัตรยังไม่ได้เปิดใช้งาน (Card not activated)',
  SUSPENDED: 'บัตรถูกระงับการใช้งาน (Card suspended)',
  LOST: 'บัตรถูกแจ้งหาย (Card reported lost)',
  BLOCKED: 'บัตรถูกบล็อก (Card blocked)',
  EXPIRED: 'บัตรหมดอายุ (Card expired)',
  REPLACED: 'บัตรถูกแทนที่ด้วยบัตรใหม่ (Card replaced)',
  CLOSED: 'บัตรถูกปิดแล้ว (Card closed)',
};

async function generateCode(db: Db, type: CredentialType, hint?: string): Promise<string> {
  switch (type) {
    case 'MEMBER_CARD': case 'TEMP_CARD': return codes.card(db);
    case 'WRISTBAND': case 'PRINTED_WRISTBAND': return codes.wristband(db);
    case 'DIGITAL_CARD': return codes.digitalCard(db);
    case 'QR_TICKET': case 'BOOKING': if (!hint) throw new Error('code hint required'); return hint;
  }
}

export interface IssueInput {
  type: CredentialType;
  branchId?: string | null;
  accountId?: string | null;
  memberId?: string | null;
  status?: CredentialStatus;
  physicalSerial?: string | null;
  expirationPolicy?: 'NONE' | 'END_OF_DAY' | 'END_OF_VISIT' | 'PACKAGE' | 'FIXED';
  expiresAt?: Date | string | null;
  code?: string;            // for QR_TICKET / BOOKING (reuse ticket / booking number)
  issuedBy?: string | null;
}

export async function issueCredential(tx: Db, input: IssueInput) {
  if (input.physicalSerial) {
    const taken = await one(tx, 'SELECT id, code, status FROM credentials WHERE physical_serial = $1', [input.physicalSerial]);
    if (taken) throw conflict('SERIAL_IN_USE', `Physical card ${input.physicalSerial} is already registered as ${taken.code} (${taken.status})`);
  }
  const code = await generateCode(tx, input.type, input.code);
  const token = newCredentialToken();
  const status = input.status ?? 'ACTIVE';
  const row = await one(tx, `INSERT INTO credentials(code, type, token, status, account_id, member_id, branch_id, physical_serial, expiration_policy, expires_at, issued_by, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $4 = 'ACTIVE' THEN now() END) RETURNING *`,
    [code, input.type, token, status, input.accountId ?? null, input.memberId ?? null, input.branchId ?? null, input.physicalSerial ?? null,
     input.expirationPolicy ?? 'NONE', input.expiresAt ?? null, input.issuedBy ?? null]);
  if (input.type === 'WRISTBAND' || input.type === 'PRINTED_WRISTBAND' || input.type === 'TEMP_CARD') {
    await tx.query('INSERT INTO wristbands(credential_id) VALUES ($1)', [row!.id]);
  }
  if (input.type === 'MEMBER_CARD' || input.type === 'DIGITAL_CARD') {
    const ms = input.memberId ? await one(tx, `SELECT id FROM memberships WHERE member_id = $1 AND status = 'ACTIVE'`, [input.memberId]) : null;
    await tx.query('INSERT INTO membership_cards(credential_id, membership_id, is_physical) VALUES ($1,$2,$3)', [row!.id, ms?.id ?? null, input.type === 'MEMBER_CARD']);
  }
  return row!;
}

/** QR / barcode payloads for printing or display. */
export function credentialPayloads(cred: { token: string; type: string }, dynamic = false) {
  const staticQr = staticQrPayload(cred.token);
  if (dynamic) {
    const d = dynamicQrPayload(cred.token);
    return { qr: d.payload, barcode: cred.token, expiresInSec: d.expiresInSec, dynamic: true };
  }
  return { qr: staticQr, barcode: cred.token, dynamic: false };
}

export class ScanError extends AppError {
  constructor(public reasonCode: string, message: string, public credential?: any) {
    super(422, reasonCode, message);
  }
}

/**
 * Resolve a scanned payload → credential. ALWAYS server-side; the QR itself is never trusted.
 * Throws ScanError with a reason code (FORGED_QR, NOT_FOUND, EXPIRED_DYNAMIC, MALFORMED).
 */
export async function resolveScan(db: Db, raw: string, opts: { lock?: boolean; allowCode?: boolean } = {}) {
  const parsed = parseScanPayload(raw);
  let cred: any = null;
  if (parsed.ok) {
    cred = await one(db, `SELECT * FROM credentials WHERE token = $1 ${opts.lock ? 'FOR UPDATE' : ''}`, [parsed.token]);
  } else if (opts.allowCode) {
    // staff-only manual entry by printed code / physical serial
    const s = raw.trim().toUpperCase();
    cred = await one(db, `SELECT * FROM credentials WHERE code = $1 OR physical_serial = $1 ${opts.lock ? 'FOR UPDATE' : ''}`, [s]);
  } else if (parsed.reason === 'FORGED') {
    throw new ScanError('FORGED_QR', 'QR ไม่ถูกต้อง (ปลอมแปลง) / Invalid QR signature');
  } else if (parsed.reason === 'EXPIRED_DYNAMIC') {
    throw new ScanError('QR_EXPIRED', 'QR หมดอายุ กรุณาเปิด QR ใหม่ / Dynamic QR expired — refresh the card');
  }
  if (!cred) throw new ScanError('NOT_FOUND', 'ไม่พบตั๋วในระบบ / Ticket not found');
  return { credential: cred, kind: parsed.ok ? parsed.kind : 'CODE' };
}

/** Check status + expiry; auto-expires temporary credentials past their expiry. */
export async function assertUsable(db: Db, cred: any): Promise<void> {
  if (cred.status === 'ACTIVE' && cred.expires_at && new Date(cred.expires_at) < new Date()) {
    await db.query(`UPDATE credentials SET status = 'EXPIRED', status_reason = 'Auto-expired' WHERE id = $1 AND status = 'ACTIVE'`, [cred.id]);
    cred.status = 'EXPIRED';
  }
  if (cred.status !== 'ACTIVE') throw new ScanError(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status] ?? `Credential ${cred.status}`, cred);
}

/** Full card profile: the single view of a customer behind any credential. */
export async function credentialProfile(db: Db, credentialId: string) {
  const cred = await one(db, `SELECT c.*, b.name AS branch_name FROM credentials c LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = $1`, [credentialId]);
  if (!cred) throw notFound('Credential');
  const today = businessDate();
  const member = cred.member_id ? await one(db, `
      SELECT m.id, m.member_code, m.first_name, m.last_name, m.phone, m.email, m.birthday, m.points, m.total_spend, m.visit_count, m.status, m.join_date,
             t.code AS tier_code, t.name AS tier_name, t.color AS tier_color,
             ms.start_date AS membership_start, ms.end_date AS membership_end, ms.status AS membership_status, mp.name AS membership_name
        FROM members m LEFT JOIN member_tiers t ON t.id = m.tier_id
        LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.status = 'ACTIVE'
        LEFT JOIN membership_products mp ON mp.id = ms.product_id
       WHERE m.id = $1`, [cred.member_id]) : null;
  const account = cred.account_id ? await one(db, 'SELECT * FROM customer_accounts WHERE id = $1', [cred.account_id]) : null;
  const wallet = cred.account_id ? await walletForAccount(db, cred.account_id) : null;
  const tickets = await ticketsForCredential(db, cred, today);
  const ticketIds = tickets.map((t) => t.id);
  const entitlements = cred.account_id ? await query(db, `
      SELECT e.*, r.name AS ride_name, r.code AS ride_code FROM ride_entitlements e LEFT JOIN rides r ON r.id = e.ride_id
       WHERE (e.ticket_id = ANY($1::uuid[]) OR (e.ticket_id IS NULL AND e.account_id = $2))
         AND e.status = 'ACTIVE' AND e.valid_until > now()
       ORDER BY r.name NULLS FIRST`, [ticketIds, cred.account_id]) : [];
  const queues = cred.account_id ? await query(db, `
      SELECT q.*, r.name AS ride_name FROM ride_queues q JOIN rides r ON r.id = q.ride_id
       WHERE q.account_id = $1 AND q.status IN ('WAITING','CALLED') ORDER BY q.joined_at`, [cred.account_id]) : [];
  const lockers = cred.account_id ? await query(db, `
      SELECT s.*, l.code AS locker_code, l.size FROM locker_sessions s JOIN lockers l ON l.id = s.locker_id
       WHERE s.account_id = $1 AND s.status = 'ACTIVE'`, [cred.account_id]) : [];
  const otherCredentials = cred.account_id ? await query(db, `
      SELECT id, code, type, status FROM credentials WHERE account_id = $1 AND id <> $2 AND status NOT IN ('CLOSED') ORDER BY issued_at DESC LIMIT 10`, [cred.account_id, cred.id]) : [];
  return {
    credential: { id: cred.id, code: cred.code, type: cred.type, status: cred.status, statusReason: cred.status_reason, expiresAt: cred.expires_at,
      issuedAt: cred.issued_at, activatedAt: cred.activated_at, physicalSerial: cred.physical_serial, branchName: cred.branch_name,
      expirationPolicy: cred.expiration_policy, accountId: cred.account_id, memberId: cred.member_id },
    customerName: member ? `${member.first_name} ${member.last_name}`.trim() : account?.display_name ?? tickets[0]?.guest_name ?? null,
    member, account,
    wallet: wallet ? { id: wallet.id, balance: Number(wallet.balance), status: wallet.status, currency: wallet.currency } : null,
    tickets: tickets.map((t) => ({ id: t.id, code: t.ticket_code, package: t.package_name, ticketType: t.ticket_type_name, visitDate: t.visit_date,
      validFrom: t.valid_from, validTo: t.valid_to, status: t.status, presence: t.presence, entryCount: t.entry_count, daysUsed: t.days_used, daysAllowed: t.days_allowed,
      guestName: t.guest_name })),
    entitlements: entitlements.map((e: any) => ({ id: e.id, rideId: e.ride_id, ride: e.ride_name ?? 'ALL RIDES', type: e.type, usesRemaining: e.uses_remaining,
      usesTotal: e.uses_total, validUntil: e.valid_until, source: e.source })),
    queues, lockers, otherCredentials,
  };
}

/** Bind a credential to a member (guest wristband → member). Guest wallet balance and rights move to the member account. */
export async function bindMember(tx: Db, actor: Actor, credentialId: string, memberId: string, afterCommit: (cb: () => void) => void) {
  const cred = await one(tx, 'SELECT * FROM credentials WHERE id = $1 FOR UPDATE', [credentialId]);
  if (!cred) throw notFound('Credential');
  if (['LOST', 'BLOCKED', 'CLOSED', 'REPLACED'].includes(cred.status)) throw unprocessable('CREDENTIAL_NOT_USABLE', STATUS_MESSAGES[cred.status]);
  if (cred.member_id === memberId) return cred;
  if (cred.member_id) throw conflict('ALREADY_BOUND', 'Credential is bound to another member — unbind first');
  const member = await one(tx, `SELECT id, status FROM members WHERE id = $1`, [memberId]);
  if (!member || member.status !== 'ACTIVE') throw notFound('Active member');
  const memberAccount = await ensureMemberAccount(tx, memberId);
  const oldAccount = cred.account_id;
  if (oldAccount && oldAccount !== memberAccount) {
    const acc = await one(tx, 'SELECT kind FROM customer_accounts WHERE id = $1', [oldAccount]);
    if (acc?.kind === 'GUEST') {
      const moved = await transferAll(tx, oldAccount, memberAccount, { staffId: actor.staffId, branchId: cred.branch_id, reason: `Bind ${cred.code} to member` }, afterCommit);
      await tx.query('UPDATE tickets SET account_id = $2, member_id = $3 WHERE account_id = $1', [oldAccount, memberAccount, memberId]);
      await tx.query('UPDATE ride_entitlements SET account_id = $2 WHERE account_id = $1', [oldAccount, memberAccount]);
      await tx.query('UPDATE locker_sessions SET account_id = $2, member_id = $3 WHERE account_id = $1 AND status = $4', [oldAccount, memberAccount, memberId, 'ACTIVE']);
      await tx.query(`UPDATE ride_queues SET account_id = $2, member_id = $3 WHERE account_id = $1 AND status IN ('WAITING','CALLED')`, [oldAccount, memberAccount, memberId]);
      await tx.query('UPDATE credentials SET account_id = $2, member_id = $3 WHERE account_id = $1', [oldAccount, memberAccount, memberId]);
      await tx.query('UPDATE customer_accounts SET merged_into_id = $2 WHERE id = $1', [oldAccount, memberAccount]);
      await audit(tx, actor, { action: 'CREDENTIAL_BIND_MEMBER', entityType: 'credential', entityId: cred.id, before: { accountId: oldAccount }, after: { accountId: memberAccount, memberId, walletMoved: moved } });
    }
  }
  const updated = await one(tx, 'UPDATE credentials SET account_id = $2, member_id = $3 WHERE id = $1 RETURNING *', [cred.id, memberAccount, memberId]);
  if (!oldAccount || oldAccount === memberAccount) {
    await audit(tx, actor, { action: 'CREDENTIAL_BIND_MEMBER', entityType: 'credential', entityId: cred.id, after: { memberId } });
  }
  afterCommit(() => publish([rooms.account(memberAccount), rooms.account(oldAccount)], 'credential.updated', { credentialId: cred.id }));
  return updated;
}

/** Unbind: the credential gets a fresh guest account; wallet & points stay with the member. */
export async function unbindMember(tx: Db, actor: Actor, credentialId: string, reason: string) {
  const cred = await one(tx, 'SELECT * FROM credentials WHERE id = $1 FOR UPDATE', [credentialId]);
  if (!cred?.member_id) throw badRequest('NOT_BOUND', 'Credential is not bound to a member');
  if (cred.type === 'DIGITAL_CARD') throw badRequest('CANNOT_UNBIND_DIGITAL', 'Digital member cards cannot be unbound');
  const guest = await createGuestAccount(tx, { branchId: cred.branch_id });
  await tx.query(`UPDATE credential_links SET unlinked_at = now() WHERE credential_id = $1 AND unlinked_at IS NULL`, [cred.id]);
  const updated = await one(tx, 'UPDATE credentials SET account_id = $2, member_id = NULL WHERE id = $1 RETURNING *', [cred.id, guest]);
  await audit(tx, actor, { action: 'CREDENTIAL_UNBIND_MEMBER', entityType: 'credential', entityId: cred.id, before: { memberId: cred.member_id, accountId: cred.account_id }, after: { accountId: guest }, reason });
  return updated;
}

const ALLOWED_TRANSITIONS: Record<string, CredentialStatus[]> = {
  NEW: ['ACTIVE', 'BLOCKED', 'CLOSED'],
  ACTIVE: ['SUSPENDED', 'LOST', 'BLOCKED', 'EXPIRED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'LOST', 'BLOCKED', 'CLOSED'],
  EXPIRED: ['ACTIVE', 'CLOSED'],
  LOST: ['CLOSED', 'BLOCKED'],
  BLOCKED: ['ACTIVE', 'CLOSED'],
  REPLACED: ['CLOSED'],
  CLOSED: [],
};

export async function setCredentialStatus(tx: Db, actor: Actor, credentialId: string, status: CredentialStatus, reason: string, extra: { expiresAt?: string | null } = {}) {
  const cred = await one(tx, 'SELECT * FROM credentials WHERE id = $1 FOR UPDATE', [credentialId]);
  if (!cred) throw notFound('Credential');
  if (cred.status === status) return cred;
  if (!ALLOWED_TRANSITIONS[cred.status]?.includes(status)) throw unprocessable('INVALID_STATUS_TRANSITION', `Cannot change ${cred.status} → ${status}`);
  if (status === 'ACTIVE' && !cred.account_id) {
    const acc = await createGuestAccount(tx, { branchId: cred.branch_id });
    await tx.query('UPDATE credentials SET account_id = $2 WHERE id = $1', [cred.id, acc]);
  }
  const updated = await one(tx, `UPDATE credentials SET status = $2, status_reason = $3,
        activated_at = CASE WHEN $2 = 'ACTIVE' AND activated_at IS NULL THEN now() ELSE activated_at END,
        expires_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE expires_at END
      WHERE id = $1 RETURNING *`, [cred.id, status, reason, extra.expiresAt !== undefined, extra.expiresAt ?? null]);
  await audit(tx, actor, { action: `CREDENTIAL_${status}`, entityType: 'credential', entityId: cred.id, before: { status: cred.status }, after: { status }, reason });
  publish([rooms.account(cred.account_id)], 'credential.updated', { credentialId: cred.id, status });
  return updated;
}

/**
 * Lost / damaged card: disable old credential immediately and move every link
 * (member, wallet account, tickets, bookings, entitlements, lockers, queue) to a new credential.
 * History stays on the old credential id for audit.
 */
export async function replaceCredential(tx: Db, actor: Actor, input: {
  oldCredentialId: string; reason: 'LOST' | 'DAMAGED' | 'STOLEN' | 'UPGRADE' | 'OTHER'; newType?: CredentialType; physicalSerial?: string | null; approvalId?: string | null; note?: string;
}) {
  const old = await one(tx, 'SELECT * FROM credentials WHERE id = $1 FOR UPDATE', [input.oldCredentialId]);
  if (!old) throw notFound('Credential');
  if (['REPLACED', 'CLOSED'].includes(old.status)) throw unprocessable('ALREADY_REPLACED', 'Credential already replaced / closed');
  if (old.type === 'QR_TICKET' || old.type === 'BOOKING') throw badRequest('NOT_REPLACEABLE', 'Ticket / booking QR cannot be replaced; issue a wristband instead');
  const type = input.newType ?? (old.type === 'DIGITAL_CARD' ? 'DIGITAL_CARD' : old.type);
  const fresh = await issueCredential(tx, {
    type, branchId: actor.branchId ?? old.branch_id, accountId: old.account_id, memberId: old.member_id, status: 'ACTIVE',
    physicalSerial: input.physicalSerial ?? null, expirationPolicy: old.expiration_policy, expiresAt: old.expires_at, issuedBy: actor.staffId,
  });
  const newStatus = input.reason === 'LOST' || input.reason === 'STOLEN' ? 'LOST' : 'REPLACED';
  await tx.query(`UPDATE credentials SET status = $2, status_reason = $3, replaced_by_id = $4 WHERE id = $1`,
    [old.id, newStatus, `${input.reason}${input.note ? `: ${input.note}` : ''}`, fresh.id]);
  const links = await query(tx, `UPDATE credential_links SET unlinked_at = now() WHERE credential_id = $1 AND unlinked_at IS NULL RETURNING link_type, ticket_id, booking_id`, [old.id]);
  for (const l of links) {
    await tx.query(`INSERT INTO credential_links(credential_id, link_type, ticket_id, booking_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [fresh.id, l.link_type, l.ticket_id, l.booking_id, actor.staffId ?? null]);
  }
  const lockers = await tx.query(`UPDATE locker_sessions SET credential_id = $2 WHERE credential_id = $1 AND status = 'ACTIVE'`, [old.id, fresh.id]);
  const queues = await tx.query(`UPDATE ride_queues SET credential_id = $2 WHERE credential_id = $1 AND status IN ('WAITING','CALLED')`, [old.id, fresh.id]);
  const wallet = old.account_id ? await walletForAccount(tx, old.account_id) : null;
  const transferred = { links: links.length, lockers: lockers.rowCount, queues: queues.rowCount, walletBalance: wallet ? Number(wallet.balance) : 0, member: old.member_id };
  const rep = await one(tx, `INSERT INTO card_replacements(old_credential_id, new_credential_id, reason, staff_id, approval_id, transferred)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [old.id, fresh.id, input.reason, actor.staffId ?? null, input.approvalId ?? null, JSON.stringify(transferred)]);
  await audit(tx, actor, { action: 'CREDENTIAL_REPLACE', entityType: 'credential', entityId: old.id, before: { code: old.code, status: old.status }, after: { newCode: fresh.code, transferred }, reason: input.reason });
  publish([rooms.account(old.account_id)], 'credential.updated', { credentialId: old.id, replacedBy: fresh.id });
  return { replacement: rep, credential: fresh };
}

/** Rotate the secret token (e.g. digital card screenshot leaked). Old QR stops working instantly. */
export async function rotateToken(tx: Db, actor: Actor, credentialId: string) {
  const row = await one(tx, `UPDATE credentials SET token = $2, token_version = token_version + 1 WHERE id = $1 RETURNING *`, [credentialId, newCredentialToken()]);
  if (!row) throw notFound('Credential');
  await audit(tx, actor, { action: 'CREDENTIAL_ROTATE_TOKEN', entityType: 'credential', entityId: credentialId, after: { tokenVersion: row.token_version } });
  return row;
}

/** Link a credential to a ticket (bind wristband ↔ ticket). */
export async function linkTicket(tx: Db, actor: Actor, credentialId: string, ticketId: string) {
  await tx.query(`INSERT INTO credential_links(credential_id, link_type, ticket_id, created_by) VALUES ($1,'TICKET',$2,$3) ON CONFLICT DO NOTHING`,
    [credentialId, ticketId, actor.staffId ?? null]);
}

export function wristbandExpiry(policy: string, visitDateOrValidTo: string): Date | null {
  if (policy === 'END_OF_DAY' || policy === 'END_OF_VISIT' || policy === 'PACKAGE') return endOfDay(visitDateOrValidTo);
  return null;
}
