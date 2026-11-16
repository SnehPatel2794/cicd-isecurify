// Evidence workflow routes. All /t/:tenantId/* routes run behind tenantCtx (no access => 404). The rules live in rules.ts; SQL lives in data.ts.
//   request (manager) -> upload a version (accountable person / manager) -> review (TP auditor or iSecurify staff): accept | reject with a mandatory note
//   a rejected or replaced request takes a NEW version; versions and reviews are never edited or deleted.
import { notify } from '../notifications/notify';
import { z } from 'zod'; import type { FastifyInstance } from 'fastify'; import { Transform } from 'node:stream';
import crypto from 'node:crypto';
import { q, tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { enqueue } from '../../platform/jobs'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { registerQuarantine } from '../storage/routes'; import { LocalStorage, StorageError, evidenceKey, type Received } from '../../platform/storage'; import type { EvidenceConfig } from '../../config';
import * as d from '../engagements/data'; import { scopeOf as scopeOfAccess, writableEngagement } from '../engagements/access'; import { getOrg } from '../tenancy/data';
import { manifestProviders } from '../users/hooks';
import * as e from './data'; import { downloadHeaders, fieldValue } from './templates';
import { REQUEST_STATUS, ALLOWED_EXTENSIONS, canManageRequests, canUpload, canViewContent, canReview, canScan, canReceiveUpload, reviewCheck, addMonths, isExpired, checkFile, checkLink, sanitizeFileName, fmtBytes, type Who } from './rules';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
const Text = (n: number) => z.string().trim().max(n); const Uuid = z.string().uuid();
const today = () => new Date().toISOString().slice(0, 10);

export function registerEvidence(app: FastifyInstance, ctx: Ctx, tenantCtx: any, deps: { storage: LocalStorage; ev: EvidenceConfig; log: { error: (o: any, m?: string) => void } }) {
  const { pool } = ctx; const { storage, ev } = deps; const me = (r: any) => ctx.U(r);
  const who = (req: any): Who => ({ via: req.access.via, role: req.access.role, manage: !!req.access.manage, readEvidence: !!req.access.readEvidence });
  const scopeOf = (req: any) => scopeOfAccess(req.access, me(req).id);
  const visibleEngagement = async (c: Conn, req: any, id: string) => { const eng = await d.getVisibleEngagement(c, req.tenantId, id, scopeOf(req)); if (!eng) throw notFound(); return eng; };
  /** client staff / vendors may only reach items assigned to them; everything else about an item they do not own is a 404, never a 403. */
  const reachable = (req: any, accountableUserId: string | null) => scopeOf(req).kind !== 'assigned' || accountableUserId === me(req).id;
  const needManage = (req: any) => { if (!canManageRequests(who(req))) throw forbidden('Only client admins and iSecurify team members with manage rights can do this'); };

  // Account-backup PDF section: the evidence this person uploaded.
  const manifest = async (c: any, userId: string) => ({ title: 'Evidence uploaded', headers: ['Engagement', 'Control', 'Version', 'Item', 'SHA-256', 'Uploaded'], rows: (await e.versionsUploadedBy(c, userId)).map(r => [r.engagementName, r.ref, String(r.versionNo), r.kind === 'link' ? `link: ${r.what}` : r.what, r.sha256 ?? '(link, not hashable)', new Date(r.uploadedAt).toISOString().slice(0, 10)]) });
  if (!manifestProviders.includes(manifest)) manifestProviders.push(manifest);

  // ---------------------------------------------------------------- shaping
  const shapeRequest = (req: any, r: any, closed: boolean) => {
    const w = who(req), uid = me(req).id, t = today(); const expired = r.status === 'accepted' && isExpired(r.validUntil, t); const live = !closed && r.status !== 'cancelled';
    const latestByMe = r.latestById === uid;
    return { id: r.id, engagementId: r.engagementId, itemId: r.itemId, itemRef: r.itemRef, itemTitle: r.itemTitle, title: r.title, instructions: r.instructions, templateId: r.templateId, templateName: r.templateName, templateFileName: r.templateFileName, templateSha256: r.templateSha256, dueDate: r.dueDate, validMonths: r.validMonths,
      status: r.status, validUntil: r.validUntil, expired, overdue: !!r.dueDate && r.dueDate < t && (r.status === 'requested' || r.status === 'rejected'), latestVersionNo: r.latestVersionNo, cancelReason: r.cancelReason, requestedByName: r.requestedByName, createdAt: r.createdAt,
      accountableUserId: r.accountableUserId,
      latest: r.latestId ? { id: r.latestId, versionNo: r.latestVersionNo, kind: r.latestKind, fileName: r.latestFileName, sizeBytes: r.latestSize, sha256: r.latestSha256, provider: r.latestProvider, uploadedAt: r.latestAt, uploadedByName: r.latestBy, scanStatus: r.latestScan ?? 'not_scanned' } : null,
      can: { upload: live && canUpload(w, uid, r.accountableUserId), review: live && canReview(w) && ['submitted', 'accepted', 'rejected'].includes(r.status) && !latestByMe, manage: live && canManageRequests(w),
        view: canViewContent(w, uid, r.accountableUserId), scan: live && ev.scannerEnabled && canScan(w) && r.latestKind === 'file' } };
  };
  const shapeVersion = (req: any, v: any, accountableUserId: string | null) => { const view = canViewContent(who(req), me(req).id, accountableUserId); return { ...v, storageKey: undefined, linkUrl: view ? v.linkUrl : null, scanStatus: v.scanStatus ?? 'not_scanned' }; };
  const detail = async (req: any, rows: any[], closed: boolean) => {
    const ids = rows.map(r => r.id); const [vers, revs] = await Promise.all([e.listVersionsFor(pool, req.tenantId, ids), e.listReviewsFor(pool, req.tenantId, ids)]);
    return rows.map(r => ({ ...shapeRequest(req, r, closed), versions: vers.filter(v => v.requestId === r.id).map(v => shapeVersion(req, v, r.accountableUserId)), reviews: revs.filter(x => x.requestId === r.id).map(x => ({ ...x, requestId: undefined })) }));
  };
  const loadRequest = async (req: any, id: string) => { const r = await e.getRequest(pool, req.tenantId, id); if (!r) throw notFound(); const eng = await visibleEngagement(pool, req, r.engagementId); if (!reachable(req, r.accountableUserId)) throw notFound(); return { r, eng }; };
  /** Takes the locks in the one global order (item -> engagement -> request) inside a transaction, then runs `fn`. */
  async function withRequestLocks<T>(req: any, refs: { id: string; engagementId: string; itemId: string }, fn: (c: any, r: any, item: any, eng: any) => Promise<T>): Promise<T> {
    return tx(pool, async (c) => { const [item] = await d.lockItems(c, req.tenantId, refs.engagementId, [refs.itemId]); if (!item) throw notFound(); const eng = await writableEngagement(c, req.tenantId, refs.engagementId);
      const r = await e.lockRequest(c, req.tenantId, refs.id); if (!r) throw notFound(); return fn(c, r, item, eng); });
  }
  const auditEv = (c: any, req: any, action: string, engagementId: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'engagement', entityId: engagementId, detail: { engagementId, ...detail }, ip: req.ip });

  // ---------------------------------------------------------------- configuration, usage
  app.get('/t/:tenantId/evidence/config', { preHandler: tenantCtx }, async (req: any) => {
    const u = await e.readUsage(pool, req.tenantId);
    return { maxFileBytes: ev.maxFileBytes, allowedExtensions: ALLOWED_EXTENSIONS, scannerEnabled: ev.scannerEnabled, autoScan: ev.autoScan, linkHosts: ev.linkHosts, maxVersionsPerRequest: ev.maxVersionsPerRequest,
      usage: { usedBytes: u.usedBytes, versionCount: u.versionCount, quotaBytes: u.quotaBytes ?? ev.defaultQuotaBytes, unlimited: (u.quotaBytes ?? ev.defaultQuotaBytes) == null, quotaIsDefault: u.quotaBytes == null } };
  });

  registerQuarantine(app, ctx, tenantCtx, (req) => canScan(who(req)));   // GET /t/:tenantId/evidence/quarantine

  // ---------------------------------------------------------------- reading
  app.get('/t/:tenantId/engagements/:id/evidence', { preHandler: tenantCtx }, async (req: any) => {
    const f = ctx.parse(z.object({ status: z.enum(REQUEST_STATUS).optional(), itemId: Uuid.optional() }), req.query); const eng = await visibleEngagement(pool, req, req.params.id); const sc = scopeOf(req); const assignedUserId = sc.kind === 'assigned' ? sc.userId : undefined;
    const [rows, summary] = await Promise.all([e.listRequests(pool, req.tenantId, eng.id, { assignedUserId, ...f }), e.evidenceSummary(pool, req.tenantId, eng.id, today(), assignedUserId)]);
    return { engagementId: eng.id, engagementStatus: eng.status, summary, truncated: rows.length > 2000, requests: rows.slice(0, 2000).map(r => shapeRequest(req, r, eng.status === 'closed')) };
  });
  app.get('/t/:tenantId/checklist/:itemId/evidence', { preHandler: tenantCtx }, async (req: any) => {
    const it = await d.getItem(pool, req.tenantId, req.params.itemId); if (!it) throw notFound(); const eng = await visibleEngagement(pool, req, it.engagementId); if (!reachable(req, it.accountableUserId)) throw notFound();
    const rows = await e.listItemRequests(pool, req.tenantId, it.id); const closed = eng.status === 'closed';
    return { item: { id: it.id, ref: it.ref, title: it.title, readiness: it.readiness, evidence: it.evidence, accountableUserId: it.accountableUserId }, engagementId: eng.id, engagementStatus: eng.status,
      canRequest: !closed && canManageRequests(who(req)) && it.readiness !== 'not_applicable', requests: await detail(req, rows, closed) };
  });
  app.get('/t/:tenantId/evidence-requests/:id', { preHandler: tenantCtx }, async (req: any) => { const { r, eng } = await loadRequest(req, req.params.id); const full = (await e.listItemRequests(pool, req.tenantId, r.itemId)).filter(x => x.id === r.id); return (await detail(req, full, eng.status === 'closed'))[0]; });

  // ---------------------------------------------------------------- requesting
  app.post('/t/:tenantId/checklist/:itemId/evidence-requests', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ title: Text(300).min(1), instructions: Text(5000).nullish(), dueDate: DateStr.nullish(), validMonths: z.number().int().min(1).max(120).nullish(), templateId: Uuid.nullish() }), req.body);
    const it = await d.getItem(pool, req.tenantId, req.params.itemId); if (!it) throw notFound(); await visibleEngagement(pool, req, it.engagementId); const id = uuid();
    await tx(pool, async (c) => {
      const [item] = await d.lockItems(c, req.tenantId, it.engagementId, [it.id]); if (!item) throw notFound(); await writableEngagement(c, req.tenantId, it.engagementId);
      if (item.readiness === 'not_applicable') throw conflict('Evidence cannot be requested for an item that is not applicable');
      if ((await e.countActiveRequests(c, req.tenantId, it.id)) >= ev.maxRequestsPerItem) throw conflict(`An item can have at most ${ev.maxRequestsPerItem} open evidence requests`);
      if (b.templateId && !(await q(c, 'SELECT 1 x FROM evidence_templates WHERE id=? AND active=1', [b.templateId]))[0]) throw bad('That template does not exist or is retired');
      await e.insertRequests(c, req.tenantId, it.engagementId, [{ id, itemId: it.id, title: b.title, instructions: b.instructions, templateId: b.templateId, dueDate: b.dueDate, validMonths: b.validMonths, requestedBy: me(req).id }]);
      await e.recomputeItemEvidence(c, req.tenantId, it.id); await auditEv(c, req, 'evidence.requested', it.engagementId, { requestId: id, itemId: it.id, itemRef: it.ref, title: b.title });
      await notify(c, { tenantId: req.tenantId, kind: 'evidence.requested', recipients: [item.accountableUserId ?? it.accountableUserId], actorId: me(req).id, entityType: 'evidence_request', entityId: id, engagementId: it.engagementId, label: `${it.ref}: ${b.title}` });
    });
    reply.code(201).send({ id });
  });
  /** One standard request per item. Skips items that already have an open request and items that are not applicable; reports why. */
  app.post('/t/:tenantId/engagements/:id/evidence-requests/bulk', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ itemIds: z.array(Uuid).min(1).max(500).optional(), allWithoutRequests: z.boolean().optional(), instructions: Text(5000).nullish(), dueDate: DateStr.nullish(), validMonths: z.number().int().min(1).max(120).nullish(), templateId: Uuid.nullish() }), req.body);
    if (!!b.itemIds === !!b.allWithoutRequests) throw bad('Provide either itemIds or allWithoutRequests');
    const eng = await visibleEngagement(pool, req, req.params.id); const tenantId = req.tenantId;
    const out = await tx(pool, async (c) => {
      const ids = b.itemIds ? [...new Set(b.itemIds)] : (await d.listEngagementItemsBrief(c, tenantId, eng.id)).map(i => i.id as string);
      await d.lockItems(c, tenantId, eng.id, ids); await writableEngagement(c, tenantId, eng.id);               // item -> engagement, same order as every other writer
      if (b.templateId && !(await q(c, 'SELECT 1 x FROM evidence_templates WHERE id=? AND active=1', [b.templateId]))[0]) throw bad('That template does not exist or is retired');
      const brief = new Map((await d.listEngagementItemsBrief(c, tenantId, eng.id)).map(i => [i.id as string, i])); const have = await e.itemsWithActiveRequests(c, tenantId, eng.id);
      const skipped: { itemId: string; reason: string }[] = []; const rows: Parameters<typeof e.insertRequests>[3] = [];
      for (const id of ids) { const i = brief.get(id); if (!i) { skipped.push({ itemId: id, reason: 'not_found' }); continue; } if (i.readiness === 'not_applicable' || Number(i.allNA) === 1) { skipped.push({ itemId: id, reason: 'not_applicable' }); continue; }
        if (have.has(id)) { skipped.push({ itemId: id, reason: 'already_requested' }); continue; }
        rows.push({ id: uuid(), itemId: id, title: `${i.ref} — ${i.title}`.slice(0, 300), instructions: b.instructions, templateId: b.templateId, dueDate: b.dueDate, validMonths: b.validMonths, requestedBy: me(req).id }); }
      await e.insertRequests(c, tenantId, eng.id, rows); await d.bulkSetEvidenceStatus(c, tenantId, eng.id, rows.map(r => r.itemId), 'requested');
      const reasons: Record<string, number> = {}; for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
      await auditEv(c, req, 'evidence.requested_bulk', eng.id, { created: rows.length, skipped: reasons });
      return { created: rows.length, skippedCount: skipped.length, skippedReasons: reasons, skipped: skipped.slice(0, 200) };
    });
    reply.code(201).send(out);
  });
  app.patch('/t/:tenantId/evidence-requests/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ title: Text(300).min(1).optional(), instructions: Text(5000).nullish(), dueDate: DateStr.nullable().optional(), validMonths: z.number().int().min(1).max(120).nullable().optional(), templateId: Uuid.nullable().optional() }), req.body);
    const { r } = await loadRequest(req, req.params.id);
    await withRequestLocks(req, r, async (c, cur) => { if (cur.status === 'cancelled') throw conflict('This request was cancelled');
      if (b.templateId && !(await q(c, 'SELECT 1 x FROM evidence_templates WHERE id=? AND active=1', [b.templateId]))[0]) throw bad('That template does not exist or is retired');
      await e.updateRequestFields(c, req.tenantId, r.id, b); await auditEv(c, req, 'evidence.request_updated', r.engagementId, { requestId: r.id, itemRef: r.itemRef, fields: Object.keys(b) }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/evidence-requests/:id/cancel', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ reason: Text(2000).min(1) }), req.body); const { r } = await loadRequest(req, req.params.id);
    return withRequestLocks(req, r, async (c, cur, item) => { if (cur.status === 'cancelled') throw conflict('This request is already cancelled');
      await e.markCancelled(c, req.tenantId, r.id, b.reason); const st = await e.recomputeItemEvidence(c, req.tenantId, item.id); await auditEv(c, req, 'evidence.cancelled', r.engagementId, { requestId: r.id, itemRef: r.itemRef, reason: b.reason }); return { ok: true, itemEvidence: st }; });
  });

  // ---------------------------------------------------------------- uploading a version (file or link)
  app.post('/t/:tenantId/evidence-requests/:id/versions', { preHandler: tenantCtx }, async (req: any, reply) => {
    const { r: rq } = await loadRequest(req, req.params.id); const uid = me(req).id;
    if (!canUpload(who(req), uid, rq.accountableUserId)) throw forbidden('Only the accountable person, a client admin or an iSecurify team member can upload evidence');
    if (!ctx.limiter.allow(`evup:${uid}`, ev.uploadsPerHour, 3600_000)) throw new HttpError(429, 'Too many uploads. Please try again later.', 'rate_limited');
    let rec: Received | null = null; let movedKey: string | null = null;
    try {
      let kind: 'file' | 'link'; let fileName: string | null = null, mediaType: string | null = null, linkUrl: string | null = null, provider: string | null = null, note: string | null = null;
      if (req.isMultipart()) {
        kind = 'file'; const part = await req.file({ limits: { fileSize: ev.maxFileBytes + 1 } }); if (!part) throw bad('No file was uploaded'); fileName = sanitizeFileName(part.filename);
        if (ev.minFreeBytes > 0) { const d = await storage.diskSpace(); if (d && d.freeBytes < ev.minFreeBytes + ev.maxFileBytes) { reply.header('connection', 'close'); throw new HttpError(507, 'The server is low on disk space, so uploads are paused. Please tell an iSecurify administrator.', 'storage_low'); } }
        try { rec = await storage.receive(part.file, ev.maxFileBytes); } catch (err) { if (err instanceof StorageError && err.code === 'too_large') { reply.header('connection', 'close'); throw new HttpError(413, `File is larger than ${fmtBytes(ev.maxFileBytes)}`, 'file_too_large'); } throw err; }
        if (part.file.truncated) { reply.header('connection', 'close'); throw new HttpError(413, `File is larger than ${fmtBytes(ev.maxFileBytes)}`, 'file_too_large'); }
        const verdict = checkFile(fileName, rec.head, rec.size); if (!verdict.ok) throw new HttpError(415, (verdict as any).reason, 'file_type_rejected'); mediaType = (verdict as any).mediaType;
        const n = fieldValue(part, 'note')?.trim(); if (n && n.length > 2000) throw bad('The note is too long (2000 characters at most)'); note = n || null;
      } else {
        kind = 'link'; const b = ctx.parse(z.object({ linkUrl: z.string().min(1).max(2000), note: Text(2000).nullish() }), req.body); const v = checkLink(b.linkUrl, ev.linkHosts); if (!v.ok) throw bad((v as any).reason); linkUrl = (v as any).url; provider = (v as any).provider; note = b.note?.trim() || null;
      }
      const size = rec?.size ?? 0; const versionId = uuid();
      const out = await withRequestLocks(req, rq, async (c, cur, item) => {
        if (!canReceiveUpload(cur.status)) throw conflict('This request was cancelled'); if (cur.latestVersionNo >= ev.maxVersionsPerRequest) throw conflict(`A request can have at most ${ev.maxVersionsPerRequest} versions`);
        const usage = await e.lockUsage(c, req.tenantId); const quota = usage.quotaBytes ?? ev.defaultQuotaBytes;
        if (quota != null && usage.usedBytes + size > quota) throw new HttpError(413, `This organization's evidence storage is full (${fmtBytes(usage.usedBytes)} of ${fmtBytes(quota)} used). Ask an iSecurify administrator to raise the quota.`, 'quota_exceeded');
        const no = cur.latestVersionNo + 1; const key = rec ? evidenceKey(req.tenantId, versionId) : null; const sha = rec?.sha256 ?? null;
        await e.insertVersion(c, req.tenantId, { id: versionId, requestId: rq.id, versionNo: no, kind, fileName, mediaType, sizeBytes: rec ? size : null, sha256: rec?.sha256 ?? null, storageKey: key, linkUrl, linkProvider: provider, note, uploadedBy: uid });
        await e.markSubmitted(c, req.tenantId, rq.id, no); await e.addUsage(c, req.tenantId, size); const itemEvidence = await e.recomputeItemEvidence(c, req.tenantId, item.id);
        if (rec && key) { await storage.commit(rec.tmp, key); movedKey = key; rec = null; }
        await notify(c, { tenantId: req.tenantId, kind: 'evidence.submitted', recipients: [rq.requestedBy], actorId: uid, entityType: 'evidence_request', entityId: rq.id, engagementId: rq.engagementId, label: `${rq.itemRef}: ${rq.title}` });
        await auditEv(c, req, kind === 'file' ? 'evidence.uploaded' : 'evidence.link_added', rq.engagementId, { requestId: rq.id, versionId, versionNo: no, itemRef: rq.itemRef, ...(kind === 'file' ? { fileName, sizeBytes: size, sha256: sha } : { provider, host: new URL(linkUrl!).hostname }) });
        if (kind === 'file' && ev.autoScan && ev.scannerEnabled) { const sid = uuid(); await enqueue(c, { type: 'evidence.scan', payload: { tenantId: req.tenantId, versionId, requestedBy: null }, idempotencyKey: `scan:${sid}` }); }
        return { versionId, versionNo: no, sha256: sha, sizeBytes: size, requestStatus: 'submitted', itemEvidence };
      });
      reply.code(201).send(out);
    } catch (err) { if (movedKey) await storage.remove(movedKey).catch(() => {}); throw err; }
    finally { if (rec) await storage.discard(rec.tmp); }
  });

  // ---------------------------------------------------------------- download, verify, scan
  const loadVersion = async (req: any, id: string) => { const v = await e.getVersion(pool, req.tenantId, id); if (!v) throw notFound(); await visibleEngagement(pool, req, v.engagementId); if (!reachable(req, v.accountableUserId)) throw notFound(); return v; };
  const needContent = (req: any, v: any) => { if (!canViewContent(who(req), me(req).id, v.accountableUserId)) throw forbidden('You do not have access to the content of this evidence'); };
  app.get('/t/:tenantId/evidence-versions/:id/download', { preHandler: tenantCtx }, async (req: any, reply) => {
    const v = await loadVersion(req, req.params.id); needContent(req, v); if (v.kind !== 'file') throw bad('This version is a link, not a file');
    if (v.scanStatus === 'infected') throw new HttpError(409, 'This file was flagged by the malware scan and cannot be downloaded', 'evidence_infected');
    if (!(await storage.exists(v.storageKey))) { deps.log.error({ versionId: v.id, key: v.storageKey }, 'evidence file missing from storage'); throw new HttpError(500, 'The stored file is missing. Contact support.', 'file_missing'); }
    await audit(pool, { tenantId: req.tenantId, actorId: me(req).id, action: 'evidence.downloaded', entity: 'engagement', entityId: v.engagementId, detail: { engagementId: v.engagementId, versionId: v.id, itemRef: v.itemRef, fileName: v.fileName, sha256: v.sha256 }, ip: req.ip });
    const h = crypto.createHash('sha256'); const stream = storage.open(v.storageKey).pipe(new Transform({ transform(chunk, _e, cb) { h.update(chunk); cb(null, chunk); },
      flush(cb) { if (h.digest('hex') !== v.sha256) { deps.log.error({ versionId: v.id }, 'INTEGRITY FAILURE while serving evidence'); audit(pool, { tenantId: req.tenantId, actorId: me(req).id, action: 'evidence.integrity_failure', entity: 'engagement', entityId: v.engagementId, detail: { engagementId: v.engagementId, versionId: v.id } }).catch(() => {}); } cb(); } }));
    for (const [k, val] of Object.entries(downloadHeaders(v.fileName, v.sizeBytes, v.sha256))) reply.header(k, val); return reply.send(stream);
  });
  /** Re-reads the stored bytes and compares them with the SHA-256 recorded at upload time. */
  app.get('/t/:tenantId/evidence-versions/:id/verify', { preHandler: tenantCtx }, async (req: any) => {
    const v = await loadVersion(req, req.params.id); needContent(req, v); if (v.kind !== 'file') throw bad('Only files can be verified; a link has no fixed content');
    let ok = false, actual: string | null = null, size: number | null = null, problem: string | null = null;
    try { const r = await storage.hashOf(v.storageKey); actual = r.sha256; size = r.size; ok = r.sha256 === v.sha256 && r.size === Number(v.sizeBytes); if (!ok) problem = 'The stored file no longer matches the hash recorded at upload'; }
    catch (err) { if (err instanceof StorageError && err.code === 'missing') problem = 'The stored file is missing'; else throw err; }
    await audit(pool, { tenantId: req.tenantId, actorId: me(req).id, action: ok ? 'evidence.verified' : 'evidence.integrity_failure', entity: 'engagement', entityId: v.engagementId, detail: { engagementId: v.engagementId, versionId: v.id, ok }, ip: req.ip });
    return { ok, expectedSha256: v.sha256, actualSha256: actual, sizeBytes: size, problem, checkedAt: new Date().toISOString() };
  });
  app.post('/t/:tenantId/evidence-versions/:id/scan', { preHandler: tenantCtx }, async (req: any, reply) => {
    const v = await loadVersion(req, req.params.id); if (!canScan(who(req))) throw forbidden(); if (!ev.scannerEnabled) throw new HttpError(409, 'The malware scanner is not configured on this server', 'scanner_unavailable'); if (v.kind !== 'file') throw bad('Only files can be scanned');
    if (!ctx.limiter.allow(`evscan:${me(req).id}`, ev.scansPerHour, 3600_000)) throw new HttpError(429, 'Too many scan requests. Please try again later.', 'rate_limited');
    await tx(pool, async (c) => { await enqueue(c, { type: 'evidence.scan', payload: { tenantId: req.tenantId, versionId: v.id, requestedBy: me(req).id }, idempotencyKey: `scan:${uuid()}` }); await auditEv(c, req, 'evidence.scan_requested', v.engagementId, { versionId: v.id, itemRef: v.itemRef }); });
    reply.code(202).send({ queued: true });
  });
  app.get('/t/:tenantId/evidence-versions/:id/scans', { preHandler: tenantCtx }, async (req: any) => { const v = await loadVersion(req, req.params.id); return e.listScans(pool, req.tenantId, v.id); });

  // ---------------------------------------------------------------- reviewing
  app.post('/t/:tenantId/evidence-requests/:id/review', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ versionId: Uuid, decision: z.enum(['accepted', 'rejected']), note: Text(5000), validUntil: DateStr.nullish() }), req.body);
    const { r: rq } = await loadRequest(req, req.params.id); if (!canReview(who(req))) throw forbidden('Only the TP auditor or an iSecurify team member who can read evidence can accept or reject it');
    if (!b.note.trim()) throw bad('A note is required when accepting or rejecting evidence'); if (b.validUntil && b.decision !== 'accepted') throw bad('A validity date only applies to accepted evidence');
    if (b.validUntil && (b.validUntil < today() || b.validUntil > addMonths(today(), 120))) throw bad('The validity date must be between today and ten years from now');
    return withRequestLocks(req, rq, async (c, cur, item) => {
      const ver = await e.getVersionInRequest(c, req.tenantId, rq.id, b.versionId); if (!ver) throw notFound();
      const chk = reviewCheck(cur.status, b.decision, ver.versionNo === cur.latestVersionNo); if (!chk.ok) throw new HttpError(409, (chk as any).message, (chk as any).code);
      if (ver.uploadedBy === me(req).id) throw forbidden('You cannot review evidence that you uploaded yourself');
      if (b.decision === 'accepted' && ver.kind === 'file') { const sc = await e.versionScanStatus(c, req.tenantId, ver.id); if (sc === 'infected') throw new HttpError(409, 'This file was flagged by the malware scan and cannot be accepted', 'evidence_infected'); }
      const validUntil = b.decision === 'accepted' ? (b.validUntil ?? (cur.validMonths ? addMonths(today(), cur.validMonths) : null)) : null;
      await e.insertReview(c, req.tenantId, { id: uuid(), requestId: rq.id, versionId: ver.id, decision: b.decision, note: b.note.trim(), validUntil, reviewedBy: me(req).id });
      await e.markReviewed(c, req.tenantId, rq.id, b.decision, validUntil); const itemEvidence = await e.recomputeItemEvidence(c, req.tenantId, item.id);
      await notify(c, { tenantId: req.tenantId, kind: b.decision === 'accepted' ? 'evidence.accepted' : 'evidence.rejected', recipients: [ver.uploadedBy], actorId: me(req).id, entityType: 'evidence_request', entityId: rq.id, engagementId: rq.engagementId, label: `${rq.itemRef}: ${rq.title}` });
      await auditEv(c, req, b.decision === 'accepted' ? 'evidence.accepted' : 'evidence.rejected', rq.engagementId, { requestId: rq.id, versionId: ver.id, versionNo: ver.versionNo, itemRef: rq.itemRef, validUntil });
      return { ok: true, requestStatus: b.decision, validUntil, itemEvidence };
    });
  });
}

