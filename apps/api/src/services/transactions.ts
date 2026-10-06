import { one, type Db } from '../db/pool.js';
import { codes } from '../lib/codes.js';

export interface JournalInput {
  branchId: string;
  type: 'SALE' | 'TOPUP' | 'WALLET_PAYMENT' | 'REFUND' | 'VOID' | 'WALLET_ADJUST' | 'CASH_IN' | 'CASH_OUT' | 'WALLET_CASH_OUT' | 'WALLET_TRANSFER' | 'POINTS_REDEEM';
  category: 'TICKET' | 'FOOD' | 'RETAIL' | 'WALLET' | 'LOCKER' | 'MEMBERSHIP' | 'RIDE' | 'CASH' | 'OTHER';
  method?: string | null;
  direction: 'IN' | 'OUT' | 'NONE';
  amount: number;
  orderId?: string | null; paymentId?: string | null; refundId?: string | null; walletLedgerId?: string | null;
  accountId?: string | null; memberId?: string | null; credentialId?: string | null;
  staffId?: string | null; storeId?: string | null; deviceId?: string | null; shiftId?: string | null;
  reference?: string | null;
  metadata?: Record<string, unknown>;
}

/** Unified financial journal powering Transaction Center, reports and shift cash reconciliation. */
export async function journal(db: Db, t: JournalInput) {
  const txnNo = await codes.txn(db);
  return one(db, `INSERT INTO transactions(txn_no, branch_id, type, category, method, direction, amount, order_id, payment_id, refund_id,
      wallet_ledger_id, account_id, member_id, credential_id, staff_id, store_id, device_id, shift_id, reference, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [txnNo, t.branchId, t.type, t.category, t.method ?? null, t.direction, t.amount, t.orderId ?? null, t.paymentId ?? null, t.refundId ?? null,
     t.walletLedgerId ?? null, t.accountId ?? null, t.memberId ?? null, t.credentialId ?? null, t.staffId ?? null, t.storeId ?? null,
     t.deviceId ?? null, t.shiftId ?? null, t.reference ?? null, JSON.stringify(t.metadata ?? {})]);
}

/** Map order type → reporting category */
export function categoryOfOrder(type: string, storeType?: string | null): JournalInput['category'] {
  switch (type) {
    case 'BOOKING': case 'TICKET': return 'TICKET';
    case 'FOOD': return 'FOOD';
    case 'RETAIL': return 'RETAIL';
    case 'TOPUP': return 'WALLET';
    case 'MEMBERSHIP': return 'MEMBERSHIP';
    case 'RIDE_ADDON': return 'RIDE';
    case 'LOCKER': return 'LOCKER';
    case 'POS': return storeType === 'RESTAURANT' ? 'FOOD' : storeType === 'RETAIL' ? 'RETAIL' : 'OTHER';
    default: return 'OTHER';
  }
}
