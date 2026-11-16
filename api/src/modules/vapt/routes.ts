// VAPT rounds (Phase 11D): two or three penetration-test rounds inside the one-year engagement, each with a plan, a report reference, a retest and its own findings.
// The report file itself is attached as ordinary evidence; the round records its title and reference.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, forbidden, notFound, conflict, bad } from '../../platform/errors';
import * as d from '../engagements/data'; import { scopeOf } from '../engagements/access'; import * as f from '../findings/data'; import * as v from './data';
import { STATUSES, STATUS_LABEL, MAX_ROUNDS, nextStatuses, transitionCheck, compare, trend, type RStatus } from './rules';
const today = () => new Date().toISOString().slice(0, 10); const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31'); const Text = (n: number) => z.string().trim().max(n);

export function registerVapt(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r); const isStaffManager = (req: any) => req.access.via === 'staff' && !!req.access.manage;
  const reviewer = (req: any) => { if (!(req.access.via === 'staff' || req.access.role === 'client_admin' || req.access.role === 'tp_auditor')) throw forbidden(); };
  const visible = async (req: any, id: string) => { const e = await d.getVisibleEngagement(pool, req.tenantId, id, scopeOf(req.access, me(req).id)); if (!e) throw notFound(); return e; };
  /** Staff managers and the engagement's own third-party auditor run the rounds. */
  const canRun = async (req: any, engagementId: string) => { if (isStaffManager(req)) return true; if (req.access.role !== 'tp_auditor') return false; const m = await d.getEngagementMember(pool, req.tenantId, engagementId, me(req).id); return !!m && m.role === 'auditor'; };
  const mustRun = async (req: any, engagementId: string) => { if (!(await canRun(req, engagementId))) throw forbidden('Only iSecurify managers and the engagement\'s third-party auditor can change VAPT rounds'); };
  const active = async (c: any, tenantId: string, engagementId: string) => { const e = await d.getEngagement(c, tenantId, engagementId, true); if (!e) throw notFound(); if (e.status !== 'active') throw new HttpError(409, 'This engagement is closed', 'engagement_closed'); return e; };
  const shape = (r: any) => ({ ...r, statusLabel: STATUS_LABEL[r.status as RStatus], next: nextStatuses(r.status).map(s => ({ status: s, label: STATUS_LABEL[s] })) });
  const log = (c: any, req: any, action: string, engagementId: string, detail: any) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'vapt_round', entityId: detail.roundId, detail: { engagementId, ...detail }, ip: req.ip });

  app.get('/t/:tenantId/engagements/:id/vapt', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const e = await visible(req, req.params.id); const rounds = await v.list(pool, req.tenantId, e.id);
    const cmp = compare(rounds.map((r: any) => ({ id: r.id, roundNo: r.roundNo, title: r.title, status: r.status, startOn: r.startedOn ?? r.plannedOn })), await f.forCompare(pool, req.tenantId, e.id));
    return { engagementId: e.id, engagementStatus: e.status, rounds: rounds.map(shape), comparison: cmp, trend: trend(cmp), max: MAX_ROUNDS, can: { manage: e.status === 'active' && await canRun(req, e.id) } };
  });
  app.get('/t/:tenantId/vapt-rounds/:rid', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const r = await v.get(pool, req.tenantId, req.params.rid); if (!r) throw notFound(); const e = await visible(req, r.engagementId);
    return { ...shape(r), engagementName: e.name, engagementStatus: e.status, can: { manage: e.status === 'active' && await canRun(req, e.id) }, findings: await f.roundFindings(pool, req.tenantId, r.id) };
  });
  app.post('/t/:tenantId/engagements/:id/vapt-rounds', { preHandler: tenantCtx }, async (req: any, reply) => {
    reviewer(req); const e = await visible(req, req.params.id); await mustRun(req, e.id);
    const b = ctx.parse(z.object({ title: Text(190).min(1), scope: Text(4000).nullish(), tester: Text(190).nullish(), plannedOn: DateStr }), req.body); const id = uuid(); let no = 0;
    await tx(pool, async (c) => { await active(c, req.tenantId, e.id); if ((await v.liveCount(c, req.tenantId, e.id)) >= MAX_ROUNDS) throw conflict(`An engagement can have at most ${MAX_ROUNDS} VAPT rounds`);
      no = await v.nextNo(c, req.tenantId, e.id); await v.insert(c, req.tenantId, { id, engagementId: e.id, no, title: b.title, scope: b.scope || null, tester: b.tester || null, plannedOn: b.plannedOn, createdBy: me(req).id });
      await log(c, req, 'vapt.round_created', e.id, { roundId: id, roundNo: no, title: b.title, plannedOn: b.plannedOn }); });
    reply.code(201).send({ id, roundNo: no });
  });
  const Patch = z.object({ title: Text(190).min(1).optional(), scope: Text(4000).nullable().optional(), tester: Text(190).nullable().optional(), plannedOn: DateStr.optional(), reportTitle: Text(300).nullable().optional(), reportRef: Text(190).nullable().optional(), reportIssuedOn: DateStr.nullable().optional(), retestPlannedOn: DateStr.nullable().optional(), retestedOn: DateStr.nullable().optional() });
  app.patch('/t/:tenantId/vapt-rounds/:rid', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const r0 = await v.get(pool, req.tenantId, req.params.rid); if (!r0) throw notFound(); const e = await visible(req, r0.engagementId); await mustRun(req, e.id); const b = ctx.parse(Patch, req.body);
    await tx(pool, async (c) => { await active(c, req.tenantId, e.id); const r = await v.get(c, req.tenantId, r0.id, true); if (r.status === 'closed' || r.status === 'cancelled') throw conflict('A closed or cancelled round cannot be edited');
      if (b.reportTitle === null && ['report_issued', 'retesting'].includes(r.status)) throw bad('The report title cannot be removed once the report is issued'); if (b.reportIssuedOn === null && ['report_issued', 'retesting'].includes(r.status)) throw bad('The report date cannot be removed once the report is issued');
      await v.update(c, req.tenantId, r.id, b); await log(c, req, 'vapt.round_updated', e.id, { roundId: r.id, fields: Object.keys(b) }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/vapt-rounds/:rid/transition', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const r0 = await v.get(pool, req.tenantId, req.params.rid); if (!r0) throw notFound(); const e = await visible(req, r0.engagementId); await mustRun(req, e.id);
    const b = ctx.parse(z.object({ to: z.enum(STATUSES), reportTitle: Text(300).min(1).optional(), reportRef: Text(190).nullish(), date: DateStr.optional(), note: Text(2000).nullish() }), req.body); let from = '';
    await tx(pool, async (c) => { await active(c, req.tenantId, e.id); const r = await v.get(c, req.tenantId, r0.id, true); from = r.status; const patch: Record<string, unknown> = {}; const on = b.date ?? today();
      if (b.to === 'in_progress') patch.startedOn = on; if (b.to === 'report_issued') { patch.reportIssuedOn = on; if (b.reportTitle) patch.reportTitle = b.reportTitle; if (b.reportRef) patch.reportRef = b.reportRef; } if (b.to === 'retesting') patch.retestPlannedOn = r.retestPlannedOn ?? on; if (b.to === 'closed' && r.status === 'retesting') patch.retestedOn = on;
      const reason = transitionCheck({ status: r.status, reportTitle: (patch.reportTitle as string) ?? r.reportTitle }, b.to, b.to === 'closed' ? await f.roundSerious(c, req.tenantId, r.id) : 0); if (reason) throw new HttpError(409, reason, 'round_transition');
      await v.update(c, req.tenantId, r.id, patch); await v.setStatus(c, req.tenantId, r.id, b.to); await log(c, req, 'vapt.round_status', e.id, { roundId: r.id, roundNo: r.roundNo, from: r.status, to: b.to, note: b.note ?? null }); });
    return { ok: true, from, to: b.to };
  });
  app.put('/t/:tenantId/vapt-rounds/:rid/findings', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const r0 = await v.get(pool, req.tenantId, req.params.rid); if (!r0) throw notFound(); const e = await visible(req, r0.engagementId); await mustRun(req, e.id);
    const b = ctx.parse(z.object({ findingIds: z.array(z.string().uuid()).min(1).max(500), untag: z.boolean().default(false) }), req.body); let n = 0;
    await tx(pool, async (c) => { await active(c, req.tenantId, e.id); const r = await v.get(c, req.tenantId, r0.id, true); if (r.status === 'cancelled' || (r.status === 'closed' && !b.untag)) throw conflict('Findings cannot be added to a closed or cancelled round');
      const ids = [...new Set(b.findingIds)]; if ((await f.countFor(c, req.tenantId, e.id, ids)) !== ids.length) throw bad('Some of these findings do not belong to this engagement');
      n = await f.setRound(c, req.tenantId, e.id, ids, b.untag ? null : r.id); await log(c, req, b.untag ? 'vapt.findings_untagged' : 'vapt.findings_tagged', e.id, { roundId: r.id, roundNo: r.roundNo, count: n }); });
    return { updated: n };
  });
}
export { v as vaptData };
