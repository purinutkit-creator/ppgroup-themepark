import type { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { publicRoutes } from './public.js';
import { operationsRoutes } from './operations.js';
import { parkRoutes } from './park.js';
import { printRoutes } from './print.js';
import { syncRoutes } from './sync.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(publicRoutes);
  await app.register(operationsRoutes);
  await app.register(parkRoutes);
  await app.register(adminRoutes);
  await app.register(printRoutes);
  await app.register(syncRoutes);
}
