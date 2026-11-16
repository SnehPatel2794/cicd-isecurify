// Reports and exports. Who: the people who review an engagement (client admins, iSecurify team members with manage rights, the engagement's TP auditor).
// Exporting is a POST because it writes a record; the file is returned in the response and never stored, only its SHA-256 is.
import crypto from 'node:crypto'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, forbidden, notFound } from '../../platform/errors';
import * as d from '../engagements/data'; import { scopeOf as scopeOfAccess } from '../engagements/access'; import { getOrg } from '../tenancy/data';
import { buildReport, ReportTooLarge } from './build'; import { renderPdf } from './pdf'; import { loadBrand } from '../branding/routes'; import { renderXlsx } from './xlsx'; import * as x from './data';

const slug = (s: string) => s.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60).toLowerCase() || 'engagement';
export function registerReports(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const canExport = (req: any) => !!req.access.manage || req.access.role === 'tp_auditor';
  const need = (req: any) => { if (!canExport(req)) throw forbidden('Only client admins, iSecurify team members and the TP auditor can export reports'); };
  const visible = async (req: any, id: string) => { const e = await d.getVisibleEngagement(pool, req.tenantId, id, scopeOfAccess(req.access, me(req).id)); if (!e) throw notFound(); return e; };
  const shape = (r: any) => ({ id: r.id, engagementId: r.engagementId, engagementName: r.engagementName, format: r.format, sha256: r.sha256, sizeBytes: Number(r.sizeBytes), counts: typeof r.counts === 'string' ? JSON.parse(r.counts) : r.counts, engagementStatus: r.engagementStatus, generatedBy: r.generatedBy, createdAt: r.createdAt });

  app.post('/t/:tenantId/engagements/:id/exports', { preHandler: tenantCtx }, async (req: any, reply) => {
    need(req); const b = ctx.parse(z.object({ format: z.enum(['pdf', 'xlsx']), includeSoa: z.boolean().default(true) }), req.body); const eng = await visible(req, req.params.id);
    if (!ctx.limiter.allow(`export:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many exports. Please try again later.', 'rate_limited');
    const org = await getOrg(pool, req.tenantId); const reportId = uuid(); const today = new Date().toISOString().slice(0, 10);
    let data; try { data = await buildReport(pool, { tenantId: req.tenantId, engagement: eng, scope: scopeOfAccess(req.access, me(req).id), today, reportId, generatedBy: me(req).name, organization: org?.name ?? '', includeSoa: b.includeSoa && !!(req.access.manage || req.access.role === 'tp_auditor') }); }
    catch (e: any) { if (e instanceof ReportTooLarge) throw new HttpError(413, e.message, 'report_too_large'); throw e; }
    const file = b.format === 'pdf' ? await renderPdf(data, await loadBrand(pool)) : await renderXlsx(data); const sha = crypto.createHash('sha256').update(file).digest('hex');
    await tx(pool, async (c) => { await x.insertExport(c, { id: reportId, tenantId: req.tenantId, engagementId: eng.id, format: b.format, sha256: sha, sizeBytes: file.length, counts: data.counts, engagementStatus: eng.status, generatedBy: me(req).id });
      await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'report.exported', entity: 'engagement', entityId: eng.id, detail: { engagementId: eng.id, reportId, format: b.format, sha256: sha, sizeBytes: file.length, ...data.counts }, ip: req.ip }); });
    const name = `${slug(eng.name)}-${b.format === 'pdf' ? 'report' : 'workbook'}-${today}.${b.format}`;
    reply.header('content-type', b.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${name}"`).header('cache-control', 'no-store').header('x-report-id', reportId).header('x-report-sha256', sha).header('access-control-expose-headers', 'x-report-id, x-report-sha256, content-disposition');
    return reply.send(file);
  });
  app.get('/t/:tenantId/engagements/:id/exports', { preHandler: tenantCtx }, async (req: any) => { need(req); const eng = await visible(req, req.params.id); return { engagementId: eng.id, exports: (await x.listExports(pool, req.tenantId, eng.id)).map(shape) }; });
  /** "Is this file one the platform produced?" The browser hashes the file and sends only the hash. Only exports of engagements the caller can see are revealed. */
  app.post('/t/:tenantId/exports/verify', { preHandler: tenantCtx }, async (req: any) => {
    need(req); const b = ctx.parse(z.object({ sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, 'Expected a SHA-256 (64 hex characters)') }), req.body);
    const hits: any[] = []; for (const r of await x.findByHash(pool, req.tenantId, b.sha256)) { if (await d.getVisibleEngagement(pool, req.tenantId, r.engagementId, scopeOfAccess(req.access, me(req).id))) hits.push(shape(r)); }
    await audit(pool, { tenantId: req.tenantId, actorId: me(req).id, action: 'report.verified', entity: 'organization', entityId: req.tenantId, detail: { sha256: b.sha256, match: hits.length > 0 }, ip: req.ip });
    return { match: hits.length > 0, exports: hits };
  });
}
