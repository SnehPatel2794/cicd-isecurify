// Auditor sign-off (Phase 11C). The third-party auditor records an opinion in the Closure phase; without it an engagement with an auditor cannot close and no certificate can be issued.
// With no auditor assigned, an iSecurify manager records a waiver and the reason. Everything is audited; nothing is deleted.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, forbidden, notFound, conflict } from '../../platform/errors';
import * as d from '../engagements/data'; import { closeBlockers, scopeOf } from '../engagements/access'; import { readiness } from '../summary/service'; import { unresolvedCount } from '../findings/data'; import { listMembers } from '../tenancy/data'; import { notify } from '../notifications/notify';
import * as s from './data'; import { OPINIONS, OPINION_LABEL, checkOpinion, checkWaiver, closeReason, type Facts } from './rules';
const today = () => new Date().toISOString().slice(0, 10);

export async function signoffFacts(c: any, tenantId: string, engagementId: string, lock = false): Promise<Facts & { engagementName: string }> {
  const e = await d.getEngagement(c, tenantId, engagementId, lock); if (!e) throw notFound();
  const sum = (await readiness(c, tenantId, [engagementId], { today: today() })).of(engagementId); const a = await s.activeFor(c, tenantId, engagementId, lock);
  return { engagementName: e.name, status: e.status, phase: e.currentPhase, applicable: sum.applicable, effective: sum.effective, unresolvedSerious: await unresolvedCount(c, tenantId, engagementId), hasAuditor: (await s.auditorCount(c, tenantId, engagementId)) > 0,
    active: a ? { id: a.id, kind: a.kind, opinion: a.opinion, applicable: a.applicable, effective: a.effective, unresolved: a.unresolved } : null };
}
// Closing needs the sign-off. Registered (once) when the routes are, so the more specific blockers registered earlier (open findings) are reported first.
const blocker = async (c: any, tenantId: string, engagementId: string) => closeReason(await signoffFacts(c, tenantId, engagementId));

