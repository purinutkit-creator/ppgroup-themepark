import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/http.js';
import { forbidden } from '../lib/errors.js';
import { getSetting } from '../services/settings.js';

/**
 * Offline queue replay. Devices store "safe" actions locally while offline and replay them
 * here when back online. Each item carries its original Idempotency-Key, so replays never
 * double-charge. Actions not on the allow-list (refunds, wallet adjustments, manual gate
 * opens …) are rejected — they must be done online.
 */
const ACTION_ROUTES: Record<string, { method: 'POST'; url: (p: any) => string }> = {
  'pos.cash_sale': { method: 'POST', url: () => '/api/pos/checkout' },
  'kds.status': { method: 'POST', url: (p) => `/api/kitchen/orders/${p.orderId}/status` },
  'gate.exit': { method: 'POST', url: (p) => `/api/gates/${p.gateId}/scan` },
};

export async function syncRoutes(app: FastifyInstance) {
  app.post('/api/sync/batch', async (req) => {
    if (req.actor.type !== 'STAFF' && req.actor.type !== 'DEVICE') throw forbidden();
    const b = parse(z.object({ items: z.array(z.object({ idempotencyKey: z.string().min(8), action: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: z.string() })).max(200) }), req.body);
    const cfg = await getSetting('offline', req.actor.branchId);
    const results = [];
    for (const item of b.items) {
      const route = ACTION_ROUTES[item.action];
      if (!route || !cfg.allowedActions.includes(item.action) || cfg.blockedActions.includes(item.action)) {
        results.push({ idempotencyKey: item.idempotencyKey, ok: false, status: 403, error: { code: 'OFFLINE_ACTION_NOT_ALLOWED', message: `${item.action} cannot be performed offline` } });
        continue;
      }
      const payload = item.action === 'pos.cash_sale' ? { ...item.payload, offlineCreatedAt: item.createdAt } : item.payload;
      const res = await app.inject({ method: route.method, url: route.url(item.payload), payload,
        headers: { authorization: req.headers.authorization ?? '', 'x-device-key': (req.headers['x-device-key'] as string) ?? '', 'idempotency-key': item.idempotencyKey, 'content-type': 'application/json' } });
      const body = res.json();
      results.push({ idempotencyKey: item.idempotencyKey, ok: res.statusCode < 300, status: res.statusCode, ...(res.statusCode < 300 ? { result: body } : { error: body.error }) });
    }
    return { results };
  });
}
