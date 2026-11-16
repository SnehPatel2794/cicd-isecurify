import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid, sha256 } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { getRelease, requireDraft, insertControls, existingRefs, createDraftFrom, compareReleases } from './service';
import { parseUpload, csvTemplate, xlsxTemplate, MAX_IMPORT_BYTES } from './importer';

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const ControlBody = z.object({ ref: z.string().trim().min(1).max(60), domain: z.string().trim().min(1).max(190), title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(), ownerDepartment: z.string().max(190).nullish(), secondaryGuidanceNote: z.string().max(5000).nullish(), remarks: z.string().max(5000).nullish() });
const toInput = (b: z.infer<typeof ControlBody>) => ({ ref: b.ref, domain: b.domain, title: b.title, description: b.description ?? null, ownerDepartment: b.ownerDepartment ?? null, secondaryGuidanceNote: b.secondaryGuidanceNote ?? null, remarks: b.remarks ?? null });
const CONTROL_SELECT = `SELECT c.id,c.ref,c.domain,c.title,c.description,c.owner_department,c.secondary_guidance_note,c.remarks,c.sort_order,m.common_control_id,cc.title common_control_title
  FROM framework_controls c LEFT JOIN control_mappings m ON m.control_id=c.id LEFT JOIN common_controls cc ON cc.id=m.common_control_id`;

