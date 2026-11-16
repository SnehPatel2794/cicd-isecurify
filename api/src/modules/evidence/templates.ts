// Evidence TEMPLATE library: global content (not tenant data) that iSecurify staff upload and every signed-in user of an organization can download.
// Files are immutable; "replace" uploads a new template that supersedes the old one, which is retired (never deleted).
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound } from '../../platform/errors';
import { LocalStorage, StorageError, templateKey } from '../../platform/storage'; import type { EvidenceConfig } from '../../config';
import { checkFile, sanitizeFileName, fmtBytes, ALLOWED_EXTENSIONS } from './rules'; import { listAccessibleOrgs } from '../tenancy/data';

const Text = (n: number) => z.string().trim().max(n);
export const downloadHeaders = (name: string, size: number, sha: string) => ({
  'content-type': 'application/octet-stream', 'content-length': String(size), 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'x-evidence-sha256': sha,
  'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
});
/** Reads one text field of a multipart request. Fields must be sent BEFORE the file part (the web client does this). */
export const fieldValue = (part: any, name: string): string | undefined => { const f = part?.fields?.[name]; const v = Array.isArray(f) ? f[0]?.value : f?.value; return typeof v === 'string' ? v : undefined; };

export function registerTemplates(app: FastifyInstance, ctx: Ctx, deps: { storage: LocalStorage; ev: EvidenceConfig }) {
  const { pool } = ctx; const { storage, ev } = deps; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  /** Platform users, or anyone who belongs to at least one organization (member or assigned staff). Customers without an organization get 403. */
  const reader = async (req: any) => { await ctx.withSession()(req); const u = me(req); if (u.platformRole !== 'none') return; if (!(await listAccessibleOrgs(pool, u.id)).length) throw forbidden(); };
  const isPlatform = (req: any) => me(req).platformRole !== 'none';
  const COLS = `t.id, t.name, t.description, t.category, t.framework_id frameworkId, f.name frameworkName, t.version_label versionLabel, t.file_name fileName, t.media_type mediaType, t.size_bytes sizeBytes, t.sha256, t.active, t.replaces_id replacesId, t.created_at createdAt, u.name createdByName, t.retired_at retiredAt`;

  app.get('/templates', { preHandler: reader }, async (req: any) => {
    const f = ctx.parse(z.object({ category: z.string().max(80).optional(), frameworkId: z.string().uuid().optional(), includeRetired: z.enum(['true', 'false']).default('false') }), req.query);
    const w = ['1=1']; const p: any[] = []; if (f.category) { w.push('t.category=?'); p.push(f.category); } if (f.frameworkId) { w.push('(t.framework_id=? OR t.framework_id IS NULL)'); p.push(f.frameworkId); }
    if (!(isPlatform(req) && f.includeRetired === 'true')) w.push('t.active=1');
    return q(pool, `SELECT ${COLS} FROM evidence_templates t JOIN users u ON u.id=t.created_by LEFT JOIN frameworks f ON f.id=t.framework_id WHERE ${w.join(' AND ')} ORDER BY t.category IS NULL, t.category, t.name, t.created_at DESC LIMIT 1000`, p);
  });
  const load = async (req: any, allowRetired = false) => { const t = (await q(pool, `SELECT ${COLS}, t.storage_key storageKey FROM evidence_templates t JOIN users u ON u.id=t.created_by LEFT JOIN frameworks f ON f.id=t.framework_id WHERE t.id=?`, [req.params.id]))[0]; if (!t) throw notFound(); if (!t.active && !allowRetired && !isPlatform(req)) throw notFound(); return t; };
  app.get('/templates/:id/download', { preHandler: reader }, async (req: any, reply) => {
    const t = await load(req, true); if (!(await storage.exists(t.storageKey))) throw new HttpError(500, 'The stored file is missing. Contact support.', 'file_missing');
    for (const [k, v] of Object.entries(downloadHeaders(t.fileName, t.sizeBytes, t.sha256))) reply.header(k, v); return reply.send(storage.open(t.storageKey));
  });
  app.post('/templates', { preHandler: platformUser }, async (req: any, reply) => {
    if (!req.isMultipart()) throw bad('Upload the template as multipart/form-data');
    const part = await req.file({ limits: { fileSize: ev.maxFileBytes + 1 } }); if (!part) throw bad('No file was uploaded');
    const meta = ctx.parse(z.object({ name: Text(190).min(1), description: Text(5000).optional(), category: Text(80).optional(), versionLabel: Text(40).optional(), frameworkId: z.string().uuid().optional(), replacesId: z.string().uuid().optional() }),
      Object.fromEntries(['name', 'description', 'category', 'versionLabel', 'frameworkId', 'replacesId'].map(k => [k, fieldValue(part, k) || undefined])));
    const fileName = sanitizeFileName(part.filename); let rec;
    try { rec = await storage.receive(part.file, ev.maxFileBytes); } catch (e) { if (e instanceof StorageError && e.code === 'too_large') throw new HttpError(413, `File is larger than ${fmtBytes(ev.maxFileBytes)}`, 'file_too_large'); throw e; }
    if (part.file.truncated) { await storage.discard(rec.tmp); throw new HttpError(413, `File is larger than ${fmtBytes(ev.maxFileBytes)}`, 'file_too_large'); }
    let moved: string | null = null; const id = uuid();
    try {
      const v = checkFile(fileName, rec.head, rec.size); if (!v.ok) throw new HttpError(415, (v as any).reason, 'file_type_rejected');
      await tx(pool, async (c) => {
        if (meta.frameworkId && !(await q(c, 'SELECT 1 x FROM frameworks WHERE id=?', [meta.frameworkId]))[0]) throw bad('Unknown framework');
        if (meta.replacesId) { const old = (await q(c, 'SELECT id,active FROM evidence_templates WHERE id=? FOR UPDATE', [meta.replacesId]))[0]; if (!old) throw bad('The template to replace does not exist'); if (!old.active) throw bad('The template to replace is already retired'); }
        await c.query('INSERT INTO evidence_templates(id,name,description,category,framework_id,version_label,file_name,media_type,size_bytes,sha256,storage_key,replaces_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id, meta.name, meta.description ?? null, meta.category ?? null, meta.frameworkId ?? null, meta.versionLabel ?? null, fileName, (v as any).mediaType, rec.size, rec.sha256, templateKey(id), meta.replacesId ?? null, me(req).id]);
        if (meta.replacesId) await c.query('UPDATE evidence_templates SET active=0, retired_by=?, retired_at=NOW(3) WHERE id=?', [me(req).id, meta.replacesId]);
        await storage.commit(rec.tmp, templateKey(id)); moved = templateKey(id);
        await audit(c, { actorId: me(req).id, action: 'template.uploaded', entity: 'evidence_template', entityId: id, detail: { name: meta.name, fileName, sizeBytes: rec.size, sha256: rec.sha256, replaces: meta.replacesId ?? null }, ip: req.ip });
      });
    } catch (e) { if (moved) await storage.remove(moved).catch(() => {}); throw e; } finally { await storage.discard(rec.tmp); }
    reply.code(201).send({ id, sha256: rec.sha256, sizeBytes: rec.size });
  });
  app.patch('/templates/:id', { preHandler: platformUser }, async (req: any) => {
    const b = ctx.parse(z.object({ name: Text(190).min(1).optional(), description: Text(5000).nullish(), category: Text(80).nullish(), versionLabel: Text(40).nullish(), frameworkId: z.string().uuid().nullish() }), req.body);
    await tx(pool, async (c) => { const t = (await q(c, 'SELECT * FROM evidence_templates WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!t) throw notFound();
      if (b.frameworkId && !(await q(c, 'SELECT 1 x FROM frameworks WHERE id=?', [b.frameworkId]))[0]) throw bad('Unknown framework');
      await c.query('UPDATE evidence_templates SET name=?, description=?, category=?, version_label=?, framework_id=? WHERE id=?', [b.name ?? t.name, b.description === undefined ? t.description : b.description, b.category === undefined ? t.category : b.category, b.versionLabel === undefined ? t.version_label : b.versionLabel, b.frameworkId === undefined ? t.framework_id : b.frameworkId, t.id]);
      await audit(c, { actorId: me(req).id, action: 'template.updated', entity: 'evidence_template', entityId: t.id, detail: { fields: Object.keys(b) }, ip: req.ip }); });
    return { ok: true };
  });
  app.post('/templates/:id/retire', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { const t = (await q(c, 'SELECT id,active FROM evidence_templates WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!t) throw notFound(); if (!t.active) throw new HttpError(409, 'This template is already retired');
      await c.query('UPDATE evidence_templates SET active=0, retired_by=?, retired_at=NOW(3) WHERE id=?', [me(req).id, t.id]); await audit(c, { actorId: me(req).id, action: 'template.retired', entity: 'evidence_template', entityId: t.id, ip: req.ip }); });
    return { ok: true };
  });
  app.get('/templates/meta/allowed-types', { preHandler: reader }, async () => ({ extensions: ALLOWED_EXTENSIONS, maxFileBytes: ev.maxFileBytes }));
}
