import mysql from 'mysql2/promise'; import crypto from 'node:crypto'; import { Writable } from 'node:stream';
import { makePool } from '../src/db'; import { migrate } from '../src/migrate'; import { buildApp } from '../src/app'; import type { Config } from '../src/config';
import { hashPassword } from '../src/platform/crypto'; import { hotp, b32decode } from '../src/platform/totp';
export const ADMIN_URL = process.env.TEST_ADMIN_URL || 'mysql://grc:grc_test_pw@127.0.0.1:3306/';
export const PW = 'Str0ngPassword!1';
export const testConfig = (over: Partial<Config> = {}): Config => ({ production: false, mfaKey: crypto.randomBytes(32), csrfKey: 'test-csrf-key-0123456789', requireMfaForPlatform: true,
  limits: { login: 1000, reset: 1000, mfa: 1000 }, logLevel: 'info', ...over });
export async function freshEnv(over: Partial<Config> = {}) {
  const name = 'grc_t_' + crypto.randomBytes(4).toString('hex');
  const admin = await mysql.createConnection(ADMIN_URL); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const pool = makePool(ADMIN_URL + name); await migrate(pool);
  const logs: string[] = []; const logStream = new Writable({ write(chunk, _e, cb) { logs.push(chunk.toString()); cb(); } });
  const cfg = testConfig({ logStream, purgePool: pool, ...over }); const app = buildApp(pool, cfg); await app.ready();
  const client = () => {
    let cookie = ''; let csrf = '';
    const call = async (method: string, url: string, payload?: any, headers: Record<string, string> = {}) => {
      const h: any = { ...headers }; if (cookie) h.cookie = cookie; if (csrf && !h['x-csrf-token'] && h['x-csrf-token'] !== null) h['x-csrf-token'] = csrf; if (h['x-csrf-token'] === null) delete h['x-csrf-token'];
      const r = await app.inject({ method: method as any, url, payload, headers: h });
      const sc = r.headers['set-cookie']; const m = /(?:__Host-)?sid=([^;]+)/.exec(Array.isArray(sc) ? sc.join(';') : sc || '');
      if (m) cookie = (sc as string).toString().split(';')[0];
      let body: any; try { body = r.json(); } catch { body = r.body; }
      if (body?.csrfToken) csrf = body.csrfToken;
      return { status: r.statusCode, body, headers: r.headers, raw: r.rawPayload as Buffer };
    };
    return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; }, get csrf() { return csrf; }, set csrf(v) { csrf = v; } };
  };
  const mkUser = async (email: string, role = 'none', pw = PW) => { const id = crypto.randomUUID(); await pool.query('INSERT INTO users(id,email,name,password_hash,platform_role) VALUES (?,?,?,?,?)', [id, email, email.split('@')[0], await hashPassword(pw), role]); return id; };
  const login = async (email: string, pw = PW) => { const c = client(); const r = await c.call('POST', '/auth/login', { email, password: pw }); if (r.status !== 200) throw new Error('login failed ' + r.status + JSON.stringify(r.body)); return c; };
  const close = async () => { await app.close(); await pool.end(); const a = await mysql.createConnection(ADMIN_URL); await a.query(`DROP DATABASE IF EXISTS ${name}`); await a.end(); };
  return { pool, app, cfg, client, mkUser, login, close, logs, name };
}
export const totpNow = (secretB32: string, offsetSteps = 0) => hotp(b32decode(secretB32), Math.floor(Date.now() / 30000) + offsetSteps);

// ---------- Phase 2 world builder ----------
export const tokenFor = async (pool: any, email: string) => {
  const [rows]: any = await pool.query("SELECT payload FROM jobs WHERE type IN ('email.invitation') AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.to'))=? ORDER BY id DESC LIMIT 1", [email]);
  const p = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload; return p.token as string;
};
export async function world(env: Awaited<ReturnType<typeof freshEnv>>) {
  const ids: Record<string, string> = {};
  ids.root = await env.mkUser('root@x.test', 'super_admin'); ids.admin = await env.mkUser('admin@x.test', 'admin'); ids.team = await env.mkUser('team@x.test', 'isecurify_team');
  const root = await env.login('root@x.test');
  const A = (await root.call('POST', '/platform/organizations', { name: 'Org A' })).body.id; const B = (await root.call('POST', '/platform/organizations', { name: 'Org B' })).body.id;
  const join = async (orgId: string, email: string, role: string) => {
    const r = await root.call('POST', `/platform/organizations/${orgId}/invitations`, { email, role }); if (r.status !== 201) throw new Error('invite failed ' + JSON.stringify(r.body));
    const a = await env.client().call('POST', `/invitations/${await tokenFor(env.pool, email)}/accept`, { name: email.split('@')[0], password: PW }); if (a.status !== 200) throw new Error('accept failed ' + JSON.stringify(a.body)); return a.body.userId as string;
  };
  for (const [k, org, role] of [['aAdmin', A, 'client_admin'], ['aStaff', A, 'client_staff'], ['aVendor', A, 'third_party_vendor'], ['aAuditor', A, 'tp_auditor'], ['bAdmin', B, 'client_admin'], ['bStaff', B, 'client_staff']] as const)
    ids[k] = await join(org, `${k.toLowerCase()}@c.test`, role);
  return { root, A, B, ids, join, as: (k: string) => env.login(`${k.toLowerCase()}@${k.startsWith('a') || k.startsWith('b') ? 'c' : 'x'}.test`) };
}

