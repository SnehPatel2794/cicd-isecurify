// Findings routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). The rules live in rules.ts; SQL lives in data.ts.
//   raise (auditor / iSecurify staff) -> assign owner + due date (client admin / staff) -> remediate (owner) -> ready for retest -> close (auditor) | back to remediation
//   Every change adds an append-only event. Unresolved findings of at least medium severity stop their control from being "effective" and stop the engagement from being closed.
import { notify } from '../notifications/notify';
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { FORMATS, MAX_EXPORT_ROWS, sendTable } from '../../platform/tabular';
import * as d from '../engagements/data'; import { scopeOf as scopeOfAccess, writableEngagement, closeBlockers } from '../engagements/access'; import { deletionBlockers, manifestProviders } from '../users/hooks';
import * as f from './data'; import { parseImport, importKey, MAX_BYTES, type Draft } from './import'; import crypto from 'node:crypto';
import { vaptData as vr } from '../vapt/routes'; import { SEVERITIES, STATUSES, STATUS_LABEL, DEFAULT_DAYS, canAssess, canAssign, canRemediate, canLinkEvidence, ageing, overdueBucket, allowedTransitions, transitionCheck, editCheck, isBlocking, isOverdue, summarize, TERMINAL, type Who, type FStatus, type EditField } from './rules';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
const Text = (n: number) => z.string().trim().max(n); const Uuid = z.string().uuid(); const today = () => new Date().toISOString().slice(0, 10);
const FIELD_LABEL: Record<EditField, string> = { title: 'title', description: 'description', recommendation: 'recommendation', severity: 'severity', ownerUserId: 'owner', dueDate: 'due date', remediationPlan: 'remediation plan' };

