import { loadConfig } from './config'; import { makePool } from './db'; import { buildApp } from './app';
const cfg = loadConfig(); const pool = makePool(cfg.databaseUrl);
if (cfg.purgeDatabaseUrl) cfg.purgePool = makePool(cfg.purgeDatabaseUrl);
const app = buildApp(pool, cfg);
await app.listen({ port: cfg.port, host: process.env.HOST || '127.0.0.1' });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
