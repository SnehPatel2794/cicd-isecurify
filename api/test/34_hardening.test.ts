import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process';
import { freshEnv, world } from './helpers'; import { securityHeaders, requestIdFrom } from '../src/platform/headers'; import { productionProblems, loadConfig } from '../src/config';
import { runRestoreChecks, verifyFiles, expectedFromMigrations, diff } from '../src/restorecheck'; import { backupHealth, queueWarnings } from '../src/modules/system/rules'; import { LocalStorage } from '../src/platform/storage';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const MIG = process.env.MIGRATIONS_DIR || path.join(ROOT, 'migrations'); const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let env: Awaited<ReturnType<typeof freshEnv>>, prod: Awaited<ReturnType<typeof freshEnv>>, w: Awaited<ReturnType<typeof world>>, admin: any, team: any, aAdmin: any;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); admin = await env.login('admin@x.test'); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin');
  prod = await freshEnv({ production: true, origin: 'https://grc.example.com' } as any); }); after(async () => { await env.close(); await prod.close(); });

test('headers: pure set is complete, HSTS only in production', () => {
  const d = securityHeaders(false), p = securityHeaders(true);
  assert.equal(d['X-Content-Type-Options'], 'nosniff'); assert.equal(d['X-Frame-Options'], 'DENY'); assert.match(d['Content-Security-Policy'], /default-src 'none'/); assert.match(d['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.ok(!d['Strict-Transport-Security']); assert.match(p['Strict-Transport-Security'], /max-age=\d+/);
});
test('request ids: a safe inbound id is kept, anything else is replaced', () => {
  assert.equal(requestIdFrom('abc12345-xyz', () => 'GEN'), 'abc12345-xyz'); for (const bad of [undefined, '', 'short', 'x'.repeat(65), 'has space 123', 'a\r\nInjected: 1', ['a1234567']]) assert.equal(requestIdFrom(bad as any, () => 'GEN'), 'GEN');
});
test('app responses carry the headers and a request id', async () => {
  const r = await env.client().call('GET', '/health', undefined, { 'x-request-id': 'trace-12345678' }); assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['x-request-id'], 'trace-12345678'); assert.ok(!r.headers['strict-transport-security']);
  const r2 = await env.client().call('GET', '/health', undefined, { 'x-request-id': 'bad id' }); assert.match(String(r2.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  assert.match(String((await prod.client().call('GET', '/health')).headers['strict-transport-security']), /max-age/);
  assert.equal((await env.client().call('GET', '/platform/system')).headers['x-frame-options'], 'DENY');
});
const good = () => ({ origin: 'https://grc.example.com', csrfKey: crypto.randomBytes(36).toString('base64'), mfaKey: crypto.randomBytes(32), requireMfaForPlatform: true, databaseUrl: 'mysql://grc_app:pw@mysql:3306/grc' });
test('production configuration: safe passes, each unsafe setting is named', () => {
  assert.deepEqual(productionProblems(good()), []);
  const cases: [any, RegExp][] = [[{ origin: 'http://x.test' }, /APP_ORIGIN/], [{ origin: undefined }, /APP_ORIGIN/], [{ origin: 'https://x.test/path' }, /APP_ORIGIN/], [{ csrfKey: 'short' }, /CSRF_KEY/], [{ csrfKey: 'a'.repeat(40) }, /placeholder/], [{ csrfKey: 'change-me-change-me-change-me-change' }, /placeholder/], [{ mfaKey: Buffer.alloc(32, 7) }, /MFA_ENC_KEY/], [{ requireMfaForPlatform: false }, /REQUIRE_MFA_PLATFORM/], [{ databaseUrl: 'mysql://root:pw@mysql/grc' }, /not root/], [{ databaseUrl: 'nonsense' }, /DATABASE_URL/]];
  for (const [o, re] of cases) assert.match(productionProblems({ ...good(), ...o }).join('|'), re);
});
test('loadConfig refuses unsafe production settings and accepts safe ones', () => {
  const env0: any = { NODE_ENV: 'production', DATABASE_URL: 'mysql://grc_app:pw@mysql:3306/grc', MFA_ENC_KEY: crypto.randomBytes(32).toString('base64'), CSRF_KEY: crypto.randomBytes(36).toString('base64'), APP_ORIGIN: 'https://grc.example.com' };
  assert.equal(loadConfig(env0).production, true); assert.throws(() => loadConfig({ ...env0, APP_ORIGIN: 'http://grc.example.com' }), /Unsafe production configuration/); assert.throws(() => loadConfig({ ...env0, DATABASE_URL: 'mysql://root:pw@mysql/grc' }), /root/);
  assert.equal(loadConfig({ ...env0, NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://root:pw@localhost/grc' }).production, false);
});

test('restore checks: a healthy database passes, and each kind of damage is caught', async () => {
  const run = () => runRestoreChecks(env.pool as any, { migrationsDir: MIG }); const ok = await run(); assert.ok(ok.ok, JSON.stringify(ok.checks.filter(c => !c.ok))); assert.ok(ok.checks.length >= 6); assert.ok(ok.counts.users >= 1);
  const fail = async (name: string) => { const r = await run(); assert.equal(r.ok, false); assert.equal(r.checks.find(c => c.name === name)!.ok, false, name); };
  const [[last]]: any = await env.pool.query('SELECT MAX(name) n FROM schema_migrations'); await env.pool.query('DELETE FROM schema_migrations WHERE name=?', [last.n]); await fail('migrations'); await env.pool.query('INSERT INTO schema_migrations(name) VALUES (?)', [last.n]);
  assert.ok((await run()).ok);
  const [[t]]: any = await env.pool.query("SELECT trigger_name n, action_timing tm, event_manipulation ev, event_object_table tb, action_statement st FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name='backup_log_no_delete'");
  await env.pool.query('DROP TRIGGER backup_log_no_delete'); await fail('triggers'); await env.pool.query(`CREATE TRIGGER backup_log_no_delete ${t.tm} ${t.ev} ON ${t.tb} FOR EACH ROW ${t.st}`); assert.ok((await run()).ok);
  const conn = await (env.pool as any).getConnection(); try { await conn.query('SET FOREIGN_KEY_CHECKS=0'); const [[fk]]: any = await conn.query("SELECT table_name t FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='memberships' AND referenced_table_name='users' LIMIT 1");
    if (fk) { const [[m]]: any = await conn.query('SELECT * FROM memberships LIMIT 1'); if (m) { await conn.query("UPDATE memberships SET user_id='no-such-user' WHERE 1=1 LIMIT 1"); await fail('foreign keys'); } } } finally { await conn.query('SET FOREIGN_KEY_CHECKS=1'); conn.release(); }
});
test('restore checks: expected tables and triggers come from the migrations', () => {
  const e = expectedFromMigrations(MIG); assert.ok(e.tables.includes('backup_log') && e.tables.includes('users')); assert.ok(e.triggers.includes('backup_log_no_update')); assert.deepEqual(diff(['a', 'b'], ['b']), ['a']);
});
test('restore checks: file verification finds missing and altered files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')); try { const st = new LocalStorage(dir); const T = crypto.randomUUID(), k = () => `evidence/${T}/${crypto.randomUUID()}`; const [k1, k2, k3] = [k(), k(), k()]; const data = Buffer.from('evidence body'); const sha = crypto.createHash('sha256').update(data).digest('hex');
    fs.mkdirSync(path.join(dir, 'evidence', T), { recursive: true }); fs.writeFileSync(path.join(dir, k1), data); fs.writeFileSync(path.join(dir, k3), 'tampered');
    const r = await verifyFiles([{ id: 'ok', storageKey: k1, sha256: sha, sizeBytes: data.length }, { id: 'gone', storageKey: k2, sha256: sha, sizeBytes: 1 }, { id: 'bad', storageKey: k3, sha256: sha, sizeBytes: data.length }], st); assert.equal(r.checked, 3); assert.deepEqual(r.missing, ['gone']); assert.deepEqual(r.mismatched, ['bad']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const H = 3600_000, D = 24 * H, NOW = Date.parse('2026-10-27T00:00:00Z'); const at = (ms: number) => new Date(NOW - ms).toISOString();
test('backup health rules: never, stale, failed, unencrypted, drill overdue', () => {
  const none = backupHealth([], NOW); assert.equal(none.backup, 'never'); assert.equal(none.drill, 'never'); assert.equal(none.warnings.length, 2);
  const fine = backupHealth([{ kind: 'backup', ok: true, takenAt: at(3 * H), encrypted: true }, { kind: 'drill', ok: true, takenAt: at(5 * D) }], NOW); assert.equal(fine.backup, 'ok'); assert.equal(fine.drill, 'ok'); assert.deepEqual(fine.warnings, []);
  assert.equal(backupHealth([{ kind: 'backup', ok: true, takenAt: at(40 * H), encrypted: true }], NOW).backup, 'stale');
  assert.match(backupHealth([{ kind: 'backup', ok: true, takenAt: at(30 * H), encrypted: true }, { kind: 'backup', ok: false, takenAt: at(H), encrypted: false }], NOW).warnings.join(), /failed/);
  assert.match(backupHealth([{ kind: 'backup', ok: true, takenAt: at(H), encrypted: false }], NOW).warnings.join(), /not encrypted/);
  assert.equal(backupHealth([{ kind: 'drill', ok: true, takenAt: at(11 * D) }], NOW).drill, 'overdue'); assert.equal(backupHealth([{ kind: 'drill', ok: true, takenAt: at(10 * D) }], NOW).drill, 'ok');
  assert.match(backupHealth([{ kind: 'drill', ok: true, takenAt: at(8 * D) }, { kind: 'drill', ok: false, takenAt: at(D) }], NOW).warnings.join(), /drill failed/);
});
test('queue rules', () => { assert.deepEqual(queueWarnings({ pending: 0, running: 0, dead: 0, oldestPendingMinutes: 5 }, 0), []); assert.equal(queueWarnings({ pending: 1, running: 0, dead: 2, oldestPendingMinutes: 31 }, 3).length, 3); });

test('system status: administrators only', async () => {
  for (const c of [team, aAdmin]) assert.equal((await c.call('GET', '/platform/system')).status, 403); assert.equal((await env.client().call('GET', '/platform/system')).status, 401);
  const r = await admin.call('GET', '/platform/system'); assert.equal(r.status, 200); assert.equal(r.body.status, 'attention'); assert.equal(r.body.schema.count >= 19, true);
});
test('system status follows the backup log and the queue', async () => {
  const get = async () => (await w.root.call('GET', '/platform/system')).body; let s = await get(); assert.equal(s.backups.backup, 'never');
  await env.pool.query("INSERT INTO backup_log(kind,ok,taken_at,db_bytes,evidence_bytes,encrypted,note) VALUES ('backup',1,NOW(),1000,10,1,'ok'),('drill',1,NOW(),NULL,NULL,1,'ok')"); s = await get(); assert.equal(s.backups.backup, 'ok'); assert.equal(s.backups.drill, 'ok'); assert.equal(s.backups.log.length, 2); assert.equal(s.backups.lastBackup.encrypted, true);
  await env.pool.query("INSERT INTO backup_log(kind,ok,taken_at,encrypted,note) VALUES ('backup',1,NOW()-INTERVAL 3 DAY,1,'old')"); await env.pool.query("DELETE FROM jobs"); await env.pool.query("INSERT INTO jobs(type,payload,status,run_at) VALUES ('email.test','{}','dead',NOW())");
  s = await get(); assert.equal(s.queue.dead, 1); assert.match(s.warnings.join(), /failed permanently/);
});
test('backup_log is append-only', async () => {
  await assert.rejects(env.pool.query("UPDATE backup_log SET note='x'"), /append|not allowed|denied|signal|45000/i); await assert.rejects(env.pool.query('DELETE FROM backup_log'), /append|not allowed|denied|signal|45000/i);
});

test('deploy files: scripts parse, CI and compose are hardened, no secrets in .env.example', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'deploy')).filter(f => f.endsWith('.sh'))) execFileSync('bash', ['-n', path.join(ROOT, 'deploy', f)]);
  const ci = read('.github/workflows/ci.yml'); assert.match(ci, /permissions:\s*\{\s*contents:\s*read/); assert.match(ci, /cancel-in-progress/); assert.match(ci, /timeout-minutes/); assert.match(ci, /deploy-lint/); assert.match(ci, /caddy validate/);
  const dep = read('.github/dependabot.yml'); for (const e of ['npm', 'github-actions', 'docker']) assert.match(dep, new RegExp(e)); assert.ok(fs.existsSync(path.join(ROOT, '.github/workflows/codeql.yml')));
  const dc = read('docker-compose.yml'); assert.match(dc, /no-new-privileges/); assert.match(dc, /cap_drop:\s*\[\s*ALL/); assert.equal((dc.match(/<<: \[ \*hardening/g) || []).length, 5); assert.match(dc, /NET_BIND_SERVICE/);
  const cd = read('web/Caddyfile'); for (const h of ['Strict-Transport-Security', 'X-Frame-Options DENY', "object-src 'none'", 'Cross-Origin-Opener-Policy', 'timeouts', 'immutable']) assert.ok(cd.includes(h), h);
  const bk = read('deploy/backup.sh'); assert.match(bk, /flock/); assert.match(bk, /sha256sum/); assert.match(read('deploy/restore-drill.sh'), /verify-restore/); assert.match(read('deploy/restore.sh'), /Type the domain/);
  const envx = read('.env.example'); for (const line of envx.split('\n')) { const m = /^\s*#?\s*([A-Z_]*(PASSWORD|KEY|SECRET|TOKEN)[A-Z_]*)=(.*)$/.exec(line); if (m) assert.ok(!m[3].trim() || /^(<.*>|change.?me.*|.*\$\{.*|)$/i.test(m[3].trim()) || m[1] === 'BACKUP_GPG_RECIPIENT', line); }
});

test('off-server copy health: not configured until the first attempt, then never / ok / stale / failed', () => {
  const base = [{ kind: 'backup' as const, ok: true, takenAt: at(3 * H), encrypted: true }, { kind: 'drill' as const, ok: true, takenAt: at(2 * D) }];
  assert.equal(backupHealth(base, NOW).offsite, 'not_configured'); assert.deepEqual(backupHealth(base, NOW).warnings, []);
  const never = backupHealth([...base, { kind: 'offsite', ok: false, takenAt: at(H) }], NOW); assert.equal(never.offsite, 'never'); assert.equal(never.warnings.length, 2);
  assert.equal(backupHealth([...base, { kind: 'offsite', ok: true, takenAt: at(4 * H) }], NOW).offsite, 'ok'); const stale = backupHealth([...base, { kind: 'offsite', ok: true, takenAt: at(48 * H) }], NOW); assert.equal(stale.offsite, 'stale'); assert.match(stale.warnings.join(), /48 hours old/);
  const failed = backupHealth([...base, { kind: 'offsite', ok: true, takenAt: at(10 * H) }, { kind: 'offsite', ok: false, takenAt: at(H) }], NOW); assert.equal(failed.offsite, 'ok'); assert.match(failed.warnings.join(), /off-server copy failed/);
});
