// Branding routes. Reading the public profile and logo needs no sign-in (the login page uses them); changing anything is for the Super Admin only.
import crypto from 'node:crypto'; import PDFDocument from 'pdfkit'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { HttpError, bad, forbidden, notFound } from '../../platform/errors';
import * as b from './data'; import { isHex, normHex, primaryProblem, inspectLogo, cleanText, DEFAULTS, MAX_LOGO_BYTES, type Brand } from './rules';

export const publicShape = (r: b.Row) => ({ companyName: r.companyName, primaryColor: r.primaryColor, secondaryColor: r.secondaryColor, accentColor: r.accentColor, footerText: r.footerText, hasLogo: !!r.hasLogo, version: r.version });
/** Everything a PDF needs: the profile plus the logo bytes (null when none). Falls back to the defaults if the row cannot be read, so documents never fail because of branding. */
export async function loadBrand(c: Conn): Promise<Brand> {
  try { const [p, l] = await Promise.all([b.getProfile(c), b.getLogo(c)]); return { companyName: p.companyName, primaryColor: p.primaryColor, secondaryColor: p.secondaryColor, accentColor: p.accentColor, footerText: p.footerText, logo: l?.data ?? null }; }
  catch { return { ...DEFAULTS, logo: null }; }
}
const Hex = z.string().trim().refine(isHex, 'Use a colour like #812671').transform(normHex);
export function registerBranding(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const superAdmin = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole !== 'super_admin') throw forbidden('Only the Super Admin can change branding'); };
  app.get('/branding', async (_req, reply) => { reply.header('cache-control', 'public, max-age=30'); return publicShape(await b.getProfile(pool)); });
  app.get('/branding/logo', async (req: any, reply) => {
    const l = await b.getLogo(pool); if (!l) throw notFound(); const etag = `"${l.sha256}"`; reply.header('etag', etag).header('cache-control', 'public, max-age=300').header('content-type', l.mime).header('content-disposition', 'inline; filename="logo"').header('content-security-policy', "default-src 'none'; sandbox");
    if (req.headers['if-none-match'] === etag) return reply.code(304).send(); return reply.send(l.data);
  });
  /** Full profile for the settings page (adds who changed it and the logo facts). */
  app.get('/platform/branding', { preHandler: superAdmin }, async () => { const r = await b.getProfile(pool); return { ...publicShape(r), logo: r.hasLogo ? { mime: r.logoMime, size: r.logoSize, width: r.logoWidth, height: r.logoHeight, sha256: r.logoSha256 } : null, updatedAt: r.updatedAt, updatedBy: r.updatedBy, defaults: DEFAULTS }; });
  const Put = z.object({ companyName: z.string().trim().min(1).max(120), primaryColor: Hex, secondaryColor: Hex, accentColor: Hex, footerText: z.string().trim().max(300).default('') });
  app.put('/platform/branding', { preHandler: superAdmin }, async (req: any) => {
    const v = ctx.parse(Put, req.body); const name = cleanText(v.companyName, 120); if (!name) throw bad('Enter the company name'); const problem = primaryProblem(v.primaryColor); if (problem) throw bad(problem); const footer = cleanText(v.footerText, 300);
    await tx(pool, async (c) => { const cur = await b.getProfile(c); const next = { companyName: name, primaryColor: v.primaryColor, secondaryColor: v.secondaryColor, accentColor: v.accentColor, footerText: footer }; const changed = (Object.keys(next) as (keyof typeof next)[]).filter(k => next[k] !== cur[k]); if (!changed.length) return;
      await b.updateProfile(c, next, me(req).id); await audit(c, { actorId: me(req).id, action: 'branding.updated', entity: 'branding', entityId: '1', detail: { fields: changed }, ip: req.ip }); });
    return publicShape(await b.getProfile(pool));
  });
  app.post('/platform/branding/logo', { preHandler: superAdmin }, async (req: any, reply) => {
    if (!req.isMultipart()) throw bad('Upload the logo as multipart/form-data'); if (!ctx.limiter.allow(`logo:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many uploads. Please try again later.', 'rate_limited');
    const part = await req.file({ limits: { fileSize: MAX_LOGO_BYTES + 1 } }); if (!part) throw bad('No file was uploaded'); const data: Buffer = await part.toBuffer(); if (part.file.truncated || data.length > MAX_LOGO_BYTES) throw new HttpError(413, 'The logo is larger than 2 MB', 'file_too_large');
    const r = inspectLogo(data); if (!r.ok) throw new HttpError(415, (r as any).reason, 'logo_rejected'); const sha = crypto.createHash('sha256').update(data).digest('hex');
    if (r.info.mime === 'image/jpeg') { try { const t = new PDFDocument(); t.on('data', () => {}); t.image(data, 0, 0, { fit: [10, 10] }); t.end(); } catch { throw new HttpError(415, 'This image cannot be placed in reports (save it again as a standard JPG)', 'logo_rejected'); } }
    await tx(pool, async (c) => { await b.setLogo(c, { data, mime: r.info.mime, sha256: sha, width: r.info.width, height: r.info.height }, me(req).id); await audit(c, { actorId: me(req).id, action: 'branding.logo_set', entity: 'branding', entityId: '1', detail: { mime: r.info.mime, size: data.length, width: r.info.width, height: r.info.height, sha256: sha }, ip: req.ip }); });
    reply.code(201).send({ ok: true, sha256: sha, width: r.info.width, height: r.info.height });
  });
  app.delete('/platform/branding/logo', { preHandler: superAdmin }, async (req: any) => { await tx(pool, async (c) => { if (!(await b.getLogo(c))) throw notFound(); await b.clearLogo(c, me(req).id); await audit(c, { actorId: me(req).id, action: 'branding.logo_removed', entity: 'branding', entityId: '1', ip: req.ip }); }); return { ok: true }; });
}
