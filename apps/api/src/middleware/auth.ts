import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool, one, query } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { DEVICE_PERMISSIONS } from '../services/permissions.js';

export interface Actor {
  type: 'STAFF' | 'MEMBER' | 'DEVICE' | 'PUBLIC';
  staffId?: string;
  memberId?: string;
  accountId?: string;
  deviceId?: string;
  deviceType?: string;
  branchId?: string | null;      // staff home branch (null = all branches) or device branch
  roleCode?: string;
  roleName?: string;
  approvalLevel?: number;
  name?: string;
  permissions: Set<string>;
  sessionId?: string;
  ip: string;
  userAgent?: string;
}

declare module 'fastify' {
  interface FastifyRequest { actor: Actor }
}

interface TokenPayload { sid: string; typ: 'STAFF' | 'MEMBER'; sub: string }

export function signSession(payload: TokenPayload, expiresInSec: number) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: expiresInSec, issuer: 'themepark' });
}

// short TTL caches (sessions, staff permissions, devices)
const cache = new Map<string, { at: number; value: any }>();
const TTL = 15_000;
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function invalidateAuthCache(prefix?: string) {
  if (!prefix) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

export async function loadStaffActor(staffId: string) {
  return cached(`staff:${staffId}`, async () => {
    const s = await one(pool, `SELECT s.id, s.first_name, s.last_name, s.nickname, s.branch_id, s.status,
        r.code AS role_code, r.name AS role_name, r.approval_level
      FROM staff s JOIN roles r ON r.id = s.role_id WHERE s.id = $1`, [staffId]);
    if (!s) return null;
    const perms = await query(pool, 'SELECT permission_key FROM role_permissions rp JOIN staff s ON s.role_id = rp.role_id WHERE s.id = $1', [staffId]);
    return { ...s, permissions: perms.map((p) => p.permission_key) as string[] };
  });
}

async function resolveDevice(key: string) {
  const m = key.match(/^tpd_([a-z0-9]+)_/);
  if (!m) return null;
  return cached(`device:${key.slice(0, 20)}`, async () => {
    const d = await one(pool, 'SELECT id, branch_id, type, status, api_key_hash FROM devices WHERE api_key_prefix = $1', [m[1]]);
    if (!d || d.api_key_hash !== sha256(key) || d.status === 'DISABLED') return null;
    return d;
  });
}

const lastTouch = new Map<string, number>();
function touchDevice(id: string, ip: string) {
  const now = Date.now();
  if ((lastTouch.get(id) ?? 0) > now - 10_000) return;
  lastTouch.set(id, now);
  pool.query(`UPDATE devices SET last_seen_at = now(), ip = $2, status = CASE WHEN status IN ('OFFLINE','ERROR') THEN 'ONLINE' ELSE status END WHERE id = $1`, [id, ip]).catch(() => {});
}

/** Global onRequest hook: resolves the actor from Authorization / X-Device-Key. Never rejects. */
export async function resolveActor(req: FastifyRequest): Promise<void> {
  const actor: Actor = { type: 'PUBLIC', permissions: new Set(), ip: req.ip, userAgent: req.headers['user-agent'] };
  req.actor = actor;

  const deviceKey = req.headers['x-device-key'];
  if (typeof deviceKey === 'string') {
    const d = await resolveDevice(deviceKey);
    if (d) {
      actor.type = 'DEVICE';
      actor.deviceId = d.id;
      actor.deviceType = d.type;
      actor.branchId = d.branch_id;
      for (const p of DEVICE_PERMISSIONS[d.type] ?? []) actor.permissions.add(p);
      touchDevice(d.id, req.ip);
    }
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return;
  let payload: TokenPayload;
  try {
    payload = jwt.verify(auth.slice(7), config.jwtSecret, { issuer: 'themepark' }) as TokenPayload;
  } catch {
    return; // invalid / expired → stays anonymous (protected routes will 401)
  }
  const session = await cached(`session:${payload.sid}`, () =>
    one(pool, 'SELECT id, principal_type, principal_id, expires_at, revoked_at FROM sessions WHERE id = $1', [payload.sid]));
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date() || session.principal_id !== payload.sub) return;

  if (payload.typ === 'STAFF') {
    const s = await loadStaffActor(payload.sub);
    if (!s || s.status !== 'ACTIVE') return;
    actor.type = 'STAFF';
    actor.staffId = s.id;
    actor.branchId = actor.deviceId ? actor.branchId ?? s.branch_id : s.branch_id;
    actor.roleCode = s.role_code;
    actor.roleName = s.role_name;
    actor.approvalLevel = s.approval_level;
    actor.name = s.nickname || `${s.first_name} ${s.last_name}`.trim();
    for (const p of s.permissions) actor.permissions.add(p);
    // staff home branch wins unless staff is HQ (null branch) using a branch device
    if (s.branch_id) actor.branchId = s.branch_id;
  } else {
    const m = await cached(`member:${payload.sub}`, () =>
      one(pool, `SELECT m.id, m.status, m.first_name, a.id AS account_id FROM members m JOIN customer_accounts a ON a.member_id = m.id WHERE m.id = $1`, [payload.sub]));
    if (!m || m.status !== 'ACTIVE') return;
    actor.type = 'MEMBER';
    actor.memberId = m.id;
    actor.accountId = m.account_id;
    actor.name = m.first_name;
  }
  actor.sessionId = session.id;
}

export const can = (actor: Actor, perm: string) => actor.permissions.has('*') || actor.permissions.has(perm);

/** preHandler: require an authenticated staff member (or device) with ALL given permissions */
export function requirePerm(...perms: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const a = req.actor;
    if (a.type !== 'STAFF' && a.type !== 'DEVICE') throw unauthorized();
    for (const p of perms) if (!can(a, p)) throw forbidden(`Missing permission: ${p}`);
  };
}

/** preHandler: require any one of the permissions */
export function requireAnyPerm(...perms: string[]) {
  return async (req: FastifyRequest) => {
    const a = req.actor;
    if (a.type !== 'STAFF' && a.type !== 'DEVICE') throw unauthorized();
    if (!perms.some((p) => can(a, p))) throw forbidden(`Requires one of: ${perms.join(', ')}`);
  };
}

export async function requireMember(req: FastifyRequest) {
  if (req.actor.type !== 'MEMBER') throw unauthorized('Member login required');
}

/**
 * Branch scoping: staff bound to a branch can only act on that branch.
 * HQ staff (branch NULL) may pass ?branchId= / body.branchId.
 */
export function branchOf(req: FastifyRequest, requested?: string | null): string {
  const a = req.actor;
  if (a.branchId) {
    if (requested && requested !== a.branchId && !can(a, 'dashboard.consolidated')) throw forbidden('Cross-branch access denied');
    return requested ?? a.branchId;
  }
  if (requested) return requested;
  throw forbidden('branchId is required for HQ accounts');
}
