import { pool, one, query, type Db } from '../db/pool.js';
import { config } from '../config.js';
import { AppError, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { hashSecret, randomDigits, sha256, verifySecret } from '../lib/crypto.js';
import { signSession, invalidateAuthCache, type Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { sendMessage } from './messaging.js';

async function createSession(db: Db, type: 'STAFF' | 'MEMBER', principalId: string, actor: Actor, ttlSec: number) {
  const s = await one(db, `INSERT INTO sessions(principal_type, principal_id, device_id, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6)) RETURNING id, expires_at`,
    [type, principalId, actor.deviceId ?? null, actor.ip, actor.userAgent?.slice(0, 300) ?? null, ttlSec]);
  return { token: signSession({ sid: s!.id, typ: type, sub: principalId }, ttlSec), expiresAt: s!.expires_at, sessionId: s!.id };
}

async function logAttempt(type: string, identifier: string, principalId: string | null, success: boolean, reason: string | null, actor: Actor) {
  await pool.query(`INSERT INTO auth_events(principal_type, identifier, principal_id, success, reason, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [type, identifier, principalId, success, reason, actor.ip, actor.userAgent?.slice(0, 300) ?? null]);
}

/** Staff login: Employee Code + PIN (or staffId from the device staff picker + PIN). Lockout after N failures. */
export async function staffLogin(actor: Actor, input: { employeeCode?: string; staffId?: string; pin: string }) {
  const s = await one(pool, `SELECT s.*, r.code AS role_code, r.name AS role_name FROM staff s JOIN roles r ON r.id = s.role_id
      WHERE ${input.staffId ? 's.id = $1' : 's.employee_code = $1'}`, [input.staffId ?? input.employeeCode?.trim().toUpperCase()]);
  const ident = input.employeeCode ?? input.staffId ?? '';
  const sec = await getSetting('security', s?.branch_id);
  if (!s) { await logAttempt('STAFF', ident, null, false, 'UNKNOWN', actor); throw unauthorized('รหัสพนักงานหรือ PIN ไม่ถูกต้อง / Invalid credentials'); }
  if (s.status !== 'ACTIVE' && s.status !== 'LOCKED') throw unauthorized('Account inactive');
  if (s.locked_until && new Date(s.locked_until) > new Date()) throw new AppError(423, 'ACCOUNT_LOCKED', `Account locked until ${new Date(s.locked_until).toLocaleTimeString('en-GB')}`);
  if (!(await verifySecret(input.pin, s.pin_hash))) {
    const fails = s.failed_attempts + 1;
    const lock = fails >= sec.maxLoginAttempts;
    await pool.query(`UPDATE staff SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
      [s.id, lock ? 0 : fails, lock, sec.lockMinutes]);
    await logAttempt('STAFF', ident, s.id, false, lock ? 'LOCKED' : 'BAD_PIN', actor);
    throw unauthorized(lock ? `Too many attempts — locked for ${sec.lockMinutes} minutes` : 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง / Invalid credentials');
  }
  await pool.query(`UPDATE staff SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), status = 'ACTIVE' WHERE id = $1`, [s.id]);
  const session = await createSession(pool, 'STAFF', s.id, actor, config.staffSessionHours * 3600);
  await logAttempt('STAFF', ident, s.id, true, null, actor);
  await audit(pool, { ...actor, staffId: s.id, roleCode: s.role_code, branchId: s.branch_id }, { action: 'LOGIN', entityType: 'staff', entityId: s.id });
  const perms = await query(pool, 'SELECT permission_key FROM role_permissions WHERE role_id = $1', [s.role_id]);
  return {
    token: session.token, expiresAt: session.expiresAt,
    staff: { id: s.id, employeeCode: s.employee_code, firstName: s.first_name, lastName: s.last_name, nickname: s.nickname, branchId: s.branch_id,
      role: { code: s.role_code, name: s.role_name }, permissions: perms.map((p: any) => p.permission_key) },
  };
}

export async function logout(actor: Actor, all = false) {
  if (!actor.sessionId) return;
  const type = actor.type === 'STAFF' ? 'STAFF' : 'MEMBER';
  const id = actor.staffId ?? actor.memberId;
  if (all) await pool.query(`UPDATE sessions SET revoked_at = now() WHERE principal_type = $1 AND principal_id = $2 AND revoked_at IS NULL`, [type, id]);
  else await pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [actor.sessionId]);
  invalidateAuthCache('session:');
  await audit(pool, actor, { action: all ? 'LOGOUT_ALL' : 'LOGOUT', entityType: type.toLowerCase(), entityId: id });
}

/** Member login: phone or email + password, rate-limited, suspicious login detection. */
export async function memberLogin(actor: Actor, input: { identifier: string; password: string }) {
  const ident = input.identifier.trim();
  const m = await one(pool, `SELECT * FROM members WHERE phone = $1 OR lower(email) = lower($1)`, [ident]);
  const sec = await getSetting('security', m?.home_branch_id);
  if (!m || !m.password_hash) { await logAttempt('MEMBER', ident, null, false, 'UNKNOWN', actor); throw unauthorized('เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง / Invalid credentials'); }
  if (m.status !== 'ACTIVE') throw unauthorized('Account is not active');
  if (m.locked_until && new Date(m.locked_until) > new Date()) throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many attempts — try again later or reset your password');
  if (!(await verifySecret(input.password, m.password_hash))) {
    const fails = m.failed_logins + 1;
    const lock = fails >= sec.maxLoginAttempts;
    await pool.query(`UPDATE members SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`, [m.id, lock ? 0 : fails, lock, sec.lockMinutes]);
    await logAttempt('MEMBER', ident, m.id, false, lock ? 'LOCKED' : 'BAD_PASSWORD', actor);
    if (lock) {
      await pool.query(`INSERT INTO security_events(branch_id, type, details) VALUES ($1,'SUSPICIOUS_LOGIN',$2)`, [m.home_branch_id, JSON.stringify({ memberId: m.id, ip: actor.ip })]);
      await notify({ audience: 'MEMBER', memberId: m.id, type: 'SUSPICIOUS_LOGIN', severity: 'WARNING', title: 'Suspicious login attempts', message: `Multiple failed logins from ${actor.ip}. Your account is temporarily locked.` });
    }
    throw unauthorized('เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง / Invalid credentials');
  }
  // new device / IP after recent failures → alert the member
  const known = await one(pool, `SELECT 1 FROM auth_events WHERE principal_id = $1 AND success AND ip = $2 LIMIT 1`, [m.id, actor.ip]);
  const recentFails = await one(pool, `SELECT COUNT(*)::int AS n FROM auth_events WHERE principal_id = $1 AND NOT success AND created_at > now() - interval '1 hour'`, [m.id]);
  if (!known && recentFails!.n >= 2) {
    await notify({ audience: 'MEMBER', memberId: m.id, type: 'NEW_DEVICE_LOGIN', severity: 'WARNING', title: 'New sign-in', message: `New sign-in from ${actor.ip}. If this wasn't you, log out all devices and reset your password.` });
  }
  await pool.query('UPDATE members SET failed_logins = 0, locked_until = NULL WHERE id = $1', [m.id]);
  const session = await createSession(pool, 'MEMBER', m.id, actor, config.memberSessionDays * 86400);
  await logAttempt('MEMBER', ident, m.id, true, null, actor);
  await audit(pool, { ...actor, memberId: m.id }, { action: 'MEMBER_LOGIN', entityType: 'member', entityId: m.id });
  return { token: session.token, expiresAt: session.expiresAt, member: { id: m.id, memberCode: m.member_code, firstName: m.first_name, lastName: m.last_name } };
}

export async function issueMemberSession(actor: Actor, memberId: string) {
  return createSession(pool, 'MEMBER', memberId, actor, config.memberSessionDays * 86400);
}

/** Forgot password → OTP (delivered via configured SMS / e-mail sender). */
export async function requestPasswordReset(actor: Actor, identifier: string) {
  const m = await one(pool, `SELECT id, phone, email FROM members WHERE phone = $1 OR lower(email) = lower($1)`, [identifier.trim()]);
  const recent = await one(pool, `SELECT COUNT(*)::int AS n FROM otp_codes WHERE identifier = $1 AND created_at > now() - interval '15 minutes'`, [identifier.trim()]);
  if (recent!.n >= 3) throw new AppError(429, 'TOO_MANY_OTP', 'Too many requests, please wait');
  const code = randomDigits(6);
  await pool.query(`INSERT INTO otp_codes(purpose, identifier, code_hash, expires_at) VALUES ('PASSWORD_RESET', $1, $2, now() + interval '10 minutes')`, [identifier.trim(), sha256(code)]);
  if (m) await sendMessage({ to: identifier.includes('@') ? m.email : m.phone, channel: identifier.includes('@') ? 'EMAIL' : 'SMS', text: `Your Theme Park verification code is ${code} (valid 10 minutes)` });
  // never reveal whether the account exists
  return { sent: true, ...(config.isProd ? {} : { devCode: m ? code : undefined }) };
}

export async function resetPassword(actor: Actor, input: { identifier: string; code: string; newPassword: string }) {
  const sec = await getSetting('security');
  if (input.newPassword.length < sec.passwordMinLength) throw badRequest('WEAK_PASSWORD', `Password must be at least ${sec.passwordMinLength} characters`);
  const otp = await one(pool, `SELECT * FROM otp_codes WHERE identifier = $1 AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [input.identifier.trim()]);
  if (!otp || new Date(otp.expires_at) < new Date() || otp.attempts >= 5) throw unauthorized('Code expired — request a new one');
  if (otp.code_hash !== sha256(input.code.trim())) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw unauthorized('Invalid code');
  }
  const m = await one(pool, `SELECT id FROM members WHERE phone = $1 OR lower(email) = lower($1)`, [input.identifier.trim()]);
  if (!m) throw notFound('Member');
  await pool.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  await pool.query('UPDATE members SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [m.id, await hashSecret(input.newPassword)]);
  await pool.query(`UPDATE sessions SET revoked_at = now() WHERE principal_type = 'MEMBER' AND principal_id = $1 AND revoked_at IS NULL`, [m.id]);
  invalidateAuthCache('session:');
  await audit(pool, { ...actor, memberId: m.id }, { action: 'PASSWORD_RESET', entityType: 'member', entityId: m.id });
  return { ok: true };
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const m = await one(pool, 'SELECT id, password_hash FROM members WHERE id = $1', [actor.memberId]);
  if (!m || !(await verifySecret(current, m.password_hash))) throw unauthorized('Current password is incorrect');
  const sec = await getSetting('security');
  if (next.length < sec.passwordMinLength) throw badRequest('WEAK_PASSWORD', `Password must be at least ${sec.passwordMinLength} characters`);
  await pool.query('UPDATE members SET password_hash = $2 WHERE id = $1', [m.id, await hashSecret(next)]);
  await pool.query(`UPDATE sessions SET revoked_at = now() WHERE principal_type = 'MEMBER' AND principal_id = $1 AND id <> $2 AND revoked_at IS NULL`, [m.id, actor.sessionId]);
  invalidateAuthCache('session:');
  await audit(pool, actor, { action: 'PASSWORD_CHANGE', entityType: 'member', entityId: m.id });
  return { ok: true };
}
