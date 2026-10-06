import { one, query, withTx, type Db } from '../db/pool.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { businessDate } from '../lib/codes.js';
import { nextCounter } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import type { Actor } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { resolveScan, STATUS_MESSAGES } from './credentials.js';

async function position(db: Db, entry: any) {
  const ride = await one(db, 'SELECT capacity_per_cycle, cycle_minutes FROM rides WHERE id = $1', [entry.ride_id]);
  const ahead = await one(db, `SELECT COUNT(*)::int AS n, COALESCE(SUM(party_size), 0)::int AS guests FROM ride_queues
      WHERE ride_id = $1 AND queue_date = $2 AND status = 'WAITING' AND (priority > $3 OR (priority = $3 AND seq < $4))`,
    [entry.ride_id, entry.queue_date, entry.priority, entry.seq]);
  const waitMin = Math.ceil((ahead!.guests + entry.party_size) / ride.capacity_per_cycle) * Number(ride.cycle_minutes);
  return { peopleAhead: ahead!.n, guestsAhead: ahead!.guests, estimatedWaitMin: entry.status === 'WAITING' ? waitMin : 0 };
}

export async function queueEntryView(db: Db, entry: any) {
  const ride = await one(db, 'SELECT name, code FROM rides WHERE id = $1', [entry.ride_id]);
  return { id: entry.id, queueNo: entry.queue_no, rideId: entry.ride_id, rideName: ride?.name, status: entry.status, partySize: entry.party_size,
    joinedAt: entry.joined_at, calledAt: entry.called_at, callExpiresAt: entry.call_expires_at, ...(await position(db, entry)) };
}

