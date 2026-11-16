// Getting-started checklist for the current person in this organization (read only; dismissing it is a per-browser convenience).
import type { FastifyInstance } from 'fastify'; import type { Ctx } from '../../platform/context';
import { countMembers } from '../tenancy/data'; import { listEngagements } from '../engagements/data'; import { listRisks } from '../risks/data'; import { listPolicies, versionSummaries, ackCounts } from '../policies/data'; import { appliesTo } from '../policies/rules';
import { stepsFor, progress, kindOf } from './rules';
export function registerOnboarding(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx;
  app.get('/t/:tenantId/onboarding', { preHandler: tenantCtx }, async (req: any) => {
    const w = { via: req.access.via, role: req.access.role, manage: !!req.access.manage }; const kind = kindOf(w); const t = req.tenantId; const me = ctx.U(req).id;
    const [members, engagements, risks, policies] = await Promise.all([countMembers(pool, t), listEngagements(pool, t, { kind: 'all' } as any), kind === 'manager' ? listRisks(pool, t) : Promise.resolve([]), listPolicies(pool, t)]);
    const vs = await versionSummaries(pool, t), acks = await ackCounts(pool, t); const live = (id: string) => vs.find((v: any) => v.policyId === id && v.status === 'published');
    const pendingAcks = policies.filter((p: any) => !p.archivedAt && live(p.id) && appliesTo(w, p.audience) && !acks.some((a: any) => a.versionId === live(p.id).id && a.userId === me)).length;
    const steps = stepsFor(w, { members, engagements: engagements.length, livePolicies: policies.filter((p: any) => !p.archivedAt && live(p.id)).length, risks: risks.length, pendingAcks }, t);
    return { steps, ...progress(steps) };
  });
}
