// Certificates. Issuing and revoking: iSecurify team members with manage rights on the organization. Viewing: client admins, the same staff, and TP auditors.
// The public status page (/public/certificates/:code) needs no sign-in and shows only the minimum: who, what, scope, dates and status.
import crypto from 'node:crypto'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import * as d from '../engagements/data'; import { evalRow } from '../engagements/evaluation'; import { getOrg, listMembers } from '../tenancy/data'; import { notify } from '../notifications/notify';
import { loadBrand } from '../branding/routes'; import * as c from './data'; import * as so from '../signoff/data'; import { certificateCheck, OPINION_LABEL } from '../signoff/rules'; import { statusOf, daysLeft, expiringSoon, readinessCheck, validityCheck, STATUS_LABEL, numberOf, type CertStatus } from './rules'; import { renderCertificate } from './pdf';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date'); const Uuid = z.string().uuid();
const today = () => new Date().toISOString().slice(0, 10);
export function registerCertificates(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r); const origin = () => (ctx.cfg.origin ?? 'http://localhost:5173').replace(/\/+$/, '');
  const isStaffManager = (req: any) => req.access.via === 'staff' && !!req.access.manage; const canView = (req: any) => !!req.access.manage || req.access.role === 'tp_auditor';
  const needView = (req: any) => { if (!canView(req)) throw forbidden(); }; const needIssuer = (req: any) => { if (!isStaffManager(req)) throw forbidden('Only iSecurify team members assigned to this organization can issue or revoke certificates'); };
  const verifyUrl = (code: string) => `${origin()}/verify/${code}`;
  const shape = (x: any, t = today()) => { const status = statusOf({ revokedAt: x.revokedAt, supersededBy: x.supersededBy, validUntil: x.validUntil }, t); return { id: x.id, number: x.number, opinion: x.opinion ?? null, opinionLabel: x.opinion ? OPINION_LABEL[x.opinion as 'qualified'] : 'Issued without an external auditor', engagementId: x.engagementId, engagementName: x.engagementName, frameworkId: x.frameworkId, frameworkName: x.frameworkName, frameworkVersion: x.frameworkVersion, organizationName: x.organizationName, scope: x.scope,
    issuedOn: x.issuedOn, validUntil: x.validUntil, status, statusLabel: STATUS_LABEL[status], daysLeft: status === 'valid' ? daysLeft(x.validUntil, t) : null, expiringSoon: expiringSoon(status, x.validUntil, t), applicable: x.applicable, effective: x.effective, overridden: !!x.overrideReason, overrideReason: x.overrideReason, issuedBy: x.issuedBy, createdAt: x.createdAt,
    revokedAt: x.revokedAt, revokedBy: x.revokedBy, revokeReason: x.revokeReason, supersededBy: x.supersededBy, verifyUrl: verifyUrl(x.verifyCode) }; };
  /** Applicable and effective control counts for one framework of one engagement, evaluated exactly as the checklist does. */
  async function readiness(conn: any, tenantId: string, engagementId: string, frameworkId: string) {
    const [rows, sat] = await Promise.all([d.listItems(conn, tenantId, engagementId, { kind: 'all' }, today()), d.satisfiesFor(conn, tenantId, engagementId)]); const ids = new Set(sat.filter((s: any) => s.frameworkId === frameworkId).map((s: any) => s.itemId));
    let applicable = 0, effective = 0; for (const r of rows) { if (!ids.has(r.id)) continue; const ev = evalRow(r, today()); if (ev.state === 'not_applicable') continue; applicable++; if (ev.state === 'effective') effective++; } return { applicable, effective };
  }
  const clientAdmins = async (conn: any, tenantId: string) => (await listMembers(conn, tenantId)).filter((m: any) => m.role === 'client_admin' && m.status === 'active').map((m: any) => m.id as string);

  app.get('/t/:tenantId/certificates', { preHandler: tenantCtx }, async (req: any) => { needView(req); const t = today(); let rows = (await c.listCertificates(pool, req.tenantId)).map((x: any) => shape(x, t));
    if (req.access.role === 'tp_auditor') { const mine = new Set((await d.listEngagements(pool, req.tenantId, { kind: 'auditor', userId: me(req).id })).map((e: any) => e.id)); rows = rows.filter(x => mine.has(x.engagementId)); }
    const n = (s: CertStatus) => rows.filter(x => x.status === s).length; return { can: { issue: isStaffManager(req), revoke: isStaffManager(req) }, summary: { valid: n('valid'), expiringSoon: rows.filter(x => x.expiringSoon).length, expired: n('expired'), revoked: n('revoked'), superseded: n('superseded') }, certificates: rows }; });
  /** Closed engagements and their frameworks with how ready each is, for the issue form. */
  app.get('/t/:tenantId/certificates/eligible', { preHandler: tenantCtx }, async (req: any) => { needIssuer(req); const out: any[] = [];
    for (const e of (await d.listEngagements(pool, req.tenantId, { kind: 'all' })).filter((x: any) => x.status === 'closed').slice(0, 100)) for (const fw of await d.engagementFrameworks(pool, req.tenantId, e.id)) { const r = await readiness(pool, req.tenantId, e.id, fw.frameworkId); out.push({ engagementId: e.id, engagementName: e.name, frameworkId: fw.frameworkId, frameworkName: fw.name, frameworkVersion: fw.version, ...r, ready: r.applicable > 0 && r.applicable === r.effective }); }
    return { options: out }; });
  app.post('/t/:tenantId/certificates', { preHandler: tenantCtx }, async (req: any, reply) => {
    needIssuer(req); const b = ctx.parse(z.object({ engagementId: Uuid, frameworkId: Uuid, scope: z.string().trim().min(10).max(2000), validUntil: DateStr, overrideReason: z.string().trim().max(1000).nullish() }), req.body); const t = today();
    const org = await getOrg(pool, req.tenantId); if (!org || org.status !== 'active') throw conflict('This organization is not active'); const v = validityCheck(t, b.validUntil); if (!v.ok) throw bad((v as any).message);
    if (!ctx.limiter.allow(`cert:${me(req).id}`, 30, 3600_000)) throw new HttpError(429, 'Too many certificates issued. Please try again later.', 'rate_limited');
    const id = uuid(); const code = crypto.randomBytes(16).toString('base64url'); let out: any;
    await tx(pool, async (conn) => {
      const e = await d.getEngagement(conn, req.tenantId, b.engagementId, true); if (!e) throw notFound(); if (e.status !== 'closed') throw new HttpError(409, 'A certificate can only be issued for a closed engagement', 'engagement_open');
      const signoff = await so.activeFor(conn, req.tenantId, e.id); const sv = certificateCheck(signoff ? { id: signoff.id, kind: signoff.kind, opinion: signoff.opinion, applicable: signoff.applicable, effective: signoff.effective, unresolved: signoff.unresolved } : null); if (!sv.ok) throw new HttpError(409, (sv as any).message, (sv as any).code);
      const fw = (await d.engagementFrameworks(conn, req.tenantId, e.id)).find((x: any) => x.frameworkId === b.frameworkId); if (!fw) throw bad('That framework is not part of this engagement');
      const r = await readiness(conn, req.tenantId, e.id, b.frameworkId); const chk = readinessCheck(r, b.overrideReason); if (!chk.ok) throw new HttpError(409, (chk as any).message, (chk as any).code);
      const previous = (await c.activeFor(conn, req.tenantId, b.frameworkId)).map((x: any) => x.id as string);
      await c.insertCertificate(conn, { id, tenantId: req.tenantId, engagementId: e.id, frameworkId: b.frameworkId, organizationName: org.name, engagementName: e.name, frameworkName: fw.name, frameworkVersion: fw.version, scope: b.scope, issuedOn: t, validUntil: b.validUntil, verifyCode: code, applicable: r.applicable, effective: r.effective, overrideReason: (chk as any).overridden ? b.overrideReason!.trim() : null, issuedBy: me(req).id, opinion: signoff.opinion ?? null, signoffId: signoff.id });
      await c.markSuperseded(conn, req.tenantId, previous, id); const row = await c.getCertificate(conn, req.tenantId, id); out = shape(row, t);
      await audit(conn, { tenantId: req.tenantId, actorId: me(req).id, action: 'certificate.issued', entity: 'engagement', entityId: e.id, detail: { engagementId: e.id, certificateId: id, number: row.number, framework: fw.name, validUntil: b.validUntil, applicable: r.applicable, effective: r.effective, overridden: (chk as any).overridden, opinion: signoff.opinion ?? 'waiver', supersedes: previous }, ip: req.ip });
      await notify(conn, { tenantId: req.tenantId, kind: 'certificate.issued', recipients: await clientAdmins(conn, req.tenantId), actorId: me(req).id, entityType: 'certificate', entityId: id, engagementId: e.id, label: `${row.number}: ${fw.name} v${fw.version}, valid until ${b.validUntil}` });
    });
    reply.code(201).send(out);
  });
  app.get('/t/:tenantId/certificates/:id', { preHandler: tenantCtx }, async (req: any) => { needView(req); const x = await load(req); return shape(x); });
  const load = async (req: any) => { const x = await c.getCertificate(pool, req.tenantId, req.params.id); if (!x) throw notFound();
    if (req.access.role === 'tp_auditor' && !(await d.getVisibleEngagement(pool, req.tenantId, x.engagementId, { kind: 'auditor', userId: me(req).id }))) throw notFound(); return x; };
  app.get('/t/:tenantId/certificates/:id/pdf', { preHandler: tenantCtx }, async (req: any, reply) => { needView(req); const x = await load(req); const status = statusOf({ revokedAt: x.revokedAt, supersededBy: x.supersededBy, validUntil: x.validUntil }, today());
    if (status === 'revoked') throw new HttpError(409, 'This certificate has been revoked and can no longer be downloaded', 'certificate_revoked');
    const brand = await loadBrand(pool); const file = await renderCertificate({ number: x.number, organizationName: x.organizationName, frameworkName: x.frameworkName, frameworkVersion: x.frameworkVersion, scope: x.scope, issuedOn: x.issuedOn, validUntil: x.validUntil, verifyUrl: verifyUrl(x.verifyCode), issuedBy: x.issuedBy, engagementName: x.engagementName, opinion: x.opinion ?? null }, brand);
    await audit(pool, { tenantId: req.tenantId, actorId: me(req).id, action: 'certificate.downloaded', entity: 'engagement', entityId: x.engagementId, detail: { engagementId: x.engagementId, certificateId: x.id, number: x.number }, ip: req.ip });
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${x.number}.pdf"`).header('cache-control', 'no-store').send(file); });
  app.post('/t/:tenantId/certificates/:id/revoke', { preHandler: tenantCtx }, async (req: any) => { needIssuer(req); const b = ctx.parse(z.object({ reason: z.string().trim().min(5).max(1000) }), req.body); await load(req);
    await tx(pool, async (conn) => { const x = await c.getCertificate(conn, req.tenantId, req.params.id, true); if (!x) throw notFound(); if (x.revokedAt) throw conflict('This certificate is already revoked');
      await c.markRevoked(conn, req.tenantId, x.id, me(req).id, b.reason);
      await audit(conn, { tenantId: req.tenantId, actorId: me(req).id, action: 'certificate.revoked', entity: 'engagement', entityId: x.engagementId, detail: { engagementId: x.engagementId, certificateId: x.id, number: x.number, reason: b.reason }, ip: req.ip });
      await notify(conn, { tenantId: req.tenantId, kind: 'certificate.revoked', recipients: await clientAdmins(conn, req.tenantId), actorId: me(req).id, entityType: 'certificate', entityId: x.id, engagementId: x.engagementId, label: `${x.number}: ${x.frameworkName} v${x.frameworkVersion}` }); });
    return { ok: true }; });
  /** Public: no sign-in. Same answer shape for every status; a code that does not exist is a plain 404 (and lookups are rate limited per address). */
  app.get('/public/certificates/:code', async (req: any, reply) => {
    if (!ctx.limiter.allow(`certverify:${req.ip}`, 60, 60_000)) throw new HttpError(429, 'Too many requests. Please try again shortly.', 'rate_limited');
    const code = String(req.params.code ?? ''); if (!/^[A-Za-z0-9_-]{22}$/.test(code)) throw notFound(); const x = await c.findPublicByCode(pool, code); if (!x) throw notFound(); const status = statusOf({ revokedAt: x.revokedAt, supersededBy: x.supersededBy, validUntil: x.validUntil }, today());
    reply.header('cache-control', 'no-store'); return { valid: status === 'valid', status, statusLabel: STATUS_LABEL[status], number: x.number, organization: x.organizationName, framework: `${x.frameworkName} (version ${x.frameworkVersion})`, scope: x.scope, issuedOn: x.issuedOn, validUntil: x.validUntil, issuer: 'iSecurify', auditorOpinion: x.opinion ?? null };
  });
}
