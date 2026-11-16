// Platform-level email administration: is outgoing email configured, what happened to recent messages, send a test message.
// The worker does the sending; these routes only enqueue the test job and read the delivery log (which never contains a body, a link or a token).
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { outboxStats, retryDead } from '../../platform/outbox'; import { audit } from '../../platform/audit'; import { enqueue } from '../../platform/jobs'; import { HttpError, forbidden } from '../../platform/errors';

export function registerMail(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  const mail = () => ctx.cfg.mail ?? { configured: false };
  app.get('/platform/email', { preHandler: adminLevel }, async (req: any) => {
    const f = ctx.parse(z.object({ status: z.enum(['sent', 'failed']).optional() }), req.query);
    const log = await q(pool, `SELECT id, template, to_email toEmail, subject, status, error, attempts, created_at createdAt FROM email_log ${f.status ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 100`, f.status ? [f.status] : []);
    const jobs = await q(pool, "SELECT status, COUNT(*) n FROM jobs WHERE type LIKE 'email.%' GROUP BY status"); const by: Record<string, number> = {}; for (const j of jobs) by[j.status] = Number(j.n);
    const outbox = await outboxStats(pool);
    const last = (await q(pool, "SELECT status, created_at createdAt FROM email_log ORDER BY id DESC LIMIT 1"))[0] ?? null;
    return { configured: !!mail().configured, host: (mail() as any).host ?? null, port: (mail() as any).port ?? null, tls: (mail() as any).tls ?? null, from: (mail() as any).from ?? null, origin: ctx.cfg.origin ?? null,
      queue: { pending: by.pending ?? 0, running: by.running ?? 0, dead: by.dead ?? 0 }, outbox,
      lastResult: last, log };
  });
  // Put dead events back in the queue (after the cause, usually mail settings, is fixed). Never touches events that were already processed.
  app.post('/platform/email/outbox/retry', { preHandler: adminLevel }, async (req: any) => {
    const n = await retryDead(pool);
    await audit(pool, { actorId: me(req).id, action: 'email.outbox_retry', entity: 'email', detail: { events: n }, ip: req.ip }); return { retried: n };
  });
  app.post('/platform/email/test', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ to: z.string().trim().toLowerCase().email().max(190) }), req.body);
    if (!mail().configured && ctx.cfg.production) throw new HttpError(409, 'Outgoing email is not configured on this server (set SMTP_HOST and MAIL_FROM)', 'email_not_configured');
    if (!ctx.limiter.allow(`mailtest:${me(req).id}`, 10, 3600_000)) throw new HttpError(429, 'Too many test messages. Please try again later.', 'rate_limited');
    await enqueue(pool, { type: 'email.test', payload: { to: b.to }, maxAttempts: 3 });
    await audit(pool, { actorId: me(req).id, action: 'email.test_requested', entity: 'email', detail: { to: b.to }, ip: req.ip }); return { ok: true };
  });
}