export function registerFindings(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const scopeOf = (req: any) => scopeOfAccess(req.access, me(req).id);
  const visibleEngagement = async (c: Conn, req: any, id: string) => { const eng = await d.getVisibleEngagement(c, req.tenantId, id, scopeOf(req)); if (!eng) throw notFound(); return eng; };
  /** client staff / vendors reach only findings they own or on items assigned to them; everything else is a 404, never a 403. */
  const reachable = (req: any, x: { ownerUserId: string | null; accountableUserId: string | null }) => scopeOf(req).kind !== 'assigned' || x.ownerUserId === me(req).id || x.accountableUserId === me(req).id;
  /** Owning a finding is enough to reach it, even when none of the engagement's items is assigned to you (the organization-wide list shows those findings, so the detail must open). */
  const loadFinding = async (req: any, id: string) => { const x = await f.getFinding(pool, req.tenantId, id); if (!x) throw notFound(); if (!reachable(req, x)) throw notFound();
    const owner = scopeOf(req).kind === 'assigned' && x.ownerUserId === me(req).id; const eng = owner ? await d.getVisibleEngagement(pool, req.tenantId, x.engagementId, { kind: 'all' }) : await visibleEngagement(pool, req, x.engagementId); if (!eng) throw notFound(); return { x, eng }; };
  const auditF = (c: any, req: any, action: string, engagementId: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'engagement', entityId: engagementId, detail: { engagementId, ...detail }, ip: req.ip });
  const fail = (c: { ok: false; status: number; code: string; message: string }) => { throw new HttpError(c.status, c.message, c.code); };

  // Hooks into other modules (registered once).
  const closeCheck = async (c: Conn, tenantId: string, engagementId: string) => { const n = await f.unresolvedCount(c, tenantId, engagementId); return n ? `${n} unresolved finding${n === 1 ? '' : 's'} of medium severity or above must be closed or risk-accepted before the engagement can be closed` : null; };
  if (!closeBlockers.includes(closeCheck)) closeBlockers.push(closeCheck);
  const openBlocker = async (c: Conn, userId: string, tenantId: string | null) => (await f.openFindingsFor(c, userId, tenantId)).map(r => ({ type: 'finding', id: r.id, label: `${r.engagementName}: finding F-${String(r.n).padStart(3, '0')} ${r.title}` }));
  if (!deletionBlockers.includes(openBlocker)) deletionBlockers.push(openBlocker);
  const manifest = async (c: any, userId: string) => ({ title: 'Findings raised', headers: ['Engagement', 'Finding', 'Severity', 'Status', 'Raised'], rows: (await f.findingsRaisedBy(c, userId)).map(r => [r.engagementName, `F-${String(r.n).padStart(3, '0')} ${r.title}`, r.severity, r.status, new Date(r.createdAt).toISOString().slice(0, 10)]) });
  if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  // ---------------------------------------------------------------- shaping
  const ref = (n: number) => `F-${String(n).padStart(3, '0')}`;
  const shape = (req: any, x: any, closed: boolean) => {
    const w = who(req), isOwner = x.ownerUserId === me(req).id, t = today(); const live = !closed; const terminal = TERMINAL.includes(x.status);
    return { id: x.id, ref: ref(x.findingNo), findingNo: x.findingNo, engagementId: x.engagementId, itemId: x.itemId, itemRef: x.itemRef, itemTitle: x.itemTitle, title: x.title, description: x.description, recommendation: x.recommendation, severity: x.severity, status: x.status, statusLabel: STATUS_LABEL[x.status as FStatus],
      ownerUserId: x.ownerUserId, ownerName: x.ownerName, dueDate: x.dueDate, remediationPlan: x.remediationPlan, raisedBy: x.raisedByName, createdAt: x.createdAt, updatedAt: x.updatedAt, closedAt: x.closedAt,
      roundId: x.roundId ?? null, blocking: isBlocking(x.status, x.severity), overdue: isOverdue(x.status, x.dueDate, t), isOwner, engagementName: x.engagementName, ...ageing(new Date(x.createdAt).toISOString(), x.status, x.dueDate, t),
      can: { transitions: live ? allowedTransitions(x.status, w, isOwner) : [], edit: live && !terminal && canAssess(w), assign: live && !terminal && canAssign(w), plan: live && !terminal && canRemediate(w, isOwner), comment: live, linkEvidence: live && !terminal && canLinkEvidence(w, isOwner) } };
  };

  // ---------------------------------------------------------------- reading
  app.get('/t/:tenantId/engagements/:id/findings', { preHandler: tenantCtx }, async (req: any) => {
    const q = ctx.parse(z.object({ status: z.enum(STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), itemId: Uuid.optional(), ownerUserId: Uuid.optional(), unresolved: z.enum(['true', 'false']).optional() }), req.query);
    const eng = await visibleEngagement(pool, req, req.params.id); const sc = scopeOf(req); const assignedUserId = sc.kind === 'assigned' ? sc.userId : undefined; const closed = eng.status === 'closed';
    const [rows, sumRows] = await Promise.all([f.listFindings(pool, req.tenantId, eng.id, { assignedUserId, status: q.status, severity: q.severity, itemId: q.itemId, ownerUserId: q.ownerUserId, unresolved: q.unresolved === 'true' }), f.summaryRows(pool, req.tenantId, eng.id, today(), assignedUserId)]);
    return { engagementId: eng.id, engagementStatus: eng.status, canRaise: !closed && canAssess(who(req)), summary: summarize(sumRows, today()), truncated: rows.length > 2000, findings: rows.slice(0, 2000).map(x => shape(req, x, closed)) };
  });
  app.get('/t/:tenantId/checklist/:itemId/findings', { preHandler: tenantCtx }, async (req: any) => {
    const it = await d.getItem(pool, req.tenantId, req.params.itemId); if (!it) throw notFound(); const eng = await visibleEngagement(pool, req, it.engagementId); const closed = eng.status === 'closed';
    const rows = (await f.listItemFindings(pool, req.tenantId, it.id)).filter(x => reachable(req, x));
    if (scopeOf(req).kind === 'assigned' && it.accountableUserId !== me(req).id && !rows.length) throw notFound();
    return { item: { id: it.id, ref: it.ref, title: it.title, readiness: it.readiness }, engagementId: eng.id, engagementStatus: eng.status, canRaise: !closed && canAssess(who(req)) && it.readiness !== 'not_applicable', defaultDays: DEFAULT_DAYS, findings: rows.map(x => shape(req, x, closed)) };
  });
  /** Export the organization-wide findings list (same filters and the same visibility as the list). */
  app.get('/t/:tenantId/findings-export', { preHandler: tenantCtx }, async (req: any, reply) => {
    const q = ctx.parse(z.object({ format: z.enum(FORMATS).default('csv'), engagementId: Uuid.optional(), mine: z.enum(['true', 'false']).optional(), status: z.enum(STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), unresolved: z.enum(['true', 'false']).optional(), overdue: z.enum(['true', 'false']).optional(), awaitingRetest: z.enum(['true', 'false']).optional() }), req.query ?? {});
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited'); const t = today();
    const rows = await f.listOrgFindings(pool, req.tenantId, scopeOf(req), { engagementId: q.engagementId, mineUserId: q.mine === 'true' ? me(req).id : undefined, status: q.status, severity: q.severity, unresolved: q.unresolved === 'true', awaitingRetest: q.awaitingRetest === 'true', overdueToday: q.overdue === 'true' ? t : undefined }); if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(413, 'Too many findings to export at once: filter by status or severity', 'too_many');
    await tx(pool, c => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'export.findings', entity: 'finding', entityId: req.tenantId, detail: { format: q.format, count: rows.length, status: q.status ?? null, severity: q.severity ?? null }, ip: req.ip }));
    const list = rows.map(x => shape(req, x, x.engagementStatus === 'closed'));
    return sendTable(reply, { base: 'findings', format: q.format, sheet: 'Findings', today: t, headers: ['Ref', 'Engagement', 'Control', 'Title', 'Severity', 'Status', 'Owner', 'Due date', 'Overdue', 'Days overdue', 'Raised by', 'Raised', 'Closed'], rows: list.map((x: any) => [x.ref, x.engagementName, x.itemRef, x.title, x.severity, x.statusLabel, x.ownerName, x.dueDate, x.overdue, x.daysOverdue ?? '', x.raisedBy, x.createdAt && new Date(x.createdAt), x.closedAt && new Date(x.closedAt)]) });
  });
  app.get('/t/:tenantId/findings/:id', { preHandler: tenantCtx }, async (req: any) => { const { x, eng } = await loadFinding(req, req.params.id); const evs = (await f.listFindingEvidence(pool, req.tenantId, x.id)).map((r: any) => ({ ...r, expired: r.status === 'accepted' && !!r.validUntil && r.validUntil < today() })); return { ...shape(req, x, eng.status === 'closed'), engagementName: eng.name, events: await f.listEvents(pool, req.tenantId, x.id), evidence: evs }; });
  app.get('/t/:tenantId/findings/:id/linkable-evidence', { preHandler: tenantCtx }, async (req: any) => { const { x } = await loadFinding(req, req.params.id); if (!canLinkEvidence(who(req), x.ownerUserId === me(req).id)) throw forbidden(); return f.listLinkable(pool, req.tenantId, x.id, x.itemId); });

  /** Remediation tracking across all engagements the caller can see: "my findings", overdue, awaiting retest. */
  app.get('/t/:tenantId/findings', { preHandler: tenantCtx }, async (req: any) => {
    const q = ctx.parse(z.object({ engagementId: Uuid.optional(), mine: z.enum(['true', 'false']).optional(), status: z.enum(STATUSES).optional(), severity: z.enum(SEVERITIES).optional(), unresolved: z.enum(['true', 'false']).optional(), overdue: z.enum(['true', 'false']).optional(), awaitingRetest: z.enum(['true', 'false']).optional() }), req.query);
    const sc = scopeOf(req); const t = today();
    const [rows, sumRows] = await Promise.all([f.listOrgFindings(pool, req.tenantId, sc, { engagementId: q.engagementId, mineUserId: q.mine === 'true' ? me(req).id : undefined, status: q.status, severity: q.severity, unresolved: q.unresolved === 'true', awaitingRetest: q.awaitingRetest === 'true', overdueToday: q.overdue === 'true' ? t : undefined }), f.orgSummaryRows(pool, req.tenantId, sc, t)]);
    const findings = rows.slice(0, 2000).map(x => shape(req, x, x.engagementStatus === 'closed')); const buckets: Record<string, number> = { '1-7': 0, '8-30': 0, '31-90': 0, '90+': 0 }; for (const x of findings) { const b = overdueBucket(x.daysOverdue); if (b) buckets[b]++; }
    return { today: t, summary: summarize(sumRows, t), overdueBuckets: buckets, truncated: rows.length > 2000, findings };
  });
  app.post('/t/:tenantId/findings/:id/evidence', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ requestId: Uuid }), req.body); const { x } = await loadFinding(req, req.params.id);
    await tx(pool, async (c) => {
      await writableEngagement(c, req.tenantId, x.engagementId); await f.lockFinding(c, req.tenantId, x.id); const cur = await f.getFinding(c, req.tenantId, x.id); if (!cur) throw notFound();
      if (TERMINAL.includes(cur.status)) throw new HttpError(409, 'This finding is closed. Reopen it to attach evidence.', 'finding_closed'); if (!canLinkEvidence(who(req), cur.ownerUserId === me(req).id)) throw forbidden('You cannot attach evidence to this finding');
      const r = await f.requestStatus(c, req.tenantId, b.requestId); if (!r || r.itemId !== cur.itemId) throw bad('That evidence request does not belong to the same checklist item'); if (r.status === 'cancelled') throw conflict('That evidence request was cancelled');
      try { await f.linkEvidence(c, req.tenantId, cur.id, b.requestId, cur.itemId, me(req).id); } catch (e: any) { if (e?.code === 'ER_DUP_ENTRY') throw conflict('That evidence is already attached to this finding'); throw e; }
      await f.addEvent(c, req.tenantId, { id: uuid(), findingId: cur.id, kind: 'evidence', note: `Attached evidence request: ${r.title}`, actorId: me(req).id });
      await auditF(c, req, 'finding.evidence_linked', cur.engagementId, { findingId: cur.id, ref: ref(cur.findingNo), requestId: b.requestId });
    });
    reply.code(201).send({ ok: true });
  });

  // ---------------------------------------------------------------- raising and changing
