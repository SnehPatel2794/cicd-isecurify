// Risk register routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). Rules live in rules.ts, SQL in data.ts.
//   log (auditor / client admin / managing staff) -> assign owner -> choose treatment + plan -> treating -> accepted (second person, review date) | closed
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { notify } from '../notifications/notify'; import { deletionBlockers, manifestProviders } from '../users/hooks';
import { FORMATS, MAX_EXPORT_ROWS, sendTable } from '../../platform/tabular';
import * as r from './data';
import { isOpen, CATEGORIES, STATUSES, TREATMENTS, STATUS_LABEL, LIKELIHOOD_LABEL, IMPACT_LABEL, canRate, canAssign, canTreat, canSeeAll, editCheck, transitionCheck, allowedTargets, scoreOf, levelOf, reviewOverdue, summarize, heatmap, type Who, type RStatus, type EditField } from './rules';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date'); const Uuid = z.string().uuid(); const Scale = z.number().int().min(1).max(5);
const Text = (n: number) => z.string().trim().max(n); const today = () => new Date().toISOString().slice(0, 10); const ref = (n: number) => `R-${String(n).padStart(3, '0')}`;
export function registerRisks(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (q: any) => ctx.U(q); const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const fail = (c: { ok: false; status: number; code: string; message: string }) => { throw new HttpError(c.status, c.message, c.code); };
  const auditR = (c: any, req: any, action: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'risk', entityId: String(detail.riskId), detail, ip: req.ip });
  /** Client staff and vendors reach only risks they own; everyone else with access sees the whole register. Others get 404, never 403. */
  const reachable = (req: any, x: { ownerUserId: string | null }) => canSeeAll(who(req)) || x.ownerUserId === me(req).id;
  const load = async (req: any, id: string, lock = false, c: Conn = pool) => { const x = await r.getRisk(c, req.tenantId, id, lock); if (!x || !reachable(req, x)) throw notFound(); return x; };
  // Hooks into the user-management module (registered once).
  const openBlocker = async (c: Conn, userId: string, tenantId: string | null) => (await r.openRisksFor(c, userId, tenantId)).map((x: any) => ({ type: 'risk', id: x.id, label: `${x.orgName}: risk ${ref(x.n)} ${x.title}` })); if (!deletionBlockers.includes(openBlocker)) deletionBlockers.push(openBlocker);
  const manifest = async (c: any, userId: string) => ({ title: 'Risks logged', headers: ['Organization', 'Risk', 'Status', 'Logged'], rows: (await r.risksRaisedBy(c, userId)).map((x: any) => [x.orgName, `${ref(x.n)} ${x.title}`, x.status, new Date(x.createdAt).toISOString().slice(0, 10)]) }); if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  const shape = (req: any, x: any) => { const w = who(req), isOwner = x.ownerUserId === me(req).id, t = today(); const inh = scoreOf(x.likelihood, x.impact); const res = x.residualLikelihood != null ? scoreOf(x.residualLikelihood, x.residualImpact) : null;
    return { id: x.id, ref: ref(x.riskNo), riskNo: x.riskNo, title: x.title, description: x.description, category: x.category, likelihood: x.likelihood, impact: x.impact, likelihoodLabel: LIKELIHOOD_LABEL[x.likelihood - 1], impactLabel: IMPACT_LABEL[x.impact - 1], score: inh, level: levelOf(inh),
      residualLikelihood: x.residualLikelihood, residualImpact: x.residualImpact, residualScore: res, residualLevel: res === null ? null : levelOf(res), status: x.status, statusLabel: STATUS_LABEL[x.status as RStatus], treatment: x.treatment, treatmentPlan: x.treatmentPlan,
      ownerUserId: x.ownerUserId, ownerName: x.ownerName, reviewDate: x.reviewDate, reviewOverdue: reviewOverdue(x.status, x.reviewDate, t), createdBy: x.createdBy, createdAt: x.createdAt, updatedAt: x.updatedAt, closedAt: x.closedAt, linkCount: Number(x.linkCount ?? 0), isOwner,
      can: { edit: x.status !== 'closed' && (canRate(w) || canTreat(w, isOwner)), assign: x.status !== 'closed' && canAssign(w), link: x.status !== 'closed' && (canRate(w) || canTreat(w, isOwner)), transitions: allowedTargets(x.status, w, isOwner) } }; };

  app.get('/t/:tenantId/risks', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional(), mine: z.enum(['true', 'false']).optional(), open: z.enum(['true', 'false']).optional() }), req.query ?? {}); const w = who(req);
    let rows = await r.listRisks(pool, req.tenantId, { status: f.status, category: f.category, ownerUserId: canSeeAll(w) ? (f.mine === 'true' ? me(req).id : undefined) : me(req).id }); if (f.open === 'true') rows = rows.filter((x: any) => isOpen(x.status)); if (rows.length > 2000) throw new HttpError(413, 'Too many risks to list at once: filter by status or category', 'too_many');
    const facts = rows.map((x: any) => ({ status: x.status, likelihood: x.likelihood, impact: x.impact, residualLikelihood: x.residualLikelihood, residualImpact: x.residualImpact, reviewDate: x.reviewDate }));
    return { can: { create: canRate(w), assign: canAssign(w) }, summary: summarize(facts, today()), heatmap: { inherent: heatmap(facts, false), residual: heatmap(facts, true) }, risks: rows.map((x: any) => shape(req, x)) };
  });
  /** Export the register (same filters as the list). Only people who see the whole register may export it. */
  app.get('/t/:tenantId/risks/export', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canSeeAll(who(req))) throw forbidden('Only client admins, auditors and managing iSecurify staff can export the register'); const f = ctx.parse(z.object({ format: z.enum(FORMATS).default('csv'), status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional() }), req.query ?? {});
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited'); const rows = await r.listRisks(pool, req.tenantId, { status: f.status, category: f.category }); if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(413, 'Too many risks to export at once: filter by status or category', 'too_many'); const t = today();
    await tx(pool, c => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'export.risks', entity: 'risk', entityId: req.tenantId, detail: { format: f.format, count: rows.length, status: f.status ?? null, category: f.category ?? null }, ip: req.ip }));
    return sendTable(reply, { base: 'risk-register', format: f.format, sheet: 'Risks', today: t, headers: ['Ref', 'Title', 'Category', 'Likelihood', 'Impact', 'Score', 'Level', 'Residual score', 'Residual level', 'Status', 'Treatment', 'Owner', 'Review date', 'Review overdue', 'Logged by', 'Logged', 'Links'],
      rows: rows.map((x: any) => { const s = scoreOf(x.likelihood, x.impact), rs = x.residualLikelihood != null ? scoreOf(x.residualLikelihood, x.residualImpact) : null; return [ref(x.riskNo), x.title, x.category, x.likelihood, x.impact, s, levelOf(s), rs, rs === null ? '' : levelOf(rs), x.status, x.treatment, x.ownerName, x.reviewDate, reviewOverdue(x.status, x.reviewDate, t), x.createdBy, new Date(x.createdAt), Number(x.linkCount ?? 0)]; }) });
  });
  /** Give several risks the same owner (or clear the owner) in one go. Each risk is checked and saved on its own, so one problem never blocks the rest. */
  app.post('/t/:tenantId/risks/bulk-assign', { preHandler: tenantCtx }, async (req: any) => {
    if (!canAssign(who(req))) throw forbidden('Only client admins and managing staff can assign owners'); const b = ctx.parse(z.object({ ids: z.array(Uuid).min(1).max(50), ownerUserId: Uuid.nullable() }), req.body); const ids = [...new Set(b.ids)];
    if (!ctx.limiter.allow(`bulk:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many bulk changes. Please try again later.', 'rate_limited'); if (b.ownerUserId && !(await r.isOwnerCandidate(pool, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
    const skipped: { id: string; ref?: string; reason: string }[] = []; let updated = 0;
    for (const id of ids) await tx(pool, async (c) => { const cur = await r.getRisk(c, req.tenantId, id, true); if (!cur) { skipped.push({ id, reason: 'not_found' }); return; } const ck = editCheck(cur.status, ['ownerUserId'], who(req), cur.ownerUserId === me(req).id); if (!ck.ok) { skipped.push({ id, ref: ref(cur.riskNo), reason: (ck as any).code }); return; } if ((cur.ownerUserId ?? null) === b.ownerUserId) { skipped.push({ id, ref: ref(cur.riskNo), reason: 'unchanged' }); return; }
      await r.updateFields(c, req.tenantId, cur.id, { ownerUserId: b.ownerUserId }); await r.addEvent(c, req.tenantId, { id: uuid(), riskId: cur.id, kind: 'assigned', note: 'Changed: ownerUserId (bulk)', actorId: me(req).id });
      if (b.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'risk.assigned', recipients: [b.ownerUserId], actorId: me(req).id, entityType: 'risk', entityId: cur.id, engagementId: null, label: `${ref(cur.riskNo)} ${cur.title}` }); await auditR(c, req, 'risk.updated', { riskId: cur.id, ref: ref(cur.riskNo), fields: ['ownerUserId'], bulk: true }); updated++; });
    return { updated, skipped };
  });
  app.get('/t/:tenantId/risks/:id', { preHandler: tenantCtx }, async (req: any) => { const x = await load(req, req.params.id); const [events, links] = await Promise.all([r.listEvents(pool, req.tenantId, x.id), r.listLinks(pool, req.tenantId, x.id)]);
    return { ...shape(req, { ...x, linkCount: links.length }), events, links: links.map((l: any) => ({ ...l, kind: l.findingId ? 'finding' : 'item' })) }; });
  const Create = z.object({ title: Text(300).min(1), description: Text(10000).min(1), category: z.enum(CATEGORIES), likelihood: Scale, impact: Scale, ownerUserId: Uuid.nullish() });
  app.post('/t/:tenantId/risks', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canRate(who(req))) throw forbidden('Only client admins, auditors and managing iSecurify staff can log risks'); const b = ctx.parse(Create, req.body); if (b.ownerUserId && !canAssign(who(req))) throw forbidden('Only client admins and managing staff can assign an owner');
    if (!ctx.limiter.allow(`risk:${me(req).id}`, 60, 3600_000)) throw new HttpError(429, 'Too many risks logged. Please try again later.', 'rate_limited'); const id = uuid(); let no = 0;
    await tx(pool, async (c) => { if (b.ownerUserId && !(await r.isOwnerCandidate(c, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
      await r.lockTenant(c, req.tenantId); no = await r.nextNo(c, req.tenantId); await r.insertRisk(c, req.tenantId, { id, no, title: b.title, description: b.description, category: b.category, likelihood: b.likelihood, impact: b.impact, ownerUserId: b.ownerUserId, createdBy: me(req).id });
      await r.addEvent(c, req.tenantId, { id: uuid(), riskId: id, kind: 'created', to: 'identified', actorId: me(req).id });
      if (b.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'risk.assigned', recipients: [b.ownerUserId], actorId: me(req).id, entityType: 'risk', entityId: id, engagementId: null, label: `${ref(no)} ${b.title}` });
      await auditR(c, req, 'risk.created', { riskId: id, ref: ref(no), category: b.category, likelihood: b.likelihood, impact: b.impact }); });
    reply.code(201).send({ id, ref: ref(no), riskNo: no });
  });
  const Patch = z.object({ title: Text(300).min(1).optional(), description: Text(10000).min(1).optional(), category: z.enum(CATEGORIES).optional(), likelihood: Scale.optional(), impact: Scale.optional(), residualLikelihood: Scale.nullable().optional(), residualImpact: Scale.nullable().optional(), ownerUserId: Uuid.nullable().optional(),
    reviewDate: DateStr.nullable().optional(), treatment: z.enum(TREATMENTS).nullable().optional(), treatmentPlan: Text(10000).nullable().optional(), note: Text(2000).nullish() });
  app.patch('/t/:tenantId/risks/:id', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Patch, req.body); const { note, ...patch } = b; if (!Object.keys(patch).length) throw bad('Nothing to change'); if ((patch.residualLikelihood === undefined) !== (patch.residualImpact === undefined)) throw bad('Rate the residual likelihood and impact together'); if ((patch.residualLikelihood == null) !== (patch.residualImpact == null)) throw bad('Rate the residual likelihood and impact together');
    if (patch.reviewDate && patch.reviewDate <= today()) throw bad('The review date must be in the future');
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id;
      const fields: EditField[] = Object.keys(patch).map(k => k === 'residualLikelihood' || k === 'residualImpact' ? 'residual' : k) as EditField[]; const ck = editCheck(cur.status, [...new Set(fields)], who(req), isOwner); if (!ck.ok) fail(ck as any);
      if (patch.ownerUserId && !(await r.isOwnerCandidate(c, req.tenantId, patch.ownerUserId))) throw bad('The owner must be an active client admin, client staff member or vendor of this organization');
      const changed = Object.keys(patch).filter(k => (patch as any)[k] !== undefined && (patch as any)[k] !== (cur as any)[k]); if (!changed.length) return; await r.updateFields(c, req.tenantId, cur.id, patch);
      const kind = changed.includes('ownerUserId') ? 'assigned' : changed.some(k => ['likelihood', 'impact', 'residualLikelihood', 'residualImpact'].includes(k)) ? 'rated' : 'edited'; await r.addEvent(c, req.tenantId, { id: uuid(), riskId: cur.id, kind, note: note ?? `Changed: ${changed.join(', ')}`, actorId: me(req).id });
      if (changed.includes('ownerUserId') && patch.ownerUserId) await notify(c, { tenantId: req.tenantId, kind: 'risk.assigned', recipients: [patch.ownerUserId], actorId: me(req).id, entityType: 'risk', entityId: cur.id, engagementId: null, label: `${ref(cur.riskNo)} ${cur.title}` });
      await auditR(c, req, 'risk.updated', { riskId: cur.id, ref: ref(cur.riskNo), fields: changed }); });
    return { ok: true };
  });
  const Transition = z.object({ to: z.enum(STATUSES), note: Text(2000).nullish(), treatment: z.enum(TREATMENTS).nullable().optional(), residualLikelihood: Scale.nullable().optional(), residualImpact: Scale.nullable().optional(), reviewDate: DateStr.nullable().optional() });
  app.post('/t/:tenantId/risks/:id/transition', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(Transition, req.body); if ((b.residualLikelihood === undefined) !== (b.residualImpact === undefined)) throw bad('Rate the residual likelihood and impact together');
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id; const t = today();
      const treatment = b.to === 'accepted' ? 'accept' : b.treatment; const inp = { note: b.note, treatment, residualLikelihood: b.residualLikelihood, residualImpact: b.residualImpact, reviewDate: b.reviewDate };
      const ck = transitionCheck({ status: cur.status, treatment: cur.treatment, treatmentPlan: cur.treatmentPlan, residualLikelihood: cur.residualLikelihood, residualImpact: cur.residualImpact, reviewDate: cur.reviewDate }, b.to, who(req), isOwner, inp, t); if (!ck.ok) fail(ck as any);
      const extra: any = {}; if (treatment !== undefined) extra.treatment = treatment; if (b.residualLikelihood !== undefined) { extra.residualLikelihood = b.residualLikelihood; extra.residualImpact = b.residualImpact; } if (b.reviewDate !== undefined) extra.reviewDate = b.reviewDate; if (b.to === 'identified') extra.reviewDate = null;
      await r.setStatus(c, req.tenantId, cur.id, b.to, extra); await r.addEvent(c, req.tenantId, { id: uuid(), riskId: cur.id, kind: 'status', from: cur.status, to: b.to, note: b.note ?? null, actorId: me(req).id });
      if (cur.ownerUserId && cur.ownerUserId !== me(req).id && ['accepted', 'closed', 'identified'].includes(b.to)) await notify(c, { tenantId: req.tenantId, kind: 'risk.decision', recipients: [cur.ownerUserId], actorId: me(req).id, entityType: 'risk', entityId: cur.id, engagementId: null, label: `${ref(cur.riskNo)} ${cur.title}` });
      await auditR(c, req, 'risk.status', { riskId: cur.id, ref: ref(cur.riskNo), from: cur.status, to: b.to }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/risks/:id/comments', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ note: Text(5000).min(1) }), req.body); const x = await load(req, req.params.id); if (x.status === 'closed') throw conflict('This risk is closed. Reopen it to comment');
    await tx(pool, async (c) => { await r.addEvent(c, req.tenantId, { id: uuid(), riskId: x.id, kind: 'comment', note: b.note, actorId: me(req).id }); }); reply.code(201).send({ ok: true });
  });
  // ---------------------------------------------------------------- links to findings and checklist items
  app.post('/t/:tenantId/risks/:id/links', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.union([z.object({ findingId: Uuid }), z.object({ itemId: Uuid })]), req.body); const id = uuid();
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id; if (!(canRate(who(req)) || canTreat(who(req), isOwner))) throw forbidden(); if (cur.status === 'closed') throw conflict('This risk is closed. Reopen it to change its links');
      if ('findingId' in b) { if (!(await r.findingExists(c, req.tenantId, b.findingId))) throw notFound(); try { await r.insertFindingLink(c, req.tenantId, { id, riskId: cur.id, findingId: b.findingId, by: me(req).id }); } catch (e: any) { if (e.code === 'ER_DUP_ENTRY') throw conflict('This finding is already linked'); throw e; } }
      else { const it = await r.itemExists(c, req.tenantId, b.itemId); if (!it) throw notFound(); try { await r.insertItemLink(c, req.tenantId, { id, riskId: cur.id, engagementId: it.engagementId, itemId: b.itemId, by: me(req).id }); } catch (e: any) { if (e.code === 'ER_DUP_ENTRY') throw conflict('This checklist item is already linked'); throw e; } }
      await r.addEvent(c, req.tenantId, { id: uuid(), riskId: cur.id, kind: 'link', note: 'findingId' in b ? 'Linked a finding' : 'Linked a checklist item', actorId: me(req).id }); await auditR(c, req, 'risk.linked', { riskId: cur.id, ref: ref(cur.riskNo), ...('findingId' in b ? { findingId: b.findingId } : { itemId: b.itemId }) }); });
    reply.code(201).send({ id });
  });
  app.delete('/t/:tenantId/risks/:id/links/:linkId', { preHandler: tenantCtx }, async (req: any) => {
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const isOwner = cur.ownerUserId === me(req).id; if (!(canRate(who(req)) || canTreat(who(req), isOwner))) throw forbidden(); if (cur.status === 'closed') throw conflict('This risk is closed. Reopen it to change its links');
      const l = await r.getLink(c, req.tenantId, cur.id, req.params.linkId); if (!l) throw notFound(); await r.deleteLink(c, req.tenantId, l.id); await r.addEvent(c, req.tenantId, { id: uuid(), riskId: cur.id, kind: 'unlink', note: l.findingId ? 'Unlinked a finding' : 'Unlinked a checklist item', actorId: me(req).id }); await auditR(c, req, 'risk.unlinked', { riskId: cur.id, ref: ref(cur.riskNo), linkId: l.id }); });
    return { ok: true };
  });
  /** Risks that point at a finding, for the finding screen. Same visibility as the register. */
  app.get('/t/:tenantId/findings/:findingId/risks', { preHandler: tenantCtx }, async (req: any) => { if (!canSeeAll(who(req))) throw forbidden(); if (!(await r.findingExists(pool, req.tenantId, req.params.findingId))) throw notFound();
    return { risks: (await r.risksForFinding(pool, req.tenantId, req.params.findingId)).map((x: any) => ({ id: x.id, ref: ref(x.riskNo), title: x.title, status: x.status, level: levelOf(scoreOf(x.likelihood, x.impact)) })) }; });
}
