import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createSocketServer } from './realtime/socket.js';
import { initGates, disposeGateRuntimes } from './services/gates.js';
import { startJobs, stopJobs } from './jobs.js';

async function main() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate();
  const app = await buildApp();
  createSocketServer(app.server);
  await initGates();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  startJobs((msg, err) => app.log.error({ err }, msg));
  const shutdown = async (sig: string) => {
    app.log.info(`${sig} received, shutting down`);
    stopJobs();
    disposeGateRuntimes();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error(err); process.exit(1); });
