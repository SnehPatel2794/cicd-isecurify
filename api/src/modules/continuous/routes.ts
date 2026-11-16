// Continuous controls (Phase 11A): recurring control tests, evidence refresh schedules and the compliance-posture trend. All /t/:tenantId/* routes run behind tenantCtx (no access => 404).
// Visibility is the same as everywhere else (scopeOf): client admins and iSecurify staff see everything, TP auditors the engagements they are on (read only), client staff and vendors only their own items.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import * as d from '../engagements/data'; import { scopeOf as scopeOfAccess, writableEngagement } from '../engagements/access'; import * as e from '../evidence/data'; import { notify } from '../notifications/notify';
import { frameworkSummaries, testHealth, emptyHealth, type TestHealth } from '../../../../shared/posture';
import * as c from './data'; import { FREQUENCIES, nextDueAfter, testState, needsAttention, scheduleState, canManage, canRecord, runDateProblem, addDays, addMonthsClamped, changeOver, TREND, type Who, type Frequency } from './rules';
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
const Text = (n: number) => z.string().trim().max(n); const Uuid = z.string().uuid(); const today = () => new Date().toISOString().slice(0, 10);
export function registerContinuous(app: FastifyInstance, ctx: Ctx, tenantCtx: any, deps: { maxRequestsPerItem: number }) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const scopeOf = (req: any) => scopeOfAccess(req.access, me(req).id); const assignedOnly = (req: any) => scopeOf(req).kind === 'assigned' ? me(req).id : undefined;
  const needManage = (req: any) => { if (!canManage(who(req))) throw forbidden('Only client admins and iSecurify team members with manage rights can do this'); };
  const visibleEngagement = async (cn: Conn, req: any, id: string) => { const eng = await d.getVisibleEngagement(cn, req.tenantId, id, scopeOf(req)); if (!eng) throw notFound(); return eng; };
  const visibleIds = async (req: any, engagementId?: string) => { if (engagementId) { await visibleEngagement(pool, req, engagementId); return [engagementId]; } return (await d.listEngagements(pool, req.tenantId, scopeOf(req))).map((x: any) => x.id as string); };
  const candidate = async (cn: Conn, tenantId: string, userId: string | null | undefined) => { if (!userId) return; if (!(await d.assignableUsers(cn, tenantId)).some((u: any) => u.id === userId)) throw bad('The owner must be an active client admin, client staff member or vendor of this organization'); };
  const auditC = (cn: any, req: any, action: string, engagementId: string, detail: Record<string, unknown>) => audit(cn, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'engagement', entityId: engagementId, detail: { engagementId, ...detail }, ip: req.ip });
  const present = (t: any, td: string) => { const state = testState(t, td); return { ...t, state, attention: needsAttention(state) }; };
  const itemOf = async (req: any, itemId: string) => { const it = await d.getItem(pool, req.tenantId, itemId); if (!it) throw notFound(); await visibleEngagement(pool, req, it.engagementId); return it; };

  // ================= control tests =================
  app.get('/t/:tenantId/control-tests', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ engagementId: Uuid.optional(), itemId: Uuid.optional(), state: z.enum(['failing', 'overdue', 'due_soon', 'ok', 'paused', 'attention']).optional(), mine: z.enum(['true', 'false']).optional() }), req.query ?? {});
    const ids = await visibleIds(req, f.engagementId); const td = today(); const rows = await c.listTests(pool, req.tenantId, { engagementIds: ids, itemId: f.itemId, assignedUserId: assignedOnly(req) ?? (f.mine === 'true' ? me(req).id : undefined) });
    const tests = rows.map((t: any) => present(t, td)).filter((t: any) => !f.state || (f.state === 'attention' ? t.attention : t.state === f.state));
    return { today: td, total: tests.length, tests };
  });
  app.post('/t/:tenantId/checklist/:itemId/control-tests', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ title: Text(300).min(1), procedure: Text(5000).nullish(), frequency: z.enum(FREQUENCIES), ownerUserId: Uuid.nullish(), firstDueOn: DateStr.optional() }), req.body);
    const it = await itemOf(req, req.params.itemId); const id = uuid(); const td = today();
    if (b.firstDueOn && b.firstDueOn < addDays(td, -366)) throw bad('The first due date cannot be more than a year in the past');
    if (!ctx.limiter.allow(`ctest:${me(req).id}`, 120, 3600_000)) throw new HttpError(429, 'Too many tests created. Please try again later.', 'rate_limited');
    await tx(pool, async (cn) => {
      const [item] = await d.lockItems(cn, req.tenantId, it.engagementId, [it.id]); if (!item) throw notFound(); await writableEngagement(cn, req.tenantId, it.engagementId);
      if (item.readiness === 'not_applicable') throw conflict('A control that is not applicable cannot have recurring tests'); if ((await c.countTestsOnItem(cn, req.tenantId, it.id)) >= 20) throw conflict('An item can have at most 20 recurring tests');
      await candidate(cn, req.tenantId, b.ownerUserId);
      await c.insertTest(cn, req.tenantId, { id, engagementId: it.engagementId, itemId: it.id, title: b.title, procedure: b.procedure, frequency: b.frequency, ownerUserId: b.ownerUserId, nextDueOn: b.firstDueOn ?? td, createdBy: me(req).id });
      await auditC(cn, req, 'control_test.created', it.engagementId, { testId: id, itemRef: it.ref, title: b.title, frequency: b.frequency });
    });
    reply.code(201).send({ id });
  });
  app.patch('/t/:tenantId/control-tests/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ title: Text(300).min(1), procedure: Text(5000).nullable(), frequency: z.enum(FREQUENCIES), ownerUserId: Uuid.nullable(), nextDueOn: DateStr, status: z.enum(['active', 'paused']) }).partial().refine(x => Object.keys(x).length > 0, 'Nothing to change'), req.body);
    const t0 = await c.getTest(pool, req.tenantId, req.params.id); if (!t0) throw notFound(); await visibleEngagement(pool, req, t0.engagementId);
    await tx(pool, async (cn) => {
      await writableEngagement(cn, req.tenantId, t0.engagementId); const t = await c.getTest(cn, req.tenantId, req.params.id, true); if (!t) throw notFound(); if (b.ownerUserId !== undefined) await candidate(cn, req.tenantId, b.ownerUserId);
      await c.updateTest(cn, req.tenantId, t.id, b); await auditC(cn, req, 'control_test.updated', t.engagementId, { testId: t.id, changed: Object.keys(b) });
    });
    return { ok: true };
  });
  app.get('/t/:tenantId/control-tests/:id/runs', { preHandler: tenantCtx }, async (req: any) => {
    const t = await c.getTest(pool, req.tenantId, req.params.id); if (!t) throw notFound(); await visibleEngagement(pool, req, t.engagementId); if (assignedOnly(req) && t.responsibleUserId !== me(req).id) throw notFound();
    return { test: present(t, today()), runs: await c.listRuns(pool, req.tenantId, t.id) };
  });
  app.post('/t/:tenantId/control-tests/:id/runs', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ result: z.enum(['pass', 'fail']), note: Text(5000).min(1), performedOn: DateStr.optional() }), req.body); const td = today(); const on = b.performedOn ?? td;
    const t0 = await c.getTest(pool, req.tenantId, req.params.id); if (!t0) throw notFound(); await visibleEngagement(pool, req, t0.engagementId); if (assignedOnly(req) && t0.responsibleUserId !== me(req).id) throw notFound();
    if (!canRecord(who(req), me(req).id, t0.ownerUserId, t0.accountableUserId)) throw forbidden('Only the person responsible for this test, a client admin or an iSecurify team member with manage rights can record a result');
    const problem = runDateProblem(on, td); if (problem) throw bad(problem); if (!ctx.limiter.allow(`crun:${me(req).id}`, 240, 3600_000)) throw new HttpError(429, 'Too many results recorded. Please try again later.', 'rate_limited');
    const id = uuid(); let out: any;
    await tx(pool, async (cn) => {
      const eng = await writableEngagement(cn, req.tenantId, t0.engagementId); void eng; const t = await c.getTest(cn, req.tenantId, t0.id, true); if (!t) throw notFound(); if (t.status === 'paused') throw conflict('This test is paused');
      await c.insertRun(cn, req.tenantId, { id, testId: t.id, engagementId: t.engagementId, itemId: t.itemId, performedOn: on, result: b.result, note: b.note, performedBy: me(req).id });
      const latest = (await c.latestRun(cn, req.tenantId, t.id))!; await c.recordResult(cn, req.tenantId, t.id, latest.result, latest.performedOn, nextDueAfter(latest.performedOn, t.frequency as Frequency));
      await auditC(cn, req, 'control_test.run', t.engagementId, { testId: t.id, itemRef: t.itemRef, result: b.result, performedOn: on, runId: id });
      if (b.result === 'fail') await notify(cn, { tenantId: req.tenantId, kind: 'control_test.failed', recipients: [...(await c.clientAdminIds(cn, req.tenantId)), t.accountableUserId, t.ownerUserId], actorId: me(req).id, entityType: 'checklist_item', entityId: t.itemId, engagementId: t.engagementId, label: `${t.itemRef}: test failed - ${t.title}` });
      out = present((await c.getTest(cn, req.tenantId, t.id))!, td);
    });
    reply.code(201).send({ id, test: out });
  });

  // ================= evidence refresh schedules =================
  app.get('/t/:tenantId/evidence-schedules', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ engagementId: Uuid.optional(), itemId: Uuid.optional(), state: z.enum(['due', 'upcoming', 'ok', 'paused']).optional() }), req.query ?? {}); const td = today();
    const rows = await c.listSchedules(pool, req.tenantId, { engagementIds: await visibleIds(req, f.engagementId), itemId: f.itemId, assignedUserId: assignedOnly(req) });
    const schedules = rows.map((s: any) => ({ ...s, state: scheduleState(s, td) })).filter((s: any) => !f.state || s.state === f.state); return { today: td, total: schedules.length, schedules };
  });
  const SchedBody = z.object({ title: Text(300).min(1), instructions: Text(5000).nullish(), templateId: Uuid.nullish(), validMonths: z.number().int().min(1).max(120).nullish(), everyMonths: z.number().int().min(1).max(36), dueDays: z.number().int().min(1).max(90).default(14), nextRunOn: DateStr.optional() });
  app.post('/t/:tenantId/checklist/:itemId/evidence-schedules', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(SchedBody, req.body); const it = await itemOf(req, req.params.itemId); const id = uuid(); const td = today();
    await tx(pool, async (cn) => {
      const [item] = await d.lockItems(cn, req.tenantId, it.engagementId, [it.id]); if (!item) throw notFound(); await writableEngagement(cn, req.tenantId, it.engagementId);
      if (item.readiness === 'not_applicable') throw conflict('A control that is not applicable cannot have an evidence schedule'); if (b.templateId && !(await c.activeTemplate(cn, b.templateId))) throw bad('That template does not exist or is retired');
      await c.insertSchedule(cn, req.tenantId, { id, engagementId: it.engagementId, itemId: it.id, title: b.title, instructions: b.instructions, templateId: b.templateId, validMonths: b.validMonths, everyMonths: b.everyMonths, dueDays: b.dueDays, nextRunOn: b.nextRunOn ?? addMonthsClamped(td, b.everyMonths), createdBy: me(req).id });
      await auditC(cn, req, 'evidence_schedule.created', it.engagementId, { scheduleId: id, itemRef: it.ref, title: b.title, everyMonths: b.everyMonths });
    });
    reply.code(201).send({ id });
  });
  app.patch('/t/:tenantId/evidence-schedules/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(SchedBody.partial().extend({ status: z.enum(['active', 'paused']).optional() }).refine(x => Object.keys(x).length > 0, 'Nothing to change'), req.body);
    const s0 = await c.getSchedule(pool, req.tenantId, req.params.id); if (!s0) throw notFound(); await visibleEngagement(pool, req, s0.engagementId);
    await tx(pool, async (cn) => {
      await writableEngagement(cn, req.tenantId, s0.engagementId); const s = await c.getSchedule(cn, req.tenantId, s0.id, true); if (!s) throw notFound(); if (b.templateId && !(await c.activeTemplate(cn, b.templateId))) throw bad('That template does not exist or is retired');
      await c.updateSchedule(cn, req.tenantId, s.id, b); await auditC(cn, req, 'evidence_schedule.updated', s.engagementId, { scheduleId: s.id, changed: Object.keys(b) });
    });
    return { ok: true };
  });
  app.delete('/t/:tenantId/evidence-schedules/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const s0 = await c.getSchedule(pool, req.tenantId, req.params.id); if (!s0) throw notFound(); await visibleEngagement(pool, req, s0.engagementId);
    await tx(pool, async (cn) => { await writableEngagement(cn, req.tenantId, s0.engagementId); await c.deleteSchedule(cn, req.tenantId, s0.id); await auditC(cn, req, 'evidence_schedule.deleted', s0.engagementId, { scheduleId: s0.id, title: s0.title }); });
    return { ok: true };
  });
  /** Opens the request a schedule describes (the same rules as asking for evidence by hand) and moves the schedule on by its period. */
  async function openOne(req: any, scheduleId: string): Promise<string> {
    const td = today(); let requestId = '';
    await tx(pool, async (cn) => {
      const s0 = await c.getSchedule(cn, req.tenantId, scheduleId); if (!s0) throw notFound(); const [item] = await d.lockItems(cn, req.tenantId, s0.engagementId, [s0.itemId]); if (!item) throw notFound(); await writableEngagement(cn, req.tenantId, s0.engagementId);
      const s = await c.getSchedule(cn, req.tenantId, scheduleId, true); if (!s) throw notFound(); if (s.status === 'paused') throw conflict('This schedule is paused');
      if (item.readiness === 'not_applicable') throw conflict('Evidence cannot be requested for an item that is not applicable'); if ((await e.countActiveRequests(cn, req.tenantId, s.itemId)) >= deps.maxRequestsPerItem) throw conflict(`An item can have at most ${deps.maxRequestsPerItem} open evidence requests`);
      if (s.templateId && !(await c.activeTemplate(cn, s.templateId))) throw conflict('The template of this schedule has been retired');
      requestId = uuid(); await e.insertRequests(cn, req.tenantId, s.engagementId, [{ id: requestId, itemId: s.itemId, title: s.title, instructions: s.instructions, templateId: s.templateId, dueDate: addDays(td, s.dueDays), validMonths: s.validMonths, requestedBy: me(req).id }]);
      await e.recomputeItemEvidence(cn, req.tenantId, s.itemId); await c.markOpened(cn, req.tenantId, s.id, requestId, td, addMonthsClamped(td, s.everyMonths));
      await auditC(cn, req, 'evidence.requested', s.engagementId, { requestId, itemId: s.itemId, itemRef: s.itemRef, title: s.title, scheduleId: s.id });
      await notify(cn, { tenantId: req.tenantId, kind: 'evidence.requested', recipients: [s.accountableUserId], actorId: me(req).id, entityType: 'evidence_request', entityId: requestId, engagementId: s.engagementId, label: `${s.itemRef}: ${s.title}` });
    });
    return requestId;
  }
  app.post('/t/:tenantId/evidence-schedules/:id/open', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const s = await c.getSchedule(pool, req.tenantId, req.params.id); if (!s) throw notFound(); await visibleEngagement(pool, req, s.engagementId); reply.code(201).send({ requestId: await openOne(req, s.id) });
  });
  app.post('/t/:tenantId/engagements/:id/evidence-schedules/open-due', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); await visibleEngagement(pool, req, req.params.id); const td = today(); const due = (await c.listSchedules(pool, req.tenantId, { engagementIds: [req.params.id] })).filter((s: any) => scheduleState(s, td) === 'due');
    const opened: string[] = [], skipped: { scheduleId: string; title: string; reason: string }[] = [];
    for (const s of due) { try { await openOne(req, s.id); opened.push(s.id); } catch (err: any) { if (err instanceof HttpError && err.status < 500) skipped.push({ scheduleId: s.id, title: s.title, reason: err.message }); else throw err; } }
    return { opened: opened.length, skipped };
  });

  // ================= posture =================
  app.get('/t/:tenantId/posture', { preHandler: tenantCtx }, async (req: any) => {
    if (scopeOf(req).kind === 'assigned') throw forbidden('The posture overview is for client admins, auditors and iSecurify staff');
    const f = ctx.parse(z.object({ engagementId: Uuid.optional(), days: z.coerce.number().int().min(7).max(730).default(90) }), req.query ?? {}); const td = today(); const query = (sql: string, p?: any[]) => q(pool, sql, p);
    const all = await d.listEngagements(pool, req.tenantId, scopeOf(req)); const chosen = f.engagementId ? all.filter((x: any) => x.id === f.engagementId) : all.filter((x: any) => x.status === 'active').slice(0, 50); if (f.engagementId && !chosen.length) throw notFound();
    const ids = chosen.map((x: any) => x.id as string); const [fws, live, health, snaps] = await Promise.all([c.frameworksOf(pool, req.tenantId, ids), frameworkSummaries(query, req.tenantId, ids, td), testHealth(query, req.tenantId, ids, td), c.snapshots(pool, req.tenantId, ids, addDays(td, -f.days))]);
    const liveBy = new Map(live.map(x => [`${x.engagementId}|${x.frameworkId}`, x.summary])); let total: TestHealth = emptyHealth();
    const engagements = chosen.map((en: any) => {
      const h = health.get(en.id) ?? emptyHealth(); total = { total: total.total + h.total, overdue: total.overdue + h.overdue, failing: total.failing + h.failing, dueSoon: total.dueSoon + h.dueSoon };
      const frameworks = fws.filter((x: any) => x.engagementId === en.id).map((fw: any) => {
        const s = liveBy.get(`${en.id}|${fw.frameworkId}`); const series = snaps.filter((p: any) => p.engagementId === en.id && p.frameworkId === fw.frameworkId).map((p: any) => ({ date: p.date, percent: Number(p.percent), effective: p.effective, applicable: p.applicable }));
        const current = s ? { percent: s.readinessPercent, effective: s.effective, applicable: s.applicable, awaitingReview: s.awaitingReview, overdue: s.overdue } : { percent: 0, effective: 0, applicable: 0, awaitingReview: 0, overdue: 0 };
        const merged = [...series.filter((p: any) => p.date !== td), { date: td, percent: current.percent, effective: current.effective, applicable: current.applicable }]; const change30 = changeOver(merged, 30);
        return { frameworkId: fw.frameworkId, name: fw.name, color: fw.color, version: fw.version, isPrimary: !!fw.isPrimary, current, series: merged, change30, trend: TREND(change30) };
      });
      return { id: en.id, name: en.name, status: en.status, frameworks, tests: h };
    });
    return { today: td, days: f.days, engagements, tests: total };
  });
}
