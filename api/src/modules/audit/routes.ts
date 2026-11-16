import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { forbidden } from '../../platform/errors'; import { queryAudit, distinctActions } from './data';
const Filter = z.object({ actorId: z.string().uuid().optional(), action: z.string().max(80).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), beforeId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(200).optional() });
export function registerAudit(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  app.get('/platform/audit', { preHandler: ctx.withSession() }, async (req: any) => {
    if (!isAdminLevel(ctx.U(req))) throw forbidden(); const f = ctx.parse(Filter, req.query);
    return { ...(await queryAudit(ctx.pool, f)), actions: await distinctActions(ctx.pool) };
  });
  app.get('/t/:tenantId/audit', { preHandler: tenantCtx }, async (req: any) => {
    if (!(req.access.manage || req.access.role === 'tp_auditor')) throw forbidden(); const f = ctx.parse(Filter, req.query);
    return { ...(await queryAudit(ctx.pool, { ...f, tenantId: req.tenantId })), actions: await distinctActions(ctx.pool, req.tenantId) };
  });
}
