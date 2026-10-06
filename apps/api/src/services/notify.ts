import { pool, one, type Db } from '../db/pool.js';
import { publish, rooms } from '../realtime/hub.js';

export interface NotifyInput {
  branchId?: string | null;
  audience?: 'STAFF' | 'MEMBER' | 'ACCOUNT';
  type: string;   // GATE_OFFLINE, RIDE_CLOSED, CAPACITY_WARNING, PAYMENT_FAILED, LOW_STOCK, QUEUE_TOO_LONG, DUPLICATE_QR, WALLET_ERROR, DEVICE_OFFLINE, QUEUE_CALLED, ORDER_READY ...
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  targetPermission?: string;
  memberId?: string | null;
  accountId?: string | null;
  dedupeKey?: string;          // suppress identical notifications within dedupeMinutes
  dedupeMinutes?: number;
}

/**
 * Persist + push a notification. Pass the transaction `db` and `afterCommit`
 * when called inside a business transaction.
 */
export async function notify(n: NotifyInput, db: Db = pool, afterCommit?: (cb: () => void) => void) {
  if (n.dedupeKey) {
    const dup = await one(db, `SELECT id FROM notifications WHERE dedupe_key = $1 AND created_at > now() - make_interval(mins => $2) LIMIT 1`,
      [n.dedupeKey, n.dedupeMinutes ?? 10]);
    if (dup) return null;
  }
  const row = await one(db,
    `INSERT INTO notifications(branch_id, audience, type, severity, title, message, data, target_permission, member_id, account_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [n.branchId ?? null, n.audience ?? 'STAFF', n.type, n.severity ?? 'INFO', n.title, n.message, JSON.stringify(n.data ?? {}),
     n.targetPermission ?? null, n.memberId ?? null, n.accountId ?? null, n.dedupeKey ?? null]);
  const send = () => {
    if ((n.audience ?? 'STAFF') === 'STAFF') {
      publish([n.branchId ? rooms.branch(n.branchId) : null, rooms.owner], 'notification', row);
    } else {
      publish([rooms.member(n.memberId), rooms.account(n.accountId)], 'notification', row);
    }
  };
  if (afterCommit) afterCommit(send); else send();
  return row;
}