/** JOIN QUEUE at a ride (scan) / kiosk / portal → virtual queue number e.g. A124. */
export async function joinQueue(actor: Actor, rideId: string, input: { scan?: string; accountId?: string; partySize?: number }) {
  return withTx(async (tx, after) => {
    const ride = await one(tx, 'SELECT * FROM rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!ride) throw notFound('Ride');
    if (!ride.queue_enabled) throw unprocessable('QUEUE_DISABLED', 'Virtual queue not available for this ride');
    if (ride.status !== 'OPEN') throw unprocessable('RIDE_CLOSED', 'Ride is not open');
    let cred: any = null;
    let accountId = input.accountId ?? null;
    let memberId: string | null = null;
    if (input.scan) {
      cred = (await resolveScan(tx, input.scan)).credential;
      if (cred.status !== 'ACTIVE') throw unprocessable(`CREDENTIAL_${cred.status}`, STATUS_MESSAGES[cred.status]);
      accountId = cred.account_id;
      memberId = cred.member_id;
    } else if (accountId) {
      memberId = (await one(tx, 'SELECT member_id FROM customer_accounts WHERE id = $1', [accountId]))?.member_id ?? null;
    }
    if (!accountId) throw unprocessable('ACCOUNT_REQUIRED', 'Scan your card / wristband');
    const cfg = await getSetting('queue', ride.branch_id, tx);
    const active = await one(tx, `SELECT COUNT(*)::int AS n FROM ride_queues WHERE account_id = $1 AND status IN ('WAITING','CALLED')`, [accountId]);
    if (active!.n >= cfg.maxActivePerAccount) throw unprocessable('QUEUE_LIMIT', `สามารถต่อคิวได้สูงสุด ${cfg.maxActivePerAccount} เครื่องเล่นพร้อมกัน`);
    const existing = await one(tx, `SELECT * FROM ride_queues WHERE ride_id = $1 AND account_id = $2 AND status IN ('WAITING','CALLED')`, [rideId, accountId]);
    if (existing) throw conflict('ALREADY_IN_QUEUE', `คุณอยู่ในคิวแล้ว (${existing.queue_no})`, await queueEntryView(tx, existing));
    // priority queue benefit
    const priority = memberId ? !!(await one(tx, `SELECT 1 FROM memberships ms JOIN membership_benefits b ON b.product_id = ms.product_id
        WHERE ms.member_id = $1 AND ms.status = 'ACTIVE' AND b.type IN ('PRIORITY_QUEUE','FAST_PASS') LIMIT 1`, [memberId])) : false;
    const date = businessDate();
    const seq = await nextCounter(tx, `Q:${rideId}`, date);
    const queueNo = `${ride.queue_prefix}${String(seq).padStart(3, '0')}`;
    const entry = await one(tx, `INSERT INTO ride_queues(ride_id, queue_date, seq, queue_no, account_id, credential_id, member_id, party_size, priority)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [rideId, date, seq, queueNo, accountId, cred?.id ?? null, memberId, input.partySize ?? 1, priority]);
    await audit(tx, actor, { action: 'QUEUE_JOIN', entityType: 'ride', entityId: ride.code, branchId: ride.branch_id, after: { queueNo } });
    const view = await queueEntryView(tx, entry);
    if (view.estimatedWaitMin >= cfg.longQueueAlertMin) {
      await notify({ branchId: ride.branch_id, type: 'QUEUE_TOO_LONG', severity: 'WARNING', title: `${ride.name}: queue ${view.estimatedWaitMin} min`, message: `${view.peopleAhead + 1} parties waiting`,
        data: { rideId }, dedupeKey: `longq:${rideId}`, dedupeMinutes: 30 }, tx, after);
    }
    after(() => {
      publish([rooms.ride(rideId)], 'queue.changed', { rideId });
      publish([rooms.account(accountId)], 'queue.updated', view);
    });
    return view;
  });
}

/** Operator calls the next batch: notifies guests "ถึงคิวของคุณแล้ว…" */
export async function callNext(actor: Actor, rideId: string, count?: number) {
  return withTx(async (tx, after) => {
    const ride = await one(tx, 'SELECT * FROM rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!ride) throw notFound('Ride');
    const n = count ?? ride.capacity_per_cycle;
    const waiting = await query(tx, `SELECT * FROM ride_queues WHERE ride_id = $1 AND queue_date = $2 AND status = 'WAITING' ORDER BY priority DESC, seq LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [rideId, businessDate(), n]);
    const called: any[] = [];
    let guests = 0;
    for (const q of waiting) {
      if (guests + q.party_size > n && called.length) break;
      guests += q.party_size;
      const upd = await one(tx, `UPDATE ride_queues SET status = 'CALLED', called_at = now(), call_expires_at = now() + make_interval(mins => $2) WHERE id = $1 RETURNING *`,
        [q.id, ride.queue_call_window_min]);
      called.push(upd);
      await notify({ audience: 'ACCOUNT', accountId: q.account_id, memberId: q.member_id, branchId: ride.branch_id, type: 'QUEUE_CALLED', severity: 'INFO',
        title: `ถึงคิวของคุณแล้ว (${q.queue_no})`, message: `กรุณาไปที่ ${ride.name} ภายใน ${ride.queue_call_window_min} นาที`, data: { rideId, queueNo: q.queue_no } }, tx, after);
    }
    await audit(tx, actor, { action: 'QUEUE_CALL', entityType: 'ride', entityId: ride.code, branchId: ride.branch_id, after: { called: called.map((c: any) => c.queue_no) } });
    after(async () => {
      publish([rooms.ride(rideId)], 'queue.changed', { rideId, called: called.map((c: any) => c.queue_no) });
      for (const c of called) publish([rooms.account(c.account_id)], 'queue.updated', await queueEntryView((await import('../db/pool.js')).pool, c));
    });
    return { called: called.map((c: any) => ({ id: c.id, queueNo: c.queue_no, partySize: c.party_size })) };
  });
}

export async function cancelQueue(actor: Actor, entryId: string, accountId?: string) {
  return withTx(async (tx, after) => {
    const q = await one(tx, 'SELECT * FROM ride_queues WHERE id = $1 FOR UPDATE', [entryId]);
    if (!q) throw notFound('Queue entry');
    if (accountId && q.account_id !== accountId) throw notFound('Queue entry');
    if (!['WAITING', 'CALLED'].includes(q.status)) throw conflict('QUEUE_NOT_ACTIVE', `Queue entry is ${q.status}`);
    await tx.query(`UPDATE ride_queues SET status = 'CANCELLED' WHERE id = $1`, [entryId]);
    await audit(tx, actor, { action: 'QUEUE_CANCEL', entityType: 'ride_queue', entityId: entryId });
    after(() => { publish([rooms.ride(q.ride_id)], 'queue.changed', { rideId: q.ride_id }); publish([rooms.account(q.account_id)], 'queue.updated', { id: q.id, status: 'CANCELLED' }); });
    return { ok: true };
  });
}

export async function rideQueue(db: Db, rideId: string) {
  return query(db, `SELECT q.*, c.code AS credential_code, m.first_name || ' ' || m.last_name AS member_name FROM ride_queues q
      LEFT JOIN credentials c ON c.id = q.credential_id LEFT JOIN members m ON m.id = q.member_id
     WHERE q.ride_id = $1 AND q.queue_date = $2 AND q.status IN ('WAITING','CALLED') ORDER BY q.status = 'CALLED' DESC, q.priority DESC, q.seq`, [rideId, businessDate()]);
}

export async function accountQueues(db: Db, accountId: string) {
  const rows = await query(db, `SELECT * FROM ride_queues WHERE account_id = $1 AND status IN ('WAITING','CALLED') ORDER BY joined_at`, [accountId]);
  return Promise.all(rows.map((r: any) => queueEntryView(db, r)));
}

/** Job: CALLED entries past their window → NO_SHOW */
export async function expireCalled(db: Db) {
  const rows = await query(db, `UPDATE ride_queues SET status = 'NO_SHOW' WHERE status = 'CALLED' AND call_expires_at < now() RETURNING ride_id, account_id, id`);
  for (const r of rows) { publish([rooms.ride(r.ride_id)], 'queue.changed', { rideId: r.ride_id }); publish([rooms.account(r.account_id)], 'queue.updated', { id: r.id, status: 'NO_SHOW' }); }
  await db.query(`UPDATE ride_queues SET status = 'EXPIRED' WHERE status = 'WAITING' AND queue_date < $1`, [businessDate()]);
  return rows.length;
}
