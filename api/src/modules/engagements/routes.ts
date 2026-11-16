import { readiness } from '../summary/service'; import { notify } from '../notifications/notify';
import * as tasksData from '../tasks/data'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import * as d from './data'; import type { Scope } from './data'; import { scopeOf as scopeOfAccess } from './access';
import { evalRow as evalRowShared, evaluateItem, isOverdue, summarize, mergeSummaries, emptySummary, STATE_LABEL } from './evaluation';
import { getMember, resolveAccess, listStaff, listMembers } from '../tenancy/data'; import { queryAudit } from '../audit/data';
import { phaseChecks, summarizeChecks } from './phaseRules'; import { unresolvedCount } from '../findings/data'; import * as fd from '../findings/data'; import { deletionBlockers, manifestProviders } from '../users/hooks'; import { closeBlockers } from './access';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
const Path = z.enum(['TYPE1_ONLY', 'TYPE2_ONLY', 'TYPE1_THEN_TYPE2']);
const Text = (n: number) => z.string().trim().max(n);
const DocControl = z.object({ documentNumber: Text(80).nullish(), documentOwner: Text(190).nullish(), classification: Text(60).nullish(), reviewCycle: Text(60).nullish(), documentVersion: Text(40).nullish(), clientAddress: Text(500).nullish() });
const today = () => new Date().toISOString().slice(0, 10);
const ASSIGNABLE = ['client_admin', 'client_staff', 'third_party_vendor'];

// Registered once (idempotent): people with open work cannot be removed from an organization or deleted until it is reassigned.
const openItemsBlocker = async (c: any, userId: string, tenantId: string | null) => (await d.openItemsFor(c, userId, tenantId)).map(r => ({ type: 'checklist_item', id: r.id, label: `${r.engagementName}: ${r.ref} ${r.title}` }));
const manifestSection = async (c: any, userId: string) => ({ title: 'Assigned checklist items', headers: ['Engagement', 'Control', 'Requirement', 'Evidence status'], rows: (await d.assignedItemsFor(c, userId)).map(r => [r.engagementName, r.ref, r.title, r.evidence]) });

