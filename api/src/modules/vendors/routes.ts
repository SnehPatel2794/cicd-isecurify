// Vendor risk routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). Rules live in rules.ts, SQL in data.ts.
//   add vendor -> request assessment -> vendor contact (or a manager) answers -> submit -> someone else approves / rejects / sends back -> next review date by tier
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { notify } from '../notifications/notify'; import { deletionBlockers, manifestProviders } from '../users/hooks'; import { FORMATS, MAX_EXPORT_ROWS, sendTable } from '../../platform/tabular';
import * as v from './data';
import { CATEGORIES, CRITICALITY, DATA_ACCESS, STATUSES, STATUS_LABEL, DATA_LABEL, QUESTIONS, QUESTIONNAIRE_VERSION, canManage, canReview, canSeeAll, canAnswer, tierOf, nextReview, ratingOf, gapsOf, domainScores, cleanAnswers, scoreOf, statusCheck, submitCheck, decideCheck, startCheck, attention, summarize, reviewOverdue, contractEnding, contractExpired, type Who, type VStatus, type Tier } from './rules';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date'); const Uuid = z.string().uuid();
const Text = (n: number) => z.string().trim().max(n); const today = () => new Date().toISOString().slice(0, 10); const ref = (n: number) => `V-${String(n).padStart(3, '0')}`;
export function registerVendors(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (q: any) => ctx.U(q); const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const fail = (c: { ok: false; status: number; code: string; message: string }) => { throw new HttpError(c.status, c.message, c.code); };
  const auditV = (c: any, req: any, action: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'vendor', entityId: String(detail.vendorId), detail, ip: req.ip });
  /** Managers and auditors see every vendor; a vendor user sees only the vendor they are the contact for. Everyone else gets 404, never 403. */
  const isContact = (req: any, x: { contactUserId: string | null }) => x.contactUserId === me(req).id;
  const reachable = (req: any, x: { contactUserId: string | null }) => canSeeAll(who(req)) || (who(req).role === 'third_party_vendor' && isContact(req, x));
  const load = async (req: any, id: string, lock = false, c: Conn = pool) => { const x = await v.getVendor(c, req.tenantId, id, lock); if (!x || !reachable(req, x)) throw notFound(); return x; };
  const lbl = (x: any) => `${ref(x.vendorNo)} ${x.name}`;
  const openBlocker = async (c: Conn, userId: string, tenantId: string | null) => (await v.openVendorsFor(c, userId, tenantId)).map((x: any) => ({ type: 'vendor', id: x.id, label: `${x.orgName}: vendor ${ref(x.n)} ${x.name}` })); if (!deletionBlockers.includes(openBlocker)) deletionBlockers.push(openBlocker);
  const manifest = async (c: any, userId: string) => ({ title: 'Vendors added', headers: ['Organization', 'Vendor', 'Status', 'Added'], rows: (await v.vendorsAddedBy(c, userId)).map((x: any) => [x.orgName, `${ref(x.n)} ${x.name}`, x.status, new Date(x.createdAt).toISOString().slice(0, 10)]) }); if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  const shape = (req: any, x: any) => { const w = who(req), t = today(); const tier = tierOf(x.criticality, x.dataAccess); const manage = canManage(w) && x.status !== 'offboarded';
    return { id: x.id, ref: ref(x.vendorNo), vendorNo: x.vendorNo, name: x.name, service: x.service, category: x.category, criticality: x.criticality, dataAccess: x.dataAccess, dataAccessLabel: DATA_LABEL[x.dataAccess as keyof typeof DATA_LABEL], tier, status: x.status, statusLabel: STATUS_LABEL[x.status as VStatus],
      ownerUserId: x.ownerUserId, ownerName: x.ownerName, contactUserId: x.contactUserId, contactUserName: x.contactUserName, contactName: x.contactName, contactEmail: x.contactEmail, contractStart: x.contractStart, contractEnd: x.contractEnd, reviewDate: x.reviewDate,
      reviewOverdue: reviewOverdue(x.status, x.reviewDate, t), contractEnding: contractEnding(x.status, x.contractEnd, t), contractExpired: contractExpired(x.status, x.contractEnd, t), latestScore: x.latestScore ?? null, latestRating: x.latestScore == null ? null : ratingOf(x.latestScore), openAssessment: x.openStatus ?? null, approvedCount: Number(x.approvedCount ?? 0),
      attention: attention({ status: x.status, tier, ownerUserId: x.ownerUserId, reviewDate: x.reviewDate, contractEnd: x.contractEnd, openAssessment: x.openStatus ?? null, latest: x.latestStatus ? { status: x.latestStatus, score: x.latestScore ?? null } : null }, t),
      createdBy: x.createdBy, createdAt: x.createdAt, updatedAt: x.updatedAt, offboardedAt: x.offboardedAt, can: { edit: manage, transition: manage, requestAssessment: manage } }; };
  const facts = (rows: any[]) => rows.map((x: any) => ({ status: x.status, tier: tierOf(x.criticality, x.dataAccess), reviewDate: x.reviewDate, contractEnd: x.contractEnd, latestScore: x.latestScore ?? null, hasApproved: Number(x.approvedCount ?? 0) > 0 }));

  app.get('/t/:tenantId/vendors/questionnaire', { preHandler: tenantCtx }, async (req: any) => { const w = who(req); if (!canSeeAll(w) && w.role !== 'third_party_vendor') throw notFound(); return { version: QUESTIONNAIRE_VERSION, questions: QUESTIONS }; });
  app.get('/t/:tenantId/vendors', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional(), mine: z.enum(['true', 'false']).optional() }), req.query ?? {}); const w = who(req);
    if (!canSeeAll(w) && w.role !== 'third_party_vendor') throw forbidden(); const all = canSeeAll(w);
    const rows = await v.listVendors(pool, req.tenantId, { status: f.status, category: f.category, ownerUserId: all && f.mine === 'true' ? me(req).id : undefined, contactUserId: all ? undefined : me(req).id }); if (rows.length > 2000) throw new HttpError(413, 'Too many vendors to list at once: filter by status or category', 'too_many');
    return { can: { create: canManage(w) }, summary: summarize(facts(rows), today()), vendors: rows.map((x: any) => shape(req, x)) };
  });
  app.get('/t/:tenantId/vendors/export', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canSeeAll(who(req))) throw forbidden('Only client admins, auditors and managing iSecurify staff can export vendors'); const f = ctx.parse(z.object({ format: z.enum(FORMATS).default('csv'), status: z.enum(STATUSES).optional(), category: z.enum(CATEGORIES).optional() }), req.query ?? {});
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited'); const rows = await v.listVendors(pool, req.tenantId, { status: f.status, category: f.category }); if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(413, 'Too many vendors to export at once: filter by status or category', 'too_many'); const t = today();
    await tx(pool, c => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'export.vendors', entity: 'vendor', entityId: req.tenantId, detail: { format: f.format, count: rows.length }, ip: req.ip }));
    return sendTable(reply, { base: 'vendor-register', format: f.format, sheet: 'Vendors', today: t, headers: ['Ref', 'Vendor', 'Service', 'Category', 'Criticality', 'Data access', 'Tier', 'Status', 'Owner', 'Contact', 'Contract start', 'Contract end', 'Latest score', 'Next assessment', 'Assessment overdue'],
      rows: rows.map((x: any) => [ref(x.vendorNo), x.name, x.service, x.category, x.criticality, x.dataAccess, tierOf(x.criticality, x.dataAccess), x.status, x.ownerName, x.contactName ?? x.contactUserName, x.contractStart, x.contractEnd, x.latestScore ?? '', x.reviewDate, reviewOverdue(x.status, x.reviewDate, t)]) });
  });
  const assessmentShape = (req: any, vendor: any, a: any) => { const w = who(req); const contact = isContact(req, vendor); const answers = a.answers ?? {}; const open = a.status === 'draft';
    return { id: a.id, no: a.assessmentNo, version: a.version, status: a.status, answers, score: a.score, rating: a.score == null ? null : ratingOf(a.score), domains: a.score == null ? null : domainScores(answers), gaps: a.status === 'draft' ? [] : gapsOf(answers), dueDate: a.dueDate, requestedBy: a.requestedBy, submittedBy: a.submittedBy, submittedAt: a.submittedAt, reviewedBy: a.reviewedBy, reviewedAt: a.reviewedAt, reviewNote: a.reviewNote, createdAt: a.createdAt,
      can: { answer: open && vendor.status !== 'offboarded' && canAnswer(w, contact), submit: open && vendor.status !== 'offboarded' && canAnswer(w, contact), decide: a.status === 'submitted' && canReview(w) && a.submittedById !== me(req).id } }; };
  app.get('/t/:tenantId/vendors/:id', { preHandler: tenantCtx }, async (req: any) => { const x = await load(req, req.params.id); const w = who(req); const [assessments, events] = await Promise.all([v.listAssessments(pool, req.tenantId, x.id), canSeeAll(w) ? v.listEvents(pool, req.tenantId, x.id) : Promise.resolve([])]);
    return { ...shape(req, x), events, assessments: assessments.map((a: any) => assessmentShape(req, x, a)) }; });
  const Create = z.object({ name: Text(200).min(1), service: Text(5000).min(1), category: z.enum(CATEGORIES), criticality: z.enum(CRITICALITY), dataAccess: z.enum(DATA_ACCESS), ownerUserId: Uuid.nullish(), contactUserId: Uuid.nullish(), contactName: Text(200).nullish(), contactEmail: z.string().trim().toLowerCase().email().max(254).nullish(), contractStart: DateStr.nullish(), contractEnd: DateStr.nullish() });
  const checkPeople = async (c: Conn, req: any, b: { ownerUserId?: string | null; contactUserId?: string | null; contractStart?: string | null; contractEnd?: string | null }) => {
    if (b.ownerUserId && !(await v.isOwnerCandidate(c, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin or client staff member of this organization'); if (b.contactUserId && !(await v.isContactCandidate(c, req.tenantId, b.contactUserId))) throw bad('The vendor contact must be an active vendor user of this organization');
    if (b.contractStart && b.contractEnd && b.contractStart > b.contractEnd) throw bad('The contract cannot end before it starts'); };
  const dupName = (e: any) => { if (e.code === 'ER_DUP_ENTRY') throw conflict('A vendor with this name already exists'); throw e; };
  app.post('/t/:tenantId/vendors', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canManage(who(req))) throw forbidden('Only client admins and managing iSecurify staff can add vendors'); const b = ctx.parse(Create, req.body); if (!ctx.limiter.allow(`vendor:${me(req).id}`, 60, 3600_000)) throw new HttpError(429, 'Too many vendors added. Please try again later.', 'rate_limited'); const id = uuid(); let no = 0;
    await tx(pool, async (c) => { await checkPeople(c, req, b); await v.lockTenant(c, req.tenantId); no = await v.nextNo(c, req.tenantId);
      try { await v.insertVendor(c, req.tenantId, { id, no, name: b.name, service: b.service, category: b.category, criticality: b.criticality, dataAccess: b.dataAccess, ownerUserId: b.ownerUserId, contactUserId: b.contactUserId, contactName: b.contactName, contactEmail: b.contactEmail, contractStart: b.contractStart, contractEnd: b.contractEnd, createdBy: me(req).id }); } catch (e: any) { dupName(e); }
      await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: id, kind: 'created', to: 'onboarding', actorId: me(req).id }); await auditV(c, req, 'vendor.created', { vendorId: id, ref: ref(no), name: b.name, tier: tierOf(b.criticality, b.dataAccess) }); });
    reply.code(201).send({ id, ref: ref(no), vendorNo: no });
  });
  const Patch = z.object({ name: Text(200).min(1).optional(), service: Text(5000).min(1).optional(), category: z.enum(CATEGORIES).optional(), criticality: z.enum(CRITICALITY).optional(), dataAccess: z.enum(DATA_ACCESS).optional(), ownerUserId: Uuid.nullable().optional(), contactUserId: Uuid.nullable().optional(), contactName: Text(200).nullable().optional(),
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(), contractStart: DateStr.nullable().optional(), contractEnd: DateStr.nullable().optional(), reviewDate: DateStr.nullable().optional(), note: Text(2000).nullish() });
  app.patch('/t/:tenantId/vendors/:id', { preHandler: tenantCtx }, async (req: any) => {
    if (!canManage(who(req))) throw forbidden('Only client admins and managing iSecurify staff can edit vendors'); const b = ctx.parse(Patch, req.body); const { note, ...patch } = b; if (!Object.keys(patch).length) throw bad('Nothing to change');
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); if (cur.status === 'offboarded') throw conflict('This vendor has been offboarded and can no longer be edited');
      await checkPeople(c, req, { ...patch, contractStart: patch.contractStart !== undefined ? patch.contractStart : cur.contractStart, contractEnd: patch.contractEnd !== undefined ? patch.contractEnd : cur.contractEnd });
      const changed = Object.keys(patch).filter(k => (patch as any)[k] !== undefined && (patch as any)[k] !== (cur as any)[k]); if (!changed.length) return;
      try { await v.updateFields(c, req.tenantId, cur.id, patch); } catch (e: any) { dupName(e); }
      if (changed.includes('criticality') || changed.includes('dataAccess')) { const ap = await v.latestApproved(c, req.tenantId, cur.id); if (ap && !('reviewDate' in patch)) await v.setReviewDate(c, req.tenantId, cur.id, nextReview(tierOf(patch.criticality ?? cur.criticality, patch.dataAccess ?? cur.dataAccess), ap.decidedOn)); }
      await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: cur.id, kind: 'edited', note: note ?? `Changed: ${changed.join(', ')}`, actorId: me(req).id }); await auditV(c, req, 'vendor.updated', { vendorId: cur.id, ref: ref(cur.vendorNo), fields: changed }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/vendors/:id/transition', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ to: z.enum(STATUSES), note: Text(2000).nullish() }), req.body);
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const ap = await v.latestApproved(c, req.tenantId, cur.id);
      const ck = statusCheck({ status: cur.status, tier: tierOf(cur.criticality, cur.dataAccess), ownerUserId: cur.ownerUserId, contractEnd: cur.contractEnd, latestApproved: ap }, b.to, who(req), b.note, today()); if (!ck.ok) fail(ck as any);
      await v.setStatus(c, req.tenantId, cur.id, b.to); await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: cur.id, kind: 'status', from: cur.status, to: b.to, note: b.note ?? null, actorId: me(req).id }); await auditV(c, req, 'vendor.status', { vendorId: cur.id, ref: ref(cur.vendorNo), from: cur.status, to: b.to }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/vendors/:id/comments', { preHandler: tenantCtx }, async (req: any, reply) => { if (!canSeeAll(who(req))) throw forbidden(); const b = ctx.parse(z.object({ note: Text(5000).min(1) }), req.body); const x = await load(req, req.params.id); if (x.status === 'offboarded') throw conflict('This vendor has been offboarded');
    await tx(pool, async (c) => { await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: x.id, kind: 'comment', note: b.note, actorId: me(req).id }); }); reply.code(201).send({ ok: true }); });
  // ---------------------------------------------------------------- assessments
  app.post('/t/:tenantId/vendors/:id/assessments', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ dueDate: DateStr.nullish() }), req.body ?? {}); if (b.dueDate && b.dueDate <= today()) throw bad('The due date must be in the future'); const id = uuid(); let no = 0;
    await tx(pool, async (c) => { const cur = await load(req, req.params.id, true, c); const ck = startCheck(cur, who(req), await v.hasOpenAssessment(c, req.tenantId, cur.id)); if (!ck.ok) fail(ck as any);
      no = await v.nextAssessmentNo(c, req.tenantId, cur.id); await v.insertAssessment(c, req.tenantId, { id, vendorId: cur.id, no, dueDate: b.dueDate, requestedBy: me(req).id });
      await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: cur.id, kind: 'assessment', to: 'draft', note: `Assessment #${no} requested`, actorId: me(req).id });
      if (cur.contactUserId) await notify(c, { tenantId: req.tenantId, kind: 'vendor.assessment_requested', recipients: [cur.contactUserId], actorId: me(req).id, entityType: 'vendor', entityId: cur.id, engagementId: null, label: lbl(cur) });
      await auditV(c, req, 'vendor.assessment_requested', { vendorId: cur.id, ref: ref(cur.vendorNo), assessmentId: id, no }); });
    reply.code(201).send({ id, no });
  });
  const loadAssessment = async (c: Conn, req: any, vendor: any, id: string, lock = false) => { const a = await v.getAssessment(c, req.tenantId, vendor.id, id, lock); if (!a) throw notFound(); return a; };
  app.put('/t/:tenantId/vendors/:id/assessments/:aid/answers', { preHandler: tenantCtx }, async (req: any) => {
    const body = ctx.parse(z.object({ answers: z.record(z.string(), z.object({ answer: z.enum(['yes', 'partial', 'no', 'na']), note: Text(1000).nullish() })) }), req.body); if (Object.keys(body.answers).some(k => !QUESTIONS.some(q => q.id === k))) throw bad('Unknown question');
    await tx(pool, async (c) => { const vendor = await load(req, req.params.id, true, c); const a = await loadAssessment(c, req, vendor, req.params.aid, true); if (!canAnswer(who(req), isContact(req, vendor))) throw forbidden(); if (a.status !== 'draft') throw conflict('Only a draft assessment can be changed'); if (vendor.status === 'offboarded') throw conflict('This vendor has been offboarded');
      const merged = { ...a.answers, ...cleanAnswers(body.answers) }; await v.saveAnswers(c, req.tenantId, a.id, merged); });
    return { ok: true };
  });
  app.post('/t/:tenantId/vendors/:id/assessments/:aid/submit', { preHandler: tenantCtx }, async (req: any) => {
    let score = 0; await tx(pool, async (c) => { const vendor = await load(req, req.params.id, true, c); const a = await loadAssessment(c, req, vendor, req.params.aid, true); if (vendor.status === 'offboarded') throw conflict('This vendor has been offboarded');
      const ck = submitCheck({ status: a.status, submittedBy: a.submittedById, answers: a.answers }, who(req), isContact(req, vendor)); if (!ck.ok) fail(ck as any); score = scoreOf(a.answers); await v.markSubmitted(c, req.tenantId, a.id, score, me(req).id);
      await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: vendor.id, kind: 'assessment', from: 'draft', to: 'submitted', note: `Assessment #${a.assessmentNo} submitted (score ${score})`, actorId: me(req).id });
      await notify(c, { tenantId: req.tenantId, kind: 'vendor.assessment_submitted', recipients: [vendor.ownerUserId], actorId: me(req).id, entityType: 'vendor', entityId: vendor.id, engagementId: null, label: lbl(vendor) });
      await auditV(c, req, 'vendor.assessment_submitted', { vendorId: vendor.id, ref: ref(vendor.vendorNo), assessmentId: a.id, no: a.assessmentNo, score }); });
    return { ok: true, score, rating: ratingOf(score) };
  });
  app.post('/t/:tenantId/vendors/:id/assessments/:aid/decision', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ action: z.enum(['approve', 'reject', 'return']), note: Text(3000).nullish() }), req.body); let reviewDate: string | null = null;
    await tx(pool, async (c) => { const vendor = await load(req, req.params.id, true, c); const a = await loadAssessment(c, req, vendor, req.params.aid, true); if (vendor.status === 'offboarded') throw conflict('This vendor has been offboarded');
      const ck = decideCheck({ status: a.status, submittedBy: a.submittedById, answers: a.answers }, b.action, me(req).id, who(req), b.note); if (!ck.ok) fail(ck as any); const note = b.note?.trim() || null;
      if (b.action === 'return') await v.markReturned(c, req.tenantId, a.id, note!); else await v.markDecided(c, req.tenantId, a.id, b.action === 'approve' ? 'approved' : 'rejected', me(req).id, note);
      if (b.action === 'approve') { reviewDate = nextReview(tierOf(vendor.criticality, vendor.dataAccess), today()); await v.setReviewDate(c, req.tenantId, vendor.id, reviewDate); }
      const to = b.action === 'approve' ? 'approved' : b.action === 'reject' ? 'rejected' : 'draft'; await v.addEvent(c, req.tenantId, { id: uuid(), vendorId: vendor.id, kind: 'assessment', from: 'submitted', to, note: `Assessment #${a.assessmentNo} ${b.action === 'return' ? 'sent back' : to}${note ? `: ${note}` : ''}`, actorId: me(req).id });
      await notify(c, { tenantId: req.tenantId, kind: 'vendor.assessment_decided', recipients: [a.submittedById], actorId: me(req).id, entityType: 'vendor', entityId: vendor.id, engagementId: null, label: lbl(vendor) });
      await auditV(c, req, 'vendor.assessment_decided', { vendorId: vendor.id, ref: ref(vendor.vendorNo), assessmentId: a.id, no: a.assessmentNo, action: b.action }); });
    return { ok: true, reviewDate };
  });
}
