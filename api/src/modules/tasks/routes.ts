// Tasks (Phase 13B): delivery work inside an engagement, with an assignee, due date, status, dependencies and comments.
// iSecurify staff and client administrators create and assign; the assignee updates the status and comments; the auditor reads. Templates and spreadsheet import load a whole plan at once.
import { z } from 'zod'; import { createHash } from 'node:crypto'; import type { FastifyInstance } from 'fastify'; import writeXlsxFile from 'write-excel-file/node';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context'; import { audit } from '../../platform/audit'; import { HttpError, forbidden, notFound, conflict, bad } from '../../platform/errors';
import { notify } from '../notifications/notify'; import { MAX_IMPORT_BYTES } from '../frameworks/importer'; import { resolveAccess } from '../tenancy/data';
import * as d from '../engagements/data'; import { scopeOf, writableEngagement } from '../engagements/access'; import * as td from './data';
import { STATUSES, PRIORITIES, STATUS_LABEL, PHASE_NAMES, MAX_TASKS, MAX_PER_ENGAGEMENT, parseTasks, schedule, wouldLoop, seesAll, canManage, canPlan, canWork, isOpen, isoDay, taskRef } from './rules';
const Text = (n: number) => z.string().trim().max(n); const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const HEAD = ['Ref', 'Stage', 'Phase', 'Task', 'What it is', 'How it is done', 'Responsible', 'Days', 'Depends on', 'Also depends on', 'Priority'];
const EX = [['T-1', 'Kick-off', 'Preparation', 'Example: hold the kick-off meeting', 'Confirm scope, owners and timeline', 'Walk through the plan', 'Engagement lead', '1', '', '', 'high'], ['T-2', 'Kick-off', 'Preparation', 'Example: Techify answers the questionnaire', 'Organization, scope, sites, people, tools', 'Questionnaire tab', 'ISMS manager', '5', 'T-1', '', 'normal'], ['T-3', 'Kick-off', 'Preparation', 'Example: milestone, questionnaire accepted', '', '', 'Engagement lead', '0', 'T-2', '', 'normal']];
const csvCell = (c: unknown) => { let s = String(c ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const today = () => isoDay(new Date());

export function registerTasks(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  /** The engagement, if the caller may reach it at all. Client staff and vendors reach it only to work on tasks assigned to them. */
  const engagementOf = async (req: any, id: string) => { const e = seesAll(req.access) ? await d.getVisibleEngagement(pool, req.tenantId, id, scopeOf(req.access, me(req).id)) : await d.getEngagement(pool, req.tenantId, id); if (!e) throw notFound(); return e; };
  const needManage = (req: any) => { if (!canManage(req.access)) throw forbidden('Only iSecurify staff and client administrators manage tasks'); };
  const needPlan = (req: any) => { if (!canPlan(req.access)) throw forbidden('Only iSecurify team members assigned to this organization can do this'); };
  const log = (c: any, req: any, action: string, engagementId: string, detail: any) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'engagement', entityId: engagementId, detail: { engagementId, ...detail }, ip: req.ip });
  /** Anyone who works in the organization (client members and assigned iSecurify staff) except the third-party auditor. */
  async function checkAssignee(c: any, tenantId: string, userId: string) { const a = await resolveAccess(c, userId, tenantId); if (!a || a.orgStatus !== 'active' || a.role === 'tp_auditor') throw bad('The assignee must be an active member of this organization or an iSecurify team member assigned to it'); }
  const shape = (t: any, extra: any = {}) => ({ ...t, statusLabel: STATUS_LABEL[t.status as keyof typeof STATUS_LABEL], phaseName: t.phase ? PHASE_NAMES[t.phase - 1] : null, overdue: !!t.dueDate && isOpen(t.status) && t.dueDate < today(), ...extra });
  const taskOf = async (req: any, c: any = pool) => { const t = await td.get(c, req.tenantId, req.params.taskId); if (!t) throw notFound(); const e = await engagementOf(req, t.engagementId); if (!seesAll(req.access) && t.assigneeId !== me(req).id) throw notFound(); return { t, e }; };
  const assigned = (c: any, req: any, t: any, userId: string | null | undefined) => userId && userId !== me(req).id ? notify(c, { tenantId: req.tenantId, kind: 'task.assigned', recipients: [userId], actorId: me(req).id, entityType: 'engagement', entityId: t.engagementId, engagementId: t.engagementId, label: `${taskRef(t.taskNo)} ${t.title}`.slice(0, 300) }) : Promise.resolve(0);

  // ---------------- engagement side ----------------
  app.get('/t/:tenantId/engagements/:id/tasks', { preHandler: tenantCtx }, async (req: any) => {
    const e = await engagementOf(req, req.params.id); const all = seesAll(req.access); const rows = await td.list(pool, req.tenantId, e.id, all ? {} : { assigneeId: me(req).id }); const names = new Map(rows.map((r: any) => [r.id, r]));
    return { engagementId: e.id, engagementStatus: e.status, scope: all ? 'all' : 'mine', tasks: rows.map((r: any) => shape(r, { waitingOn: r.depIds.filter((x: string) => names.has(x) && isOpen(names.get(x).status)).length })), counts: await td.counts(pool, req.tenantId, e.id, today()),
      can: { manage: e.status === 'active' && canManage(req.access), plan: e.status === 'active' && canPlan(req.access) }, statuses: STATUSES.map(s => ({ status: s, label: STATUS_LABEL[s] })), phases: PHASE_NAMES };
  });
  app.get('/t/:tenantId/engagements/:id/tasks.csv', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!seesAll(req.access)) throw forbidden(); const e = await engagementOf(req, req.params.id); const rows = await td.list(pool, req.tenantId, e.id);
    const out = [['No', 'Ref', 'Stage', 'Phase', 'Task', 'Responsible (hint)', 'Assignee', 'Priority', 'Status', 'Start', 'Due', 'Depends on'], ...rows.map((r: any) => [r.taskNo, r.ref ?? '', r.stage ?? '', r.phase ? PHASE_NAMES[r.phase - 1] : '', r.title, r.ownerHint ?? '', r.assigneeName ?? '', r.priority, STATUS_LABEL[r.status as keyof typeof STATUS_LABEL], r.startDate ?? '', r.dueDate ?? '', r.depIds.map((x: string) => taskRef(rows.find((y: any) => y.id === x)?.taskNo ?? 0)).join(' ')])];
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="tasks.csv"'); return '﻿' + out.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  });
  const Body = z.object({ title: Text(300).min(3), description: Text(5000).nullish(), stage: Text(190).nullish(), phase: z.number().int().min(1).max(5).nullish(), ownerHint: Text(190).nullish(), assigneeId: z.string().uuid().nullish(), priority: z.enum(PRIORITIES).default('normal'), startDate: DateStr.nullish(), dueDate: DateStr.nullish(), dependsOn: z.array(z.string().uuid()).max(20).default([]) });
  const datesOk = (s?: string | null, du?: string | null) => { if (s && du && s > du) throw bad('The start date is after the due date'); };
  app.post('/t/:tenantId/engagements/:id/tasks', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(Body, req.body); datesOk(b.startDate, b.dueDate); let out: any;
    await tx(pool, async (c) => { const e = await writableEngagement(c, req.tenantId, req.params.id); if ((await td.countOf(c, req.tenantId, e.id)) >= MAX_PER_ENGAGEMENT) throw conflict(`An engagement can hold at most ${MAX_PER_ENGAGEMENT} tasks`);
      if (b.assigneeId) await checkAssignee(c, req.tenantId, b.assigneeId); const deps = await td.idsIn(c, req.tenantId, e.id, b.dependsOn); if (deps.length !== new Set(b.dependsOn).size) throw bad('A dependency is not a task of this engagement');
      const [id] = await td.insertMany(c, req.tenantId, e.id, [{ ref: null, stage: b.stage ?? null, phase: b.phase ?? null, title: b.title, description: b.description?.trim() || null, ownerHint: b.ownerHint?.trim() || null, assigneeId: b.assigneeId ?? null, priority: b.priority, startDate: b.startDate ?? null, dueDate: b.dueDate ?? null, deps }], me(req).id);
      const t = await td.get(c, req.tenantId, id); out = { id, taskNo: t.taskNo }; await log(c, req, 'task.created', e.id, { taskId: id, taskNo: t.taskNo, title: b.title, assigneeId: b.assigneeId ?? null }); await assigned(c, req, t, b.assigneeId); });
    return out;
  });
  app.get('/t/:tenantId/tasks/:taskId', { preHandler: tenantCtx }, async (req: any) => {
    const { t, e } = await taskOf(req); const [deps, dependents, comments] = await Promise.all([td.depsOf(pool, req.tenantId, t.id), td.dependents(pool, req.tenantId, t.id), td.comments(pool, req.tenantId, t.id)]);
    return { ...shape(t), engagementName: e.name, engagementStatus: e.status, dependsOn: deps, blocks: dependents, comments, can: { manage: e.status === 'active' && canManage(req.access), work: e.status === 'active' && canWork(req.access, t, me(req).id) } };
  });
  const Patch = z.object({ title: Text(300).min(3).optional(), description: Text(5000).nullish(), stage: Text(190).nullish(), phase: z.number().int().min(1).max(5).nullish(), ownerHint: Text(190).nullish(), assigneeId: z.string().uuid().nullish(), priority: z.enum(PRIORITIES).optional(), startDate: DateStr.nullish(), dueDate: DateStr.nullish(), dependsOn: z.array(z.string().uuid()).max(20).optional(), status: z.enum(STATUSES).optional() });
  app.patch('/t/:tenantId/tasks/:taskId', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Patch, req.body); if (!Object.keys(b).length) throw bad('Nothing to change');
    await tx(pool, async (c) => { const t0 = await td.get(c, req.tenantId, req.params.taskId); if (!t0) throw notFound(); const e0 = await engagementOf(req, t0.engagementId); void e0; await writableEngagement(c, req.tenantId, t0.engagementId); const t = await td.get(c, req.tenantId, t0.id, true);
      if (!seesAll(req.access) && t.assigneeId !== me(req).id) throw notFound(); if (!canWork(req.access, t, me(req).id)) throw forbidden('Only the assignee, iSecurify staff and client administrators can change a task');
      const mgr = canManage(req.access); const keys = Object.keys(b); if (!mgr && keys.some(k => k !== 'status')) throw forbidden('You can change the status of a task assigned to you; ask a manager for other changes');
      if (b.status === 'cancelled' && !mgr) throw forbidden('Only a manager cancels a task'); if (t.status === 'cancelled' && !mgr) throw forbidden('Only a manager reopens a cancelled task');
      datesOk(b.startDate === undefined ? t.startDate : b.startDate, b.dueDate === undefined ? t.dueDate : b.dueDate);
      if (b.assigneeId) await checkAssignee(c, req.tenantId, b.assigneeId);
      if (b.dependsOn) { const ids = await td.idsIn(c, req.tenantId, t.engagementId, b.dependsOn); if (ids.length !== new Set(b.dependsOn).size || b.dependsOn.includes(t.id)) throw bad('A dependency is not another task of this engagement'); if (wouldLoop(await td.edges(c, req.tenantId, t.engagementId), t.id, b.dependsOn)) throw conflict('Those dependencies would form a loop'); await td.setDeps(c, req.tenantId, t.id, b.dependsOn); }
      const { status, dependsOn, ...rest } = b; const patch: Record<string, any> = {}; for (const [k, v] of Object.entries(rest)) patch[k] = typeof v === 'string' ? (v.trim() || null) : v ?? null;
      await td.update(c, req.tenantId, t.id, patch, status && status !== t.status ? status : undefined);
      const changed = [...Object.keys(rest), ...(status && status !== t.status ? ['status'] : []), ...(dependsOn ? ['dependsOn'] : [])];
      await log(c, req, status && Object.keys(rest).length === 0 && !dependsOn ? 'task.status_changed' : 'task.updated', t.engagementId, { taskId: t.id, taskNo: t.taskNo, changed, ...(status && status !== t.status ? { from: t.status, to: status } : {}) });
      if ('assigneeId' in b && b.assigneeId !== t.assigneeId) await assigned(c, req, t, b.assigneeId); });
    return { ok: true };
  });
  app.post('/t/:tenantId/tasks/:taskId/comments', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ body: Text(4000).min(1) }), req.body); let id = '';
    await tx(pool, async (c) => { const t0 = await td.get(c, req.tenantId, req.params.taskId); if (!t0) throw notFound(); await engagementOf(req, t0.engagementId); await writableEngagement(c, req.tenantId, t0.engagementId); if (!seesAll(req.access) && t0.assigneeId !== me(req).id) throw notFound(); if (req.access.role === 'tp_auditor') throw forbidden('Auditors read tasks but do not comment on them');
      id = await td.addComment(c, req.tenantId, t0.id, me(req).id, b.body); await log(c, req, 'task.commented', t0.engagementId, { taskId: t0.id, taskNo: t0.taskNo });
      const who = [t0.assigneeId, t0.createdBy].filter((x: string | null) => x && x !== me(req).id); await notify(c, { tenantId: req.tenantId, kind: 'task.assigned', recipients: who, actorId: me(req).id, entityType: 'engagement', entityId: t0.engagementId, engagementId: t0.engagementId, label: `Comment on ${taskRef(t0.taskNo)} ${t0.title}`.slice(0, 300) }); });
    return { id };
  });

  // ---------------- plans: spreadsheet import and templates ----------------
  const StartQ = z.object({ confirm: z.enum(['true', 'false']).default('false'), startDate: DateStr.default(() => today()) });
  const rowsOut = (parsed: any, sched: Map<string, { start: string; due: string }> | null) => parsed.rows.slice(0, 500).map((r: any) => ({ row: r.row, ref: r.data.ref, stage: r.data.stage, title: r.data.title, ownerHint: r.data.ownerHint, days: r.data.days, deps: r.data.deps, start: sched?.get(r.data.ref || `#${r.row}`)?.start ?? null, due: sched?.get(r.data.ref || `#${r.row}`)?.due ?? null, valid: !r.errors.length, errors: r.errors }));
  async function readUpload(req: any) { if (!req.isMultipart()) throw bad('Upload the file as multipart/form-data'); const part = await req.file({ limits: { fileSize: MAX_IMPORT_BYTES } }); if (!part) throw bad('No file was uploaded'); const buf = await part.toBuffer(); if (part.file.truncated) throw new HttpError(413, 'File is larger than 5 MB'); return { part, buf, parsed: await parseTasks(part.filename, buf) }; }
  const toRows = (items: any[], start: string) => { const s = schedule(items.map((x, i) => ({ key: x.ref || `#${i}`, days: x.days, deps: x.deps })), start); if ('error' in s) throw bad(s.error); return items.map((x, i) => { const w = s.get(x.ref || `#${i}`)!; return { key: x.ref || `#${i}`, depKeys: x.deps, ref: x.ref || null, stage: x.stage, phase: x.phase, title: x.title, description: x.description, ownerHint: x.ownerHint, assigneeId: null, priority: x.priority, startDate: w.start, dueDate: w.due }; }); };
  app.post('/t/:tenantId/engagements/:id/tasks/import', { preHandler: tenantCtx }, async (req: any) => {
    needPlan(req); const o = ctx.parse(StartQ, req.query); const e = await engagementOf(req, req.params.id); const { part, buf, parsed } = await readUpload(req);
    const valid = parsed.rows.filter(r => !r.errors.length); const counts = { total: parsed.rows.length, valid: valid.length, invalid: parsed.rows.length - valid.length };
    const sched = counts.invalid ? null : schedule(valid.map(r => ({ key: r.data.ref || `#${r.row}`, days: r.data.days, deps: r.data.deps })), o.startDate); const sc = sched && !('error' in sched) ? sched : null;
    if (o.confirm !== 'true') return { confirmed: false, format: parsed.format, counts, startDate: o.startDate, rows: rowsOut(parsed, sc), truncated: parsed.rows.length > 500 };
    if (counts.invalid) throw new HttpError(422, `${counts.invalid} row(s) have errors. Fix the file and upload it again; a plan is loaded whole or not at all`, 'invalid_rows'); if (!valid.length) throw new HttpError(422, 'There are no tasks to load');
    let made = 0; await tx(pool, async (c) => { await writableEngagement(c, req.tenantId, e.id); if ((await td.countOf(c, req.tenantId, e.id)) + valid.length > MAX_PER_ENGAGEMENT) throw conflict(`An engagement can hold at most ${MAX_PER_ENGAGEMENT} tasks`);
      made = (await td.insertMany(c, req.tenantId, e.id, toRows(valid.map(r => r.data), o.startDate), me(req).id)).length; await log(c, req, 'task.imported', e.id, { tasks: made, source: part.filename, sha256: createHash('sha256').update(buf).digest('hex'), startDate: o.startDate }); });
    return { confirmed: true, created: made };
  });
  app.get('/t/:tenantId/engagements/:id/task-templates', { preHandler: tenantCtx }, async (req: any) => { needPlan(req); const e = await engagementOf(req, req.params.id); return td.templates(pool, await td.frameworkIdsOf(pool, req.tenantId, e.id)); });
  app.post('/t/:tenantId/engagements/:id/tasks/apply-template', { preHandler: tenantCtx }, async (req: any) => {
    needPlan(req); const b = ctx.parse(z.object({ templateId: z.string().uuid(), startDate: DateStr }), req.body); const e = await engagementOf(req, req.params.id); const tpl = await td.template(pool, b.templateId); if (!tpl) throw notFound();
    let made = 0; await tx(pool, async (c) => { await writableEngagement(c, req.tenantId, e.id); if ((await td.countOf(c, req.tenantId, e.id)) + tpl.items.length > MAX_PER_ENGAGEMENT) throw conflict(`An engagement can hold at most ${MAX_PER_ENGAGEMENT} tasks`);
      made = (await td.insertMany(c, req.tenantId, e.id, toRows(tpl.items, b.startDate), me(req).id)).length; await log(c, req, 'task.template_applied', e.id, { templateId: tpl.id, template: tpl.name, tasks: made, startDate: b.startDate }); });
    return { created: made };
  });

  // ---------------- platform side: templates ----------------
  app.get('/task-template.csv', { preHandler: platformUser }, async (_req, reply) => { reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="task-plan-template.csv"'); return '﻿' + [HEAD, ...EX].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; });
  app.get('/task-template.xlsx', { preHandler: platformUser }, async (_req, reply) => { const buf = await writeXlsxFile([HEAD.map(h => ({ value: h, fontWeight: 'bold' as const })), ...EX.map(r => r.map(c => ({ value: c })))], { columns: [{ width: 8 }, { width: 16 }, { width: 14 }, { width: 44 }, { width: 40 }, { width: 36 }, { width: 22 }, { width: 6 }, { width: 12 }, { width: 12 }, { width: 10 }] } as any).toBuffer(); reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="task-plan-template.xlsx"'); return buf; });
  app.get('/task-templates', { preHandler: platformUser }, async () => td.templates(pool, null));
  app.get('/task-templates/:tid', { preHandler: platformUser }, async (req: any) => { const t = await td.template(pool, req.params.tid); if (!t) throw notFound(); return t; });
  app.post('/task-templates', { preHandler: adminLevel }, async (req: any) => {
    const o = ctx.parse(z.object({ confirm: z.enum(['true', 'false']).default('false'), name: Text(190).min(3), frameworkId: z.string().uuid().optional(), description: Text(500).optional() }), req.query); const { part, buf, parsed } = await readUpload(req);
    const valid = parsed.rows.filter(r => !r.errors.length); const counts = { total: parsed.rows.length, valid: valid.length, invalid: parsed.rows.length - valid.length };
    if (o.confirm !== 'true') return { confirmed: false, format: parsed.format, counts, rows: rowsOut(parsed, null), truncated: parsed.rows.length > 500 };
    if (counts.invalid) throw new HttpError(422, `${counts.invalid} row(s) have errors. Fix the file and upload it again`, 'invalid_rows'); if (!valid.length || valid.length > MAX_TASKS) throw new HttpError(422, 'There are no tasks to save');
    if (o.frameworkId && !(await q(pool, 'SELECT 1 x FROM frameworks WHERE id=?', [o.frameworkId]))[0]) throw bad('Unknown framework'); let id = '';
    await tx(pool, async (c) => { id = await td.saveTemplate(c, { name: o.name, frameworkId: o.frameworkId ?? null, description: o.description ?? null, items: valid.map(r => r.data), sourceName: part.filename.slice(0, 255), sha256: createHash('sha256').update(buf).digest('hex'), by: me(req).id });
      await audit(c, { actorId: me(req).id, action: 'task_template.created', entity: 'task_template', entityId: id, detail: { name: o.name, tasks: valid.length, frameworkId: o.frameworkId ?? null, source: part.filename }, ip: req.ip }); });
    return { confirmed: true, id, counts };
  });
  app.post('/task-templates/:tid/archive', { preHandler: adminLevel }, async (req: any) => { await tx(pool, async (c) => { if (!(await td.archiveTemplate(c, req.params.tid))) throw notFound(); await audit(c, { actorId: me(req).id, action: 'task_template.archived', entity: 'task_template', entityId: req.params.tid, detail: {}, ip: req.ip }); }); return { ok: true }; });
}
