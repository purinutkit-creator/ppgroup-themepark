import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool, one } from '../db/pool.js';
import { sha256 } from '../lib/crypto.js';
import { loadStaffActor } from '../middleware/auth.js';
import { attachIo } from './hub.js';

interface SocketPrincipal {
  type: 'STAFF' | 'MEMBER' | 'DEVICE' | 'PUBLIC';
  id?: string;
  branchId?: string | null;
  accountId?: string;
  permissions: Set<string>;
}

/**
 * Socket.IO server. Clients authenticate in the handshake (`auth: { token, deviceKey }`) and
 * then `subscribe` to rooms; every subscription is authorised server-side.
 * Horizontal scaling: plug @socket.io/redis-adapter here (REDIS_URL) — publish() is unchanged.
 */
export function createSocketServer(http: HttpServer) {
  const io = new Server(http, { cors: { origin: config.corsOrigin, credentials: true }, path: '/socket.io' });
  attachIo(io);

  io.use(async (socket, next) => {
    const p: SocketPrincipal = { type: 'PUBLIC', permissions: new Set() };
    try {
      const { token, deviceKey } = (socket.handshake.auth ?? {}) as { token?: string; deviceKey?: string };
      if (deviceKey) {
        const m = deviceKey.match(/^tpd_([a-z0-9]+)_/);
        const d = m ? await one(pool, 'SELECT id, branch_id, api_key_hash, status FROM devices WHERE api_key_prefix = $1', [m[1]]) : null;
        if (d && d.api_key_hash === sha256(deviceKey) && d.status !== 'DISABLED') Object.assign(p, { type: 'DEVICE', id: d.id, branchId: d.branch_id });
      }
      if (token) {
        const payload = jwt.verify(token, config.jwtSecret, { issuer: 'themepark' }) as { sid: string; typ: string; sub: string };
        const s = await one(pool, 'SELECT revoked_at, expires_at FROM sessions WHERE id = $1', [payload.sid]);
        if (s && !s.revoked_at && new Date(s.expires_at) > new Date()) {
          if (payload.typ === 'STAFF') {
            const st = await loadStaffActor(payload.sub);
            if (st?.status === 'ACTIVE') Object.assign(p, { type: 'STAFF', id: st.id, branchId: st.branch_id, permissions: new Set(st.permissions) });
          } else {
            const a = await one(pool, 'SELECT id FROM customer_accounts WHERE member_id = $1', [payload.sub]);
            Object.assign(p, { type: 'MEMBER', id: payload.sub, accountId: a?.id });
          }
        }
      }
    } catch { /* anonymous */ }
    socket.data.principal = p;
    next();
  });

  io.on('connection', (socket) => {
    const p: SocketPrincipal = socket.data.principal;
    if (p.type === 'MEMBER') { socket.join(`member:${p.id}`); if (p.accountId) socket.join(`account:${p.accountId}`); }

    socket.on('subscribe', async (req: { rooms: string[]; bookingToken?: string }, ack?: (r: unknown) => void) => {
      const granted: string[] = [];
      for (const room of req?.rooms ?? []) {
        if (await authorise(p, room, req.bookingToken)) { socket.join(room); granted.push(room); }
      }
      ack?.({ granted });
    });
    socket.on('unsubscribe', (req: { rooms: string[] }) => { for (const r of req?.rooms ?? []) socket.leave(r); });
  });
  return io;
}

const hasPerm = (p: SocketPrincipal, perm: string) => p.permissions.has('*') || p.permissions.has(perm);

async function sameBranch(p: SocketPrincipal, branchId: string) {
  if (p.type === 'STAFF') return !p.branchId || p.branchId === branchId || hasPerm(p, 'dashboard.consolidated');
  if (p.type === 'DEVICE') return p.branchId === branchId;
  return false;
}

async function authorise(p: SocketPrincipal, room: string, bookingToken?: string): Promise<boolean> {
  const [kind, id] = room.split(':');
  if (room === 'owner') return p.type === 'STAFF' && hasPerm(p, 'dashboard.consolidated');
  switch (kind) {
    case 'branch': case 'devices': return sameBranch(p, id);
    case 'gates': return (await sameBranch(p, id)) && (p.type === 'DEVICE' || hasPerm(p, 'gate.view'));
    case 'payverify': return (await sameBranch(p, id)) && hasPerm(p, 'payment.verify');
    case 'gate': { const g = await one(pool, 'SELECT branch_id FROM gates WHERE id::text = $1', [id]); return !!g && sameBranch(p, g.branch_id); }
    case 'ride': { const r = await one(pool, 'SELECT branch_id FROM rides WHERE id::text = $1', [id]); return !!r && sameBranch(p, r.branch_id); }
    case 'kds': { const s = await one(pool, 'SELECT branch_id FROM stores WHERE id::text = $1', [id]); return !!s && (await sameBranch(p, s.branch_id)); }
    case 'kdsready': return true; // public queue display: ready numbers only
    case 'account': {
      if (p.type === 'MEMBER') return p.accountId === id;
      if (p.type === 'STAFF' || p.type === 'DEVICE') return true; // staff / kiosk screens showing a scanned card
      return false;
    }
    case 'member': return p.type === 'MEMBER' ? p.id === id : p.type === 'STAFF';
    case 'booking': {
      if (p.type === 'STAFF') return true;
      if (!bookingToken) return false;
      const b = await one(pool, 'SELECT 1 FROM bookings WHERE id::text = $1 AND public_token = $2', [id, bookingToken]);
      return !!b;
    }
    default: return false;
  }
}
