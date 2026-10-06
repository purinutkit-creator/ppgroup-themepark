import { pool, query } from './db/pool.js';
import { businessDate } from './lib/codes.js';
import { sweepOfflineDevices } from './services/devices.js';
import { expireCalled } from './services/queue.js';
import { membershipMaintenance } from './services/membership.js';
import { retryUnfulfilled } from './services/orders.js';
import { reconcileWallets } from './services/wallet.js';
import { notify } from './services/notify.js';
import { publish, rooms } from './realtime/hub.js';

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

/** Background maintenance. Uses a PG advisory lock per job so only one API instance runs it. */
export const JOBS: Job[] = [
  { name: 'device-offline-sweep', everyMs: 30_000, run: sweepOfflineDevices },
  { name: 'queue-expire', everyMs: 30_000, run: () => expireCalled(pool) },
  {
    name: 'payment-expiry', everyMs: 60_000, run: async () => {
      const exp = await query(pool, `UPDATE payments SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now() RETURNING order_id`);
      const b = await query(pool, `UPDATE bookings SET status = 'EXPIRED' WHERE status = 'PENDING_PAYMENT' AND expires_at < now() AND channel <> 'COUNTER' RETURNING id, order_id, branch_id`);
      for (const x of b) {
        await pool.query(`UPDATE tickets SET status = 'CANCELLED' WHERE booking_id = $1 AND status = 'UNPAID'`, [x.id]);
        await pool.query(`UPDATE orders SET status = 'CANCELLED', void_reason = 'Payment timeout' WHERE id = $1 AND status = 'PENDING'`, [x.order_id]);
        publish([rooms.booking(x.id)], 'booking.updated', { bookingId: x.id, status: 'EXPIRED' });
      }
      await pool.query(`UPDATE ride_purchase_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND created_at < now() - interval '15 minutes'`);
      return { payments: exp.length, bookings: b.length };
    },
  },
  {
    name: 'end-of-day', everyMs: 10 * 60_000, run: async () => {
      const today = businessDate();
      await pool.query(`UPDATE tickets SET status = CASE WHEN entry_count > 0 THEN 'USED' ELSE 'EXPIRED' END WHERE status = 'ACTIVE' AND valid_to < $1`, [today]);
      await pool.query(`UPDATE tickets SET presence = 'OUTSIDE', current_zone_id = NULL WHERE presence = 'INSIDE' AND valid_to < $1`, [today]);
      await pool.query(`UPDATE bookings SET status = 'NO_SHOW' WHERE status IN ('RESERVED','CONFIRMED') AND visit_date < $1`, [today]);
      await pool.query(`UPDATE ride_entitlements SET status = 'EXPIRED' WHERE status IN ('ACTIVE','EXHAUSTED') AND valid_until < now()`);
      await pool.query(`UPDATE credentials SET status = 'EXPIRED', status_reason = 'Auto-expired' WHERE status = 'ACTIVE' AND expires_at < now()`);
      const overdue = await query(pool, `UPDATE locker_sessions SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expire_at < now() RETURNING locker_id`);
      for (const o of overdue) {
        const l = await query(pool, 'SELECT branch_id, code FROM lockers WHERE id = $1', [o.locker_id]);
        await notify({ branchId: l[0]?.branch_id, type: 'LOCKER_OVERDUE', severity: 'INFO', title: `Locker ${l[0]?.code} overdue`, message: 'Rental expired — check and release', data: { lockerId: o.locker_id } });
      }
      return membershipMaintenance(pool);
    },
  },
  { name: 'fulfillment-retry', everyMs: 60_000, run: () => retryUnfulfilled() },
  {
    name: 'wallet-reconciliation', everyMs: 15 * 60_000, run: async () => {
      const bad = await reconcileWallets(pool);
      if (bad.length) await notify({ type: 'WALLET_ERROR', severity: 'CRITICAL', title: 'Wallet reconciliation mismatch', message: `${bad.length} wallet(s) differ from ledger`, data: { wallets: bad.map((b: any) => b.id) }, dedupeKey: 'walletrecon', dedupeMinutes: 60 });
      return { mismatches: bad.length };
    },
  },
  { name: 'idempotency-cleanup', everyMs: 60 * 60_000, run: () => pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'`) },
];

const timers: NodeJS.Timeout[] = [];
export function startJobs(log: (msg: string, err?: unknown) => void) {
  JOBS.forEach((job, i) => {
    const lockId = 9100 + i;
    const tick = async () => {
      const c = await pool.connect();
      try {
        const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS ok', [lockId]);
        if (!rows[0].ok) return;
        try { await job.run(); } finally { await c.query('SELECT pg_advisory_unlock($1)', [lockId]); }
      } catch (err) { log(`job ${job.name} failed`, err); } finally { c.release(); }
    };
    timers.push(setInterval(tick, job.everyMs));
  });
}
export function stopJobs() { timers.forEach(clearInterval); }
