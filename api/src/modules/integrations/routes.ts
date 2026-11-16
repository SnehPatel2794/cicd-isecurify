// Integrations (Phase 11B). Two halves:
//   1. management (signed-in client admins and managing iSecurify staff): API keys and webhook endpoints, under /t/:tenantId/...
//   2. the public API, /v1/..., called with "Authorization: Bearer isg_..." and nothing else. A key is tied to ONE organization and a list of scopes; no cookies, no CSRF.
import crypto from 'node:crypto'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx, type Conn } from '../../db'; import type { Ctx } from '../../platform/context'; import { audit } from '../../platform/audit'; import { uuid, sha256, safeEqual, encrypt, newToken } from '../../platform/crypto'; import { HttpError, bad, forbidden, notFound, conflict, unauthorized } from '../../platform/errors';
import * as t from '../tenancy/data'; import * as d from '../engagements/data'; import * as f from '../findings/data'; import * as cd from '../continuous/data'; import * as e from './data'; import { notify } from '../notifications/notify';
import { itemRows } from '../../../../shared/readiness'; import { frameworkSummaries } from '../../../../shared/posture'; import { evaluateItem, STATE_LABEL } from '../../../../shared/evaluation';
import { SCOPES, SCOPE_LABEL, KEY_PATTERN, validPattern, checkUrl, newSecret, isSendable, payloadOf, type Scope } from '../../../../shared/webhooks';
import { nextDueAfter, runDateProblem, type Frequency } from '../continuous/rules'; import { SEVERITIES } from '../findings/rules';
const Text = (n: number) => z.string().trim().max(n); const Uuid = z.string().uuid(); const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
const today = () => new Date().toISOString().slice(0, 10); const ref = (n: number) => `F-${String(n).padStart(3, '0')}`;
export function registerIntegrations(app: FastifyInstance, ctx: Ctx, tenantCtx: any) {
  const { pool, cfg } = ctx; const me = (r: any) => ctx.U(r);
  const needManage = (req: any) => { if (!req.access.manage) throw forbidden('Only client admins and iSecurify team members with manage rights can manage integrations'); };
  const auditI = (c: Conn, req: any, action: string, entityId: string, detail: Record<string, unknown>) => audit(c, { tenantId: req.tenantId, actorId: me(req).id, action, entity: action.startsWith('api_key') ? 'api_key' : 'webhook', entityId, detail, ip: req.ip });

  // ================= API keys =================
  app.get('/t/:tenantId/integrations/scopes', { preHandler: tenantCtx }, async (req: any) => { needManage(req); return { scopes: SCOPES.map(s => ({ id: s, label: SCOPE_LABEL[s] })), webhooksConfigured: !!cfg.webhookKey }; });
  app.get('/t/:tenantId/api-keys', { preHandler: tenantCtx }, async (req: any) => { needManage(req); const now = Date.now(); return { keys: (await e.listKeys(pool, req.tenantId)).map((k: any) => ({ ...k, state: k.revokedAt ? 'revoked' : k.expiresAt && new Date(k.expiresAt).getTime() < now ? 'expired' : 'active' })) }; });
  app.post('/t/:tenantId/api-keys', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const b = ctx.parse(z.object({ name: Text(120).min(1), scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length), expiresInDays: z.number().int().min(1).max(730).nullish() }), req.body);
    if (!ctx.limiter.allow(`apikey:${me(req).id}`, 20, 3600_000)) throw new HttpError(429, 'Too many keys created. Please try again later.', 'rate_limited');
    const id = uuid(); const prefix = crypto.randomBytes(4).toString('hex'); const secret = newToken(32); const key = `isg_${prefix}_${secret}`; const scopes = [...new Set(b.scopes)];
    await tx(pool, async (c) => {
      if ((await e.countLiveKeys(c, req.tenantId)) >= 20) throw conflict('An organization can have at most 20 active API keys. Revoke one first.');
      try { await e.insertKey(c, req.tenantId, { id, name: b.name, prefix, hash: sha256(key), scopes, createdBy: me(req).id, expiresAt: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86400000) : null }); } catch (err: any) { if (err.code === 'ER_DUP_ENTRY') throw conflict('Please try again'); throw err; }
      await auditI(c, req, 'api_key.created', id, { name: b.name, scopes, prefix, expiresInDays: b.expiresInDays ?? null });
    });
    reply.code(201).send({ id, key, prefix, scopes, note: 'Copy the key now. It is shown only once and cannot be recovered; if lost, revoke it and create another.' });
  });
  app.delete('/t/:tenantId/api-keys/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const k = await e.getKey(pool, req.tenantId, req.params.id); if (!k) throw notFound();
    await tx(pool, async (c) => { await e.revokeKey(c, req.tenantId, k.id, me(req).id); await auditI(c, req, 'api_key.revoked', k.id, { name: k.name, prefix: k.prefix }); }); return { ok: true };
  });

  // ================= webhook endpoints =================
  const needKey = () => { if (!cfg.webhookKey) throw conflict('Webhooks are not switched on for this installation (WEBHOOK_ENC_KEY is not set). Ask your administrator.'); return cfg.webhookKey; };
  const urlOk = (raw: string) => { const r = checkUrl(raw, { allowHttp: !!cfg.allowHttpWebhooks }); if (r.ok === false) throw bad(r.reason); return (r as any).url.toString(); };
  const Events = z.array(z.string().max(60).refine(validPattern, 'Use "*", a prefix such as "finding.*", or an exact event such as "finding.raised"')).min(1).max(30);
  app.get('/t/:tenantId/webhooks', { preHandler: tenantCtx }, async (req: any) => { needManage(req); return { configured: !!cfg.webhookKey, endpoints: await e.listEndpoints(pool, req.tenantId) }; });
  app.post('/t/:tenantId/webhooks', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); const key = needKey(); const b = ctx.parse(z.object({ name: Text(120).min(1), url: Text(500).min(1), events: Events }), req.body); const url = urlOk(b.url); const id = uuid(); const secret = newSecret();
    await tx(pool, async (c) => { if ((await e.countEndpoints(c, req.tenantId)) >= 10) throw conflict('An organization can have at most 10 webhook endpoints'); await e.insertEndpoint(c, req.tenantId, { id, name: b.name, url, secretEnc: encrypt(secret, key), events: [...new Set(b.events)], createdBy: me(req).id }); await auditI(c, req, 'webhook.created', id, { name: b.name, host: new URL(url).host, events: b.events }); });
    reply.code(201).send({ id, secret, note: 'Copy the signing secret now. It is shown only once; rotate it if lost.' });
  });
  app.patch('/t/:tenantId/webhooks/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const b = ctx.parse(z.object({ name: Text(120).min(1), url: Text(500).min(1), events: Events, active: z.boolean() }).partial().refine(x => Object.keys(x).length > 0, 'Nothing to change'), req.body); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound();
    const patch: any = { ...b }; if (b.url) patch.url = urlOk(b.url); if (b.events) patch.events = [...new Set(b.events)];
    await tx(pool, async (c) => { await e.updateEndpoint(c, req.tenantId, ep.id, patch); await auditI(c, req, 'webhook.updated', ep.id, { changed: Object.keys(b) }); }); return { ok: true };
  });
  app.post('/t/:tenantId/webhooks/:id/rotate-secret', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const key = needKey(); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound(); const secret = newSecret();
    await tx(pool, async (c) => { await e.updateEndpoint(c, req.tenantId, ep.id, { secretEnc: encrypt(secret, key) }); await auditI(c, req, 'webhook.secret_rotated', ep.id, {}); }); return { secret, note: 'The old secret stops working immediately. Update the receiver now.' };
  });
  app.delete('/t/:tenantId/webhooks/:id', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound(); await tx(pool, async (c) => { await e.deleteEndpoint(c, req.tenantId, ep.id); await auditI(c, req, 'webhook.deleted', ep.id, { name: ep.name }); }); return { ok: true };
  });
  app.get('/t/:tenantId/webhooks/:id/deliveries', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const p = ctx.parse(z.object({ status: z.enum(['pending', 'delivered', 'dead']).optional() }), req.query ?? {}); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound(); return { endpoint: ep, deliveries: await e.listDeliveries(pool, req.tenantId, ep.id, p.status) };
  });
  app.post('/t/:tenantId/webhooks/:id/test', { preHandler: tenantCtx }, async (req: any, reply) => {
    needManage(req); needKey(); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound(); if (!ctx.limiter.allow(`whtest:${ep.id}`, 10, 3600_000)) throw new HttpError(429, 'Too many test events. Please try again later.', 'rate_limited');
    await e.queueDelivery(pool, req.tenantId, ep.id, 'webhook.test', { id: `evt_test_${uuid()}`, type: 'webhook.test', organizationId: req.tenantId, occurredAt: new Date().toISOString(), actorId: me(req).id, entity: 'webhook', entityId: ep.id, data: { message: 'This is a test event from iSecurify GRC.' } }, null); reply.code(202).send({ queued: true });
  });
  app.post('/t/:tenantId/webhooks/:id/deliveries/:did/retry', { preHandler: tenantCtx }, async (req: any) => {
    needManage(req); const ep = await e.getEndpoint(pool, req.tenantId, req.params.id); if (!ep) throw notFound(); const n = await e.retryDelivery(pool, req.tenantId, ep.id, Number(req.params.did)); if (!n) throw conflict('Only a failed (dead) delivery can be retried'); return { ok: true };
  });

  // ================= public API (/v1) =================
  type Key = { tenantId: string; id: string; name: string; createdBy: string; scopes: string[] };
  const keyAuth = (scope?: Scope) => async (req: any) => {
    const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? '')); const kp = m ? KEY_PATTERN.exec(m[1]) : null;
    const fail = () => { if (!ctx.limiter.allow(`v1bad:${req.ip}`, 30, 600_000)) throw new HttpError(429, 'Too many failed attempts', 'rate_limited'); return unauthorized('Invalid API key'); };
    if (!kp) throw fail(); const rec = await e.keyByPrefix(pool, kp[1]); if (!rec || !safeEqual(rec.hash, sha256(m![1]))) throw fail();
    if (rec.revokedAt || (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) || rec.userStatus !== 'active') throw fail();
    const acc = await t.resolveAccess(pool, rec.createdBy, rec.tenantId); if (!acc || acc.orgStatus !== 'active' || !acc.manage) throw fail();   // the key stops working when its creator loses the right to manage, or the organization is suspended
    if (!ctx.limiter.allow(`v1:${rec.id}`, 600, 60_000)) throw new HttpError(429, 'Rate limit: 600 requests per minute per key', 'rate_limited');
    if (scope && !rec.scopes.includes(scope)) throw forbidden(`This key does not have the "${scope}" scope`);
    req.apiKey = { tenantId: rec.tenantId, id: rec.id, name: rec.name, createdBy: rec.createdBy, scopes: rec.scopes } as Key; await e.touchKey(pool, rec.tenantId, rec.id, req.ip);
  };
  const K = (req: any) => req.apiKey as Key; const auditV = (c: Conn, req: any, action: string, engagementId: string | null, detail: Record<string, unknown>) =>
    audit(c, { tenantId: K(req).tenantId, actorId: K(req).createdBy, action, entity: engagementId ? 'engagement' : 'api', entityId: engagementId ?? K(req).id, detail: { ...(engagementId ? { engagementId } : {}), ...detail, viaApiKey: K(req).id, apiKeyName: K(req).name }, ip: req.ip });
  const engagements = async (req: any, engagementId?: string, activeOnly = true) => { let l = await d.listEngagements(pool, K(req).tenantId, { kind: 'all' }); if (activeOnly) l = l.filter((x: any) => x.status === 'active'); if (engagementId) { l = l.filter((x: any) => x.id === engagementId); if (!l.length) throw notFound(); } return l.slice(0, 100); };

  app.get('/v1/me', { preHandler: keyAuth() }, async (req: any) => ({ organizationId: K(req).tenantId, keyId: K(req).id, name: K(req).name, scopes: K(req).scopes, rateLimit: '600/minute' }));
  app.get('/v1/items', { preHandler: keyAuth('items:read') }, async (req: any) => {
    const p = ctx.parse(z.object({ engagementId: Uuid.optional(), overdue: z.enum(['true', 'false']).optional(), state: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(100) }), req.query ?? {});
    const ids = (await engagements(req, p.engagementId)).map((x: any) => x.id as string); const td = today(); const rows = await itemRows((sql, v) => q(pool, sql, v), K(req).tenantId, { today: td, engagementIds: ids, overdue: p.overdue === 'true' });
    const all = rows.map(r => ({ id: r.id, engagementId: r.engagementId, ref: r.ref, title: r.title, owner: r.ownerName, dueDate: r.dueDate, readiness: r.readiness, evidence: r.evidence, state: evaluateItem({ readiness: r.readiness, evidence: r.evidence, evidenceExpired: r.evidenceExpired, allControlsNotApplicable: r.allControlsNotApplicable, blockingFindings: r.blockingFindings }) })).filter(r => !p.state || r.state === p.state).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    return { total: all.length, page: p.page, pageSize: p.pageSize, items: all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(r => ({ ...r, stateLabel: STATE_LABEL[r.state as keyof typeof STATE_LABEL] })) };
  });
  app.get('/v1/findings', { preHandler: keyAuth('findings:read') }, async (req: any) => {
    const p = ctx.parse(z.object({ engagementId: Uuid.optional(), status: z.string().max(30).optional(), severity: z.enum(SEVERITIES).optional(), unresolved: z.enum(['true', 'false']).optional() }), req.query ?? {}); const out: any[] = [];
    for (const en of await engagements(req, p.engagementId, false)) out.push(...(await f.listFindings(pool, K(req).tenantId, en.id, { severity: p.severity as any, status: p.status as any, unresolved: p.unresolved === 'true' })).map((x: any) => ({ id: x.id, ref: ref(x.findingNo), engagementId: x.engagementId, itemId: x.itemId, title: x.title, description: x.description, severity: x.severity, status: x.status, owner: x.ownerName, dueDate: x.dueDate, externalRef: x.externalRef ?? null, createdAt: x.createdAt })));
    return { total: out.length, findings: out.slice(0, 2000) };
  });
  app.post('/v1/findings', { preHandler: keyAuth('findings:write') }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ itemId: Uuid, title: Text(300).min(1), description: Text(10000).min(1), severity: z.enum(SEVERITIES), recommendation: Text(10000).nullish(), dueDate: DateStr.nullish(), externalRef: z.string().trim().min(1).max(120).regex(/^[\x21-\x7e]+$/, 'No spaces or control characters').nullish() }), req.body);
    if (!ctx.limiter.allow(`v1find:${K(req).id}`, 600, 3600_000)) throw new HttpError(429, 'Rate limit: 600 findings per hour per key', 'rate_limited'); const it = await d.getItem(pool, K(req).tenantId, b.itemId); if (!it) throw notFound(); const id = uuid(); let no = 0; let existing: any = null;
    await tx(pool, async (c) => {
      const [item] = await d.lockItems(c, K(req).tenantId, it.engagementId, [it.id]); if (!item) throw notFound(); const eng = await d.getEngagement(c, K(req).tenantId, it.engagementId, true); if (!eng || eng.status === 'closed') throw conflict('This engagement is closed');
      if (b.externalRef) { existing = await e.findingByExternalRef(c, K(req).tenantId, b.externalRef); if (existing) return; }
      if (item.readiness === 'not_applicable') throw conflict('Findings cannot be raised against an item that is not applicable');
      no = await f.nextNo(c, K(req).tenantId, it.engagementId); await f.insertFinding(c, K(req).tenantId, { id, engagementId: it.engagementId, itemId: it.id, no, title: b.title, description: b.description, recommendation: b.recommendation, severity: b.severity, ownerUserId: null, dueDate: b.dueDate, raisedBy: K(req).createdBy });
      if (b.externalRef) await e.setExternalRef(c, K(req).tenantId, id, b.externalRef); await f.addEvent(c, K(req).tenantId, { id: uuid(), findingId: id, kind: 'raised', to: 'open', note: `Raised through the API (${K(req).name})`, actorId: K(req).createdBy });
      await auditV(c, req, 'finding.raised', it.engagementId, { findingId: id, ref: ref(no), itemId: it.id, itemRef: it.ref, severity: b.severity, title: b.title, externalRef: b.externalRef ?? null });
    });
    if (existing) return reply.code(200).send({ id: existing.id, ref: ref(existing.findingNo), duplicate: true }); reply.code(201).send({ id, ref: ref(no), findingNo: no, duplicate: false });
  });
  app.get('/v1/control-tests', { preHandler: keyAuth('tests:read') }, async (req: any) => {
    const p = ctx.parse(z.object({ engagementId: Uuid.optional() }), req.query ?? {}); const ids = (await engagements(req, p.engagementId)).map((x: any) => x.id as string); const rows = await cd.listTests(pool, K(req).tenantId, { engagementIds: ids });
    return { total: rows.length, tests: rows.map((x: any) => ({ id: x.id, engagementId: x.engagementId, itemRef: x.itemRef, title: x.title, frequency: x.frequency, nextDueOn: x.nextDueOn, lastResult: x.lastResult, lastRunOn: x.lastRunOn, status: x.status })) };
  });
  app.post('/v1/control-tests/:id/runs', { preHandler: keyAuth('tests:write') }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ result: z.enum(['pass', 'fail']), note: Text(5000).min(1), performedOn: DateStr.optional() }), req.body); const td = today(); const on = b.performedOn ?? td; const prob = runDateProblem(on, td); if (prob) throw bad(prob);
    const t0 = await cd.getTest(pool, K(req).tenantId, req.params.id); if (!t0) throw notFound(); if (!ctx.limiter.allow(`v1run:${K(req).id}`, 1200, 3600_000)) throw new HttpError(429, 'Rate limit: 1200 results per hour per key', 'rate_limited'); const id = uuid();
    await tx(pool, async (c) => {
      const eng = await d.getEngagement(c, K(req).tenantId, t0.engagementId, true); if (!eng || eng.status === 'closed') throw conflict('This engagement is closed'); const tt = await cd.getTest(c, K(req).tenantId, t0.id, true); if (!tt) throw notFound(); if (tt.status === 'paused') throw conflict('This test is paused');
      await cd.insertRun(c, K(req).tenantId, { id, testId: tt.id, engagementId: tt.engagementId, itemId: tt.itemId, performedOn: on, result: b.result, note: `[via API: ${K(req).name}] ${b.note}`, performedBy: K(req).createdBy });
      const latest = (await cd.latestRun(c, K(req).tenantId, tt.id))!; await cd.recordResult(c, K(req).tenantId, tt.id, latest.result, latest.performedOn, nextDueAfter(latest.performedOn, tt.frequency as Frequency));
      await auditV(c, req, 'control_test.run', tt.engagementId, { testId: tt.id, itemRef: tt.itemRef, result: b.result, performedOn: on, runId: id });
      if (b.result === 'fail') await notify(c, { tenantId: K(req).tenantId, kind: 'control_test.failed', recipients: [...(await cd.clientAdminIds(c, K(req).tenantId)), tt.accountableUserId, tt.ownerUserId], actorId: null as any, entityType: 'checklist_item', entityId: tt.itemId, engagementId: tt.engagementId, label: `${tt.itemRef}: test failed - ${tt.title}` });
    });
    reply.code(201).send({ id });
  });
  app.get('/v1/posture', { preHandler: keyAuth('posture:read') }, async (req: any) => {
    const ens = await engagements(req); const ids = ens.map((x: any) => x.id as string); const fw = await cd.frameworksOf(pool, K(req).tenantId, ids); const live = await frameworkSummaries((s, v) => q(pool, s, v), K(req).tenantId, ids, today());
    return { date: today(), engagements: ens.map((en: any) => ({ id: en.id, name: en.name, frameworks: fw.filter((x: any) => x.engagementId === en.id).map((x: any) => { const s = live.find(l => l.engagementId === en.id && l.frameworkId === x.frameworkId)?.summary; return { frameworkId: x.frameworkId, name: x.name, version: x.version, percent: s?.readinessPercent ?? 0, effective: s?.effective ?? 0, applicable: s?.applicable ?? 0, overdue: s?.overdue ?? 0 }; }) })) };
  });
  app.get('/v1/audit', { preHandler: keyAuth('audit:read') }, async (req: any) => {
    const p = ctx.parse(z.object({ afterId: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query ?? {}); const rows = await e.auditFeed(pool, K(req).tenantId, { afterId: p.afterId, limit: p.limit });
    return { nextAfterId: rows.length ? Number(rows[rows.length - 1].id) : p.afterId, events: rows.filter((r: any) => isSendable(r.action)).map((r: any) => payloadOf({ auditId: Number(r.id), tenantId: K(req).tenantId, action: r.action, actorId: r.actorId, entity: r.entity, entityId: r.entityId, detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail, createdAt: r.createdAt })) };
  });
}