export function registerFrameworks(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  // Library = iSecurify-internal content. Customers never read it directly (they see only their engagement's checklist from Phase 4).
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  const visibleRelease = async (req: any) => { const r = await getRelease(pool, req.params.id); if (!r || (r.status === 'draft' && !isAdminLevel(me(req)))) throw notFound(); return r; };

  // ---------- frameworks ----------
  app.get('/frameworks', { preHandler: platformUser }, async (req: any) => {
    const archived = isAdminLevel(me(req)) && req.query.includeArchived === 'true'; const admin = isAdminLevel(me(req));
    return q(pool, `SELECT f.id,f.name,f.region,f.description,f.color,f.secondary_guidance_label secondaryGuidanceLabel,f.archived,
      (SELECT MAX(version) FROM framework_releases r WHERE r.framework_id=f.id AND r.status='published') latestPublished,
      (SELECT r.id FROM framework_releases r WHERE r.framework_id=f.id AND r.status='published' ORDER BY version DESC LIMIT 1) latestPublishedReleaseId,
      (SELECT COUNT(*) FROM framework_controls c JOIN framework_releases r ON r.id=c.release_id WHERE r.framework_id=f.id AND r.version=(SELECT MAX(version) FROM framework_releases r2 WHERE r2.framework_id=f.id AND r2.status='published')) controlCount
      ${admin ? ",(SELECT r.id FROM framework_releases r WHERE r.framework_id=f.id AND r.status='draft') draftReleaseId" : ''}
      FROM frameworks f WHERE ${archived ? '1=1' : 'f.archived=0'} ${admin ? '' : 'AND EXISTS (SELECT 1 FROM framework_releases r WHERE r.framework_id=f.id AND r.status=\'published\')'} ORDER BY f.name`);
  });
  app.get('/frameworks/import-template', { preHandler: platformUser }, async (req: any, reply) => {
    const fmt = ctx.parse(z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }), req.query).format;
    if (fmt === 'csv') return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="framework-import-template.csv"').send(csvTemplate());
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', 'attachment; filename="framework-import-template.xlsx"').send(await xlsxTemplate());
  });
  app.post('/frameworks', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ name: z.string().trim().min(1).max(190), region: z.string().max(80).optional(), description: z.string().max(5000).optional(), color: Color.optional(), secondaryGuidanceLabel: z.string().max(80).optional() }), req.body);
    const id = uuid(), rid = uuid();
    await tx(pool, async (c) => {
      await c.query('INSERT INTO frameworks(id,name,region,description,color,secondary_guidance_label,created_by) VALUES (?,?,?,?,?,?,?)', [id, b.name, b.region ?? null, b.description ?? null, b.color ?? '#812671', b.secondaryGuidanceLabel ?? null, me(req).id]);
      await c.query('INSERT INTO framework_releases(id,framework_id,version) VALUES (?,?,1)', [rid, id]);
      await audit(c, { actorId: me(req).id, action: 'framework.created', entity: 'framework', entityId: id, detail: { name: b.name }, ip: req.ip });
    });
    reply.code(201).send({ id, draftReleaseId: rid });
  });
  app.get('/frameworks/:id', { preHandler: platformUser }, async (req: any) => {
    const f = (await q(pool, 'SELECT id,name,region,description,color,secondary_guidance_label secondaryGuidanceLabel,archived FROM frameworks WHERE id=?', [req.params.id]))[0]; if (!f) throw notFound();
    const admin = isAdminLevel(me(req)); if (f.archived && !admin) throw notFound();
    const releases = await q(pool, `SELECT r.id,r.version,r.status,r.published_at publishedAt,r.based_on_release_id basedOn,(SELECT COUNT(*) FROM framework_controls c WHERE c.release_id=r.id) controlCount FROM framework_releases r WHERE r.framework_id=? ${admin ? '' : "AND r.status='published'"} ORDER BY r.version DESC`, [f.id]);
    if (!admin && !releases.length) throw notFound(); return { ...f, releases };
  });
  app.patch('/frameworks/:id', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ name: z.string().trim().min(1).max(190).optional(), region: z.string().max(80).nullable().optional(), description: z.string().max(5000).nullable().optional(), color: Color.optional(), secondaryGuidanceLabel: z.string().max(80).nullable().optional(), archived: z.boolean().optional() }), req.body);
    await tx(pool, async (c) => {
      const f = (await q(c, 'SELECT * FROM frameworks WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!f) throw notFound();
      await c.query('UPDATE frameworks SET name=?,region=?,description=?,color=?,secondary_guidance_label=?,archived=? WHERE id=?', [b.name ?? f.name, b.region === undefined ? f.region : b.region, b.description === undefined ? f.description : b.description, b.color ?? f.color, b.secondaryGuidanceLabel === undefined ? f.secondary_guidance_label : b.secondaryGuidanceLabel, b.archived === undefined ? f.archived : b.archived ? 1 : 0, f.id]);
      await audit(c, { actorId: me(req).id, action: b.archived === true && !f.archived ? 'framework.archived' : b.archived === false && f.archived ? 'framework.restored' : 'framework.updated', entity: 'framework', entityId: f.id, detail: b, ip: req.ip });
    });
    return { ok: true };       // there is deliberately NO delete route: frameworks are archived, releases and engagements keep their history
  });

  // ---------- releases ----------
  app.get('/releases/:id', { preHandler: platformUser }, async (req: any) => { const r = await visibleRelease(req); return { id: r.id, frameworkId: r.framework_id, frameworkName: r.framework_name, version: r.version, status: r.status, publishedAt: r.published_at, archived: !!r.framework_archived }; });
  app.get('/releases/:id/controls', { preHandler: platformUser }, async (req: any) => { await visibleRelease(req); return q(pool, `${CONTROL_SELECT} WHERE c.release_id=? ORDER BY c.domain, c.sort_order, c.ref`, [req.params.id]); });
  app.post('/releases/:id/new-draft', { preHandler: adminLevel }, async (req: any, reply) => {
    const out = await tx(pool, async (c) => {
      const src = await getRelease(c, req.params.id); if (!src) throw notFound(); if (src.status !== 'published') throw conflict('Only a published release can be the starting point for a new draft');
      if (src.framework_archived) throw new HttpError(409, 'This framework is archived', 'framework_archived');
      const d = await createDraftFrom(c, src, me(req).id);
      await audit(c, { actorId: me(req).id, action: 'release.draft_created', entity: 'release', entityId: d.id, detail: { from: src.id, fromVersion: src.version, version: d.version, controls: d.controls }, ip: req.ip }); return d;
    });
    reply.code(201).send(out);
  });
  app.post('/releases/:id/publish', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => {
      const r = await requireDraft(c, req.params.id); const n = (await q(c, 'SELECT COUNT(*) n FROM framework_controls WHERE release_id=?', [r.id]))[0].n as number; if (!n) throw bad('A release needs at least one control before it can be published');
      await c.query("UPDATE framework_releases SET status='published', published_at=NOW(3), published_by=? WHERE id=?", [me(req).id, r.id]);
      await audit(c, { actorId: me(req).id, action: 'release.published', entity: 'release', entityId: r.id, detail: { framework: r.framework_name, version: r.version, controls: n }, ip: req.ip });
    });
    return { ok: true };
  });
  app.get('/releases/:id/compare/:otherId', { preHandler: platformUser }, async (req: any) => {
    const a = await getRelease(pool, req.params.id), b = await getRelease(pool, req.params.otherId); const admin = isAdminLevel(me(req));
    if (!a || !b || ((a.status === 'draft' || b.status === 'draft') && !admin)) throw notFound(); if (a.framework_id !== b.framework_id) throw bad('Only releases of the same framework can be compared');
    return { from: { id: a.id, version: a.version, status: a.status }, to: { id: b.id, version: b.version, status: b.status }, ...(await compareReleases(pool, a.id, b.id)) };
  });

  // ---------- controls (DRAFT releases only) ----------
  app.post('/releases/:id/controls', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(ControlBody, req.body); const id = uuid();
    await tx(pool, async (c) => { await requireDraft(c, req.params.id); await insertControls(c, req.params.id, [toInput(b)]); const row = (await q(c, 'SELECT id FROM framework_controls WHERE release_id=? AND ref=?', [req.params.id, b.ref]))[0];
      await audit(c, { actorId: me(req).id, action: 'control.added', entity: 'control', entityId: row.id, detail: { release: req.params.id, ref: b.ref }, ip: req.ip }); (req as any)._id = row.id; });
    reply.code(201).send({ id: (req as any)._id ?? id });
  });
  app.post('/releases/:id/controls/bulk', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ controls: z.array(ControlBody).min(1).max(2000) }), req.body);
    await tx(pool, async (c) => { await requireDraft(c, req.params.id); await insertControls(c, req.params.id, b.controls.map(toInput)); await audit(c, { actorId: me(req).id, action: 'control.bulk_added', entity: 'release', entityId: req.params.id, detail: { count: b.controls.length }, ip: req.ip }); });
    reply.code(201).send({ added: b.controls.length });
  });
  app.patch('/releases/:id/controls/:controlId', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(ControlBody.partial().omit({ ref: true }), req.body);
    await tx(pool, async (c) => { await requireDraft(c, req.params.id); const cur = (await q(c, 'SELECT * FROM framework_controls WHERE id=? AND release_id=?', [req.params.controlId, req.params.id]))[0]; if (!cur) throw notFound();
      await c.query('UPDATE framework_controls SET domain=?,title=?,description=?,owner_department=?,secondary_guidance_note=?,remarks=? WHERE id=?', [b.domain ?? cur.domain, b.title ?? cur.title, b.description === undefined ? cur.description : b.description, b.ownerDepartment === undefined ? cur.owner_department : b.ownerDepartment, b.secondaryGuidanceNote === undefined ? cur.secondary_guidance_note : b.secondaryGuidanceNote, b.remarks === undefined ? cur.remarks : b.remarks, cur.id]);
      await audit(c, { actorId: me(req).id, action: 'control.updated', entity: 'control', entityId: cur.id, detail: { ref: cur.ref }, ip: req.ip }); });
    return { ok: true };
  });
  app.delete('/releases/:id/controls/:controlId', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { await requireDraft(c, req.params.id); const cur = (await q(c, 'SELECT id,ref FROM framework_controls WHERE id=? AND release_id=?', [req.params.controlId, req.params.id]))[0]; if (!cur) throw notFound();
      const m = (await q(c, 'SELECT common_control_id FROM control_mappings WHERE control_id=?', [cur.id]))[0];
      if (m) { await c.query('DELETE FROM control_mappings WHERE control_id=?', [cur.id]); await c.query("INSERT INTO control_mapping_history(control_id,common_control_id,previous_common_control_id,action,rationale,actor_id) VALUES (?,NULL,?, 'unmap', 'control deleted from draft', ?)", [cur.id, m.common_control_id, me(req).id]); }
      await c.query('DELETE FROM framework_controls WHERE id=?', [cur.id]); await audit(c, { actorId: me(req).id, action: 'control.deleted', entity: 'control', entityId: cur.id, detail: { ref: cur.ref }, ip: req.ip }); });
    return { ok: true };
  });

  // ---------- CSV / Excel import: preview (never writes) and confirm ----------
  app.post('/releases/:id/import', { preHandler: adminLevel }, async (req: any) => {
    const confirmImport = ctx.parse(z.object({ confirm: z.enum(['true', 'false']).default('false') }), req.query).confirm === 'true';
    if (!req.isMultipart()) throw bad('Upload the file as multipart/form-data'); const part = await req.file({ limits: { fileSize: MAX_IMPORT_BYTES } }); if (!part) throw bad('No file was uploaded');
    const buf = await part.toBuffer(); if (part.file.truncated) throw new HttpError(413, 'File is larger than 5 MB');
    const rel = await requireDraftReadOnly(req.params.id); const parsed = await parseUpload(part.filename, buf); const have = await existingRefs(pool, rel.id);
    const rows = parsed.rows.map(r => ({ ...r, errors: have.has(r.data.ref.toLowerCase()) ? [...r.errors, `ref "${r.data.ref}" already exists in this draft`] : r.errors }));
    const valid = rows.filter(r => !r.errors.length); const counts = { total: rows.length, valid: valid.length, invalid: rows.length - valid.length };
    if (!confirmImport) return { confirmed: false, format: parsed.format, headerRow: parsed.headerRow, columns: parsed.columns, counts, rows: rows.slice(0, 200).map(r => ({ row: r.row, ref: r.data.ref, domain: r.data.domain, title: r.data.title, valid: !r.errors.length, errors: r.errors })), truncated: rows.length > 200 };
    if (!valid.length) throw new HttpError(422, 'There are no valid rows to import');
    await tx(pool, async (c) => { await requireDraft(c, rel.id); const have2 = await existingRefs(c, rel.id); if (valid.some(r => have2.has(r.data.ref.toLowerCase()))) throw conflict('The draft changed while importing; run the preview again');
      await insertControls(c, rel.id, valid.map(r => r.data)); await audit(c, { actorId: me(req).id, action: 'release.imported', entity: 'release', entityId: rel.id, detail: { file: part.filename.slice(0, 120), sha256: sha256(buf), imported: valid.length, skipped: counts.invalid }, ip: req.ip }); });
    return { confirmed: true, imported: valid.length, skipped: counts.invalid };
  });
  const requireDraftReadOnly = async (id: string) => { const r = await getRelease(pool, id); if (!r) throw notFound(); if (r.status === 'published') throw new HttpError(409, 'Published releases are immutable. Create a new draft release to import into.', 'release_immutable'); if (r.framework_archived) throw new HttpError(409, 'This framework is archived', 'framework_archived'); return r; };
}
