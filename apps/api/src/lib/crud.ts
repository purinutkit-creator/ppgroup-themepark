import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, one, query, withTx } from '../db/pool.js';
import { notFound } from './errors.js';
import { parse } from './http.js';
import { branchOf, requirePerm } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { publish, rooms } from '../realtime/hub.js';

export interface CrudEntity {
  path: string;                  // /api/admin/rides
  table: string;
  schema: z.ZodObject<any>;      // create schema (update uses .partial())
  jsonColumns?: string[];
  permission: string;            // manage permission
  viewPermission?: string;
  branchScoped?: 'required' | 'optional' | false;   // optional = NULL means all branches
  orderBy?: string;
  select?: string;               // custom list select (must alias main table as t)
  searchColumns?: string[];
  afterWrite?: (row: any, req: FastifyRequest) => Promise<void> | void;
  beforeWrite?: (data: Record<string, unknown>, req: FastifyRequest, existing?: any) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

function toRow(data: Record<string, unknown>, jsonColumns: string[] = []) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const col = snake(k);
    cols.push(col);
    vals.push(jsonColumns.includes(col) && v !== null ? JSON.stringify(v) : v);
  }
  return { cols, vals };
}

/** Generic, audited, branch-scoped CRUD for configuration entities (admin back office). */
export function registerCrud(app: FastifyInstance, e: CrudEntity) {
  const view = e.viewPermission ?? e.permission;
  app.get(e.path, { preHandler: requirePerm(view) }, async (req) => {
    const q = req.query as Record<string, string>;
    const where: string[] = [];
    const params: unknown[] = [];
    // HQ staff (no home branch) may list branch-optional entities across all branches
    const hqAll = e.branchScoped === 'optional' && !req.actor.branchId && !q.branchId;
    if (e.branchScoped && !hqAll) {
      const branchId = branchOf(req, q.branchId || null);
      params.push(branchId);
      where.push(e.branchScoped === 'optional' ? `(t.branch_id = $${params.length} OR t.branch_id IS NULL)` : `t.branch_id = $${params.length}`);
    }
    if (q.q && e.searchColumns?.length) {
      params.push(`%${q.q}%`);
      where.push(`(${e.searchColumns.map((c) => `t.${c}::text ILIKE $${params.length}`).join(' OR ')})`);
    }
    const sql = `${e.select ?? `SELECT t.* FROM ${e.table} t`} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${e.orderBy ?? 't.created_at DESC'} LIMIT 1000`;
    return query(pool, sql, params);
  });

  app.get(`${e.path}/:id`, { preHandler: requirePerm(view) }, async (req) => {
    const { id } = req.params as { id: string };
    const row = await one(pool, `${e.select ?? `SELECT t.* FROM ${e.table} t`} WHERE t.id = $1`, [id]);
    if (!row) throw notFound(e.table);
    return row;
  });

  app.post(e.path, { preHandler: requirePerm(e.permission) }, async (req) => {
    let data = parse(e.schema, req.body) as Record<string, unknown>;
    if (e.branchScoped === 'required') data.branchId = branchOf(req, (data.branchId as string) ?? null);
    if (e.branchScoped === 'optional' && req.actor.branchId && !data.branchId) data.branchId = data.branchId ?? null;
    if (e.beforeWrite) data = await e.beforeWrite(data, req);
    const row = await withTx(async (tx) => {
      const { cols, vals } = toRow(data, e.jsonColumns);
      const r = await one(tx, `INSERT INTO ${e.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: e.table, entityId: r.id, after: r, metadata: { op: 'create' } });
      return r;
    });
    await e.afterWrite?.(row, req);
    if (row.branch_id) publish([rooms.branch(row.branch_id)], 'config.changed', { entity: e.table, id: row.id });
    return row;
  });

  app.patch(`${e.path}/:id`, { preHandler: requirePerm(e.permission) }, async (req) => {
    const { id } = req.params as { id: string };
    const sent = (req.body ?? {}) as Record<string, unknown>;
    // zod applies .default() even for partial schemas → keep only keys the client actually sent
    let data = Object.fromEntries(Object.entries(parse(e.schema.partial(), sent) as Record<string, unknown>).filter(([k]) => k in sent));
    const row = await withTx(async (tx) => {
      const before = await one(tx, `SELECT * FROM ${e.table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound(e.table);
      if (e.branchScoped && before.branch_id) branchOf(req, before.branch_id);
      if (e.beforeWrite) data = await e.beforeWrite(data, req, before);
      if (e.branchScoped === 'required') delete data.branchId;
      const { cols, vals } = toRow(data, e.jsonColumns);
      if (!cols.length) return before;
      const r = await one(tx, `UPDATE ${e.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...vals]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: e.table, entityId: id, before, after: r, metadata: { op: 'update' } });
      return r;
    });
    await e.afterWrite?.(row, req);
    if (row.branch_id) publish([rooms.branch(row.branch_id)], 'config.changed', { entity: e.table, id: row.id });
    return row;
  });

  app.delete(`${e.path}/:id`, { preHandler: requirePerm(e.permission) }, async (req) => {
    const { id } = req.params as { id: string };
    await withTx(async (tx) => {
      const before = await one(tx, `SELECT * FROM ${e.table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound(e.table);
      if (e.branchScoped && before.branch_id) branchOf(req, before.branch_id);
      await tx.query(`DELETE FROM ${e.table} WHERE id = $1`, [id]);
      await audit(tx, req.actor, { action: 'SETTINGS_CHANGE', entityType: e.table, entityId: id, before, metadata: { op: 'delete' } });
    });
    return { ok: true };
  });
}
