// Policy routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). Rules live in rules.ts, SQL in data.ts.
//   draft (client admin / managing staff) -> submit -> a DIFFERENT manager publishes (supersedes the live version) -> the audience acknowledges the live version.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { notify } from '../notifications/notify'; import { deletionBlockers, manifestProviders } from '../users/hooks';
import { FORMATS, MAX_EXPORT_ROWS, sendTable } from '../../platform/tabular';
import * as p from './data';
import { CATEGORIES, AUDIENCES, AUDIENCE_ROLES, AUDIENCE_LABEL, VSTATUS_LABEL, canManage, canApprove, canReadAll, appliesTo, versionCheck, versionTargets, bodyCheck, addMonths, reviewOverdue, reviewSoon, summarize, type Who, type Audience } from './rules';

const Uuid = z.string().uuid(); const Text = (n: number) => z.string().trim().max(n); const today = () => new Date().toISOString().slice(0, 10); const ref = (n: number) => `POL-${String(n).padStart(3, '0')}`;
export function registerPolicies(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (q: any) => ctx.U(q); const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage });
  const fail = (c: { ok: false; status: number; code: string; message: string }) => { throw new HttpError(c.status, c.message, c.code); };
  const auditP = (c: any, req: any, action: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'policy', entityId: String(detail.policyId), detail, ip: req.ip });
  const label = (x: any) => `${ref(x.policyNo)} ${x.title}`;
  const blocker = async (c: Conn, userId: string, tenantId: string | null) => (await p.policiesOwnedBy(c, userId, tenantId)).map((x: any) => ({ type: 'policy', id: x.id, label: `${x.orgName}: policy ${ref(x.n)} ${x.title} (owner)` })); if (!deletionBlockers.includes(blocker)) deletionBlockers.push(blocker);
  const manifest = async (c: any, userId: string) => ({ title: 'Policy versions written and policies acknowledged', headers: ['Organization', 'Policy', 'What', 'When'], rows: [...(await p.policiesAuthoredBy(c, userId)).map((x: any) => [x.orgName, `${ref(x.n)} ${x.title}`, `Wrote version ${x.vn} (${x.status})`, new Date(x.createdAt).toISOString().slice(0, 10)]), ...(await p.acksBy(c, userId)).map((x: any) => [x.orgName, `${ref(x.n)} ${x.title}`, `Acknowledged version ${x.vn}`, new Date(x.at).toISOString().slice(0, 10)])] }); if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  /** Everyone required to acknowledge, with whether they did, for one live version. */
  const ackState = async (c: Conn, tenantId: string, audience: Audience, versionId: string | null) => { const req = await p.requiredUsers(c, tenantId, AUDIENCE_ROLES[audience]); const done = new Map<string, any>(); if (versionId) for (const a of await p.acksFor(c, tenantId, versionId)) done.set(a.userId, a.acknowledgedAt); return req.map((u: any) => ({ userId: u.id, name: u.name, email: u.email, role: u.role, acknowledgedAt: done.get(u.id) ?? null })); };
  const vShape = (req: any, policy: any, v: any, withBody: boolean) => ({ id: v.id, versionNo: v.versionNo, status: v.status, statusLabel: VSTATUS_LABEL[v.status as keyof typeof VSTATUS_LABEL], changeSummary: v.changeSummary, authorName: v.authorName, isAuthor: v.authorId === me(req).id, submittedAt: v.submittedAt, approvedBy: v.approvedBy, publishedAt: v.publishedAt, nextReviewDate: v.nextReviewDate, createdAt: v.createdAt, ...(withBody ? { body: v.body } : {}),
    can: { edit: v.status === 'draft' && canManage(who(req)) && !policy.archivedAt, transitions: versionTargets(v.status, who(req), v.authorId === me(req).id, !!policy.archivedAt), discard: v.status === 'draft' && canManage(who(req)) && !policy.archivedAt } });
  const pShape = (req: any, x: any, live: any, open: any, ack: { required: number; acknowledged: number; mine: boolean | null }) => { const t = today(); return { id: x.id, ref: ref(x.policyNo), policyNo: x.policyNo, title: x.title, category: x.category, audience: x.audience, audienceLabel: AUDIENCE_LABEL[x.audience as Audience], reviewMonths: x.reviewMonths, ownerUserId: x.ownerUserId, ownerName: x.ownerName, archived: !!x.archivedAt, archivedAt: x.archivedAt, createdAt: x.createdAt, updatedAt: x.updatedAt,
    liveVersionNo: live?.versionNo ?? null, publishedAt: live?.publishedAt ?? null, nextReviewDate: live?.nextReviewDate ?? null, reviewOverdue: reviewOverdue(live?.nextReviewDate ?? null, t), reviewSoon: reviewSoon(live?.nextReviewDate ?? null, t), openVersionNo: open?.versionNo ?? null, openStatus: open?.status ?? null,
    required: ack.required, acknowledged: ack.acknowledged, mustAcknowledge: ack.mine === false, acknowledgedByMe: ack.mine,
    can: { edit: canManage(who(req)) && !x.archivedAt, archive: canManage(who(req)), newVersion: canManage(who(req)) && !x.archivedAt && !open } }; };

  app.get('/t/:tenantId/policies', { preHandler: tenantCtx }, async (req: any) => {
    const w = who(req), all = canReadAll(w), rows = await p.listPolicies(pool, req.tenantId); if (rows.length > 2000) throw new HttpError(413, 'Too many policies to list at once', 'too_many');
    const vs = await p.versionSummaries(pool, req.tenantId); const acks = await p.ackCounts(pool, req.tenantId); const reqCache: Partial<Record<Audience, any[]>> = {}; const required = async (a: Audience) => reqCache[a] ??= await p.requiredUsers(pool, req.tenantId, AUDIENCE_ROLES[a]);
    const out: any[] = [], facts: any[] = [];
    for (const x of rows) { const live = vs.find((v: any) => v.policyId === x.id && v.status === 'published'), open = vs.find((v: any) => v.policyId === x.id && v.status !== 'published');
      const reqd = await required(x.audience), ids = new Set(reqd.map((u: any) => u.id)); const done = live ? acks.filter((a: any) => a.versionId === live.id && ids.has(a.userId)) : []; const mine = live && appliesTo(w, x.audience) ? acks.some((a: any) => a.versionId === live.id && a.userId === me(req).id) : null;
      const shaped = pShape(req, x, live, open, { required: live ? reqd.length : 0, acknowledged: done.length, mine }); facts.push({ archived: shaped.archived, liveVersionNo: shaped.liveVersionNo, nextReviewDate: shaped.nextReviewDate, draftStatus: open?.status ?? null, required: shaped.required, acknowledged: shaped.acknowledged });
      if (all || (live && !x.archivedAt && appliesTo(w, x.audience))) out.push(all ? shaped : { ...shaped, openVersionNo: null, openStatus: null, required: 0, acknowledged: 0 }); }
    return { can: { create: canManage(w) }, summary: all ? summarize(facts, today()) : null, pendingForMe: out.filter(x => x.mustAcknowledge && !x.archived).length, policies: out };
  });
  const loadPolicy = async (req: any, id: string, c: Conn = pool, lock = false) => { const x = await p.getPolicy(c, req.tenantId, id, lock); if (!x) throw notFound(); if (!canReadAll(who(req))) { const live = await p.getLive(c, req.tenantId, x.id); if (!live || x.archivedAt || !appliesTo(who(req), x.audience)) throw notFound(); } return x; };
  /** Export the policy list with acknowledgement counts. Managers and auditors only. */
  app.get('/t/:tenantId/policies/export', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canReadAll(who(req))) throw forbidden('Only client admins, auditors and managing iSecurify staff can export policies'); const f = ctx.parse(z.object({ format: z.enum(FORMATS).default('csv') }), req.query ?? {});
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited'); const rows = await p.listPolicies(pool, req.tenantId); if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(413, 'Too many policies to export at once', 'too_many');
    const vs = await p.versionSummaries(pool, req.tenantId), acks = await p.ackCounts(pool, req.tenantId), cache: Partial<Record<Audience, any[]>> = {}, t = today();
    await tx(pool, c => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'export.policies', entity: 'policy', entityId: req.tenantId, detail: { format: f.format, count: rows.length }, ip: req.ip }));
    const out: any[][] = []; for (const x of rows) { const live = vs.find((v: any) => v.policyId === x.id && v.status === 'published'), open = vs.find((v: any) => v.policyId === x.id && v.status !== 'published'); const reqd = cache[x.audience as Audience] ??= await p.requiredUsers(pool, req.tenantId, AUDIENCE_ROLES[x.audience as Audience]); const ids = new Set(reqd.map((u: any) => u.id));
      out.push([ref(x.policyNo), x.title, x.category, AUDIENCE_LABEL[x.audience as Audience], x.ownerName, live?.versionNo ?? '', live?.publishedAt ? new Date(live.publishedAt) : '', live?.nextReviewDate ?? '', live ? reviewOverdue(live.nextReviewDate, t) : '', open ? `v${open.versionNo} ${open.status}` : '', live ? reqd.length : '', live ? acks.filter((a: any) => a.versionId === live.id && ids.has(a.userId)).length : '', x.archivedAt ? 'Archived' : 'Active']); }
    return sendTable(reply, { base: 'policies', format: f.format, sheet: 'Policies', today: t, headers: ['Ref', 'Title', 'Category', 'Audience', 'Owner', 'Live version', 'Published', 'Next review', 'Review overdue', 'Open version', 'Must acknowledge', 'Acknowledged', 'State'], rows: out });
  });
  app.get('/t/:tenantId/policies/:id', { preHandler: tenantCtx }, async (req: any) => {
    const x = await loadPolicy(req, req.params.id); const w = who(req), all = canReadAll(w); const live = await p.getLive(pool, req.tenantId, x.id); const versions = await p.listVersions(pool, req.tenantId, x.id, !all);
    const state = await ackState(pool, req.tenantId, x.audience, live?.id ?? null); const mine = live && appliesTo(w, x.audience) ? state.some((s: any) => s.userId === me(req).id && s.acknowledgedAt) || await p.hasAck(pool, req.tenantId, live.id, me(req).id) : null;
    const open = versions.find((v: any) => v.status === 'draft' || v.status === 'in_review');
    const bodies = all ? await Promise.all(versions.map((v: any) => p.getVersion(pool, req.tenantId, x.id, v.id))) : versions;
    return { ...pShape(req, x, live, open, { required: live ? state.length : 0, acknowledged: state.filter((s: any) => s.acknowledgedAt).length, mine }), live: live ? vShape(req, x, live, true) : null,
      versions: (all ? bodies : versions).map((v: any) => vShape(req, x, v, true)), events: all ? await p.listEvents(pool, req.tenantId, x.id) : [], acknowledgements: all ? state : [] };
  });
  const Create = z.object({ title: Text(300).min(1), category: z.enum(CATEGORIES), audience: z.enum(AUDIENCES).default('staff'), reviewMonths: z.number().int().min(1).max(36).default(12), ownerUserId: Uuid.nullish(), body: z.string().min(1), changeSummary: Text(1000).nullish() });
  app.post('/t/:tenantId/policies', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canManage(who(req))) throw forbidden('Only client admins and managing iSecurify staff can write policies'); const b = ctx.parse(Create, req.body); { const k = bodyCheck(b.body); if (!k.ok) fail(k as any); }
    if (!ctx.limiter.allow(`policy:${me(req).id}`, 60, 3600_000)) throw new HttpError(429, 'Too many policies created. Please try again later.', 'rate_limited'); const id = uuid(), vid = uuid(); let no = 0; const owner = b.ownerUserId ?? me(req).id;
    await tx(pool, async (c) => { if (!(await p.isOwnerCandidate(c, req.tenantId, owner))) throw bad('The owner must be an active client admin of this organization');
      await p.lockTenant(c, req.tenantId); no = await p.nextNo(c, req.tenantId); await p.insertPolicy(c, req.tenantId, { id, no, title: b.title, category: b.category, audience: b.audience, reviewMonths: b.reviewMonths, ownerUserId: owner, createdBy: me(req).id });
      await p.insertVersion(c, req.tenantId, { id: vid, policyId: id, no: 1, body: b.body.trim(), changeSummary: b.changeSummary ?? 'First version', authorId: me(req).id });
      await p.addEvent(c, req.tenantId, { id: uuid(), policyId: id, kind: 'created', versionNo: 1, actorId: me(req).id }); await auditP(c, req, 'policy.created', { policyId: id, ref: ref(no), category: b.category, audience: b.audience }); });
    reply.code(201).send({ id, ref: ref(no), policyNo: no, versionId: vid });
  });
  const Patch = z.object({ title: Text(300).min(1).optional(), category: z.enum(CATEGORIES).optional(), audience: z.enum(AUDIENCES).optional(), reviewMonths: z.number().int().min(1).max(36).optional(), ownerUserId: Uuid.optional() });
  app.patch('/t/:tenantId/policies/:id', { preHandler: tenantCtx }, async (req: any) => {
    if (!canManage(who(req))) throw forbidden(); const b = ctx.parse(Patch, req.body); if (!Object.keys(b).length) throw bad('Nothing to change');
    await tx(pool, async (c) => { const cur = await loadPolicy(req, req.params.id, c, true); if (cur.archivedAt) throw conflict('This policy is archived. Restore it first'); if (b.ownerUserId && !(await p.isOwnerCandidate(c, req.tenantId, b.ownerUserId))) throw bad('The owner must be an active client admin of this organization');
      const changed = Object.keys(b).filter(k => (b as any)[k] !== (cur as any)[k]); if (!changed.length) return; await p.updatePolicy(c, req.tenantId, cur.id, b);
      await p.addEvent(c, req.tenantId, { id: uuid(), policyId: cur.id, kind: changed.includes('ownerUserId') ? 'assigned' : 'edited', note: `Changed: ${changed.join(', ')}`, actorId: me(req).id }); await auditP(c, req, 'policy.updated', { policyId: cur.id, ref: ref(cur.policyNo), fields: changed }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/policies/:id/archive', { preHandler: tenantCtx }, async (req: any) => {
    if (!canManage(who(req))) throw forbidden(); const b = ctx.parse(z.object({ archived: z.boolean() }), req.body);
    await tx(pool, async (c) => { const cur = await loadPolicy(req, req.params.id, c, true); if (!!cur.archivedAt === b.archived) throw conflict(b.archived ? 'This policy is already archived' : 'This policy is not archived'); await p.setArchived(c, req.tenantId, cur.id, b.archived);
      await p.addEvent(c, req.tenantId, { id: uuid(), policyId: cur.id, kind: b.archived ? 'archived' : 'restored', actorId: me(req).id }); await auditP(c, req, b.archived ? 'policy.archived' : 'policy.restored', { policyId: cur.id, ref: ref(cur.policyNo) }); });
    return { ok: true };
  });
  // ---------------------------------------------------------------- versions
  app.post('/t/:tenantId/policies/:id/versions', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canManage(who(req))) throw forbidden(); const b = ctx.parse(z.object({ body: z.string().min(1).optional(), changeSummary: Text(1000).nullish() }), req.body ?? {}); const vid = uuid(); let no = 0;
    await tx(pool, async (c) => { const cur = await loadPolicy(req, req.params.id, c, true); if (cur.archivedAt) throw conflict('This policy is archived. Restore it first'); const live = await p.getLive(c, req.tenantId, cur.id); const body = (b.body ?? live?.body ?? '').trim(); { const k = bodyCheck(body); if (!k.ok) fail(k as any); }
      no = await p.nextVersionNo(c, req.tenantId, cur.id); try { await p.insertVersion(c, req.tenantId, { id: vid, policyId: cur.id, no, body, changeSummary: b.changeSummary ?? null, authorId: me(req).id }); } catch (e: any) { if (e.code === 'ER_DUP_ENTRY') throw conflict('This policy already has a version being worked on'); throw e; }
      await p.addEvent(c, req.tenantId, { id: uuid(), policyId: cur.id, kind: 'drafted', versionNo: no, actorId: me(req).id }); await auditP(c, req, 'policy.version_drafted', { policyId: cur.id, ref: ref(cur.policyNo), version: no }); });
    reply.code(201).send({ id: vid, versionNo: no });
  });
  const loadVersion = async (c: Conn, req: any, pol: any, vid: string, lock = true) => { const v = await p.getVersion(c, req.tenantId, pol.id, vid, lock); if (!v) throw notFound(); return v; };
  app.patch('/t/:tenantId/policies/:id/versions/:vid', { preHandler: tenantCtx }, async (req: any) => {
    if (!canManage(who(req))) throw forbidden(); const b = ctx.parse(z.object({ body: z.string().min(1).optional(), changeSummary: Text(1000).nullable().optional() }), req.body); if (b.body === undefined && b.changeSummary === undefined) throw bad('Nothing to change'); if (b.body !== undefined) { const k = bodyCheck(b.body); if (!k.ok) fail(k as any); }
    await tx(pool, async (c) => { const pol = await loadPolicy(req, req.params.id, c, true); if (pol.archivedAt) throw conflict('This policy is archived. Restore it first'); const v = await loadVersion(c, req, pol, req.params.vid); if (v.status !== 'draft') throw conflict('Only a draft can be edited. Send the version back first');
      await p.updateDraft(c, req.tenantId, v.id, { body: b.body?.trim(), changeSummary: b.changeSummary }); await p.addEvent(c, req.tenantId, { id: uuid(), policyId: pol.id, kind: 'edited', versionNo: v.versionNo, actorId: me(req).id }); await auditP(c, req, 'policy.version_edited', { policyId: pol.id, ref: ref(pol.policyNo), version: v.versionNo }); });
    return { ok: true };
  });
  app.delete('/t/:tenantId/policies/:id/versions/:vid', { preHandler: tenantCtx }, async (req: any) => {
    if (!canManage(who(req))) throw forbidden();
    await tx(pool, async (c) => { const pol = await loadPolicy(req, req.params.id, c, true); if (pol.archivedAt) throw conflict('This policy is archived. Restore it first'); const v = await loadVersion(c, req, pol, req.params.vid); if (v.status !== 'draft') throw conflict('Only a draft can be discarded'); if ((await p.versionCount(c, req.tenantId, pol.id)) < 2) throw conflict('A policy needs at least one version. Archive the policy instead');
      await p.deleteVersion(c, req.tenantId, v.id); await p.addEvent(c, req.tenantId, { id: uuid(), policyId: pol.id, kind: 'discarded', versionNo: v.versionNo, actorId: me(req).id }); await auditP(c, req, 'policy.version_discarded', { policyId: pol.id, ref: ref(pol.policyNo), version: v.versionNo }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/policies/:id/versions/:vid/transition', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ to: z.enum(['draft', 'in_review', 'published']), note: Text(2000).nullish() }), req.body);
    await tx(pool, async (c) => { const pol = await loadPolicy(req, req.params.id, c, true); const v = await loadVersion(c, req, pol, req.params.vid); const isAuthor = v.authorId === me(req).id; const ck = versionCheck(v.status, b.to, who(req), isAuthor, b.note, !!pol.archivedAt); if (!ck.ok) fail(ck as any);
      const note = b.note?.trim() || null;
      if (b.to === 'in_review') { await p.submitVersion(c, req.tenantId, v.id); await p.addEvent(c, req.tenantId, { id: uuid(), policyId: pol.id, kind: 'submitted', versionNo: v.versionNo, note, actorId: me(req).id }); await notify(c, { tenantId: req.tenantId, kind: 'policy.review', recipients: (await p.approvers(c, req.tenantId)).map((a: any) => a.id).filter((id: string) => id !== v.authorId), actorId: me(req).id, entityType: 'policy', entityId: pol.id, engagementId: null, label: `${label(pol)} version ${v.versionNo}` }); }
      else if (b.to === 'draft') { await p.backToDraft(c, req.tenantId, v.id); await p.addEvent(c, req.tenantId, { id: uuid(), policyId: pol.id, kind: isAuthor ? 'withdrawn' : 'rejected', versionNo: v.versionNo, note, actorId: me(req).id }); }
      else { const t = today(); await p.supersedeLive(c, req.tenantId, pol.id); await p.publishVersion(c, req.tenantId, v.id, me(req).id, addMonths(t, pol.reviewMonths)); await p.addEvent(c, req.tenantId, { id: uuid(), policyId: pol.id, kind: 'published', versionNo: v.versionNo, note, actorId: me(req).id });
        await notify(c, { tenantId: req.tenantId, kind: 'policy.published', recipients: (await p.requiredUsers(c, req.tenantId, AUDIENCE_ROLES[pol.audience as Audience])).map((u: any) => u.id), actorId: me(req).id, entityType: 'policy', entityId: pol.id, engagementId: null, label: `${label(pol)} version ${v.versionNo}` }); }
      await auditP(c, req, `policy.${b.to === 'published' ? 'published' : b.to === 'in_review' ? 'submitted' : isAuthor ? 'withdrawn' : 'rejected'}`, { policyId: pol.id, ref: ref(pol.policyNo), version: v.versionNo }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/policies/:id/comments', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!canReadAll(who(req))) throw forbidden(); const b = ctx.parse(z.object({ note: Text(5000).min(1) }), req.body); const x = await loadPolicy(req, req.params.id);
    await tx(pool, async (c) => { await p.addEvent(c, req.tenantId, { id: uuid(), policyId: x.id, kind: 'comment', note: b.note, actorId: me(req).id }); }); reply.code(201).send({ ok: true });
  });
  // ---------------------------------------------------------------- acknowledgement
  app.post('/t/:tenantId/policies/:id/acknowledge', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ versionId: Uuid }), req.body); const id = uuid();
    await tx(pool, async (c) => { const pol = await loadPolicy(req, req.params.id, c, true); if (!appliesTo(who(req), pol.audience)) throw forbidden('This policy does not require your acknowledgement'); const live = await p.getLive(c, req.tenantId, pol.id); if (!live) throw notFound();
      if (live.id !== b.versionId) throw new HttpError(409, 'A newer version has been published. Read it and acknowledge that one', 'outdated'); if (await p.hasAck(c, req.tenantId, live.id, me(req).id)) throw new HttpError(409, 'You have already acknowledged this version', 'already_acknowledged');
      await p.insertAck(c, req.tenantId, { id, policyId: pol.id, versionId: live.id, userId: me(req).id }); await auditP(c, req, 'policy.acknowledged', { policyId: pol.id, ref: ref(pol.policyNo), version: live.versionNo }); });
    reply.code(201).send({ ok: true });
  });
}