const okRound = async (c: any, tenantId: string, engId: string, roundId?: string | null) => { if (!roundId) return; const r = await vr.inEngagement(c, tenantId, engId, roundId); if (!r) throw bad('That VAPT round does not belong to this engagement'); if (r.status === 'closed' || r.status === 'cancelled') throw conflict('That VAPT round is closed'); };
  const Create = z.object({ title: Text(300).min(1), description: Text(10000).min(1), severity: z.enum(SEVERITIES), recommendation: Text(10000).nullish(), ownerUserId: Uuid.nullish(), dueDate: DateStr.nullish(), roundId: Uuid.nullish() });
  // ---------------------------------------------------------------- import scanner / VAPT results (Phase 8C)
  const ImportBody = z.object({ format: z.enum(['csv', 'json']), content: z.string().min(1).max(MAX_BYTES + 1000), filename: Text(200).min(1), defaultItemRef: Text(100).nullish(), roundId: Uuid.nullish(), commit: z.boolean().default(false), skipInvalid: z.boolean().default(false) });
  /** Decides what each row would do: create, skip as a duplicate, or fail. Used identically for the preview and the real import. */
  async function plan(c: Conn, req: any, engagementId: string, drafts: Draft[], defaultRef: string | null) {
    const items: any[] = await d.listItems(c, req.tenantId, engagementId, scopeOf(req), today()); const byRef = new Map(items.map(i => [String(i.ref).toLowerCase(), i]));
    const rows = drafts.map(dr => { const ref = (dr.itemRef ?? defaultRef ?? '').trim(); const it = ref ? byRef.get(ref.toLowerCase()) : null; let error: string | null = null;
      if (!ref) error = 'No checklist item: add an "item" column or choose a default item'; else if (!it) error = `Unknown checklist item "${ref.slice(0, 40)}"`; else if (it.readiness === 'not_applicable') error = `Checklist item ${it.ref} is not applicable`;
      return { draft: dr, item: it ?? null, error, key: it && !error ? importKey(dr, it.id) : null, duplicate: false as boolean }; });
    const existing = await f.existingImportKeys(c, req.tenantId, engagementId, rows.map(r => r.key).filter(Boolean) as string[]); const seen = new Set<string>();
    for (const r of rows) if (r.key) { if (existing.has(r.key) || seen.has(r.key)) r.duplicate = true; seen.add(r.key); } return rows;
  }
  app.post('/t/:tenantId/engagements/:id/findings/import', { preHandler: tenantCtx, bodyLimit: 3 * 1024 * 1024 }, async (req: any, reply) => {
    if (!canAssess(who(req))) throw forbidden('Only the TP auditor and iSecurify team members with manage rights can import findings');
    const b = ctx.parse(ImportBody, req.body); if (!ctx.limiter.allow(`fimport:${me(req).id}`, b.commit ? 20 : 60, 3600_000)) throw new HttpError(429, 'Too many imports. Please try again later.', 'rate_limited');
    const eng = await visibleEngagement(pool, req, req.params.id); if (b.commit && eng.status === 'closed') throw new HttpError(409, 'This engagement is closed', 'engagement_closed');
    const parsed = parseImport(b.format, b.content); if (!parsed.ok) throw bad((parsed as any).message);
    const show = (rows: Awaited<ReturnType<typeof plan>>) => rows.map(r => ({ row: r.draft.row, title: r.draft.title, severity: r.draft.severity, itemRef: r.item?.ref ?? null, host: r.draft.host, status: r.error ? 'invalid' : r.duplicate ? 'duplicate' : 'new', message: r.error }))
      .concat(parsed.errors.map(e => ({ row: e.row, title: '', severity: null as any, itemRef: null, host: null, status: 'invalid', message: e.message }))).sort((a, b) => a.row - b.row);
    const tally = (rows: Awaited<ReturnType<typeof plan>>) => { const ok = rows.filter(r => !r.error && !r.duplicate); const sev: Record<string, number> = {}; for (const r of ok) sev[r.draft.severity] = (sev[r.draft.severity] ?? 0) + 1;
      return { total: parsed.total, willCreate: ok.length, duplicates: rows.filter(r => r.duplicate && !r.error).length, invalid: rows.filter(r => r.error).length + parsed.errors.length, bySeverity: sev }; };
    if (!b.commit) { const rows = await plan(pool, req, eng.id, parsed.drafts, b.defaultItemRef ?? null); return { committed: false, ...tally(rows), rows: show(rows).slice(0, 300) }; }
    const sha = crypto.createHash('sha256').update(b.content).digest('hex'); const importId = uuid(); let result: any;
    await tx(pool, async (c) => {
      await writableEngagement(c, req.tenantId, eng.id); await okRound(c, req.tenantId, eng.id, b.roundId); const rows = await plan(c, req, eng.id, parsed.drafts, b.defaultItemRef ?? null); const t = tally(rows);
      if (t.invalid && !b.skipInvalid) throw new HttpError(409, `${t.invalid} row${t.invalid === 1 ? ' is' : 's are'} invalid. Fix the file, or choose to skip invalid rows.`, 'invalid_rows');
      if (!t.willCreate) throw new HttpError(409, 'Nothing to import: every row is either a duplicate or invalid', 'nothing_to_import');
      const ids = [...new Set(rows.filter(r => !r.error && !r.duplicate).map(r => r.item.id as string))]; await d.lockItems(c, req.tenantId, eng.id, ids);
      await f.insertImport(c, req.tenantId, { id: importId, engagementId: eng.id, sourceName: b.filename, format: b.format, sha256: sha, total: t.total, created: t.willCreate, duplicates: t.duplicates, invalid: t.invalid, importedBy: me(req).id });
      let no = await f.nextNo(c, req.tenantId, eng.id);
      for (const r of rows) { if (r.error || r.duplicate) continue; const id = uuid();
        await f.insertImported(c, req.tenantId, { id, engagementId: eng.id, itemId: r.item.id, no, title: r.draft.title, description: r.draft.description, recommendation: r.draft.recommendation, severity: r.draft.severity, raisedBy: me(req).id, importId, importKey: r.key!, roundId: b.roundId ?? null });
        await f.addEvent(c, req.tenantId, { id: uuid(), findingId: id, kind: 'raised', to: 'open', note: `Imported from ${b.filename} (row ${r.draft.row})`, actorId: me(req).id }); no++; }
      await auditF(c, req, 'finding.imported', eng.id, { importId, source: b.filename, format: b.format, sha256: sha, created: t.willCreate, duplicates: t.duplicates, invalid: t.invalid, bySeverity: t.bySeverity });
      result = { committed: true, importId, ...t, rows: show(rows).slice(0, 300) };
    });
    reply.code(201).send(result);
  });
  app.get('/t/:tenantId/engagements/:id/findings/imports', { preHandler: tenantCtx }, async (req: any) => { if (!canAssess(who(req))) throw forbidden('Only the TP auditor and iSecurify team members with manage rights can see imports'); const eng = await visibleEngagement(pool, req, req.params.id); return { imports: await f.listImports(pool, req.tenantId, eng.id) }; });
  app.post('/t/:tenantId/checklist/:itemId/findings', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canAssess(who(req))) throw forbidden('Only the TP auditor and iSecurify team members with manage rights can raise findings');
    const b = ctx.parse(Create, req.body); const it = await d.getItem(pool, req.tenantId, req.params.itemId); if (!it) throw notFound(); await visibleEngagement(pool, req, it.engagementId); const id = uuid(); let no = 0;
    if (b.ownerUserId && !canAssign(who(req))) throw forbidden('Only client admins and iSecurify team members can assign an owner');
    await tx(pool, async (c) => {
      const [item] = await d.lockItems(c, req.tenantId, it.engagementId, [it.id]); if (!item) throw notFound(); await writableEngagement(c, req.tenantId, it.engagementId);
      if (item.readiness === 'not_applicable') throw conflict('Findings cannot be raised against an item that is not applicable'); await okRound(c, req.tenantId, it.engagementId, b.roundId);
      if (b.ownerUserId && !(await f.isOwnerCandidate(c, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
      no = await f.nextNo(c, req.tenantId, it.engagementId);
      await f.insertFinding(c, req.tenantId, { id, engagementId: it.engagementId, itemId: it.id, no, title: b.title, description: b.description, recommendation: b.recommendation, severity: b.severity, ownerUserId: b.ownerUserId, dueDate: b.dueDate, raisedBy: me(req).id, roundId: b.roundId ?? null });
      await f.addEvent(c, req.tenantId, { id: uuid(), findingId: id, kind: 'raised', to: 'open', note: null, actorId: me(req).id });
      if (b.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'finding.assigned', recipients: [b.ownerUserId], actorId: me(req).id, entityType: 'finding', entityId: id, engagementId: it.engagementId, label: `${ref(no)} ${b.title}` });
      await auditF(c, req, 'finding.raised', it.engagementId, { findingId: id, ref: ref(no), itemId: it.id, itemRef: it.ref, severity: b.severity, title: b.title });
    });
    reply.code(201).send({ id, ref: ref(no), findingNo: no });
  });
  const Patch = z.object({ title: Text(300).min(1).optional(), description: Text(10000).min(1).optional(), recommendation: Text(10000).nullable().optional(), severity: z.enum(SEVERITIES).optional(), ownerUserId: Uuid.nullable().optional(), dueDate: DateStr.nullable().optional(), remediationPlan: Text(10000).nullable().optional(), note: Text(2000).nullish() });
  app.patch('/t/:tenantId/findings/:id', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Patch, req.body); const { note, ...patch } = b; const { x } = await loadFinding(req, req.params.id);
    const result = await tx(pool, async (c) => {
      await writableEngagement(c, req.tenantId, x.engagementId); await f.lockFinding(c, req.tenantId, x.id); const cur = await f.getFinding(c, req.tenantId, x.id); if (!cur) throw notFound();
      const changed = (Object.keys(patch) as EditField[]).filter(k => (patch as any)[k] !== undefined && ((patch as any)[k] ?? null) !== ((cur as any)[k] ?? null)); if (!changed.length) return { ok: true, changed };
      const chk = editCheck(changed, cur.status, who(req), cur.ownerUserId === me(req).id); if (!chk.ok) fail(chk as any);
      if (changed.includes('severity') && !(note ?? '').trim()) throw new HttpError(400, 'A note is required when the severity changes', 'note_required');
      if (changed.includes('ownerUserId') && patch.ownerUserId && !(await f.isOwnerCandidate(c, req.tenantId, patch.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
      await f.updateFields(c, req.tenantId, cur.id, Object.fromEntries(changed.map(k => [k, (patch as any)[k]])));
      const onlyAssign = changed.every(k => k === 'ownerUserId' || k === 'dueDate');
      await f.addEvent(c, req.tenantId, { id: uuid(), findingId: cur.id, kind: onlyAssign ? 'assigned' : 'edited', note: `Changed: ${changed.map(k => FIELD_LABEL[k]).join(', ')}${(note ?? '').trim() ? ' — ' + note!.trim() : ''}`, actorId: me(req).id });
      if (changed.includes('ownerUserId') && patch.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'finding.assigned', recipients: [patch.ownerUserId], actorId: me(req).id, entityType: 'finding', entityId: cur.id, engagementId: cur.engagementId, label: `${ref(cur.findingNo)} ${patch.title ?? cur.title}` });
      await auditF(c, req, 'finding.updated', cur.engagementId, { findingId: cur.id, ref: ref(cur.findingNo), fields: changed, ...(changed.includes('severity') ? { from: cur.severity, to: patch.severity } : {}) });
      return { ok: true, changed };
    });
    return result;
  });
  app.post('/t/:tenantId/findings/:id/transition', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ to: z.enum(STATUSES), note: Text(5000).nullish() }), req.body); const { x } = await loadFinding(req, req.params.id);
    return tx(pool, async (c) => {
      await writableEngagement(c, req.tenantId, x.engagementId); await f.lockFinding(c, req.tenantId, x.id); const cur = await f.getFinding(c, req.tenantId, x.id); if (!cur) throw notFound();
      const chk = transitionCheck(cur.status, b.to, who(req), cur.ownerUserId === me(req).id, b.note); if (!chk.ok) fail(chk as any);
      await f.setStatus(c, req.tenantId, cur.id, b.to); await f.addEvent(c, req.tenantId, { id: uuid(), findingId: cur.id, kind: 'status', from: cur.status, to: b.to, note: (b.note ?? '').trim() || null, actorId: me(req).id });
      { const label = `${ref(cur.findingNo)} ${cur.title}`; const base = { tenantId: req.tenantId, actorId: me(req).id, entityType: 'finding' as const, entityId: cur.id, engagementId: cur.engagementId, label };
        if (b.to === 'ready_for_retest') await notify(c, { ...base, kind: 'finding.ready_for_retest', recipients: [cur.raisedBy] });
        else if (b.to === 'closed' || b.to === 'risk_accepted' || b.to === 'cancelled') await notify(c, { ...base, kind: 'finding.closed', recipients: [cur.ownerUserId] });
        else if (cur.status !== 'open' && (b.to === 'open' || b.to === 'in_remediation')) await notify(c, { ...base, kind: 'finding.reopened', recipients: [cur.ownerUserId] }); }
      await auditF(c, req, 'finding.status_changed', cur.engagementId, { findingId: cur.id, ref: ref(cur.findingNo), from: cur.status, to: b.to }); return { ok: true, status: b.to };
    });
  });
  app.post('/t/:tenantId/findings/:id/comments', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ note: Text(5000).min(1) }), req.body); const { x } = await loadFinding(req, req.params.id); const id = uuid();
    await tx(pool, async (c) => { await writableEngagement(c, req.tenantId, x.engagementId); await f.addEvent(c, req.tenantId, { id, findingId: x.id, kind: 'comment', note: b.note, actorId: me(req).id }); await notify(c, { tenantId: req.tenantId, kind: 'finding.comment', recipients: [x.ownerUserId, x.raisedBy], actorId: me(req).id, entityType: 'finding', entityId: x.id, engagementId: x.engagementId, label: `${ref(x.findingNo)} ${x.title}` }); await auditF(c, req, 'finding.commented', x.engagementId, { findingId: x.id, ref: ref(x.findingNo) }); });
    reply.code(201).send({ id });
  });
}
