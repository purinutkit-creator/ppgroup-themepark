import { one, query, type Db } from '../db/pool.js';
import { AppError, notFound, unprocessable } from '../lib/errors.js';
import { codes } from '../lib/codes.js';
import { publish, rooms } from '../realtime/hub.js';
import { ensureWallet } from './accounts.js';
import { getSetting } from './settings.js';

export type LedgerType = 'TOPUP' | 'PAYMENT' | 'REFUND' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'CASH_OUT' | 'BONUS' | 'EXPIRE' | 'REVERSAL';

export interface PostInput {
  walletId: string;
  type: LedgerType;
  debit?: number;
  credit?: number;
  referenceType?: string; referenceId?: string;
  orderId?: string | null; paymentId?: string | null; credentialId?: string | null; memberId?: string | null;
  storeId?: string | null; deviceId?: string | null; staffId?: string | null; branchId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}

/**
 * The ONLY way to change a wallet balance. Locks the wallet row (SELECT … FOR UPDATE),
 * validates funds, appends an immutable ledger row (before/after balances) and updates
 * the cached balance in the same transaction. Idempotent per (wallet, idempotencyKey).
 */
export async function postLedger(tx: Db, input: PostInput, afterCommit?: (cb: () => void) => void) {
  const debit = input.debit ?? 0;
  const credit = input.credit ?? 0;
  if ((debit > 0) === (credit > 0) || debit < 0 || credit < 0 || !Number.isInteger(debit) || !Number.isInteger(credit)) {
    throw new AppError(400, 'INVALID_LEDGER_AMOUNT', 'Exactly one of debit / credit must be a positive integer');
  }
  if (input.idempotencyKey) {
    const dup = await one(tx, 'SELECT * FROM wallet_ledger WHERE wallet_id = $1 AND idempotency_key = $2', [input.walletId, input.idempotencyKey]);
    if (dup) return { entry: dup, duplicate: true };
  }
  const w = await one(tx, 'SELECT * FROM wallet_accounts WHERE id = $1 FOR UPDATE', [input.walletId]);
  if (!w) throw notFound('Wallet');
  if (w.status !== 'ACTIVE' && !(input.type === 'REVERSAL' || input.type === 'REFUND' || input.type === 'TRANSFER_OUT')) {
    throw unprocessable('WALLET_NOT_ACTIVE', `Wallet is ${w.status}`);
  }
  if (debit > w.balance) {
    throw unprocessable('INSUFFICIENT_BALANCE', 'ยอดเงินในกระเป๋าไม่เพียงพอ / Insufficient wallet balance', { balance: w.balance, required: debit });
  }
  const before = Number(w.balance);
  const after = before + credit - debit;
  if (credit > 0 && input.type === 'TOPUP') {
    const cfg = await getSetting('wallet', input.branchId);
    if (after > cfg.maxBalance) throw unprocessable('WALLET_MAX_BALANCE', `Wallet balance cannot exceed ${cfg.maxBalance / 100} THB`);
  }
  const txnNo = await codes.walletTxn(tx);
  const entry = await one(tx, `INSERT INTO wallet_ledger(txn_no, wallet_id, type, debit, credit, balance_before, balance_after, reference_type, reference_id,
      order_id, payment_id, credential_id, member_id, store_id, device_id, staff_id, branch_id, note, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [txnNo, w.id, input.type, debit, credit, before, after, input.referenceType ?? null, input.referenceId ?? null,
     input.orderId ?? null, input.paymentId ?? null, input.credentialId ?? null, input.memberId ?? null, input.storeId ?? null,
     input.deviceId ?? null, input.staffId ?? null, input.branchId ?? null, input.note ?? null, input.idempotencyKey ?? null]);
  await tx.query('UPDATE wallet_accounts SET balance = $2, version = version + 1 WHERE id = $1', [w.id, after]);
  const push = () => publish([rooms.account(w.account_id)], 'wallet.updated', {
    accountId: w.account_id, walletId: w.id, balance: after, entry: { txnNo, type: input.type, debit, credit, balanceAfter: after },
  });
  if (afterCommit) afterCommit(push); else push();
  return { entry, duplicate: false };
}

export async function walletForAccount(tx: Db, accountId: string) {
  const id = await ensureWallet(tx, accountId);
  return one(tx, 'SELECT * FROM wallet_accounts WHERE id = $1', [id]);
}

/** Move the full balance from one account's wallet to another's (guest → member, lost card merge). */
export async function transferAll(tx: Db, fromAccountId: string, toAccountId: string, ctx: { staffId?: string | null; branchId?: string | null; reason: string },
  afterCommit?: (cb: () => void) => void) {
  if (fromAccountId === toAccountId) return 0;
  const fromId = await ensureWallet(tx, fromAccountId);
  const toId = await ensureWallet(tx, toAccountId);
  // lock in a stable order to avoid deadlocks
  const [a, b] = [fromId, toId].sort();
  await tx.query('SELECT id FROM wallet_accounts WHERE id IN ($1,$2) ORDER BY id FOR UPDATE', [a, b]);
  const from = await one(tx, 'SELECT balance FROM wallet_accounts WHERE id = $1', [fromId]);
  const amount = Number(from!.balance);
  if (amount <= 0) return 0;
  const ref = `${fromAccountId}->${toAccountId}:${Date.now()}`;
  await postLedger(tx, { walletId: fromId, type: 'TRANSFER_OUT', debit: amount, referenceType: 'ACCOUNT_TRANSFER', referenceId: toAccountId, note: ctx.reason, staffId: ctx.staffId, branchId: ctx.branchId, idempotencyKey: `xfer-out:${ref}` }, afterCommit);
  await postLedger(tx, { walletId: toId, type: 'TRANSFER_IN', credit: amount, referenceType: 'ACCOUNT_TRANSFER', referenceId: fromAccountId, note: ctx.reason, staffId: ctx.staffId, branchId: ctx.branchId, idempotencyKey: `xfer-in:${ref}` }, afterCommit);
  return amount;
}

/** Reconciliation: cached balance must equal the ledger. Returns mismatching wallets. */
export async function reconcileWallets(db: Db) {
  return query(db, `
    SELECT w.id, w.account_id, w.balance,
           COALESCE(SUM(l.credit - l.debit), 0) AS ledger_sum,
           (SELECT balance_after FROM wallet_ledger x WHERE x.wallet_id = w.id ORDER BY created_at DESC, txn_no DESC LIMIT 1) AS last_balance_after
      FROM wallet_accounts w LEFT JOIN wallet_ledger l ON l.wallet_id = w.id
     GROUP BY w.id
    HAVING w.balance <> COALESCE(SUM(l.credit - l.debit), 0)`);
}

export async function ledgerHistory(db: Db, walletId: string, limit = 100) {
  return query(db, `SELECT l.*, s.name AS store_name, st.first_name AS staff_name
      FROM wallet_ledger l LEFT JOIN stores s ON s.id = l.store_id LEFT JOIN staff st ON st.id = l.staff_id
     WHERE l.wallet_id = $1 ORDER BY l.created_at DESC, l.txn_no DESC LIMIT $2`, [walletId, limit]);
}
