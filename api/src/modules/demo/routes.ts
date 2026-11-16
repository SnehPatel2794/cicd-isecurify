// Demo organizations (Phase 13C): flag status and the permanent wipe. Only an organization marked demo when it was created can ever be wiped.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { verifyPassword } from '../../platform/crypto'; import { HttpError, forbidden, notFound, conflict, bad } from '../../platform/errors';
import * as d from './data';

export function registerDemo(app: FastifyInstance, ctx: Ctx, opts: { purgePool?: any; storage: { remove(key: string): Promise<void> } }) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const superAdmin = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole !== 'super_admin') throw forbidden('Only the Super Admin can wipe a demo organization'); };
  app.get('/platform/demo', { preHandler: async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); } }, async (req: any) => ({ wipeConfigured: !!opts.purgePool, canWipe: me(req).platformRole === 'super_admin' }));
  app.post('/platform/organizations/:id/wipe', { preHandler: superAdmin }, async (req: any) => {
    const b = ctx.parse(z.object({ confirmName: z.string().min(1).max(190), password: z.string().min(1).max(200), removePeople: z.boolean().default(true) }), req.body);
    if (!opts.purgePool) throw new HttpError(503, 'The wipe is not set up on this server. Set PURGE_DB_PASSWORD in .env and re-run the database setup (docs/DEMO_DATA.md).', 'not_configured');
    const o = await d.orgOf(pool, req.params.id); if (!o) throw notFound();
    if (!o.isDemo) throw conflict('Only an organization that was created as a demo organization can be wiped. This one is a real organization and cannot be wiped from the application.');
    const hash = await d.passwordHashOf(pool, me(req).id); if (!hash || !(await verifyPassword(hash, b.password))) throw forbidden('Your password is incorrect');
    if (b.confirmName !== o.name) throw bad('Type the organization name exactly to confirm');
    const rows: Record<string, number> = {}; let keys: string[] = []; let people = 0; let peopleKept = 0; const p = opts.purgePool;
    const c = await p.getConnection();
    try {
      await c.beginTransaction();
      try {
        const locked = await d.lockForWipe(c, o.id); if (!locked || !locked.isDemo) throw conflict('Only a demo organization can be wiped');
        await d.markWiping(c, o.id); keys = await d.storageKeys(c, o.id); const candidates = b.removePeople ? await d.peopleOnlyHere(c, o.id) : [];
        const tables = await d.tenantTables(c); await d.setForeignKeyChecks(c, false);
        await d.deleteDependents(c, o.id);
        for (let pass = 0; pass < 3; pass++) { let any = 0; for (const t of tables) { const n = await d.deleteFrom(c, t, o.id); if (n) { rows[t] = (rows[t] ?? 0) + n; any += n; } } if (!any) break; }   // a second pass clears rows the delete triggers re-created
        for (const t of tables) { if (await d.remaining(c, t, o.id)) throw new HttpError(500, `The wipe could not remove every row of ${t}; nothing was changed`); }
        await d.setForeignKeyChecks(c, true);
        for (const u of candidates) { try { await d.deletePerson(c, u); people++; } catch { peopleKept++; } }
        await d.deleteOrg(c, o.id);
        await d.writeAudit(c, me(req).id, { id: o.id, name: o.name, rows, files: keys.length, peopleRemoved: people, peopleKept }, req.ip);
        await c.commit();
      } catch (e) { await c.rollback(); throw e; }
    } finally { try { await d.setForeignKeyChecks(c, true); } catch { /* connection already gone */ } c.release(); }
    let removed = 0; const failed: string[] = []; for (const k of keys) { try { await opts.storage.remove(k); removed++; } catch { failed.push(k); } }
    return { ok: true, rows, rowsTotal: Object.values(rows).reduce((a, n) => a + n, 0), filesRemoved: removed, filesFailed: failed.length, peopleRemoved: people, peopleKept };
  });
}