const taskFigures = async (c: any, tenantId: string, id: string) => { const k = await tasksData.counts(c, tenantId, id, new Date().toISOString().slice(0, 10)); return { total: k.total, open: k.total - (k.byStatus.done ?? 0) - (k.byStatus.cancelled ?? 0), overdue: k.overdue, done: k.byStatus.done ?? 0 }; };
export function registerEngagements(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  if (!deletionBlockers.includes(openItemsBlocker)) deletionBlockers.push(openItemsBlocker); if (!manifestProviders.includes(manifestSection)) manifestProviders.push(manifestSection);

  const scopeOf = (req: any): Scope => scopeOfAccess(req.access, me(req).id);
  const isManager = (req: any) => !!req.access.manage; const isStaffManager = (req: any) => req.access.via === 'staff' && !!req.access.manage;
  const seesDetail = (req: any) => scopeOf(req).kind !== 'assigned';           // client_staff / vendors see only their own items
  const needManage = (req: any) => { if (!isManager(req)) throw forbidden(); }; const needStaff = (req: any) => { if (!isStaffManager(req)) throw forbidden('Only iSecurify team members assigned to this organization can do this'); };
  const visible = async (req: any, id: string) => { const e = await d.getVisibleEngagement(pool, req.tenantId, id, scopeOf(req)); if (!e) throw notFound(); return e; };
  const writable = async (c: any, tenantId: string, id: string) => { const e = await d.getEngagement(c, tenantId, id, true); if (!e) throw notFound(); if (e.status === 'closed') throw new HttpError(409, 'This engagement is closed', 'engagement_closed'); return e; };
  const evalRow = (r: any) => evalRowShared(r, today());
  const factsSummary = (tenantId: string, engIds: string[], scope: Scope) => readiness(pool, tenantId, engIds, { today: today(), assignedUserId: scope.kind === 'assigned' ? scope.userId : undefined });

  // ---------- choosing frameworks ----------
  async function loadReleases(c: any, ids: string[]) {
    const rows = await q(c, 'SELECT r.id,r.framework_id frameworkId,r.version,r.status,f.name,f.archived FROM framework_releases r JOIN frameworks f ON f.id=r.framework_id WHERE r.id IN (?)', [ids]);
    if (rows.length !== new Set(ids).size) throw bad('One of the selected releases does not exist');
    for (const r of rows) { if (r.status !== 'published') throw bad(`${r.name} v${r.version} is not published`); if (r.archived) throw bad(`${r.name} is archived`); }
    if (new Set(rows.map(r => r.frameworkId)).size !== rows.length) throw bad('Select at most one release per framework'); return rows as { id: string; frameworkId: string; version: number; name: string }[];
  }
  app.get('/t/:tenantId/available-frameworks', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req);
    return q(pool, `SELECT f.id frameworkId, f.name, f.color, f.region, r.id releaseId, r.version, (SELECT COUNT(*) FROM framework_controls c WHERE c.release_id=r.id) controlCount,
      EXISTS(SELECT 1 FROM process_templates t JOIN process_template_milestones m ON m.template_id=t.id WHERE t.framework_id=f.id AND m.path_filter IS NOT NULL) hasAuditPath
      FROM frameworks f JOIN framework_releases r ON r.framework_id=f.id AND r.status='published' AND r.version=(SELECT MAX(version) FROM framework_releases x WHERE x.framework_id=f.id AND x.status='published') WHERE f.archived=0 ORDER BY f.name`);
  });
  app.get('/t/:tenantId/engagements/overlap-preview', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const ids = ctx.parse(z.object({ releaseIds: z.string().transform(s => s.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).min(1).max(10)) }), req.query).releaseIds;
    const rels = await loadReleases(pool, ids);
    const rows = await q(pool, `SELECT c.id,c.ref,f.id frameworkId,f.name frameworkName,m.common_control_id commonId,cc.title commonTitle FROM framework_controls c JOIN framework_releases r ON r.id=c.release_id JOIN frameworks f ON f.id=r.framework_id
      LEFT JOIN control_mappings m ON m.control_id=c.id LEFT JOIN common_controls cc ON cc.id=m.common_control_id WHERE r.id IN (?) ORDER BY f.name,c.ref`, [ids]);
    const groups = new Map<string, any>(); let unmapped = 0; for (const r of rows) { if (!r.commonId) { unmapped++; continue; } const g = groups.get(r.commonId) ?? groups.set(r.commonId, { commonControlId: r.commonId, title: r.commonTitle, frameworks: {} as Record<string, string[]> }).get(r.commonId); (g.frameworks[r.frameworkName] ??= []).push(r.ref); }
    const shared = [...groups.values()].filter(g => Object.keys(g.frameworks).length >= 2).sort((a, b) => a.title.localeCompare(b.title));
    const distinct = unmapped + groups.size;
    return { frameworks: rels.map(r => ({ frameworkId: r.frameworkId, name: r.name, version: r.version })), totalControls: rows.length, distinctItems: distinct, duplicatesAvoided: rows.length - distinct, shared };
  });

  // ---------- create / list / read ----------
  async function buildEngagement(c: any, o: { tenantId: string; actor: string; ip: string; id: string; name: string; clientRef?: string | null; startDate?: string | null; endDate?: string | null; ids: string[]; soc2Path?: string | null; leadUserId?: string | null; doc?: any; isStaff: boolean; renewedFrom?: string | null }) {
    const { tenantId, actor, id, ids } = o;
      const rels = await loadReleases(c, ids); const ordered = ids.map(i => rels.find(r => r.id === i)!);
      const tmpl = await q(c, `SELECT t.id,t.name,t.framework_id frameworkId,m.phase,m.sort_order,m.title,m.path_filter pathFilter FROM process_templates t JOIN process_template_milestones m ON m.template_id=t.id WHERE t.framework_id IN (?) ORDER BY t.name,m.phase,m.sort_order`, [rels.map(r => r.frameworkId)]);
      const needsPath = tmpl.some(m => m.pathFilter); if (needsPath && !o.soc2Path) throw bad('Choose the audit path (Type I only, Type II only, or Type I then Type II) for the selected framework');
      const path = needsPath ? o.soc2Path! : null;
      await d.insertEngagement(c, tenantId, { id, name: o.name, clientRef: o.clientRef, startDate: o.startDate, endDate: o.endDate, soc2Path: path, createdBy: actor, renewedFrom: o.renewedFrom ?? null, doc: o.doc ?? undefined });
      for (const [i, r] of ordered.entries()) await d.addEngagementFramework(c, tenantId, id, { frameworkId: r.frameworkId, releaseId: r.id, isPrimary: i === 0, addedBy: actor });
      await d.insertPhaseLogs(c, tenantId, id, today());
      const applied = []; for (const r of ordered) applied.push({ frameworkId: r.frameworkId, frameworkName: r.name, version: r.version, ...(await d.applyRelease(c, tenantId, id, r.id, actor)) });
      const useDefault = tmpl.length === 0; const src = useDefault ? await q(c, "SELECT t.name,m.phase,m.title,m.path_filter pathFilter FROM process_templates t JOIN process_template_milestones m ON m.template_id=t.id WHERE t.framework_id IS NULL ORDER BY m.phase,m.sort_order") : tmpl;
      const ms = src.filter(m => !m.pathFilter || (path && String(m.pathFilter).split(',').includes(path))).map(m => ({ phase: m.phase as number, title: m.title as string, source: m.name as string })); await d.insertMilestones(c, tenantId, id, ms);
      let lead = o.leadUserId ?? (o.isStaff ? actor : null);
      if (lead) { const a = await resolveAccess(c, lead, tenantId); if (!a || a.via !== 'staff') throw bad('The lead must be an iSecurify team member assigned to this organization'); await d.setEngagementMember(c, tenantId, id, lead, 'lead', actor); }
      const shared = await d.countSharedItems(c, tenantId, id); const totals = { frameworksApplied: applied.length, totalCreated: applied.reduce((n, a) => n + a.created, 0), totalMerged: applied.reduce((n, a) => n + a.merged, 0), sharedEvidenceItems: shared };
      await audit(c, { tenantId, actorId: actor, action: 'engagement.created', entity: 'engagement', entityId: id, detail: { name: o.name, engagementId: id, ...(o.renewedFrom ? { renewedFrom: o.renewedFrom } : {}), releases: ids, applied: applied.map(a => ({ framework: a.frameworkName, version: a.version, created: a.created, merged: a.merged })), milestones: ms.length }, ip: o.ip });
      return { id, applied, summary: totals, milestones: ms.length };
  }
  app.post('/t/:tenantId/engagements', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ name: Text(190).min(1), clientRef: Text(190).nullish(), startDate: DateStr.nullish(), endDate: DateStr.nullish(), primaryReleaseId: z.string().uuid(), additionalReleaseIds: z.array(z.string().uuid()).max(9).default([]),
      soc2Path: Path.nullish(), leadUserId: z.string().uuid().nullish(), document: DocControl.optional() }), req.body);
    const ids = [b.primaryReleaseId, ...b.additionalReleaseIds]; if (new Set(ids).size !== ids.length) throw bad('A release was selected twice');
    const out = await tx(pool, (c) => buildEngagement(c, { tenantId: req.tenantId, actor: me(req).id, ip: req.ip, id: uuid(), name: b.name, clientRef: b.clientRef, startDate: b.startDate, endDate: b.endDate, ids, soc2Path: b.soc2Path, leadUserId: b.leadUserId, doc: b.document, isStaff: req.access.via === 'staff' }));
    reply.code(201).send(out);
  });
  // ---------- renew / re-certify (Phase 11C) ----------
  app.post('/t/:tenantId/engagements/:id/renew', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ name: Text(190).min(1), startDate: DateStr.nullish(), endDate: DateStr.nullish(), useLatestReleases: z.boolean().default(true),
      carryOver: z.object({ assignees: z.boolean().default(true), notApplicable: z.boolean().default(true), team: z.boolean().default(true), openFindings: z.boolean().default(true) }).default({ assignees: true, notApplicable: true, team: true, openFindings: true }) }), req.body);
    const tenantId = req.tenantId, actor = me(req).id;
    const out = await tx(pool, async (c) => {
      const src = await d.getEngagement(c, tenantId, req.params.id, true); if (!src) throw notFound(); if (src.status !== 'closed') throw new HttpError(409, 'Only a closed engagement can be renewed', 'engagement_open');
      const existing = await d.renewalOf(c, tenantId, src.id); if (existing) throw new HttpError(409, `This engagement has already been renewed: ${existing.name}`, 'already_renewed');
      const fws = (await d.engagementFrameworks(c, tenantId, src.id)).sort((a: any, z2: any) => Number(!!z2.isPrimary) - Number(!!a.isPrimary)); const dropped: string[] = []; let ids: string[];
      if (b.useLatestReleases) { const latest = new Map((await d.latestPublished(c, fws.map((f: any) => f.frameworkId))).map((r: any) => [r.frameworkId, r])); ids = []; for (const f of fws) { const l: any = latest.get(f.frameworkId); if (l) ids.push(l.releaseId); else dropped.push(f.name); } } else ids = fws.map((f: any) => f.releaseId);
      if (!ids.length) throw bad('None of this engagement\'s frameworks can be renewed: they are archived or have no published version');
      const members = await d.listEngagementMembers(c, tenantId, src.id); const srcLead = members.find((m: any) => m.role === 'lead'); let lead: string | null = null;
      if (srcLead) { const a = await resolveAccess(c, srcLead.userId, tenantId); if (a && a.via === 'staff') lead = srcLead.userId; } if (!lead && req.access.via === 'staff') lead = actor;
      const id = uuid(); const built = await buildEngagement(c, { tenantId, actor, ip: req.ip, id, name: b.name, clientRef: src.clientRef, startDate: b.startDate, endDate: b.endDate, ids, soc2Path: src.soc2Path, leadUserId: lead, isStaff: req.access.via === 'staff', renewedFrom: src.id,
        doc: { documentNumber: src.documentNumber, documentOwner: src.documentOwner, classification: src.classification, reviewCycle: src.reviewCycle, documentVersion: src.documentVersion, clientAddress: src.clientAddress } });
      const carried: any = { ...(await d.carryDecisions(c, tenantId, src.id, id, { assignees: b.carryOver.assignees, notApplicable: b.carryOver.notApplicable })), team: 0, findings: 0, skippedFindings: 0 };
      if (b.carryOver.team) for (const m of members) { if (m.userId === lead) continue; const a = await resolveAccess(c, m.userId, tenantId); if (m.role === 'auditor' ? a?.role === 'tp_auditor' : a?.via === 'staff') { await d.setEngagementMember(c, tenantId, id, m.userId, m.role === 'lead' ? 'team' : m.role, actor); carried.team++; } }
      if (b.carryOver.openFindings) { const byRef = await d.itemIdsByRef(c, tenantId, id); const owners = new Set((await d.assignableUsers(c, tenantId)).map((u: any) => u.id as string));
        for (const f of await fd.unresolvedForCarry(c, tenantId, src.id)) { const it = byRef.get(f.itemRef); if (!it || it.na) { carried.skippedFindings++; continue; } const fid = uuid();
          await fd.insertFinding(c, tenantId, { id: fid, engagementId: id, itemId: it.id, no: await fd.nextNo(c, tenantId, id), title: f.title, description: `Carried over from "${src.name}" (finding ${f.n}).\n\n${f.description}`, recommendation: f.recommendation, severity: f.severity, ownerUserId: f.ownerUserId && owners.has(f.ownerUserId) ? f.ownerUserId : null, raisedBy: actor });
          await fd.setCarriedFrom(c, tenantId, fid, f.id); await fd.addEvent(c, tenantId, { id: uuid(), findingId: fid, kind: 'raised', to: 'open', note: `Carried over from ${src.name}`, actorId: actor }); carried.findings++; } }
      await audit(c, { tenantId, actorId: actor, action: 'engagement.renewed', entity: 'engagement', entityId: id, detail: { engagementId: id, renewedFrom: src.id, from: src.name, name: b.name, useLatestReleases: b.useLatestReleases, dropped, carried }, ip: req.ip });
      await audit(c, { tenantId, actorId: actor, action: 'engagement.renewal_started', entity: 'engagement', entityId: src.id, detail: { engagementId: src.id, renewal: id, name: b.name }, ip: req.ip });
      return { ...built, renewedFrom: src.id, carried, dropped };
    });
    reply.code(201).send(out);
  });
  app.get('/t/:tenantId/engagements', { preHandler: tenantCtx }, async (req: any) => {
    const af = ctx.parse(z.object({ archived: z.enum(['hide', 'only', 'all']).default('all') }), req.query).archived; const scope = scopeOf(req); const list = (await d.listEngagements(pool, req.tenantId, scope)).filter((x: any) => af === 'all' || (af === 'only') === !!x.archived); const ids = list.map(e => e.id);
    const [fw, leads, sum] = await Promise.all([d.engagementFrameworksFor(pool, req.tenantId, ids), d.leadOf(pool, req.tenantId, ids), factsSummary(req.tenantId, ids, scope)]);
    return list.map(e => ({ ...e, phaseName: d.PHASE_NAMES[e.currentPhase - 1], frameworks: (fw.get(e.id) ?? []).map(f => ({ ...f, isPrimary: !!f.isPrimary })), lead: leads.get(e.id) ?? null, summary: sum.of(e.id) }));
  });
  app.get('/t/:tenantId/engagements/:id', { preHandler: tenantCtx }, async (req: any) => {
    const e = await visible(req, req.params.id); const scope = scopeOf(req);
    const [fw, phases, members, sum] = await Promise.all([d.engagementFrameworks(pool, req.tenantId, e.id), d.listPhases(pool, req.tenantId, e.id), seesDetail(req) ? d.listEngagementMembers(pool, req.tenantId, e.id) : [], factsSummary(req.tenantId, [e.id], scope)]);
    return { ...e, phaseName: d.PHASE_NAMES[e.currentPhase - 1], frameworks: fw.map(f => ({ ...f, isPrimary: !!f.isPrimary })), phases, members, summary: sum.of(e.id), freshness: sum.freshness, tasks: seesDetail(req) ? await taskFigures(pool, req.tenantId, e.id) : null,
      permissions: { export: isManager(req) || req.access.role === 'tp_auditor', manage: isManager(req), advancePhase: isStaffManager(req) && e.status === 'active', seesDetail: seesDetail(req), role: req.access.role, via: req.access.via } };
  });
  app.patch('/t/:tenantId/engagements/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ name: Text(190).min(1).optional(), clientRef: Text(190).nullish(), startDate: DateStr.nullish(), endDate: DateStr.nullish() }).merge(DocControl), req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); await d.updateEngagement(c, req.tenantId, req.params.id, b); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.updated', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, fields: Object.keys(b) }, ip: req.ip }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/engagements/:id/frameworks', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ releaseId: z.string().uuid() }), req.body);
    const out = await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const [rel] = await loadReleases(c, [b.releaseId]);
      if ((await d.engagementFrameworks(c, req.tenantId, req.params.id)).some(f => f.frameworkId === rel.frameworkId)) throw conflict('This framework is already part of the engagement');
      await d.addEngagementFramework(c, req.tenantId, req.params.id, { frameworkId: rel.frameworkId, releaseId: rel.id, isPrimary: false, addedBy: me(req).id }); const r = await d.applyRelease(c, req.tenantId, req.params.id, rel.id, me(req).id);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.framework_added', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, framework: rel.name, version: rel.version, ...r }, ip: req.ip }); return { frameworkName: rel.name, version: rel.version, ...r }; });
    reply.code(201).send(out);
  });

  // ---------- checklist ----------
  app.get('/t/:tenantId/engagements/:id/checklist', { preHandler: tenantCtx }, async (req: any) => {
    const e = await visible(req, req.params.id); const [rows, sat] = await Promise.all([d.listItems(pool, req.tenantId, e.id, scopeOf(req), today()), d.satisfiesFor(pool, req.tenantId, e.id)]);
    const by = new Map<string, any[]>(); for (const s of sat) (by.get(s.itemId) ?? by.set(s.itemId, []).get(s.itemId)!).push(s);
    const filter = ctx.parse(z.object({ state: z.string().optional() }), req.query).state;
    const items = rows.map(r => { const ev = evalRow(r); return { ...r, linkCount: undefined, naLinks: undefined, evidenceExpired: !!r.evidenceExpired, blockingFindings: !!r.blockingFindings, ...ev, satisfies: by.get(r.id) ?? [] }; }).filter(i => !filter || i.state === filter);
    return { engagementId: e.id, status: e.status, items };
  });
  app.post('/t/:tenantId/engagements/:id/checklist', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ ref: Text(60).min(1), domain: Text(190).min(1), title: Text(500).min(1), description: Text(5000).nullish(), ownerDepartment: Text(190).nullish(), accountableUserId: z.string().uuid().nullish(), dueDate: DateStr.nullish() }), req.body);
    const id = await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); if (b.accountableUserId) await checkAssignee(c, req.tenantId, b.accountableUserId); const itemId = await d.insertCustomItem(c, req.tenantId, req.params.id, b);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'checklist.item_added', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, itemId, ref: b.ref }, ip: req.ip }); return itemId; });
    reply.code(201).send({ id });
  });
  async function checkAssignee(c: any, tenantId: string, userId: string) { const m = await getMember(c, tenantId, userId); if (!m || m.status !== 'active' || !ASSIGNABLE.includes(m.role)) throw bad('The accountable person must be an active client or vendor member of this organization'); }
  app.get('/t/:tenantId/engagements/:id/assignees', { preHandler: tenantCtx }, async (req: any) => { needManage(req); await visible(req, req.params.id); return d.assignableUsers(pool, req.tenantId); });
  app.patch('/t/:tenantId/checklist/:itemId', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ accountableUserId: z.string().uuid().nullable().optional(), dueDate: DateStr.nullable().optional(), readiness: z.enum(['not_started', 'in_progress', 'partially_implemented', 'implemented', 'not_applicable']).optional(), naJustification: Text(2000).nullish(), ownerDepartment: Text(190).nullish(), remarks: Text(5000).nullish() }), req.body);
    const user = me(req);
    await tx(pool, async (c) => {
      const it = await d.getItem(c, req.tenantId, req.params.itemId, true); if (!it) throw notFound(); const eng = await d.getVisibleEngagement(c, req.tenantId, it.engagementId, scopeOf(req)); if (!eng) throw notFound(); await writable(c, req.tenantId, it.engagementId);
      const own = it.accountableUserId === user.id; const touchesManaged = ['accountableUserId', 'dueDate', 'ownerDepartment', 'remarks', 'naJustification'].some(k => (b as any)[k] !== undefined) || b.readiness === 'not_applicable';
      if (!isManager(req)) { if (!own || touchesManaged) throw forbidden('Only the accountable person can update readiness; assignments, due dates and N/A decisions are managed by administrators'); }
      const patch: Record<string, unknown> = { ...b };
      if (b.accountableUserId) await checkAssignee(c, req.tenantId, b.accountableUserId);
      const readiness = b.readiness ?? it.readiness;
      if (readiness === 'not_applicable') { const j = (b.naJustification ?? it.naJustification ?? '').trim(); if (!j) throw bad('A justification is required to mark an item not applicable'); patch.naJustification = j; }
      else if (b.readiness) patch.naJustification = null;
      await d.updateItem(c, req.tenantId, it.id, patch);
      if (b.accountableUserId && b.accountableUserId !== it.accountableUserId) await notify(c, { tenantId: req.tenantId, kind: 'item.assigned', recipients: [b.accountableUserId], actorId: user.id, entityType: 'checklist_item', entityId: it.id, engagementId: it.engagementId, label: `${it.ref}: ${it.title}` });
      await audit(c, { tenantId: req.tenantId, actorId: user.id, action: 'checklist.item_updated', entity: 'engagement', entityId: it.engagementId, detail: { engagementId: it.engagementId, itemId: it.id, ref: it.ref, changes: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, k === 'naJustification' ? '(set)' : v])) }, ip: req.ip });
    });
    return { ok: true };
  });

  // ---------- SOA ----------
  const reviewers = (req: any) => { if (!(isManager(req) || req.access.role === 'tp_auditor')) throw forbidden(); };
  app.get('/t/:tenantId/engagements/:id/soa', { preHandler: tenantCtx }, async (req: any) => { reviewers(req); const e = await visible(req, req.params.id); const rows = await d.listSoa(pool, req.tenantId, e.id); const na = rows.filter(r => !r.applicable).length;
    return { engagementId: e.id, summary: { total: rows.length, applicable: rows.length - na, notApplicable: na }, entries: rows.map(r => ({ ...r, applicable: !!r.applicable })) }; });
  app.patch('/t/:tenantId/engagements/:id/soa/:controlId', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ applicable: z.boolean(), justification: Text(2000).nullish() }), req.body);
    if (!b.applicable && !(b.justification && b.justification.trim())) throw bad('A justification is required when a control is not applicable');
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const cur = await d.getSoa(c, req.tenantId, req.params.id, req.params.controlId); if (!cur) throw notFound();
      await d.updateSoa(c, req.tenantId, req.params.id, req.params.controlId, b.applicable, b.justification?.trim() ?? null, me(req).id);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'soa.updated', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, controlId: req.params.controlId, applicable: b.applicable }, ip: req.ip }); });
    return { ok: true };
  });

  // ---------- phases ----------
  app.patch('/t/:tenantId/engagements/:id/phases/:phase', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const phase = ctx.parse(z.coerce.number().int().min(1).max(5), req.params.phase); const b = ctx.parse(z.object({ startDate: DateStr.nullable().optional(), endDate: DateStr.nullable().optional(), ownerUserId: z.string().uuid().nullable().optional() }), req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const cur = await d.getPhase(c, req.tenantId, req.params.id, phase); if (!cur) throw notFound();
      if (b.ownerUserId && !(await d.getEngagementMember(c, req.tenantId, req.params.id, b.ownerUserId))) throw bad('The phase owner must be a member of this engagement');
      const s = b.startDate === undefined ? cur.startDate : b.startDate, e2 = b.endDate === undefined ? cur.endDate : b.endDate; if (s && e2 && e2 < s) throw bad('The end date cannot be before the start date');
      await d.updatePhase(c, req.tenantId, req.params.id, phase, b); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'phase.updated', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, phase, ...b }, ip: req.ip }); });
    return { ok: true };
  });
  async function phaseCheck(c: any, tenantId: string, e: any) {
    const sum = (await readiness(c, tenantId, [e.id], { today: today() })).of(e.id); const k = await d.phaseCounts(c, tenantId, e.id, e.currentPhase);
    const checks = phaseChecks(e.currentPhase, { ...k, applicable: sum.applicable, effective: sum.effective, awaitingReview: sum.awaitingReview, overdue: sum.overdue, unresolvedSerious: await unresolvedCount(c, tenantId, e.id) });
    return { from: e.currentPhase, to: e.currentPhase + 1, fromName: d.PHASE_NAMES[e.currentPhase - 1], toName: d.PHASE_NAMES[e.currentPhase] ?? null, checks, ...summarizeChecks(checks) };
  }
  app.get('/t/:tenantId/engagements/:id/phase-check', { preHandler: tenantCtx }, async (req: any) => {
    reviewers(req); const e = await visible(req, req.params.id); if (e.status === 'closed' || e.currentPhase >= 5) return { from: e.currentPhase, to: null, checks: [], blocked: [], warnings: [], canAdvance: false };
    const r = await phaseCheck(pool, req.tenantId, e); return { ...r, canAdvance: r.blocked.length === 0 };
  });
  app.post('/t/:tenantId/engagements/:id/advance-phase', { preHandler: tenantCtx }, async (req: any) => {
    needStaff(req); const b = ctx.parse(z.object({ acknowledge: z.boolean().default(false), note: Text(1000).nullish() }), req.body ?? {});
    return tx(pool, async (c) => { const e = await writable(c, req.tenantId, req.params.id); if (e.currentPhase >= 5) throw new HttpError(409, 'The engagement is already in the final phase', 'final_phase');
      const chk = await phaseCheck(c, req.tenantId, e); if (chk.blocked.length) throw new HttpError(409, chk.blocked.map(x => x.message).join('. '), 'phase_blocked');
      if (chk.warnings.length && !(b.acknowledge && (b.note ?? '').trim().length >= 5)) throw new HttpError(409, `${chk.warnings.map(x => x.message).join('; ')}. Acknowledge these with a short note to continue`, 'phase_warnings');
      const from = e.currentPhase, to = from + 1; await d.completePhase(c, req.tenantId, e.id, from, today()); await d.startPhase(c, req.tenantId, e.id, to, today()); await d.setPhaseNumber(c, req.tenantId, e.id, to);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'phase.advanced', entity: 'engagement', entityId: e.id, detail: { engagementId: e.id, from: d.PHASE_NAMES[from - 1], to: d.PHASE_NAMES[to - 1], ...(chk.warnings.length ? { acknowledged: chk.warnings.map(x => x.code), note: (b.note ?? '').trim() } : {}) }, ip: req.ip });
      await notify(c, { tenantId: req.tenantId, kind: 'engagement.phase_advanced', recipients: (await d.listEngagementMembers(c, req.tenantId, e.id)).map((m: any) => m.userId), actorId: me(req).id, entityType: 'engagement', entityId: `${e.id}`, engagementId: e.id, label: `${e.name} moved to ${d.PHASE_NAMES[to - 1]}` }); return { currentPhase: to, phaseName: d.PHASE_NAMES[to - 1], acknowledged: chk.warnings.map(x => x.code) }; });
  });
  app.post('/t/:tenantId/engagements/:id/close', { preHandler: tenantCtx }, async (req: any) => {
    needStaff(req);
    return tx(pool, async (c) => { const e = await writable(c, req.tenantId, req.params.id); if (e.currentPhase !== 5) throw new HttpError(409, 'Only an engagement in the final phase can be closed', 'not_final_phase');
      for (const cb of closeBlockers) { const why = await cb(c, req.tenantId, e.id); if (why) throw new HttpError(409, why, 'close_blocked'); }
      await d.completePhase(c, req.tenantId, e.id, 5, today()); await d.closeEngagement(c, req.tenantId, e.id); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.closed', entity: 'engagement', entityId: e.id, detail: { engagementId: e.id }, ip: req.ip }); return { ok: true }; });
  });

  // ---------- engagement team (iSecurify lead/team and the TP auditor) ----------
  app.get('/t/:tenantId/team-candidates', { preHandler: tenantCtx }, async (req: any) => {      // who can be added to an engagement team: assigned iSecurify staff + this organization's TP auditors
    needStaff(req); const [staff, members] = await Promise.all([listStaff(pool, req.tenantId), listMembers(pool, req.tenantId)]);
    return { staff: staff.filter(s => !s.expires_at || new Date(s.expires_at) > new Date()).map(s => ({ id: s.id, name: s.name, email: s.email })), auditors: members.filter(m => m.role === 'tp_auditor' && m.status === 'active').map(m => ({ id: m.id, name: m.name, email: m.email })) };
  });
  app.get('/t/:tenantId/engagements/:id/members', { preHandler: tenantCtx }, async (req: any) => { reviewers(req); const e = await visible(req, req.params.id); return d.listEngagementMembers(pool, req.tenantId, e.id); });
  app.put('/t/:tenantId/engagements/:id/members/:userId', { preHandler: tenantCtx }, async (req: any) => {
    needStaff(req); const b = ctx.parse(z.object({ role: z.enum(['lead', 'team', 'auditor']) }), req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id);
      if (b.role === 'auditor') { const m = await getMember(c, req.tenantId, req.params.userId); if (!m || m.status !== 'active' || m.role !== 'tp_auditor') throw bad('An auditor must be an active TP auditor member of this organization'); }
      else { const a = await resolveAccess(c, req.params.userId, req.tenantId); const u = (await q(c, "SELECT status FROM users WHERE id=?", [req.params.userId]))[0]; if (!a || a.via !== 'staff' || u?.status !== 'active') throw bad('The lead and team must be iSecurify team members assigned to this organization'); }
      await d.setEngagementMember(c, req.tenantId, req.params.id, req.params.userId, b.role, me(req).id);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.member_set', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, userId: req.params.userId, role: b.role }, ip: req.ip }); });
    return { ok: true };
  });
  app.delete('/t/:tenantId/engagements/:id/members/:userId', { preHandler: tenantCtx }, async (req: any) => {
    needStaff(req);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); if (!(await d.removeEngagementMember(c, req.tenantId, req.params.id, req.params.userId))) throw notFound();
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.member_removed', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, userId: req.params.userId }, ip: req.ip }); });
    return { ok: true };
  });

  // ---------- milestones, discovery, activity ----------
  app.get('/t/:tenantId/engagements/:id/milestones', { preHandler: tenantCtx }, async (req: any) => { if (!seesDetail(req)) throw forbidden(); const e = await visible(req, req.params.id); return d.listMilestones(pool, req.tenantId, e.id); });
  app.patch('/t/:tenantId/milestones/:milestoneId', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ status: z.enum(['pending', 'in_progress', 'complete']).optional(), dueDate: DateStr.nullable().optional() }), req.body);
    await tx(pool, async (c) => { const m = await d.getMilestone(c, req.tenantId, req.params.milestoneId); if (!m) throw notFound(); await writable(c, req.tenantId, m.engagementId); await d.updateMilestone(c, req.tenantId, m.id, b);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'milestone.updated', entity: 'engagement', entityId: m.engagementId, detail: { engagementId: m.engagementId, milestoneId: m.id, ...b }, ip: req.ip }); });
    return { ok: true };
  });
  app.get('/t/:tenantId/engagements/:id/discovery', { preHandler: tenantCtx }, async (req: any) => { reviewers(req); const e = await visible(req, req.params.id); const fw = await d.engagementFrameworks(pool, req.tenantId, e.id);
    const rows = await d.listDiscovery(pool, req.tenantId, e.id, fw.map(f => f.frameworkId)); return { questions: rows, answered: rows.filter(r => r.response).length, total: rows.length }; });
  app.put('/t/:tenantId/engagements/:id/discovery/:questionId', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ response: Text(5000).nullish(), notes: Text(5000).nullish() }), req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); if (!(await d.questionApplies(c, req.tenantId, req.params.id, req.params.questionId))) throw notFound();
      await d.upsertResponse(c, req.tenantId, req.params.id, req.params.questionId, b.response?.trim() || null, b.notes?.trim() || null, me(req).id);
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'discovery.answered', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, questionId: req.params.questionId }, ip: req.ip }); });
    return { ok: true };
  });
  app.get('/t/:tenantId/engagements/:id/activity', { preHandler: tenantCtx }, async (req: any) => { reviewers(req); const e = await visible(req, req.params.id);
    const f = ctx.parse(z.object({ beforeId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(200).default(50) }), req.query); return queryAudit(pool, { tenantId: req.tenantId, entity: 'engagement', entityId: e.id, ...f }); });

  // ---------- dashboard (reads ONLY from the evaluation service) ----------
  app.get('/t/:tenantId/dashboard', { preHandler: tenantCtx }, async (req: any) => {
    const scope = scopeOf(req); const list = await d.listEngagements(pool, req.tenantId, scope); const ids = list.map(e => e.id); const sum = await factsSummary(req.tenantId, ids, scope);
    const per = list.map(e => ({ id: e.id, name: e.name, status: e.status, currentPhase: e.currentPhase, phaseName: d.PHASE_NAMES[e.currentPhase - 1], summary: sum.of(e.id) }));
    const active = per.filter(p => p.status === 'active'); const overall = active.length ? mergeSummaries(active.map(p => p.summary)) : emptySummary();
    return { today: today(), engagements: { total: per.length, active: active.length, closed: per.length - active.length }, summary: overall, perEngagement: per, scope: scope.kind, freshness: sum.freshness };
  });
}