// ---------- Phase 3 helpers ----------
import writeXlsxFile from 'write-excel-file/node';
export const mp = (filename: string, buf: Buffer) => { const b = '----t' + crypto.randomBytes(8).toString('hex');
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } }; };
export const xlsxBuf = (rows: (string | number)[][]) => writeXlsxFile(rows.map(r => r.map(v => ({ value: v })))).toBuffer();
export const HDR = ['Ref #', 'Domain / Clause', 'Requirement', 'Owner (Department)', 'Evidence / Reference', 'Additional Evidence Notes', 'Remarks'];
export async function newFramework(root: any, name: string, controls: { ref: string; domain: string; title: string }[] = [], publish = false) {
  const r = (await root.call('POST', '/frameworks', { name })).body; if (controls.length) await root.call('POST', `/releases/${r.draftReleaseId}/controls/bulk`, { controls });
  if (publish) { const p = await root.call('POST', `/releases/${r.draftReleaseId}/publish`); if (p.status !== 200) throw new Error('publish failed ' + JSON.stringify(p.body)); } return { id: r.id as string, releaseId: r.draftReleaseId as string };
}

// ---------- Phase 4 fixtures ----------
export async function frameworkFixtures(root: any) {
  const cc = async (t: string) => (await root.call('POST', '/common-controls', { title: t })).body.id as string;
  const mfa = await cc('Multi-factor authentication'), backup = await cc('Backup and recovery'), policy = await cc('Security policy');
  const X = await newFramework(root, 'Fixture X', [{ ref: 'X-1', domain: 'Access', title: 'MFA (X)' }, { ref: 'X-2', domain: 'Ops', title: 'Backups (X)' }, { ref: 'X-3', domain: 'Governance', title: 'Policy (X)' }]);
  const Y = await newFramework(root, 'Fixture Y', [{ ref: 'Y-1', domain: 'Auth', title: 'MFA (Y)' }, { ref: 'Y-2', domain: 'Resilience', title: 'Backups (Y)' }, { ref: 'Y-3', domain: 'People', title: 'Training (Y)' }]);
  const ids: Record<string, string> = {}; for (const r of [X.releaseId, Y.releaseId]) for (const c of (await root.call('GET', `/releases/${r}/controls`)).body) ids[c.ref] = c.id;
  for (const [ref, common] of [['X-1', mfa], ['Y-1', mfa], ['X-2', backup], ['Y-2', backup]] as const) await root.call('PUT', `/controls/${ids[ref]}/mapping`, { commonControlId: common });
  for (const f of [X, Y]) await root.call('POST', `/releases/${f.releaseId}/publish`);
  return { X, Y, cc: { mfa, backup, policy }, ctl: ids };
}

// ---------- Phase 5 helpers ----------
/** Multipart body with text fields BEFORE the file part (the order the web client uses). */
export const mpf = (filename: string, buf: Buffer, fields: Record<string, string> = {}) => { const b = '----t' + crypto.randomBytes(8).toString('hex');
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  const payload = Buffer.concat([...parts, Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } }; };
export const PDF = (extra = '') => Buffer.from('%PDF-1.4\n% test evidence ' + extra + '\n%%EOF\n');
export const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** Records a sign-off straight in the database, for tests that close an engagement without going through the auditor and then need to close or certify it. */
export const signoffSql = (pool: any, tenantId: string, engagementId: string, userId: string, opinion: 'unqualified' | 'qualified' | 'adverse' = 'qualified') => pool.query("INSERT INTO engagement_signoffs(tenant_id,id,engagement_id,kind,opinion,note,applicable_controls,effective_controls,unresolved_findings,signed_by) VALUES (?,UUID(),?,'auditor',?,'Test sign-off',0,0,0,?)", [tenantId, engagementId, opinion, userId]);