export function registerSignoff(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  if (!closeBlockers.includes(blocker)) closeBlockers.push(blocker);
  const { pool } = ctx; const me = (r: any) => ctx.U(r); const isStaffManager = (req: any) => req.access.via === 'staff' && !!req.access.manage;
  const reviewer = (req: any) => { if (!(req.access.via === 'staff' || req.access.role === 'client_admin' || req.access.role === 'tp_auditor')) throw forbidden(); };
  const visible = async (req: any, id: string) => { const e = await d.getVisibleEngagement(pool, req.tenantId, id, scopeOf(req.access, me(req).id)); if (!e) throw notFound(); return e; };
  const Note = (min: number) => z.string().trim().min(min, `Please write at least ${min} characters`).max(4000);
  const tell = async (c: any, req: any, engagementId: string, label: string) => { const admins = (await listMembers(c, req.tenantId)).filter((m: any) => m.role === 'client_admin' && m.status === 'active').map((m: any) => m.id as string); const team = (await d.listEngagementMembers(c, req.tenantId, engagementId)).map((m: any) => m.userId as string);
    await notify(c, { tenantId: req.tenantId, kind: 'engagement.signed_off', recipients: [...new Set([...admins, ...team])], actorId: me(req).id, entityType: 'engagement', entityId: engagementId, engagementId, label }); };

  app.get('/t/:tenantId/engagements/:id/signoff', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); await visible(req, req.params.id); const f = await signoffFacts(pool, req.tenantId, req.params.id); const history = await s.listFor(pool, req.tenantId, req.params.id); const mine = req.access.role === 'tp_auditor' && !!(await d.getEngagementMember(pool, req.tenantId, req.params.id, me(req).id) && (await d.getEngagementMember(pool, req.tenantId, req.params.id, me(req).id)).role === 'auditor');
    const opinions = OPINIONS.map(o => ({ opinion: o, label: OPINION_LABEL[o], allowed: checkOpinion(f, o).ok, reason: (checkOpinion(f, o) as any).message ?? null })); const wv = checkWaiver(f);
    return { engagementId: req.params.id, status: f.status, phase: f.phase, hasAuditor: f.hasAuditor, applicable: f.applicable, effective: f.effective, unresolvedSerious: f.unresolvedSerious, current: history.find((h: any) => !h.withdrawnAt) ?? null, history, blockedClose: closeReason(f),
      can: { sign: mine && opinions.some(o => o.allowed), waive: isStaffManager(req) && wv.ok, withdraw: f.status === 'active' && (isStaffManager(req) || mine) }, opinions: mine ? opinions : [], waiverReason: isStaffManager(req) && !wv.ok ? (wv as any).message : null };
  });
  app.post('/t/:tenantId/engagements/:id/signoff', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (req.access.role !== 'tp_auditor' || req.access.via === 'staff') throw forbidden('Only the third-party auditor on this engagement can record an opinion'); const b = ctx.parse(z.object({ opinion: z.enum(OPINIONS), note: Note(10) }), req.body);
    if (b.opinion !== 'unqualified' && b.note.length < 20) throw new HttpError(400, 'A qualified or adverse opinion needs an explanation of at least 20 characters', 'validation');
    const out = await tx(pool, async (c) => {
      const m = await d.getEngagementMember(c, req.tenantId, req.params.id, me(req).id); if (!m || m.role !== 'auditor') throw notFound(); const f = await signoffFacts(c, req.tenantId, req.params.id, true);
      const v = checkOpinion(f, b.opinion); if (!v.ok) throw new HttpError(409, (v as any).message, (v as any).code); const id = uuid();
      await s.insert(c, req.tenantId, { id, engagementId: req.params.id, kind: 'auditor', opinion: b.opinion, note: b.note, applicable: f.applicable, effective: f.effective, unresolved: f.unresolvedSerious, signedBy: me(req).id });
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.signed_off', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, signoffId: id, kind: 'auditor', opinion: b.opinion, applicable: f.applicable, effective: f.effective, unresolved: f.unresolvedSerious }, ip: req.ip });
      await tell(c, req, req.params.id, `${f.engagementName}: auditor opinion ${OPINION_LABEL[b.opinion]}`); return { id, opinion: b.opinion };
    }); reply.code(201).send(out);
  });
  app.post('/t/:tenantId/engagements/:id/signoff/waiver', { preHandler: tenantCtx }, async (req: any, reply) => {
    if (!isStaffManager(req)) throw forbidden('Only iSecurify team members assigned to this organization can record a waiver'); const b = ctx.parse(z.object({ reason: Note(10) }), req.body);
    const out = await tx(pool, async (c) => { const f = await signoffFacts(c, req.tenantId, req.params.id, true); const v = checkWaiver(f); if (!v.ok) throw new HttpError(409, (v as any).message, (v as any).code); const id = uuid();
      await s.insert(c, req.tenantId, { id, engagementId: req.params.id, kind: 'waiver', opinion: null, note: b.reason, applicable: f.applicable, effective: f.effective, unresolved: f.unresolvedSerious, signedBy: me(req).id });
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.signoff_waived', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, signoffId: id, reason: b.reason }, ip: req.ip }); return { id }; });
    reply.code(201).send(out);
  });
  app.post('/t/:tenantId/engagements/:id/signoff/withdraw', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); const b = ctx.parse(z.object({ reason: Note(5) }), req.body);
    return tx(pool, async (c) => { const e = await d.getEngagement(c, req.tenantId, req.params.id, true); if (!e) throw notFound(); if (e.status === 'closed') throw new HttpError(409, 'This engagement is closed', 'engagement_closed'); const a = await s.activeFor(c, req.tenantId, req.params.id, true); if (!a) throw conflict('There is no sign-off to withdraw');
      const m = await d.getEngagementMember(c, req.tenantId, req.params.id, me(req).id); const mine = a.signedById === me(req).id && req.access.role === 'tp_auditor' && m?.role === 'auditor'; if (!(isStaffManager(req) || mine)) throw forbidden('Only the auditor who signed, or iSecurify staff with manage rights, can withdraw it');
      await s.withdraw(c, req.tenantId, a.id, me(req).id, b.reason); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'engagement.signoff_withdrawn', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, signoffId: a.id, reason: b.reason }, ip: req.ip }); return { ok: true }; });
  });
}
