import pg from 'pg';
import { config } from '../config.js';

// BIGINT (int8) → number. Amounts are satang; max safe integer ≈ 90 trillion THB.
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC → number
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE → keep as 'YYYY-MM-DD' string (avoid timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
});

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Run fn inside a DB transaction. Retries automatically on serialization
 * failures / deadlocks. Side effects that must only happen after commit
 * (realtime events, hardware commands) are registered with `afterCommit`.
 */
export async function withTx<T>(fn: (tx: Tx, afterCommit: (cb: () => void | Promise<void>) => void) => Promise<T>, opts: { retries?: number; isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    const callbacks: Array<() => void | Promise<void>> = [];
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? 'READ COMMITTED'}`);
      const result = await fn(client, (cb) => callbacks.push(cb));
      await client.query('COMMIT');
      client.release();
      for (const cb of callbacks) {
        try { await cb(); } catch (err) { console.error('afterCommit callback failed', err); }
      }
      return result;
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      client.release();
      if (RETRYABLE.has(err?.code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
        continue;
      }
      throw err;
    }
  }
}
