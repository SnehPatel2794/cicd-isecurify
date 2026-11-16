// Saved filter views: personal shortcuts to a filtered list (risks, incidents, findings). Nobody sees anyone else's views.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, notFound } from '../../platform/errors';
import * as v from './data'; import { PAGES, MAX_VIEWS, cleanFilters } from './rules';
export function registerViews(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (q: any) => ctx.U(q);
  app.get('/t/:tenantId/views', { preHandler: tenantCtx }, async (req: any) => { const { page } = ctx.parse(z.object({ page: z.enum(PAGES) }), req.query ?? {}); const rows = await v.listViews(pool, req.tenantId, me(req).id, page); return { views: rows.map((x: any) => ({ id: x.id, name: x.name, filters: JSON.parse(x.filters) })), max: MAX_VIEWS }; });
  app.post('/t/:tenantId/views', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ page: z.enum(PAGES), name: z.string().trim().min(1).max(60), filters: z.record(z.string(), z.unknown()) }), req.body); const f = cleanFilters(b.page, b.filters); if (!f) throw bad('These filters cannot be saved'); if (!Object.keys(f).length) throw bad('Choose at least one filter first'); const id = uuid();
    await tx(pool, async (c) => { if (await v.countViews(c, req.tenantId, me(req).id, b.page) >= MAX_VIEWS) throw new HttpError(409, `You can keep up to ${MAX_VIEWS} saved views per list`, 'too_many');
      try { await v.insertView(c, req.tenantId, { id, userId: me(req).id, page: b.page, name: b.name, filters: JSON.stringify(f) }); } catch (e: any) { if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'You already have a view with that name', 'duplicate'); throw e; } });
    reply.code(201).send({ id });
  });
  app.delete('/t/:tenantId/views/:id', { preHandler: tenantCtx }, async (req: any) => { const ok = await tx(pool, c => v.deleteView(c, req.tenantId, me(req).id, req.params.id)); if (!ok) throw notFound(); return { ok: true }; });
}
