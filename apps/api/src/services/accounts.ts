import { one, type Db } from '../db/pool.js';

export async function ensureMemberAccount(db: Db, memberId: string): Promise<string> {
  const existing = await one(db, 'SELECT id FROM customer_accounts WHERE member_id = $1', [memberId]);
  if (existing) return existing.id;
  const m = await one(db, 'SELECT first_name, last_name, phone, email, home_branch_id FROM members WHERE id = $1', [memberId]);
  const row = await one(db, `INSERT INTO customer_accounts(kind, member_id, display_name, phone, email, branch_id)
     VALUES ('MEMBER', $1, $2, $3, $4, $5)
     ON CONFLICT (member_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    [memberId, `${m.first_name} ${m.last_name}`.trim(), m.phone, m.email, m.home_branch_id]);
  await ensureWallet(db, row!.id);
  return row!.id;
}

export async function createGuestAccount(db: Db, input: { name?: string | null; phone?: string | null; email?: string | null; branchId?: string | null }): Promise<string> {
  const row = await one(db, `INSERT INTO customer_accounts(kind, display_name, phone, email, branch_id) VALUES ('GUEST',$1,$2,$3,$4) RETURNING id`,
    [input.name ?? null, input.phone ?? null, input.email ?? null, input.branchId ?? null]);
  await ensureWallet(db, row!.id);
  return row!.id;
}

export async function ensureWallet(db: Db, accountId: string): Promise<string> {
  const row = await one(db, `INSERT INTO wallet_accounts(account_id) VALUES ($1)
     ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id RETURNING id`, [accountId]);
  return row!.id;
}

export async function walletOf(db: Db, accountId: string) {
  await ensureWallet(db, accountId);
  return one(db, 'SELECT * FROM wallet_accounts WHERE account_id = $1', [accountId]);
}
