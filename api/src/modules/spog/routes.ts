// Search, My Work and the activity timeline (Phase 10G). Read-only. See docs/SPOG.md.
//   GET /t/:tenantId/search     GET /me/search      (text search; the second one covers every organization the caller can enter)
//   GET /t/:tenantId/my-work    GET /me/work
//   GET /t/:tenantId/timeline
import { z } from 'zod'; import type { FastifyInstance } from 'fastify'; import type { Ctx } from '../../platform/context'; import { HttpError } from '../../platform/errors';
import { listAccessibleOrgs, resolveAccess } from '../tenancy/data'; import { cleanTerm, FiltersSchema, SearchSchema, ENTITY_TYPES, MIN_TERM } from './rules'; import * as s from './service';
const today = () => new Date().toISOString().slice(0, 10); const MAX_ORGS = 30;
export function registerSpog(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const limit = (req: any) => { if (!ctx.limiter.allow(`search:${me(req).id}`, 300, 3600_000)) throw new HttpError(429, 'Too many searches. Please try again shortly.', 'rate_limited'); };
  const termOf = (q: unknown) => { const t = cleanTerm(q); if (!t) throw new HttpError(400, `Type at least ${MIN_TERM} characters to search`, 'bad_request'); return t; };
  /** Every organization the caller can enter right now, with their access there (never a guess from the session: resolved per organization). */
  const myOrgs = async (req: any, onlyId?: string) => { const out: { org: s.Org; access: s.Access }[] = [];
    for (const o of (await listAccessibleOrgs(pool, me(req).id)).filter((x: any) => x.status === 'active' && (!onlyId || x.id === onlyId)).slice(0, MAX_ORGS)) { const a = await resolveAccess(pool, me(req).id, o.id); if (a && a.orgStatus === 'active') out.push({ org: { id: o.id, name: o.name }, access: a as any }); } return out; };

  app.get('/t/:tenantId/search', { preHandler: tenantCtx }, async (req: any) => {
    const p = ctx.parse(SearchSchema, req.query ?? {}); const term = termOf(p.q); limit(req);
    const raw = await s.searchOrg(pool, { id: req.tenantId, name: '' }, me(req), req.access, term, p, { type: p.type, limit: p.limit }); return { q: term, groups: s.arrange(raw, p.limit, p.type) };
  });
  app.get('/me/search', { preHandler: ctx.withSession() }, async (req: any) => {
    const p = ctx.parse(SearchSchema, req.query ?? {}); const term = termOf(p.q); limit(req); const raw: s.Result[] = [];
    for (const { org, access } of await myOrgs(req, p.orgId)) raw.push(...await s.searchOrg(pool, org, me(req), access, term, p, { type: p.type, limit: p.limit }));
    return { q: term, groups: s.arrange(raw, p.limit, p.type) };
  });
  app.get('/t/:tenantId/my-work', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(FiltersSchema, req.query ?? {}); const sections = await s.workOrg(pool, { id: req.tenantId, name: '' }, me(req), req.access, f, today());
    return { today: today(), total: sections.reduce((n, x) => n + x.entries.length, 0), sections };
  });
  app.get('/me/work', { preHandler: ctx.withSession() }, async (req: any) => {
    const f = ctx.parse(FiltersSchema, req.query ?? {}); const t = today(); const orgs: any[] = [];
    for (const { org, access } of await myOrgs(req, f.orgId)) { const sections = await s.workOrg(pool, org, me(req), access, f, t); const total = sections.reduce((n, x) => n + x.entries.length, 0); if (total) orgs.push({ id: org.id, name: org.name, total, sections }); }
    return { today: t, total: orgs.reduce((n, o) => n + o.total, 0), organizations: orgs };
  });
  app.get('/t/:tenantId/timeline', { preHandler: tenantCtx }, async (req: any) => {
    const p = ctx.parse(FiltersSchema.extend({ beforeId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).default(30), entity: z.enum(ENTITY_TYPES).optional() }), req.query ?? {});
    const r = await s.timelineOrg(pool, { id: req.tenantId, name: '' }, me(req), req.access, p, { beforeId: p.beforeId, limit: p.limit, entity: p.entity }); return { scope: s.sees(req.access) ? 'organization' : 'mine', ...r };
  });
}