// ===================== platform administration: per-organization storage quota =====================
export function registerEvidenceAdmin(app: FastifyInstance, ctx: Ctx, deps: { ev: EvidenceConfig }) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  const view = (u: e.Usage) => ({ usedBytes: u.usedBytes, versionCount: u.versionCount, quotaBytes: u.quotaBytes ?? deps.ev.defaultQuotaBytes, unlimited: (u.quotaBytes ?? deps.ev.defaultQuotaBytes) == null, quotaIsDefault: u.quotaBytes == null, defaultQuotaBytes: deps.ev.defaultQuotaBytes });
  app.get('/platform/organizations/:orgId/evidence-usage', { preHandler: platformUser }, async (req: any) => { if (!(await getOrg(pool, req.params.orgId))) throw notFound(); return view(await e.readUsage(pool, req.params.orgId)); });
  /** quotaMb = null restores the platform default. Lowering a quota below current usage is allowed: it simply blocks further uploads. */
  app.put('/platform/organizations/:orgId/evidence-quota', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ quotaMb: z.number().int().min(1).max(10_485_760).nullable() }), req.body);
    if (!(await getOrg(pool, req.params.orgId))) throw notFound();
    await tx(pool, async (c) => { await e.setQuota(c, req.params.orgId, b.quotaMb == null ? null : b.quotaMb * 1048576); await audit(c, { tenantId: req.params.orgId, actorId: me(req).id, action: 'evidence.quota_set', entity: 'organization', entityId: req.params.orgId, detail: { quotaMb: b.quotaMb }, ip: req.ip }); });
    return view(await e.readUsage(pool, req.params.orgId));
  });
}
