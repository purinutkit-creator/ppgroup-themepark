import { one, query, type Db } from '../db/pool.js';
import { unprocessable, notFound } from '../lib/errors.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';

export type MoveType = 'IN' | 'OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'WASTE' | 'SALE' | 'RETURN';

/** Apply a signed stock delta with row lock + movement record. */
export async function moveStock(tx: Db, input: {
  productId: string; storeId: string; delta: number; type: MoveType; orderId?: string | null; transferRef?: string | null;
  reason?: string | null; staffId?: string | null; branchId?: string | null;
}, afterCommit?: (cb: () => void) => void) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw unprocessable('INVALID_QTY', 'Quantity must be a non-zero integer');
  await tx.query(`INSERT INTO inventory(product_id, store_id, qty) VALUES ($1,$2,0) ON CONFLICT (product_id, store_id) DO NOTHING`, [input.productId, input.storeId]);
  const inv = await one(tx, 'SELECT * FROM inventory WHERE product_id = $1 AND store_id = $2 FOR UPDATE', [input.productId, input.storeId]);
  const after = inv.qty + input.delta;
  if (after < 0) {
    const cfg = await getSetting('inventory', input.branchId);
    if (!cfg.allowNegative) {
      const p = await one(tx, 'SELECT name FROM products WHERE id = $1', [input.productId]);
      throw unprocessable('OUT_OF_STOCK', `สินค้าไม่พอ: ${p?.name} (คงเหลือ ${inv.qty})`, { productId: input.productId, available: inv.qty });
    }
  }
  await tx.query('UPDATE inventory SET qty = $2, updated_at = now() WHERE id = $1', [inv.id, after]);
  const mv = await one(tx, `INSERT INTO stock_movements(product_id, store_id, type, qty, qty_before, qty_after, order_id, transfer_ref, reason, staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.productId, input.storeId, input.type, input.delta, inv.qty, after, input.orderId ?? null, input.transferRef ?? null, input.reason ?? null, input.staffId ?? null]);
  if (input.delta < 0) {
    const p = await one(tx, 'SELECT name, low_stock_threshold FROM products WHERE id = $1', [input.productId]);
    if (p && after <= p.low_stock_threshold && inv.qty > p.low_stock_threshold) {
      const store = await one(tx, 'SELECT name, branch_id FROM stores WHERE id = $1', [input.storeId]);
      await notify({ branchId: store?.branch_id, type: 'LOW_STOCK', severity: 'WARNING', title: 'Low stock', message: `${p.name} @ ${store?.name}: ${after} left`,
        data: { productId: input.productId, storeId: input.storeId, qty: after }, targetPermission: 'inventory.view', dedupeKey: `low:${input.productId}:${input.storeId}`, dedupeMinutes: 60 }, tx, afterCommit);
    }
  }
  return mv;
}

export async function transferStock(tx: Db, input: { productId: string; fromStoreId: string; toStoreId: string; qty: number; staffId?: string | null; reason?: string | null; branchId?: string | null }) {
  if (input.qty <= 0) throw unprocessable('INVALID_QTY', 'Quantity must be positive');
  const ref = `TR-${Date.now()}`;
  const out = await moveStock(tx, { productId: input.productId, storeId: input.fromStoreId, delta: -input.qty, type: 'TRANSFER_OUT', transferRef: ref, reason: input.reason, staffId: input.staffId, branchId: input.branchId });
  const inn = await moveStock(tx, { productId: input.productId, storeId: input.toStoreId, delta: input.qty, type: 'TRANSFER_IN', transferRef: ref, reason: input.reason, staffId: input.staffId, branchId: input.branchId });
  return { ref, out, in: inn };
}

export async function stockLevels(db: Db, branchId: string, storeId?: string | null) {
  return query(db, `SELECT i.*, p.sku, p.name AS product_name, p.low_stock_threshold, s.name AS store_name, s.type AS store_type,
                           (i.qty <= p.low_stock_threshold) AS low
      FROM inventory i JOIN products p ON p.id = i.product_id JOIN stores s ON s.id = i.store_id
     WHERE s.branch_id = $1 AND ($2::uuid IS NULL OR s.id = $2) ORDER BY s.name, p.name`, [branchId, storeId ?? null]);
}

export async function assertProduct(db: Db, id: string) {
  const p = await one(db, 'SELECT * FROM products WHERE id = $1', [id]);
  if (!p) throw notFound('Product');
  return p;
}
