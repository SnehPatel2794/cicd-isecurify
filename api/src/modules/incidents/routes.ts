// Incident register routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). Rules live in rules.ts, SQL in data.ts.
//   anyone in the organization reports -> triage (severity, owner, notifiable) -> investigating -> contained -> resolved (root cause) -> closed (lessons, actions, authority notified)
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { notify } from '../notifications/notify'; import { deletionBlockers, manifestProviders } from '../users/hooks';
import { FORMATS, MAX_EXPORT_ROWS, sendTable } from '../../platform/tabular';
import * as r from './data';
import { isOpen, CATEGORIES, SEVERITIES, STATUSES, STATUS_LABEL, CATEGORY_LABEL, canTriage, canReport, canSeeAll, canWork, editCheck, transitionCheck, allowedTargets, summarize, type Who, type EditField } from './rules';

const Uuid = z.string().uuid(); const Text = (n: number) => z.string().trim().max(n); const Stamp = z.string().datetime({ offset: true }); const ref = (n: number) => `INC-${String(n).padStart(3, '0')}`;
const iso = (d: any) => d ? new Date(d).toISOString() : null;
export function registerIncidents(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (q: any) => ctx.U(q); const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const fail = (c: { ok: false; status: number; code: string; message: string }) => { throw new HttpError(c.status, c.message, c.code); };
  const auditI = (c: any, req: any, action: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'incident', entityId: String(detail.incidentId), detail, ip: req.ip });
  const reachable = (req: any, x: any) => canSeeAll(who(req)) || x.reportedById === me(req).id || x.ownerUserId === me(req).id;
  const load = async (req: any, id: string, lock = false, c: Conn = pool) => { const x = await r.getIncident(c, req.tenantId, id, lock); if (!x || !reachable(req, x)) throw notFound(); return x; };
  const blocker = async (c: Conn, userId: string, tenantId: string | null) => (await r.openIncidentsFor(c, userId, tenantId)).map((x: any) => ({ type: 'incident', id: x.id, label: `${x.orgName}: incident ${ref(x.n)} ${x.title}` })); if (!deletionBlockers.includes(blocker)) deletionBlockers.push(blocker);
  const manifest = async (c: any, userId: string) => ({ title: 'Incidents reported', headers: ['Organization', 'Incident', 'Status', 'Reported'], rows: (await r.incidentsReportedBy(c, userId)).map((x: any) => [x.orgName, `${ref(x.n)} ${x.title}`, x.status, new Date(x.createdAt).toISOString().slice(0, 10)]) }); if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  const shape = (req: any, x: any) => { const w = who(req), isOwner = x.ownerUserId === me(req).id, isReporter = x.reportedById === me(req).id;
    return { id: x.id, ref: ref(x.incidentNo), incidentNo: x.incidentNo, title: x.title, description: x.description, category: x.category, categoryLabel: CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL], severity: x.severity, status: x.status, statusLabel: STATUS_LABEL[x.status as keyof typeof STATUS_LABEL],
      occurredAt: iso(x.occurredAt), detectedAt: iso(x.detectedAt), reportedBy: x.reportedBy, ownerUserId: x.ownerUserId, ownerName: x.ownerName, notifiable: !!x.notifiable, authorityNotifiedAt: iso(x.authorityNotifiedAt), notificationPending: !!x.notifiable && !x.authorityNotifiedAt && x.status !== 'closed',
      rootCause: x.rootCause, correctiveActions: x.correctiveActions, lessons: x.lessons, containedAt: iso(x.containedAt), resolvedAt: iso(x.resolvedAt), closedAt: iso(x.closedAt), createdAt: x.createdAt, updatedAt: x.updatedAt, linkCount: Number(x.linkCount ?? 0), isOwner, isReporter,
      can: { edit: x.status !== 'closed' && (canTriage(w) || canWork(w, isOwner) || (isReporter && x.status === 'reported')), triage: x.status !== 'closed' && canTriage(w), link: x.status !== 'closed' && canTriage(w), transitions: allowedTargets(x.status, w, isOwner) } }; };

  app.get('/t/:tenantId/incidents', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ status: z.enum(STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), category: z.enum(CATEGORIES).optional(), mine: z.enum(['true', 'false']).optional(), open: z.enum(['true', 'false']).optional() }), req.query ?? {}); const w = who(req); const all = canSeeAll(w);
    let rows = await r.listIncidents(pool, req.tenantId, { status: f.status, severity: f.severity, category: f.category, userId: all ? (f.mine === 'true' ? me(req).id : undefined) : me(req).id }); if (f.open === 'true') rows = rows.filter((x: any) => isOpen(x.status)); if (rows.length > 2000) throw new HttpError(413, 'Too many incidents to list at once: filter by status or severity', 'too_many');
    return { can: { report: canReport(w), triage: canTriage(w) }, summary: summarize(rows.map((x: any) => ({ status: x.status, severity: x.severity, notifiable: !!x.notifiable, authorityNotifiedAt: iso(x.authorityNotifiedAt), detectedAt: iso(x.detectedAt), resolvedAt: iso(x.resolvedAt) }))), incidents: rows.map((x: any) => shape(req, x)) };
  });
  /** Export the register (same filters as the list). Only people who see every incident may export. */
  app.get('/t/:tenantId/incidents/export', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canSeeAll(who(req))) throw forbidden('Only client admins, auditors and managing iSecurify staff can export the register'); const f = ctx.parse(z.object({ format: z.enum(FORMATS).default('csv'), status: z.enum(STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), category: z.enum(CATEGORIES).optional() }), req.query ?? {});
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited'); const rows = await r.listIncidents(pool, req.tenantId, f); if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(413, 'Too many incidents to export at once: filter by status or severity', 'too_many');
    await tx(pool, c => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'export.incidents', entity: 'incident', entityId: req.tenantId, detail: { format: f.format, count: rows.length, status: f.status ?? null, severity: f.severity ?? null, category: f.category ?? null }, ip: req.ip }));
    return sendTable(reply, { base: 'incident-register', format: f.format, sheet: 'Incidents', today: new Date().toISOString().slice(0, 10), headers: ['Ref', 'Title', 'Type', 'Severity', 'Status', 'Owner', 'Reported by', 'Occurred', 'Detected', 'Contained', 'Resolved', 'Closed', 'Reportable', 'Authority notified', 'Root cause', 'Corrective actions', 'Lessons learned'],
      rows: rows.map((x: any) => [ref(x.incidentNo), x.title, CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL], x.severity, STATUS_LABEL[x.status as keyof typeof STATUS_LABEL], x.ownerName, x.reportedBy, x.occurredAt && new Date(x.occurredAt), new Date(x.detectedAt), x.containedAt && new Date(x.containedAt), x.resolvedAt && new Date(x.resolvedAt), x.closedAt && new Date(x.closedAt), !!x.notifiable, x.authorityNotifiedAt && new Date(x.authorityNotifiedAt), x.rootCause, x.correctiveActions, x.lessons]) });
  });
  /** Give several incidents the same owner in one go. Each is checked and saved on its own, so one problem never blocks the rest. */
  app.post('/t/:tenantId/incidents/bulk-assign', { preHandler: tenantCtx }, async (req: any) => {
    if (!canTriage(who(req))) throw forbidden('Only client admins and managing staff can assign owners'); const b = ctx.parse(z.object({ ids: z.array(Uuid).min(1).max(50), ownerUserId: Uuid }), req.body); const ids = [...new Set(b.ids)];
    if (!ctx.limiter.allow(`bulk:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many bulk changes. Please try again later.', 'rate_limited'); if (!(await r.isOwnerCandidate(pool, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
    const skipped: { id: string; ref?: string; reason: string }[] = []; let updated = 0;
    for (const id of ids) await tx(pool, async (c) => { const cur = await r.getIncident(c, req.tenantId, id, true); if (!cur) { skipped.push({ id, reason: 'not_found' }); return; } const ck = editCheck(cur.status, ['ownerUserId'], who(req), cur.ownerUserId === me(req).id, false); if (!ck.ok) { skipped.push({ id, ref: ref(cur.incidentNo), reason: (ck as any).code }); return; } if (cur.ownerUserId === b.ownerUserId) { skipped.push({ id, ref: ref(cur.incidentNo), reason: 'unchanged' }); return; }
      await r.updateFields(c, req.tenantId, cur.id, { ownerUserId: b.ownerUserId }); await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: cur.id, kind: 'assigned', note: 'Changed: ownerUserId (bulk)', actorId: me(req).id });
      await notify(c, { tenantId: req.tenantId, kind: 'incident.assigned', recipients: [b.ownerUserId], actorId: me(req).id, entityType: 'incident', entityId: cur.id, engagementId: null, label: `${ref(cur.incidentNo)} ${cur.title}` }); await auditI(c, req, 'incident.updated', { incidentId: cur.id, ref: ref(cur.incidentNo), fields: ['ownerUserId'], bulk: true }); updated++; });
    return { updated, skipped };
  });
  app.get('/t/:tenantId/incidents/:id', { preHandler: tenantCtx }, async (req: any) => { const x = await load(req, req.params.id); const [events, links] = await Promise.all([r.listEvents(pool, req.tenantId, x.id), r.listLinks(pool, req.tenantId, x.id)]);
    return { ...shape(req, { ...x, linkCount: links.length }), events, risks: links.map((l: any) => ({ id: l.id, riskId: l.riskId, ref: `R-${String(l.riskNo).padStart(3, '0')}`, title: l.title, status: l.status })) }; });
  const Create = z.object({ title: Text(300).min(1), description: Text(10000).min(1), category: z.enum(CATEGORIES), severity: z.enum(SEVERITIES), occurredAt: Stamp.nullish(), detectedAt: Stamp.nullish() });
  app.post('/t/:tenantId/incidents', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canReport(who(req))) throw forbidden('You cannot report incidents for this organization'); const b = ctx.parse(Create, req.body); const now = Date.now(); const det = b.detectedAt ? new Date(b.detectedAt) : new Date(now); const occ = b.occurredAt ? new Date(b.occurredAt) : null;
    if (det.getTime() > now + 300_000) throw bad('The detection time cannot be in the future'); if (occ && occ > det) throw bad('The incident cannot have happened after it was detected');
    if (!ctx.limiter.allow(`incident:${me(req).id}`, 30, 3600_000)) throw new HttpError(429, 'Too many incidents reported. Please try again later.', 'rate_limited'); const id = uuid(); let no = 0;
    await tx(pool, async (c) => { await r.lockTenant(c, req.tenantId); no = await r.nextNo(c, req.tenantId); await r.insertIncident(c, req.tenantId, { id, no, title: b.title, description: b.description, category: b.category, severity: b.severity, occurredAt: occ, detectedAt: det, reportedBy: me(req).id });
      await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: id, kind: 'created', to: 'reported', actorId: me(req).id });
      if (b.severity === 'high' || b.severity === 'critical') await notify(c, { tenantId: req.tenantId, kind: 'incident.reported', recipients: (await r.admins(c, req.tenantId)).map((a: any) => a.id), actorId: me(req).id, entityType: 'incident', entityId: id, engagementId: null, label: `${ref(no)} ${b.title}` });
      await auditI(c, req, 'incident.reported', { incidentId: id, ref: ref(no), category: b.category, severity: b.severity }); });
    reply.code(201).send({ id, ref: ref(no), incidentNo: no });
  });
  const Patch = z.object({ title: Text(300).min(1).optional(), description: Text(10000).min(1).optional(), category: z.enum(CATEGORIES).optional(), severity: z.enum(SEVERITIES).optional(), ownerUserId: Uuid.nullable().optional(), notifiable: z.boolean().optional(), authorityNotifiedAt: Stamp.nullable().optional(),
    occurredAt: Stamp.nullable().optional(), detectedAt: Stamp.optional(), rootCause: Text(10000).nullable().optional(), correctiveActions: Text(10000).nullable().optional(), lessons: Text(10000).nullable().optional(), note: Text(2000).nullish() });
  const norm = (k: string, v: any) => ['occurredAt', 'detectedAt', 'authorityNotifiedAt'].includes(k) ? (v ? new Date(v) : null) : (typeof v === 'string' && ['rootCause', 'correctiveActions', 'lessons'].includes(k) ? (v.trim() || null) : v);
  app.patch('/t/:tenantId/incidents/:id', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Patch, req.body); const { note, ...raw } = b; const patch: Record<string, any> = {}; for (const [k, v] of Object.entries(raw)) if (v !== undefined) patch[k] = norm(k, v); if (!Object.keys(patch).length) throw bad('Nothing to change');
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id, isReporter = cur.reportedById === me(req).id;
      const ck = editCheck(cur.status, Object.keys(patch) as EditField[], who(req), isOwner, isReporter); if (!ck.ok) fail(ck as any);
      if (patch.ownerUserId) { if (!(await r.isOwnerCandidate(c, req.tenantId, patch.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization'); } if (patch.ownerUserId === null && cur.status !== 'reported') throw bad('An incident that is being worked on needs an owner');
      const occ = 'occurredAt' in patch ? patch.occurredAt : cur.occurredAt, det = 'detectedAt' in patch ? patch.detectedAt : cur.detectedAt; if (occ && det && new Date(occ) > new Date(det)) throw bad('The incident cannot have happened after it was detected'); if ('detectedAt' in patch && patch.detectedAt.getTime() > Date.now() + 300_000) throw bad('The detection time cannot be in the future');
      const notifiable = 'notifiable' in patch ? patch.notifiable : !!cur.notifiable, notified = 'authorityNotifiedAt' in patch ? patch.authorityNotifiedAt : cur.authorityNotifiedAt;
      if (notified && !notifiable) throw bad('Mark the incident as notifiable before recording that the authorities were told'); if (notified && notified.getTime() > Date.now() + 300_000) throw bad('The notification time cannot be in the future');
      const same = (k: string) => { const a = (cur as any)[k], v = patch[k]; return v instanceof Date ? a && new Date(a).getTime() === v.getTime() : (k === 'notifiable' ? !!a === v : a === v); };
      const changed = Object.keys(patch).filter(k => !same(k)); if (!changed.length) return; await r.updateFields(c, req.tenantId, cur.id, patch);
      const kind = changed.includes('ownerUserId') ? 'assigned' : changed.some(k => ['severity', 'notifiable', 'authorityNotifiedAt'].includes(k)) ? 'triaged' : 'edited'; await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: cur.id, kind, note: note ?? `Changed: ${changed.join(', ')}`, actorId: me(req).id });
      if (changed.includes('ownerUserId') && patch.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'incident.assigned', recipients: [patch.ownerUserId], actorId: me(req).id, entityType: 'incident', entityId: cur.id, engagementId: null, label: `${ref(cur.incidentNo)} ${cur.title}` });
      if (changed.includes('severity') && ['high', 'critical'].includes(patch.severity) && !['high', 'critical'].includes(cur.severity)) await notify(c, { tenantId: req.tenantId, kind: 'incident.reported', recipients: (await r.admins(c, req.tenantId)).map((a: any) => a.id), actorId: me(req).id, entityType: 'incident', entityId: cur.id, engagementId: null, label: `${ref(cur.incidentNo)} ${cur.title}` });
      await auditI(c, req, 'incident.updated', { incidentId: cur.id, ref: ref(cur.incidentNo), fields: changed }); });
    return { ok: true };
  });
  const Transition = z.object({ to: z.enum(STATUSES), note: Text(2000).nullish(), rootCause: Text(10000).nullable().optional(), correctiveActions: Text(10000).nullable().optional(), lessons: Text(10000).nullable().optional(), authorityNotifiedAt: Stamp.nullable().optional() });
  app.post('/t/:tenantId/incidents/:id/transition', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Transition, req.body);
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id; const trim = (v: any) => typeof v === 'string' ? (v.trim() || null) : v; const inp = { note: b.note, rootCause: trim(b.rootCause), correctiveActions: trim(b.correctiveActions), lessons: trim(b.lessons), authorityNotifiedAt: b.authorityNotifiedAt === undefined ? undefined : b.authorityNotifiedAt };
      if (b.authorityNotifiedAt && !cur.notifiable) throw bad('Mark the incident as notifiable before recording that the authorities were told'); if (b.authorityNotifiedAt && new Date(b.authorityNotifiedAt).getTime() > Date.now() + 300_000) throw bad('The notification time cannot be in the future');
      const ck = transitionCheck({ status: cur.status, ownerUserId: cur.ownerUserId, notifiable: !!cur.notifiable, authorityNotifiedAt: iso(cur.authorityNotifiedAt), rootCause: cur.rootCause, correctiveActions: cur.correctiveActions, lessons: cur.lessons }, b.to, who(req), isOwner, inp); if (!ck.ok) fail(ck as any);
      await r.setStatus(c, req.tenantId, cur.id, b.to, { rootCause: inp.rootCause, correctiveActions: inp.correctiveActions, lessons: inp.lessons, authorityNotifiedAt: b.authorityNotifiedAt === undefined ? undefined : b.authorityNotifiedAt ? new Date(b.authorityNotifiedAt) : null });
      await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: cur.id, kind: 'status', from: cur.status, to: b.to, note: b.note ?? null, actorId: me(req).id });
      await auditI(c, req, 'incident.status', { incidentId: cur.id, ref: ref(cur.incidentNo), from: cur.status, to: b.to }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/incidents/:id/comments', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ note: Text(5000).min(1) }), req.body); const x = await load(req, req.params.id); if (x.status === 'closed') throw conflict('This incident is closed. Reopen it to comment');
    await tx(pool, async (c) => { await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: x.id, kind: 'comment', note: b.note, actorId: me(req).id }); }); reply.code(201).send({ ok: true });
  });
  // ---------------------------------------------------------------- links to risks of the register
  app.post('/t/:tenantId/incidents/:id/risks', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ riskId: Uuid }), req.body); const id = uuid();
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); if (!canTriage(who(req))) throw forbidden('Only client admins and managing staff can link risks'); if (cur.status === 'closed') throw conflict('This incident is closed. Reopen it to change its links'); if (!(await r.riskExists(c, req.tenantId, b.riskId))) throw notFound();
      try { await r.insertLink(c, req.tenantId, { id, incidentId: cur.id, riskId: b.riskId, by: me(req).id }); } catch (e: any) { if (e.code === 'ER_DUP_ENTRY') throw conflict('This risk is already linked'); throw e; }
      await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: cur.id, kind: 'link', note: 'Linked a risk', actorId: me(req).id }); await auditI(c, req, 'incident.linked', { incidentId: cur.id, ref: ref(cur.incidentNo), riskId: b.riskId }); });
    reply.code(201).send({ id });
  });
  app.delete('/t/:tenantId/incidents/:id/risks/:linkId', { preHandler: tenantCtx }, async (req: any) => {
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); if (!canTriage(who(req))) throw forbidden(); if (cur.status === 'closed') throw conflict('This incident is closed. Reopen it to change its links');
      const l = await r.getLink(c, req.tenantId, cur.id, req.params.linkId); if (!l) throw notFound(); await r.deleteLink(c, req.tenantId, l.id); await r.addEvent(c, req.tenantId, { id: uuid(), incidentId: cur.id, kind: 'unlink', note: 'Unlinked a risk', actorId: me(req).id }); await auditI(c, req, 'incident.unlinked', { incidentId: cur.id, ref: ref(cur.incidentNo), linkId: l.id }); });
    return { ok: true };
  });
}
