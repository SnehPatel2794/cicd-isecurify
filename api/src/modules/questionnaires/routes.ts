// Questionnaires (Phase 11E). Platform admins upload a standard question set per framework; each engagement keeps a frozen copy; the client answers; iSecurify staff review.
import { z } from 'zod'; import { createHash } from 'node:crypto'; import type { FastifyInstance } from 'fastify'; import writeXlsxFile from 'write-excel-file/node';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, forbidden, notFound, conflict, bad } from '../../platform/errors';
import { isAdminLevel } from '../../platform/context'; import { notify } from '../notifications/notify'; import { MAX_IMPORT_BYTES } from '../frameworks/importer';
import * as d from '../engagements/data'; import { scopeOf } from '../engagements/access'; import * as qd from './data'; import { parseQuestionnaire, checkAnswer, progress, TYPE_LABEL, MAX_QUESTIONS, INDUSTRIES, TYPES } from './rules';
const Text = (n: number) => z.string().trim().max(n);
const HEAD = ['Ref #', 'Section', 'Question', 'Answer type', 'Choices (separate with |)', 'Required', 'Help text', 'Core (all clients)', 'Industries'];
const EX = [['EX-1', 'Scope', 'Example: Is the organization registered as a legal entity?', 'yes/no', '', 'yes', 'Fictional example row', 'yes', ''], ['EX-2', 'Scope', 'Example: How many employees are in scope?', 'number', '', 'yes', '', 'yes', ''], ['EX-3', 'Hosting', 'Example: Where is production hosted?', 'choice', 'Own data centre|Public cloud|Hybrid', 'yes', '', 'no', ''], ['EX-4', 'Governance', 'Example: When was the security policy last approved?', 'date', '', 'no', '', 'no', ''], ['EX-5', 'Governance', 'Example: Describe the incident response process.', 'text', '', 'no', '', 'no', 'BFSI|Healthcare'], ['EX-6', 'Hosting', 'Example: Which cloud providers are used?', 'choose all', 'AWS|Azure|Google Cloud|Other', 'no', 'Pick every one that applies', 'no', '']];
const csvCell = (c: unknown) => { let s = String(c ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function registerQuestionnaires(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };

  // ---------------- platform side: one questionnaire per framework, versioned ----------------
  app.get('/questionnaire-template.csv', { preHandler: platformUser }, async (_req, reply) => { reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="questionnaire-template.csv"'); return '﻿' + [HEAD, ...EX].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; });
  app.get('/questionnaire-template.xlsx', { preHandler: platformUser }, async (_req, reply) => { const buf = await writeXlsxFile([HEAD.map(h => ({ value: h, fontWeight: 'bold' as const })), ...EX.map(r => r.map(c => ({ value: c })))], { columns: [{ width: 10 }, { width: 18 }, { width: 60 }, { width: 14 }, { width: 36 }, { width: 10 }, { width: 30 }, { width: 14 }, { width: 24 }] } as any).toBuffer(); reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="questionnaire-template.xlsx"'); return buf; });
  app.get('/frameworks/:id/questionnaires', { preHandler: platformUser }, async (req: any) => qd.versions(pool, req.params.id));
  app.get('/questionnaire-versions/:vid', { preHandler: platformUser }, async (req: any) => { const v = await qd.version(pool, req.params.vid); if (!v) throw notFound(); return { ...v, questions: (await qd.questionsOf(pool, v.id)).map(x => ({ ...x, typeLabel: TYPE_LABEL[x.answerType as keyof typeof TYPE_LABEL] })) }; });
  /** Preview (never writes) or, with confirm=true, saves the rows as the framework's draft, replacing an earlier draft. Publishing is a separate step. */
  app.post('/frameworks/:id/questionnaire/import', { preHandler: adminLevel }, async (req: any) => {
    const o = ctx.parse(z.object({ confirm: z.enum(['true', 'false']).default('false'), title: Text(190).optional() }), req.query); if (!req.isMultipart()) throw bad('Upload the file as multipart/form-data');
    const part = await req.file({ limits: { fileSize: MAX_IMPORT_BYTES } }); if (!part) throw bad('No file was uploaded'); const buf = await part.toBuffer(); if (part.file.truncated) throw new HttpError(413, 'File is larger than 5 MB');
    const fw = (await q(pool, 'SELECT id, name FROM frameworks WHERE id=?', [req.params.id]))[0]; if (!fw) throw notFound(); const parsed = await parseQuestionnaire(part.filename, buf);
    const valid = parsed.rows.filter(r => !r.errors.length); const counts = { total: parsed.rows.length, valid: valid.length, invalid: parsed.rows.length - valid.length, required: valid.filter(r => r.data.required).length };
    if (o.confirm !== 'true') return { confirmed: false, format: parsed.format, headerRow: parsed.headerRow, counts, rows: parsed.rows.slice(0, 300).map(r => ({ row: r.row, ref: r.data.ref, section: r.data.section, question: r.data.question, answerType: r.data.answerType, required: r.data.required, valid: !r.errors.length, errors: r.errors })), truncated: parsed.rows.length > 300 };
    if (counts.invalid) throw new HttpError(422, `${counts.invalid} row(s) have errors. Fix the file and upload it again; a questionnaire is saved whole or not at all`, 'invalid_rows'); if (!valid.length || valid.length > MAX_QUESTIONS) throw new HttpError(422, 'There are no questions to save');
    const id = uuid(); let no = 0; const sha = createHash('sha256').update(buf).digest('hex');
    await tx(pool, async (c) => { const old = await qd.draftOf(c, fw.id); if (old) await qd.discard(c, old.id); no = await qd.nextVersionNo(c, fw.id);
      await qd.saveDraft(c, { id, frameworkId: fw.id, no, title: o.title || `${fw.name} questionnaire`, sourceName: part.filename.slice(0, 255), sha256: sha, by: me(req).id }, valid.map(r => r.data as any));
      await audit(c, { actorId: me(req).id, action: 'questionnaire.uploaded', entity: 'questionnaire', entityId: id, detail: { frameworkId: fw.id, versionNo: no, questions: valid.length, source: part.filename, sha256: sha, replacedDraft: !!old }, ip: req.ip }); });
    return { confirmed: true, id, versionNo: no, counts };
  });
  app.post('/questionnaire-versions/:vid/publish', { preHandler: adminLevel }, async (req: any) => {
    let no = 0; await tx(pool, async (c) => { const v = await qd.version(c, req.params.vid, true); if (!v) throw notFound(); if (v.status !== 'draft') throw conflict('Only a draft can be published'); no = v.versionNo;
      await qd.publish(c, v.frameworkId, v.id, me(req).id); await audit(c, { actorId: me(req).id, action: 'questionnaire.published', entity: 'questionnaire', entityId: v.id, detail: { frameworkId: v.frameworkId, versionNo: v.versionNo, questions: v.questionCount }, ip: req.ip }); });
    return { ok: true, versionNo: no };
  });
  app.delete('/questionnaire-versions/:vid', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { const v = await qd.version(c, req.params.vid, true); if (!v) throw notFound(); if (v.status !== 'draft') throw conflict('Only a draft can be discarded; published versions stay as a record'); await qd.discard(c, v.id); await audit(c, { actorId: me(req).id, action: 'questionnaire.discarded', entity: 'questionnaire', entityId: v.id, detail: { frameworkId: v.frameworkId, versionNo: v.versionNo }, ip: req.ip }); });
    return { ok: true };
  });

  // ---------------- engagement side ----------------
  const isStaff = (req: any) => req.access.via === 'staff';
  const reviewer = (req: any) => { if (!(isStaff(req) || req.access.role === 'client_admin' || req.access.role === 'tp_auditor')) throw forbidden(); };
  const canAnswer = (req: any) => isStaff(req) || req.access.role === 'client_admin';
  const visible = async (req: any, id: string) => { const e = await d.getVisibleEngagement(pool, req.tenantId, id, scopeOf(req.access, me(req).id)); if (!e) throw notFound(); return e; };
  const writable = async (c: any, tenantId: string, id: string) => { const e = await d.getEngagement(c, tenantId, id, true); if (!e) throw notFound(); if (e.status !== 'active') throw new HttpError(409, 'This engagement is closed', 'engagement_closed'); return e; };
  const view = async (req: any, e: any) => { const rows = await qd.forEngagement(pool, req.tenantId, e.id); const fws = new Map<string, any>();
    for (const r of rows) { if (!fws.has(r.frameworkId)) fws.set(r.frameworkId, { frameworkId: r.frameworkId, name: r.frameworkName, versionNo: r.versionNo, questions: [] }); fws.get(r.frameworkId).questions.push({ ...r, typeLabel: TYPE_LABEL[r.answerType as keyof typeof TYPE_LABEL], answered: r.answer != null }); }
    const prog = progress(rows.filter((r: any) => r.removedAt == null).map((r: any) => ({ required: r.required, answered: r.answer != null, review: r.reviewStatus }))); const industry = await qd.industryOf(pool, req.tenantId, e.id); return { engagementId: e.id, engagementStatus: e.status, industry, industries: INDUSTRIES, frameworks: [...fws.values()], progress: prog, can: { answer: e.status === 'active' && canAnswer(req), review: e.status === 'active' && isStaff(req), edit: e.status === 'active' && isStaff(req) } }; };
  app.get('/t/:tenantId/engagements/:id/questionnaire', { preHandler: tenantCtx }, async (req: any) => { reviewer(req); return view(req, await visible(req, req.params.id)); });
  app.get('/t/:tenantId/engagements/:id/questionnaire.csv', { preHandler: tenantCtx }, async (req: any, reply) => {
    reviewer(req); const e = await visible(req, req.params.id); const rows = await qd.forEngagement(pool, req.tenantId, e.id);
    const lines = [['Framework', 'Ref', 'Section', 'Question', 'Type', 'Required', 'Answer', 'Note', 'Answered by', 'Answered on', 'Review', 'Review note'], ...rows.map((r: any) => [r.frameworkName, r.ref, r.section, r.question, r.answerType, (r.removedAt ? 'removed' : r.core ? 'core, ' : '') + (r.required ? 'required' : 'optional'), r.answer ?? '', r.note ?? '', r.answeredBy ?? '', r.answeredAt ? new Date(r.answeredAt).toISOString().slice(0, 10) : '', r.reviewStatus ?? 'unanswered', r.reviewNote ?? ''])];
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="questionnaire-${e.id.slice(0, 8)}.csv"`); return '﻿' + lines.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; });
  app.put('/t/:tenantId/engagements/:id/questionnaire/:qid', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); if (!canAnswer(req)) throw forbidden(); await visible(req, req.params.id); const b = ctx.parse(z.object({ answer: Text(4100), note: Text(2000).nullish() }), req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const q = await qd.question(c, req.tenantId, req.params.id, req.params.qid); if (!q) throw notFound(); if (q.removedAt) throw conflict('This question was removed from the engagement'); const r = checkAnswer(q, b.answer); if ('error' in r) throw bad(r.error);
      await qd.saveAnswer(c, req.tenantId, req.params.id, q.id, r.value, b.note?.trim() || null, me(req).id); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'questionnaire.answered', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, questionId: q.id, ref: q.ref, changed: !!q.answerId }, ip: req.ip }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/engagements/:id/questionnaire/:qid/review', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); if (!isStaff(req)) throw forbidden('Only iSecurify staff review questionnaire answers'); await visible(req, req.params.id); const b = ctx.parse(z.object({ status: z.enum(['accepted', 'needs_change']), note: Text(2000).nullish() }), req.body);
    if (b.status === 'needs_change' && (b.note ?? '').length < 5) throw bad('Say what needs to change (at least 5 characters)');
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const q = await qd.question(c, req.tenantId, req.params.id, req.params.qid); if (!q) throw notFound(); if (q.removedAt) throw conflict('This question was removed from the engagement'); if (!q.answerId) throw conflict('This question has no answer yet');
      await qd.review(c, req.tenantId, q.id, b.status, b.note?.trim() || null, me(req).id); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: b.status === 'accepted' ? 'questionnaire.accepted' : 'questionnaire.sent_back', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, questionId: q.id, ref: q.ref, note: b.note ?? null }, ip: req.ip });
      if (b.status === 'needs_change' && q.answeredBy && q.answeredBy !== me(req).id) await notify(c, { tenantId: req.tenantId, kind: 'questionnaire.sent_back', recipients: [q.answeredBy], actorId: me(req).id, entityType: 'engagement', entityId: req.params.id, engagementId: req.params.id, label: `Questionnaire answer ${q.ref} needs a change: ${(b.note ?? '').slice(0, 120)}` }); });
    return { ok: true };
  });

  // ---- structure of this engagement's copy (iSecurify staff only). Core questions can never be changed or removed (API and database). ----
  const staffOnly = async (req: any) => { reviewer(req); if (!isStaff(req)) throw forbidden('Only iSecurify staff change an engagement\'s questionnaire'); await visible(req, req.params.id); };
  const QDef = z.object({ section: Text(190).min(1), question: Text(1000).min(5), required: z.boolean().default(true), helpText: Text(1000).nullish(), choices: z.array(Text(200).min(1)).max(40).nullish() });
  const choicesOk = (type: string, ch: string[] | null | undefined) => { const need = type === 'choice' || type === 'multi_choice'; if (need && (!ch || ch.length < 2)) throw bad('A choice question needs at least two choices'); if (need && new Set(ch!.map(x => x.toLowerCase())).size !== ch!.length) throw bad('Choices must be different from each other'); if (!need && ch?.length) throw bad('Only choice questions have choices'); };
  const audited = (c: any, req: any, action: string, detail: any) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, ...detail }, ip: req.ip });
  app.put('/t/:tenantId/engagements/:id/questionnaire-industry', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req); const b = ctx.parse(z.object({ industry: z.enum(INDUSTRIES).nullable() }), req.body); let added = 0;
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); added = await qd.setIndustry(c, req.tenantId, req.params.id, b.industry); await audited(c, req, 'questionnaire.industry_set', { industry: b.industry, added }); });
    return { industry: b.industry, added };
  });
  app.get('/t/:tenantId/engagements/:id/questionnaire/library', { preHandler: tenantCtx }, async (req: any) => { await staffOnly(req); return (await qd.library(pool, req.tenantId, req.params.id)).map((x: any) => ({ ...x, typeLabel: TYPE_LABEL[x.answerType as keyof typeof TYPE_LABEL] })); });
  app.post('/t/:tenantId/engagements/:id/questionnaire/library/add', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req); const b = ctx.parse(z.object({ frameworkId: z.string().uuid(), refs: z.array(Text(60)).min(1).max(200) }), req.body); let added = 0;
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); added = await qd.addFromLibrary(c, req.tenantId, req.params.id, b.frameworkId, b.refs); await audited(c, req, 'questionnaire.questions_added', { frameworkId: b.frameworkId, refs: b.refs, added }); });
    return { added };
  });
  app.post('/t/:tenantId/engagements/:id/questionnaire/custom', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req); const b = ctx.parse(QDef.extend({ frameworkId: z.string().uuid(), answerType: z.enum(TYPES) }), req.body); choicesOk(b.answerType, b.choices); let out: any;
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); if (!(await qd.hasFramework(c, req.tenantId, req.params.id, b.frameworkId))) throw bad('That framework is not part of this engagement');
      out = await qd.addCustom(c, req.tenantId, req.params.id, b.frameworkId, { section: b.section, question: b.question, answerType: b.answerType, choices: b.choices ?? null, required: b.required, helpText: b.helpText?.trim() || null }); await audited(c, req, 'questionnaire.question_added', { questionId: out.id, ref: out.ref, custom: true }); });
    return out;
  });
  app.patch('/t/:tenantId/engagements/:id/questionnaire/:qid/definition', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req); const b = ctx.parse(QDef, req.body);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const x = await qd.question(c, req.tenantId, req.params.id, req.params.qid); if (!x) throw notFound(); if (x.core) throw forbidden('Core questions cannot be changed'); if (x.removedAt) throw conflict('Restore the question before editing it');
      if (b.choices) { choicesOk(x.answerType, b.choices); if (x.answerId) throw conflict('Choices cannot change once the question has an answer'); } else choicesOk(x.answerType, x.choices);
      await qd.updateDefinition(c, req.tenantId, x.id, { section: b.section, question: b.question, required: b.required, helpText: b.helpText?.trim() || null, choices: b.choices ?? null }); await audited(c, req, 'questionnaire.question_edited', { questionId: x.id, ref: x.ref, before: { section: x.section, question: x.question, required: x.required }, after: { section: b.section, question: b.question, required: b.required } }); });
    return { ok: true };
  });
  app.delete('/t/:tenantId/engagements/:id/questionnaire/:qid', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req); const b = ctx.parse(z.object({ reason: Text(500).min(5) }), req.body ?? {});
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const x = await qd.question(c, req.tenantId, req.params.id, req.params.qid); if (!x) throw notFound(); if (x.core) throw forbidden('Core questions cannot be removed'); if (x.removedAt) throw conflict('Already removed');
      await qd.setRemoved(c, req.tenantId, x.id, me(req).id, b.reason); await audited(c, req, 'questionnaire.question_removed', { questionId: x.id, ref: x.ref, reason: b.reason, hadAnswer: !!x.answerId }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/engagements/:id/questionnaire/:qid/restore', { preHandler: tenantCtx }, async (req: any) => {
    await staffOnly(req);
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); const x = await qd.question(c, req.tenantId, req.params.id, req.params.qid); if (!x) throw notFound(); if (!x.removedAt) throw conflict('This question is not removed'); await qd.setRemoved(c, req.tenantId, x.id, null, null); await audited(c, req, 'questionnaire.question_restored', { questionId: x.id, ref: x.ref }); });
    return { ok: true };
  });
  app.post('/t/:tenantId/engagements/:id/questionnaire/accept-pending', { preHandler: tenantCtx }, async (req: any) => {
    reviewer(req); if (!isStaff(req)) throw forbidden('Only iSecurify staff review questionnaire answers'); await visible(req, req.params.id); let n = 0;
    await tx(pool, async (c) => { await writable(c, req.tenantId, req.params.id); n = await qd.acceptPending(c, req.tenantId, req.params.id, me(req).id); await audit(c, { tenantId: req.tenantId, actorId: me(req).id, action: 'questionnaire.accepted_all', entity: 'engagement', entityId: req.params.id, detail: { engagementId: req.params.id, count: n }, ip: req.ip }); });
    return { accepted: n };
  });
}
