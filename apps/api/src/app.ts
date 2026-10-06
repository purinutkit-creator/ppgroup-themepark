import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { resolveActor } from './middleware/auth.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.isTest ? false : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers["x-device-key"]'] },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 600), timeWindow: '1 minute',
    // per device / per session rather than per IP: a park's terminals often share one NAT address
    keyGenerator: (req) => (req.headers['x-device-key'] as string)?.slice(0, 16) ?? (req.headers.authorization ? `t:${req.headers.authorization.slice(-24)}` : req.ip),
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  // keep the raw body for payment webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    try { done(null, body ? JSON.parse(body as string) : {}); } catch (err) { (err as any).statusCode = 400; done(err as Error, undefined); }
  });

  app.decorateRequest('actor', null as any);
  app.addHook('onRequest', resolveActor);

  app.setErrorHandler((err: FastifyError & { code?: string; details?: unknown }, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    const pg = err as any;
    if (pg?.code === '23505') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Duplicate value', details: pg.detail } });
    if (pg?.code === '23503') return reply.status(409).send({ error: { code: 'REFERENCE_CONSTRAINT', message: 'Record is referenced by other data', details: pg.detail } });
    if (pg?.code === '23514') return reply.status(422).send({ error: { code: 'CONSTRAINT_VIOLATION', message: 'Value violates a business constraint', details: pg.constraint } });
    if (pg?.code === '22P02') return reply.status(400).send({ error: { code: 'BAD_INPUT', message: 'Malformed identifier or value' } });
    if (err.statusCode === 429) return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    if (err.validation || err.statusCode === 400) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: config.isProd ? 'Internal server error' : err.message } });
  });

  app.get('/api/health', async () => {
    const { pool } = await import('./db/pool.js');
    const r = await pool.query('SELECT now() AS now');
    return { status: 'ok', db: 'ok', time: r.rows[0].now, hardwareMode: config.hardwareMode, paymentProvider: config.paymentProvider };
  });

  await registerRoutes(app);
  return app;
}
