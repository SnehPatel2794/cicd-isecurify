// Dashboard tiles (one endpoint each) and the org-wide checklist item list they drill into (Phase 10H). Read-only.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify'; import type { Ctx } from '../../platform/context'; import { forbidden, notFound } from '../../platform/errors';
import { STATES } from '../engagements/evaluation'; import * as s from './service'; import type { Access } from '../spog/service';
const today = () => new Date().toISOString().slice(0, 10); const Uuid = z.string().uuid();
export function registerWidgets(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r); const org = (req: any) => ({ id: req.tenantId as string, name: '' }); const acc = (req: any) => req.access as Access;
  app.get('/t/:tenantId/widgets', { preHandler: tenantCtx }, async (req: any) => ({ widgets: s.TILES.filter(t => t.allowed(acc(req))).map(t => ({ id: t.id, title: t.title, drill: s.drillPath(t, req.tenantId) })) }));
  app.get('/t/:tenantId/widgets/:id', { preHandler: tenantCtx }, async (req: any) => {
    const t = s.tileById(String(req.params.id)); if (!t) throw notFound(); if (!t.allowed(acc(req))) throw forbidden('This tile is not available for your role');
    return s.loadTile(t, { c: pool, org: org(req), user: me(req), access: acc(req), today: today() });
  });
  app.get('/t/:tenantId/items', { preHandler: tenantCtx }, async (req: any) => {
    const p = ctx.parse(z.object({ state: z.enum(STATES).optional(), overdue: z.enum(['true', 'false']).optional(), engagementId: Uuid.optional(), frameworkId: Uuid.optional(), ownerId: Uuid.optional(), q: z.string().trim().max(80).optional(), engagementStatus: z.enum(['active', 'all']).default('active'),
      page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }), req.query ?? {});
    const all = await s.itemList(pool, org(req), me(req), acc(req), { state: p.state, overdue: p.overdue === 'true', engagementId: p.engagementId, frameworkId: p.frameworkId, ownerId: p.ownerId, q: p.q && p.q.length >= 2 ? p.q : undefined, engagementStatus: p.engagementStatus }, today());
    return { today: today(), total: all.length, page: p.page, pageSize: p.pageSize, items: all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize) };
  });
}
