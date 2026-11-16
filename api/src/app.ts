import Fastify, { FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie'; import multipart from '@fastify/multipart';
import pino from 'pino';
import { z } from 'zod';
import type { Config } from './config';
import { q, tx, type Pool } from './db';
import { uuid, sha256, newToken, hashPassword, verifyPassword, passwordOk, safeEqual, encrypt, decrypt, csrfFor } from './platform/crypto';
import { newSecret, verifyTotp, otpauthUri } from './platform/totp';
import { RateLimiter } from './platform/ratelimit';
import { audit } from './platform/audit';
import { enqueue } from './platform/jobs';
import { HttpError, bad, unauthorized, forbidden, conflict } from './platform/errors';
import type { Ctx } from './platform/context';
import { registerTenancy } from './modules/tenancy/routes'; import { registerUsers } from './modules/users/routes'; import { registerAudit } from './modules/audit/routes';
import { listAccessibleOrgs } from './modules/tenancy/data';
import { registerEngagements, registerEngagementAdmin } from './modules/engagements/routes';
import { registerFrameworks } from './modules/frameworks/routes'; import { registerCommonControls } from './modules/frameworks/common';
import { registerQuestionnaires } from './modules/questionnaires/routes'; import { registerTasks } from './modules/tasks/routes'; import { registerDemo } from './modules/demo/routes'; import { registerVapt } from './modules/vapt/routes'; import { registerSignoff } from './modules/signoff/routes'; import { registerIntegrations } from './modules/integrations/routes'; import { registerContinuous } from './modules/continuous/routes'; import { registerWidgets } from './modules/widgets/routes'; import { registerSpog } from './modules/spog/routes'; import { registerStorage } from './modules/storage/routes'; import { registerFindings } from './modules/findings/routes'; import { registerCertificates } from './modules/certificates/routes'; import { registerReports } from './modules/reports/routes'; import { registerAnalytics } from './modules/analytics/routes'; import { registerRisks } from './modules/risks/routes'; import { securityHeaders, requestIdFrom } from './platform/headers'; import { registerBranding } from './modules/branding/routes'; import { registerVendors } from './modules/vendors/routes'; import { registerSystem } from './modules/system/routes'; import { registerViews } from './modules/views/routes'; import { registerOnboarding } from './modules/onboarding/routes'; import { registerPolicies } from './modules/policies/routes'; import { registerIncidents } from './modules/incidents/routes'; import { registerNotifications } from './modules/notifications/routes'; import { registerMail } from './modules/mail/routes'; import { registerEvidence, registerEvidenceAdmin } from './modules/evidence/routes'; import { registerTemplates } from './modules/evidence/templates'; import { LocalStorage } from './platform/storage'; import { evidenceDefaults } from './config';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'; import crypto from 'node:crypto';

const SESSION_HOURS = 8, PENDING_MIN = 5, MAX_FAILS = 5, LOCK_MIN = 15;
const parse = <T extends z.ZodTypeAny>(s: T, d: unknown): z.infer<T> => { const r = s.safeParse(d); if (!r.success) throw bad(r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; };
const normRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function buildApp(pool: Pool, cfg: Config) {
  const logger = pino({ level: cfg.logLevel, redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], censor: '[redacted]' } }, cfg.logStream);
  const app = Fastify({ loggerInstance: logger, bodyLimit: 1024 * 1024, trustProxy: cfg.production, disableRequestLogging: false, genReqId: (req) => requestIdFrom(req.headers['x-request-id'], () => crypto.randomUUID()), connectionTimeout: 30_000, keepAliveTimeout: 65_000, requestTimeout: 120_000 });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 5, parts: 8 } });
  const limiter = new RateLimiter();
  const COOKIE = cfg.production ? '__Host-sid' : 'sid';
  const cookieOpts = (maxAgeSec: number) => ({ httpOnly: true, sameSite: 'strict' as const, secure: cfg.production, path: '/', maxAge: maxAgeSec });
  let dummyHash: string | null = null;

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'Already exists' });
    if (err.errno === 3819) return reply.code(400).send({ error: 'A value breaks a data rule (for example an end date before the start date, or a missing justification)' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_FILES_LIMIT' || err.statusCode === 413) return reply.code(413).send({ error: 'File is larger than 5 MB' });
    if (err.code === 'ER_SIGNAL_EXCEPTION') return reply.code(409).send({ error: err.sqlMessage || 'Operation not allowed' });
    if (err.validation || err.statusCode === 400 || err.statusCode === 415) return reply.code(400).send({ error: 'Bad request' });
    req.log.error({ msg: err.message, code: err.code }, 'unhandled error'); reply.code(500).send({ error: 'Internal error' });
  });
  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (cfg.origin && req.headers.origin && req.headers.origin !== cfg.origin) throw forbidden('Bad origin');
      const ct = String(req.headers['content-type'] || ''); const isImport = /^\/releases\/[0-9a-f-]{36}\/import(\?|$)/.test(req.url) || /^\/t\/[0-9a-f-]{36}\/evidence-requests\/[0-9a-f-]{36}\/versions(\?|$)/.test(req.url) || /^\/templates(\?|$)/.test(req.url) || /^\/frameworks\/[0-9a-f-]{36}\/questionnaire\/import(\?|$)/.test(req.url) || /^\/platform\/branding\/logo(\?|$)/.test(req.url) || /^\/t\/[0-9a-f-]{36}\/engagements\/[0-9a-f-]{36}\/tasks\/import(\?|$)/.test(req.url) || /^\/task-templates(\?|$)/.test(req.url);   // the only multipart routes
      if (Number(req.headers['content-length'] || 0) > 0 && !ct.includes('application/json') && !(isImport && ct.startsWith('multipart/form-data'))) throw bad('JSON required');
    }
  });
  const SEC = securityHeaders(cfg.production); app.addHook('onSend', async (req, reply) => { if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store'); for (const [k, v] of Object.entries(SEC)) if (!reply.hasHeader(k)) reply.header(k, v); reply.header('X-Request-Id', req.id); });

  // ---------- session middleware ----------
  type Opts = { allowPending?: boolean; allowUnenrolled?: boolean };
  const withSession = (o: Opts = {}) => async (req: FastifyRequest) => {
    const tok = (req.cookies as any)?.[COOKIE]; if (!tok) throw unauthorized();
    const r = (await q(pool, `SELECT s.id sid, s.mfa_pending, s.expires_at, u.id, u.email, u.name, u.platform_role, m.enabled mfa_enabled
      FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN mfa_secrets m ON m.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>NOW(3) AND u.status='active'`, [sha256(tok)]))[0];
    if (!r) throw unauthorized();
    if (!['GET', 'HEAD'].includes(req.method)) { const h = String(req.headers['x-csrf-token'] || ''); if (!h || !safeEqual(h, csrfFor(tok, cfg.csrfKey))) throw forbidden('Invalid CSRF token', 'csrf'); }
    if (r.mfa_pending && !o.allowPending) throw unauthorized('MFA required', 'mfa_required');
    const platform = r.platform_role !== 'none'; const mfaEnabled = !!r.mfa_enabled;
    if (!r.mfa_pending && cfg.requireMfaForPlatform && platform && !mfaEnabled && !o.allowUnenrolled) throw forbidden('MFA enrollment required', 'mfa_enrollment_required');
    (req as any).user = { id: r.id, email: r.email, name: r.name, platformRole: r.platform_role, mfaEnabled };
    (req as any).session = { id: r.sid, token: tok, pending: !!r.mfa_pending };
  };
  const U = (req: any) => req.user as { id: string; email: string; name: string; platformRole: string; mfaEnabled: boolean };
  const S = (req: any) => req.session as { id: string; token: string; pending: boolean };

  async function startSession(req: FastifyRequest, reply: any, userId: string, pending: boolean) {
    const token = newToken(); const ttl = pending ? PENDING_MIN * 60 : SESSION_HOURS * 3600;
    await pool.query('INSERT INTO sessions(id,token_hash,user_id,mfa_pending,ip,user_agent,expires_at) VALUES (?,?,?,?,?,?,?)',
      [uuid(), sha256(token), userId, pending ? 1 : 0, req.ip, String(req.headers['user-agent'] || '').slice(0, 255), new Date(Date.now() + ttl * 1000)]);
    reply.setCookie(COOKIE, token, cookieOpts(ttl));
    return csrfFor(token, cfg.csrfKey);
  }
  const userView = (u: any) => ({ id: u.id, name: u.name, email: u.email, platformRole: u.platformRole ?? u.platform_role });

  // ---------- health ----------
  app.get('/health', async () => ({ ok: true }));
  const releaseVersion = (() => { try { return fs.readFileSync(path.join(process.cwd(), '..', 'VERSION'), 'utf8').trim().slice(0, 40) || 'unknown'; } catch { return 'dev'; } })();
  app.get('/environment', async (_req, reply) => { reply.header('cache-control', 'no-cache'); return { environment: process.env.APP_ENV === 'staging' ? 'staging' : 'production', version: releaseVersion }; });   // lets the web app show a STAGING bar
  app.get('/ready', async () => { await pool.query('SELECT 1'); return { ok: true }; });

  // ---------- first-run setup ----------
  app.get('/setup', async () => ({ needsSetup: (await q(pool, 'SELECT COUNT(*) n FROM users'))[0].n === 0 }));
  app.post('/setup', async (req, reply) => {
    const b = parse(z.object({ email: z.string().email().max(190), name: z.string().min(1).max(190), password: z.string() }), req.body);
    if (!passwordOk(b.password)) throw bad('Password needs 12+ characters with upper case, lower case and a digit');
    const id = uuid(); const ph = await hashPassword(b.password);
    await tx(pool, async (c) => {
      const n = (await q(c, 'SELECT COUNT(*) n FROM users FOR UPDATE'))[0].n;
      if (n > 0) throw forbidden('Setup already completed');
      await c.query("INSERT INTO users(id,email,name,password_hash,platform_role,password_changed_at) VALUES (?,?,?,?,'super_admin',NOW(3))", [id, b.email.toLowerCase(), b.name, ph]);
      await audit(c, { actorId: id, action: 'setup.super_admin_created', entity: 'user', entityId: id, ip: req.ip });
    });
    reply.code(201).send({ id });
  });

  // ---------- login / mfa ----------
  app.post('/auth/login', async (req, reply) => {
    const b = parse(z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) }), req.body);
    if (!limiter.allow('login:' + req.ip, cfg.limits.login, 60_000)) throw new HttpError(429, 'Too many attempts, try again shortly');
    const u = (await q(pool, 'SELECT * FROM users WHERE email=?', [b.email.toLowerCase()]))[0];
    const fail = unauthorized('Invalid credentials');
    if (!u || u.status !== 'active' || !u.password_hash) { dummyHash ??= await hashPassword('Dummy-Password-0'); await verifyPassword(dummyHash, b.password); throw fail; }
    if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.');
    if (!(await verifyPassword(u.password_hash, b.password))) {
      const fails = u.failed_logins + 1; const lock = fails >= MAX_FAILS;
      await pool.query('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [lock ? 0 : fails, lock ? new Date(Date.now() + LOCK_MIN * 60_000) : null, u.id]);
      await audit(pool, { actorId: u.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', entity: 'user', entityId: u.id, ip: req.ip });
      throw fail;
    }
    await pool.query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [u.id]);
    const mfaOn = (await q(pool, 'SELECT enabled FROM mfa_secrets WHERE user_id=?', [u.id]))[0]?.enabled === 1;
    const csrfToken = await startSession(req, reply, u.id, mfaOn);
    if (!mfaOn) await audit(pool, { actorId: u.id, action: 'auth.login', entity: 'user', entityId: u.id, ip: req.ip });
    return { user: userView(u), mfaRequired: mfaOn, csrfToken };
  });

  app.post('/auth/mfa/verify', { preHandler: withSession({ allowPending: true }) }, async (req: any, reply) => {
    const b = parse(z.object({ code: z.string().min(6).max(32) }), req.body); const user = U(req), sess = S(req);
    if (!sess.pending) throw conflict('Session is already verified');
    if (!limiter.allow('mfa:' + user.id, cfg.limits.mfa, 5 * 60_000)) throw new HttpError(429, 'Too many attempts');
    let ok = false;
    if (/^\d{6}$/.test(b.code)) {
      const m = (await q(pool, 'SELECT * FROM mfa_secrets WHERE user_id=? AND enabled=1', [user.id]))[0];
      const step = m ? verifyTotp(decrypt(m.secret_enc, cfg.mfaKey), b.code) : null;
      if (step !== null) { const r: any = await pool.query('UPDATE mfa_secrets SET last_step=? WHERE user_id=? AND last_step<?', [step, user.id, step]); ok = r[0].affectedRows === 1; } // replay protection
    } else {
      const r: any = await pool.query('UPDATE recovery_codes SET used_at=NOW(3) WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1', [user.id, sha256(normRecovery(b.code))]);
      ok = r[0].affectedRows === 1; if (ok) await audit(pool, { actorId: user.id, action: 'auth.recovery_code_used', entity: 'user', entityId: user.id, ip: req.ip });
    }
    if (!ok) { await audit(pool, { actorId: user.id, action: 'auth.mfa_failed', entity: 'user', entityId: user.id, ip: req.ip }); throw unauthorized('Invalid code'); }
    await pool.query('DELETE FROM sessions WHERE id=?', [sess.id]);               // rotate session id after privilege change
    const csrfToken = await startSession(req, reply, user.id, false);
    await audit(pool, { actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, detail: { mfa: true }, ip: req.ip });
    return { user: userView(user), csrfToken };
  });

  app.post('/auth/logout', { preHandler: withSession({ allowPending: true, allowUnenrolled: true }) }, async (req: any, reply) => {
    await pool.query('DELETE FROM sessions WHERE id=?', [S(req).id]); reply.clearCookie(COOKIE, { path: '/' }); return { ok: true };
  });

  app.get('/auth/me', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const u = U(req);
    return { user: userView(u), organizations: await listAccessibleOrgs(pool, u.id), mfa: { enabled: u.mfaEnabled }, mfaEnrollmentRequired: cfg.requireMfaForPlatform && u.platformRole !== 'none' && !u.mfaEnabled, csrfToken: csrfFor(S(req).token, cfg.csrfKey) };
  });

  // ---------- password ----------
  app.post('/auth/password/change', { preHandler: withSession() }, async (req: any) => {
    const b = parse(z.object({ currentPassword: z.string().max(200), newPassword: z.string() }), req.body); const user = U(req);
    if (!passwordOk(b.newPassword)) throw bad('Password needs 12+ characters with upper case, lower case and a digit');
    const row = (await q(pool, 'SELECT password_hash FROM users WHERE id=?', [user.id]))[0];
    if (!(await verifyPassword(row.password_hash, b.currentPassword))) throw forbidden('Current password is incorrect');
    const ph = await hashPassword(b.newPassword);
    await tx(pool, async (c) => {
      await c.query('UPDATE users SET password_hash=?, password_changed_at=NOW(3) WHERE id=?', [ph, user.id]);
      await c.query('DELETE FROM sessions WHERE user_id=? AND id<>?', [user.id, S(req).id]);
      await audit(c, { actorId: user.id, action: 'auth.password_changed', entity: 'user', entityId: user.id, ip: req.ip });
    });
    return { ok: true };
  });
  app.post('/auth/password/reset-request', async (req) => {
    const b = parse(z.object({ email: z.string().email().max(190) }), req.body);
    if (!limiter.allow('reset:' + req.ip, cfg.limits.reset, 15 * 60_000)) throw new HttpError(429, 'Too many requests');
    const u = (await q(pool, "SELECT id,email FROM users WHERE email=? AND status='active'", [b.email.toLowerCase()]))[0];
    if (u) {
      const token = newToken();
      await tx(pool, async (c) => {
        await c.query('INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES (?,?,?,?)', [uuid(), u.id, sha256(token), new Date(Date.now() + 30 * 60_000)]);
        await enqueue(c, { type: 'email.password_reset', payload: { to: u.email, token } });
        await audit(c, { actorId: u.id, action: 'auth.password_reset_requested', entity: 'user', entityId: u.id, ip: req.ip });
      });
    }
    return { ok: true };                                                     // same answer whether or not the account exists
  });
  app.post('/auth/password/reset', async (req) => {
    const b = parse(z.object({ token: z.string().min(20).max(100), newPassword: z.string() }), req.body);
    if (!passwordOk(b.newPassword)) throw bad('Password needs 12+ characters with upper case, lower case and a digit');
    if (!limiter.allow('resetc:' + req.ip, 10, 15 * 60_000)) throw new HttpError(429, 'Too many requests');
    const ph = await hashPassword(b.newPassword);
    await tx(pool, async (c) => {
      const r = (await q(c, 'SELECT id,user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW(3) FOR UPDATE', [sha256(b.token)]))[0];
      if (!r) throw bad('Invalid or expired token');
      await c.query('UPDATE password_resets SET used_at=NOW(3) WHERE id=?', [r.id]);
      await c.query('UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL, password_changed_at=NOW(3) WHERE id=?', [ph, r.user_id]);
      await c.query('DELETE FROM sessions WHERE user_id=?', [r.user_id]);
      await audit(c, { actorId: r.user_id, action: 'auth.password_reset_completed', entity: 'user', entityId: r.user_id, ip: req.ip });
    });
    return { ok: true };
  });

  // ---------- MFA management ----------
  app.post('/auth/mfa/enroll', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const user = U(req); if (user.mfaEnabled) throw conflict('MFA is already enabled');
    const secret = newSecret();
    await pool.query('INSERT INTO mfa_secrets(user_id,secret_enc,enabled) VALUES (?,?,0) ON DUPLICATE KEY UPDATE secret_enc=VALUES(secret_enc), enabled=0, last_step=0', [user.id, encrypt(secret, cfg.mfaKey)]);
    return { secret, otpauthUri: otpauthUri('iSecurify GRC', user.email, secret) };
  });
  app.post('/auth/mfa/confirm', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body); const user = U(req);
    const m = (await q(pool, 'SELECT * FROM mfa_secrets WHERE user_id=? AND enabled=0', [user.id]))[0]; if (!m) throw conflict('Start enrollment first');
    const step = verifyTotp(decrypt(m.secret_enc, cfg.mfaKey), b.code); if (step === null) throw bad('Invalid code');
    const codes = Array.from({ length: 10 }, () => { const c = newToken(8).replace(/[^A-Za-z0-9]/g, '').toUpperCase().padEnd(10, 'X').slice(0, 10); return c.slice(0, 5) + '-' + c.slice(5); });
    await tx(pool, async (c) => {
      await c.query('UPDATE mfa_secrets SET enabled=1, enabled_at=NOW(3), last_step=? WHERE user_id=?', [step, user.id]);
      await c.query('DELETE FROM recovery_codes WHERE user_id=?', [user.id]);
      for (const code of codes) await c.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES (?,?)', [user.id, sha256(normRecovery(code))]);
      await c.query('DELETE FROM sessions WHERE user_id=? AND id<>?', [user.id, S(req).id]);
      await audit(c, { actorId: user.id, action: 'auth.mfa_enabled', entity: 'user', entityId: user.id, ip: req.ip });
    });
    return { recoveryCodes: codes };                                          // shown once; only hashes are stored
  });
  app.post('/auth/mfa/disable', { preHandler: withSession() }, async (req: any) => {
    const b = parse(z.object({ password: z.string().max(200), code: z.string().regex(/^\d{6}$/) }), req.body); const user = U(req);
    if (cfg.requireMfaForPlatform && user.platformRole !== 'none') throw forbidden('Platform users must keep MFA enabled');
    const row = (await q(pool, 'SELECT u.password_hash, m.secret_enc FROM users u JOIN mfa_secrets m ON m.user_id=u.id WHERE u.id=? AND m.enabled=1', [user.id]))[0]; if (!row) throw conflict('MFA is not enabled');
    if (!(await verifyPassword(row.password_hash, b.password)) || verifyTotp(decrypt(row.secret_enc, cfg.mfaKey), b.code) === null) throw forbidden('Password or code is incorrect');
    await tx(pool, async (c) => { await c.query('DELETE FROM mfa_secrets WHERE user_id=?', [user.id]); await c.query('DELETE FROM recovery_codes WHERE user_id=?', [user.id]); await audit(c, { actorId: user.id, action: 'auth.mfa_disabled', entity: 'user', entityId: user.id, ip: req.ip }); });
    return { ok: true };
  });

  // ---------- sessions ----------
  app.get('/auth/sessions', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const rows = await q(pool, 'SELECT id,ip,user_agent,created_at,expires_at FROM sessions WHERE user_id=? AND mfa_pending=0 AND expires_at>NOW(3) ORDER BY created_at DESC', [U(req).id]);
    return rows.map(r => ({ ...r, current: r.id === S(req).id }));
  });
  app.post('/auth/sessions/revoke-others', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const r: any = await pool.query('DELETE FROM sessions WHERE user_id=? AND id<>?', [U(req).id, S(req).id]);
    await audit(pool, { actorId: U(req).id, action: 'auth.sessions_revoked', entity: 'user', entityId: U(req).id, detail: { count: r[0].affectedRows }, ip: req.ip }); return { revoked: r[0].affectedRows };
  });
  app.delete('/auth/sessions/:id', { preHandler: withSession({ allowUnenrolled: true }) }, async (req: any) => {
    const r: any = await pool.query('DELETE FROM sessions WHERE id=? AND user_id=?', [req.params.id, U(req).id]); if (!r[0].affectedRows) throw new HttpError(404, 'Not found'); return { ok: true };
  });

  // ---------- feature modules ----------
  const ctx: Ctx = { pool, cfg, limiter, withSession, U, parse };
  const { tenantCtx, adminLevel, createInvite } = registerTenancy(app, ctx);
  registerUsers(app, ctx, adminLevel, createInvite);
  registerAudit(app, ctx, tenantCtx);
  registerFrameworks(app, ctx); registerCommonControls(app, ctx);
  registerEngagements(app, ctx, tenantCtx); registerEngagementAdmin(app, ctx);
  // Phase 5: evidence. Files live on a local volume shared with the worker; tests get a private temp directory.
  const evCfg = { ...evidenceDefaults(cfg.evidence?.dir ?? path.join(os.tmpdir(), 'grc-evidence-' + crypto.randomUUID())), ...cfg.evidence }; const storage = new LocalStorage(evCfg.dir); fs.mkdirSync(path.join(storage.root, '.tmp'), { recursive: true, mode: 0o700 });
  registerEvidence(app, ctx, tenantCtx, { storage, ev: evCfg, log: logger }); registerEvidenceAdmin(app, ctx, { ev: evCfg }); registerStorage(app, ctx, { ev: evCfg, storage }); registerDemo(app, ctx, { purgePool: cfg.purgePool, storage }); registerSpog(app, ctx, tenantCtx); registerIntegrations(app, ctx, tenantCtx); registerContinuous(app, ctx, tenantCtx, { maxRequestsPerItem: (evCfg as any).maxRequestsPerItem ?? 10 }); registerWidgets(app, ctx, tenantCtx); registerTemplates(app, ctx, { storage, ev: evCfg }); registerFindings(app, ctx, tenantCtx); registerSignoff(app, ctx, tenantCtx); registerVapt(app, ctx, tenantCtx); registerQuestionnaires(app, ctx, tenantCtx); registerTasks(app, ctx, tenantCtx); registerMail(app, ctx); registerReports(app, ctx, tenantCtx); registerCertificates(app, ctx, tenantCtx); registerAnalytics(app, ctx, tenantCtx); registerRisks(app, ctx, tenantCtx); registerPolicies(app, ctx, tenantCtx); registerIncidents(app, ctx, tenantCtx); registerViews(app, ctx, tenantCtx); registerVendors(app, ctx, tenantCtx); registerBranding(app, ctx); registerSystem(app, ctx, { storage, minFreeBytes: evCfg.minFreeBytes }); registerOnboarding(app, ctx, tenantCtx); registerNotifications(app, ctx);
  return app;
}
