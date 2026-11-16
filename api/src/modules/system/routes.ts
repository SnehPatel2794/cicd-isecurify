// GET /platform/system: one screen that answers "is this installation healthy and recoverable?". Administrators only; read only; never shows secrets.
import type { FastifyInstance } from 'fastify'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context'; import { forbidden } from '../../platform/errors';
import * as s from './data'; import { orgsNearQuota } from '../storage/data'; import { backupHealth, queueWarnings, diskWarnings } from './rules';
const STARTED = Date.now();
export function registerSystem(app: FastifyInstance, ctx: Ctx, deps?: { storage: { diskSpace(): Promise<{ freeBytes: number; totalBytes: number } | null> }; minFreeBytes: number }) {
  const { pool } = ctx; const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(ctx.U(req))) throw forbidden(); };
  app.get('/platform/system', { preHandler: adminLevel }, async () => {
    const now = Date.now(); const [log, mig, queue, failed] = await Promise.all([s.recentBackups(pool), s.migrationInfo(pool), s.queueCounts(pool), s.failedEmails24h(pool)]);
    const health = backupHealth(log.map((r: any) => ({ kind: r.kind, ok: !!r.ok, takenAt: r.takenAt, encrypted: !!r.encrypted, note: r.note })), now); const oldest = queue.oldestPending ? Math.max(0, Math.round((now - queue.oldestPending.getTime()) / 60000)) : null;
    const q = { pending: queue.pending, running: queue.running, dead: queue.dead, oldestPendingMinutes: oldest }; const mail = ctx.cfg.mail ?? { configured: false };
    const disk = deps ? await deps.storage.diskSpace() : null; const near = await orgsNearQuota(pool); const warnings = [...health.warnings, ...queueWarnings(q, failed), ...diskWarnings(disk, deps?.minFreeBytes ?? 0), ...near.map((o: any) => `${o.name} has used ${o.percent}% of its storage limit.`)]; if (ctx.cfg.production && !mail.configured) warnings.push('Outgoing email is not configured: invitations and password resets cannot be delivered.');
    return { status: warnings.length ? 'attention' : 'ok', warnings, version: process.env.APP_VERSION || process.env.npm_package_version || 'dev', node: process.version, production: ctx.cfg.production, uptimeSeconds: Math.round((now - STARTED) / 1000), schema: mig, backups: { ...health, log: log.map((r: any) => ({ id: r.id, kind: r.kind, ok: !!r.ok, takenAt: r.takenAt, dbBytes: r.dbBytes === null ? null : Number(r.dbBytes), evidenceBytes: r.evidenceBytes === null ? null : Number(r.evidenceBytes), encrypted: !!r.encrypted, note: r.note })) },
      disk: disk ? { freeBytes: disk.freeBytes, totalBytes: disk.totalBytes } : null, queue: q, email: { configured: !!mail.configured, failedLast24h: failed }, security: { mfaRequiredForPlatform: ctx.cfg.requireMfaForPlatform, originConfigured: !!ctx.cfg.origin, scannerEnabled: !!ctx.cfg.evidence?.scannerEnabled } };
  });
}