// ===================== global admin content: process templates and discovery questions =====================
export function registerEngagementAdmin(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  app.get('/process-templates', { preHandler: platformUser }, async () => {
    const t = await q(pool, 'SELECT t.id,t.name,t.framework_id frameworkId,f.name frameworkName FROM process_templates t LEFT JOIN frameworks f ON f.id=t.framework_id ORDER BY t.framework_id IS NOT NULL, t.name');
    const m = await q(pool, 'SELECT template_id templateId,phase,sort_order sortOrder,title,path_filter pathFilter FROM process_template_milestones ORDER BY phase,sort_order'); return t.map(x => ({ ...x, milestones: m.filter(y => y.templateId === x.id) }));
  });
  /** Replace the milestone list of a framework's template (frameworkId = 'default' for the generic one). Existing engagements keep their own copy. */
  app.put('/process-templates/:frameworkId', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ name: Text(190).min(1), milestones: z.array(z.object({ phase: z.number().int().min(1).max(5), title: Text(300).min(1), pathFilter: z.array(Path).min(1).nullish() })).min(1).max(200) }), req.body);
    const fid = req.params.frameworkId === 'default' ? null : ctx.parse(z.string().uuid(), req.params.frameworkId);
    await tx(pool, async (c) => {
      if (fid && !(await q(c, 'SELECT 1 x FROM frameworks WHERE id=?', [fid]))[0]) throw notFound();
      let t = (await q(c, fid ? 'SELECT id FROM process_templates WHERE framework_id=? FOR UPDATE' : 'SELECT id FROM process_templates WHERE framework_id IS NULL FOR UPDATE', fid ? [fid] : []))[0]; let id = t?.id as string;
      if (!id) { id = uuid(); await c.query('INSERT INTO process_templates(id,name,framework_id,created_by) VALUES (?,?,?,?)', [id, b.name, fid, me(req).id]); } else await c.query('UPDATE process_templates SET name=? WHERE id=?', [b.name, id]);
      await c.query('DELETE FROM process_template_milestones WHERE template_id=?', [id]); const counters = new Map<number, number>();
      await c.query('INSERT INTO process_template_milestones(id,template_id,phase,sort_order,title,path_filter) VALUES ?', [b.milestones.map(m => { const n = (counters.get(m.phase) ?? 0) + 1; counters.set(m.phase, n); return [uuid(), id, m.phase, n, m.title, m.pathFilter ? m.pathFilter.join(',') : null]; })]);
      await audit(c, { actorId: me(req).id, action: 'process_template.saved', entity: 'process_template', entityId: id, detail: { frameworkId: fid, milestones: b.milestones.length }, ip: req.ip });
    });
    return { ok: true };
  });
  app.get('/discovery-questions', { preHandler: platformUser }, async () => q(pool, 'SELECT dq.id,dq.framework_id frameworkId,f.name frameworkName,dq.domain,dq.question,dq.sort_order sortOrder,dq.active FROM discovery_questions dq LEFT JOIN frameworks f ON f.id=dq.framework_id ORDER BY dq.framework_id IS NOT NULL, f.name, dq.sort_order'));
  app.post('/discovery-questions', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ frameworkId: z.string().uuid().nullish(), domain: Text(190).min(1), question: Text(1000).min(1) }), req.body); const id = uuid();
    await tx(pool, async (c) => { if (b.frameworkId && !(await q(c, 'SELECT 1 x FROM frameworks WHERE id=?', [b.frameworkId]))[0]) throw notFound(); const n = (await q(c, 'SELECT COALESCE(MAX(sort_order),0)+1 n FROM discovery_questions WHERE framework_id <=> ?', [b.frameworkId ?? null]))[0].n;
      await c.query('INSERT INTO discovery_questions(id,framework_id,domain,question,sort_order,created_by) VALUES (?,?,?,?,?,?)', [id, b.frameworkId ?? null, b.domain, b.question, n, me(req).id]); await audit(c, { actorId: me(req).id, action: 'discovery_question.created', entity: 'discovery_question', entityId: id, ip: req.ip }); });
    reply.code(201).send({ id });
  });
  app.patch('/discovery-questions/:id', { preHandler: adminLevel }, async (req: any) => {      // questions are never deleted (answers keep their foreign key); retire with active=false
    const b = ctx.parse(z.object({ domain: Text(190).min(1).optional(), question: Text(1000).min(1).optional(), active: z.boolean().optional() }), req.body);
    await tx(pool, async (c) => { const cur = (await q(c, 'SELECT * FROM discovery_questions WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!cur) throw notFound();
      await c.query('UPDATE discovery_questions SET domain=?,question=?,active=? WHERE id=?', [b.domain ?? cur.domain, b.question ?? cur.question, b.active === undefined ? cur.active : b.active ? 1 : 0, cur.id]); await audit(c, { actorId: me(req).id, action: 'discovery_question.updated', entity: 'discovery_question', entityId: cur.id, detail: b, ip: req.ip }); });
    return { ok: true };
  });
}
