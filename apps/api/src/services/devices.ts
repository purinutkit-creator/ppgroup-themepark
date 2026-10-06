import { pool, one, query, type Db } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { newDeviceApiKey } from '../lib/crypto.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { invalidateAuthCache } from '../middleware/auth.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

export async function issueDeviceKey(db: Db, actor: Actor, deviceId: string) {
  const k = newDeviceApiKey();
  const d = await one(db, 'UPDATE devices SET api_key_hash = $2, api_key_prefix = $3 WHERE id = $1 RETURNING id, code', [deviceId, k.hash, k.prefix]);
  if (!d) throw notFound('Device');
  invalidateAuthCache('device:');
  await audit(db, actor, { action: 'DEVICE_KEY_ISSUED', entityType: 'device', entityId: d.code });
  return { apiKey: k.key };
}

export async function heartbeat(actor: Actor, input: { firmware?: string; status?: 'ONLINE' | 'ERROR'; detail?: unknown }) {
  if (!actor.deviceId) return null;
  const before = await one(pool, 'SELECT status, branch_id, name, code FROM devices WHERE id = $1', [actor.deviceId]);
  const d = await one(pool, `UPDATE devices SET last_seen_at = now(), ip = $2, firmware = COALESCE($3, firmware), status = $4 WHERE id = $1 RETURNING *`,
    [actor.deviceId, actor.ip, input.firmware ?? null, input.status ?? 'ONLINE']);
  if (before?.status !== d!.status) publish([rooms.devices(d!.branch_id), rooms.branch(d!.branch_id)], 'device.status', { deviceId: d!.id, status: d!.status, code: d!.code });
  return { ok: true, serverTime: new Date().toISOString() };
}

/** Job: devices silent for > 90s become OFFLINE (+ notification). */
export async function sweepOfflineDevices() {
  const rows = await query(pool, `UPDATE devices SET status = 'OFFLINE' WHERE status IN ('ONLINE','ERROR') AND last_seen_at < now() - interval '90 seconds' RETURNING id, branch_id, code, name, type`);
  for (const d of rows) {
    publish([rooms.devices(d.branch_id), rooms.branch(d.branch_id)], 'device.status', { deviceId: d.id, status: 'OFFLINE', code: d.code });
    await notify({ branchId: d.branch_id, type: d.type.startsWith('GATE') ? 'GATE_OFFLINE' : 'DEVICE_OFFLINE', severity: d.type.startsWith('GATE') ? 'CRITICAL' : 'WARNING',
      title: `${d.name} offline`, message: `${d.code} (${d.type}) has not reported for 90 seconds`, data: { deviceId: d.id }, dedupeKey: `devoff:${d.id}`, dedupeMinutes: 30 });
  }
  return rows.length;
}
