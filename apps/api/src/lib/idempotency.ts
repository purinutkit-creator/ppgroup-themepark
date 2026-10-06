import { pool, one } from '../db/pool.js';
import { AppError } from './errors.js';
import { sha256 } from './crypto.js';

/**
 * Request-level idempotency (Idempotency-Key header). Guarantees a retried
 * request (double tap, network retry, offline-queue replay) returns the
 * original result instead of executing twice. Business tables additionally
 * carry their own UNIQUE idempotency keys as a second line of defence.
 */
export async function withIdempotency<T>(scope: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  if (key.length > 200) throw new AppError(400, 'BAD_IDEMPOTENCY_KEY', 'Idempotency key too long');
  const hash = sha256(JSON.stringify(body ?? {}));
  const inserted = await one(pool, `INSERT INTO idempotency_keys(scope, key, request_hash) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING RETURNING key`, [scope, key, hash]);
  if (!inserted) {
    const existing = await one(pool, 'SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2', [scope, key]);
    if (existing?.request_hash !== hash) throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with a different request');
    if (existing.status === 'COMPLETED') return existing.response_body as T;
    throw new AppError(409, 'REQUEST_IN_PROGRESS', 'An identical request is still being processed');
  }
  try {
    const result = await fn();
    await pool.query(`UPDATE idempotency_keys SET status = 'COMPLETED', response_status = 200, response_body = $3, completed_at = now()
                      WHERE scope = $1 AND key = $2`, [scope, key, JSON.stringify(result ?? null)]);
    return result;
  } catch (err) {
    await pool.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2', [scope, key]);
    throw err;
  }
}
