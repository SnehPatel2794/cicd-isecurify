import type { Handler } from './queue';
import pino from 'pino'; import { makeEmailHandler, defaultMailEnv } from './mail/handlers'; import { makeScanHandler, sweepOrphans, evidenceEnv } from './evidence';
export const log = pino({ level: process.env.LOG_LEVEL || 'info' });
import { runContinuous } from './continuous'; import { makeAlertHandler } from './alerts'; import { makeArchiveHandler } from './archive'; import { runDaily } from './reminders/scan';
const mailEnv = defaultMailEnv({ warn: (o, m) => log.warn(o, m) });
export const handlers: Record<string, Handler> = {
  noop: async () => {},
  'evidence.scan': makeScanHandler(evidenceEnv),
  'email.password_reset': makeEmailHandler('email.password_reset', mailEnv),
  'email.invitation': makeEmailHandler('email.invitation', mailEnv),
  'reminders.scan': async (_j, { pool }) => { await runDaily(pool, new Date(), mailEnv, { info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m) }); },
  'continuous.daily': async (_j, { pool }) => { await runContinuous(pool, new Date(), { info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m) }); },
  'email.digest': makeEmailHandler('email.digest', mailEnv),
  'email.notification': makeEmailHandler('email.notification', mailEnv),
  'evidence.archive': makeArchiveHandler({ info: (o, m) => log.info(o, m) }),
  'email.alert': makeEmailHandler('email.alert', mailEnv),
  'system.alerts': makeAlertHandler(() => ({ evidenceDir: evidenceEnv().dir, minFreeBytes: Number(process.env.ALERT_MIN_FREE_MB ?? 2048) * 1048576 }), { info: (o, m) => log.info(o, m) }),
  'email.test': makeEmailHandler('email.test', mailEnv),
  'maintenance.cleanup': async (_j, { pool }) => {
    await pool.query("DELETE FROM webhook_deliveries WHERE created_at < DATE_SUB(NOW(3), INTERVAL 30 DAY)");
    await pool.query('DELETE FROM sessions WHERE expires_at < DATE_SUB(NOW(3), INTERVAL 1 DAY)');
    await pool.query('DELETE FROM password_resets WHERE expires_at < DATE_SUB(NOW(3), INTERVAL 1 DAY)');
    await pool.query('DELETE FROM reminder_log WHERE created_at < DATE_SUB(NOW(3), INTERVAL 400 DAY)');
    await pool.query('DELETE FROM notifications WHERE (read_at IS NOT NULL AND read_at < DATE_SUB(NOW(3), INTERVAL 90 DAY)) OR created_at < DATE_SUB(NOW(3), INTERVAL 180 DAY)');   // read: 90 days, anything: 180 days
    await pool.query("DELETE FROM jobs WHERE status IN ('done','dead') AND finished_at < DATE_SUB(NOW(3), INTERVAL 30 DAY)");
    try { const r = await sweepOrphans(pool, evidenceEnv().dir); if (r.removed.length || r.tmpRemoved) log.info({ removed: r.removed.length, tmp: r.tmpRemoved }, 'evidence orphan sweep'); if (r.missing.length) log.error({ missing: r.missing.slice(0, 20), count: r.missing.length }, 'evidence files referenced by the database are MISSING from storage'); }
    catch (e: any) { log.error({ err: e.message }, 'evidence orphan sweep failed'); }
  },
};
