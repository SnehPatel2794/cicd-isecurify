import mysql from 'mysql2/promise';
import { runOnce, reapStale, enqueue } from './queue'; import { dispatchOutbox } from './outbox'; import { refreshDue } from './summaries'; import { fanOut, deliverDue, defaultEnv as whEnv } from './webhooks'; import { handlers, log } from './handlers'; import { scanDue } from './reminders/rules';
const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 4, timezone: 'Z', charset: 'utf8mb4' });
let stopping = false; const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { log.info('shutting down after current job'); stopping = true; });
const hourly = async () => { await reapStale(pool); await enqueue(pool, { type: 'maintenance.cleanup', idempotencyKey: `cleanup:${new Date().toISOString().slice(0, 13)}` });
  await enqueue(pool, { type: 'system.alerts', idempotencyKey: `alerts:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 2 });
  await enqueue(pool, { type: 'evidence.archive', idempotencyKey: `archive:${new Date().toISOString().slice(0, 10)}`, maxAttempts: 3 });
  const now = new Date(); if (scanDue(now)) { await enqueue(pool, { type: 'reminders.scan', idempotencyKey: `reminders:${now.toISOString().slice(0, 10)}`, maxAttempts: 3 }); await enqueue(pool, { type: 'continuous.daily', idempotencyKey: `continuous:${now.toISOString().slice(0, 10)}`, maxAttempts: 3 }); } };   // once per UTC day, from 03:00 UTC

await hourly(); const t = setInterval(() => hourly().catch(e => log.error(e)), 3600_000);
log.info('worker started');
let lastOutbox = 0, lastSummary = 0, lastHook = 0; const hookEnv = whEnv({ info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m) });
while (!stopping) { try { if (Date.now() - lastHook > 3000) { lastHook = Date.now(); await fanOut(pool); const w = await deliverDue(pool, hookEnv); if (w.dead) log.warn(w, 'webhook deliveries parked as dead'); }  if (Date.now() - lastOutbox > 3000) { lastOutbox = Date.now(); const o = await dispatchOutbox(pool); if (o.dead) log.error(o, 'outbox events parked as dead'); } if (Date.now() - lastSummary > 2000) { lastSummary = Date.now(); const n = await refreshDue(pool); if (n > 200) log.info({ refreshed: n }, 'summaries'); } if (!(await runOnce(pool, handlers))) await sleep(1000); } catch (e: any) { log.error({ err: e.message }, 'loop error'); await sleep(3000); } }
clearInterval(t); await pool.end(); process.exit(0);
