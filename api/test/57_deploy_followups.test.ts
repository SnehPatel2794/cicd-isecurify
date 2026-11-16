// Phase 11F: read-only containers, log shipping, staging (with data scrubbing), smoke test. Scripts run against stand-ins; the scrub SQL runs against the real test database.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { freshEnv, world } from './helpers';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const DEPLOY = path.join(ROOT, 'deploy'); const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'df-'));
const run = (cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH!, ...env } });
const put = (root: string, rel: string, text: string, mode = 0o644) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, { mode }); };
const rd = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('every new deploy script is valid shell and executable', () => { for (const f of ['ship-logs.sh', 'verify-readonly.sh', 'smoke.sh', 'staging.sh', 'install-cron.sh']) { assert.equal(run('bash', ['-n', path.join(DEPLOY, f)]).status, 0, f); assert.ok(fs.statSync(path.join(DEPLOY, f)).mode & 0o100, f + ' is not executable'); } });

test('compose: the application containers are read-only with a memory /tmp; the database and scanner are untouched; ports can be moved for staging', () => {
  const py = run('python3', ['-c', `import yaml,json,sys;print(json.dumps(yaml.safe_load(open('${ROOT}/docker-compose.yml'))))`]); if (py.status !== 0) return; // no PyYAML here: the text checks below still run
  const d = JSON.parse(py.stdout).services; for (const s of ['bootstrap', 'init', 'api', 'worker', 'web']) { assert.equal(d[s].read_only, true, s + ' read_only'); assert.ok((d[s].tmpfs ?? []).some((t: string) => t.startsWith('/tmp')), s + ' tmpfs'); assert.deepEqual(d[s].cap_drop, ['ALL'], s + ' cap_drop'); assert.deepEqual(d[s].security_opt, ['no-new-privileges:true']); }
  for (const s of ['bootstrap', 'init', 'api', 'worker']) assert.equal(d[s].environment.HOME, '/tmp', s + ' HOME (npm and tsx need a writable home)');
  assert.equal(d.mysql.read_only, undefined); assert.equal(d.clamav.read_only, undefined);
  assert.ok(d.api.volumes.some((v: string) => v.startsWith('evidence_data:/data/evidence')) && d.worker.volumes.some((v: string) => v.startsWith('evidence_data:/data/evidence')), 'evidence stays writable'); assert.ok(d.web.volumes.some((v: string) => v.startsWith('caddy_data:/data')) && d.web.volumes.some((v: string) => v.startsWith('caddy_config:/config')), 'Caddy keeps its certificate storage');
  assert.deepEqual(d.web.ports, ['${HTTP_PORT:-80}:80', '${HTTPS_PORT:-443}:443']);
});
test('compose: the main file still demands every secret, and the staging overlay only renames the project and mounts the staging Caddyfile', () => {
  const c = rd('docker-compose.yml'); for (const k of ['MYSQL_ROOT_PASSWORD', 'MIGRATOR_DB_PASSWORD', 'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD', 'MFA_ENC_KEY', 'CSRF_KEY', 'DOMAIN']) assert.match(c, new RegExp('\\$\\{' + k + ':\\?'), k + ' must stay required');
  const st = rd('docker-compose.staging.yml'); assert.match(st, /name: isecurify-grc-staging/); assert.match(st, /Caddyfile\.staging:\/etc\/caddy\/Caddyfile:ro/); assert.ok(!/SMTP|ports:/.test(st.replace(/#.*$/gm, '')), 'the overlay must not touch mail or ports');
  const ex = rd('.env.staging.example'); assert.ok(!/^\s*SMTP_HOST=/m.test(ex) && !/^\s*WEBHOOK_ENC_KEY=/m.test(ex) && /^APP_ENV=staging/m.test(ex)); for (const f of ['.env.example', '.env.staging.example']) assert.ok(!/(PASSWORD|KEY)=\S/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\s*#.*$/gm, '')), f + ' must not contain a secret');
});
test('the staging Caddyfile is the production one plus a private certificate and noindex, nothing else', () => {
  const a = rd('web/Caddyfile').split('\n'), b = rd('web/Caddyfile.staging').split('\n'); const extra = b.filter(l => !a.includes(l)); assert.equal(extra.length, 2, extra.join('|')); assert.ok(extra.some(l => /tls internal/.test(l)) && extra.some(l => /X-Robots-Tag/.test(l))); assert.deepEqual(a.filter(l => !b.includes(l)), []);
});

// ---------- log shipping with a stand-in docker ----------
function logHost(opts: { gpg?: boolean; dockerFails?: boolean } = {}) {
  const r = path.join(tmp(), 'grc'); for (const f of ['lib.sh', 'offsite.sh', 'ship-logs.sh']) put(r, 'deploy/' + f, fs.readFileSync(path.join(DEPLOY, f), 'utf8'), 0o755); put(r, '.env', 'DOMAIN=x\n'); const bin = tmp(); const out = tmp();
  put(bin, 'docker', `#!/usr/bin/env bash\n[ "$1" = compose ] || exit 0\n${opts.dockerFails ? 'exit 1' : 'if [ "$2" = logs ]; then echo "2026-11-08T00:00:00Z ${@: -1} line one"; echo "2026-11-08T00:00:01Z ${@: -1} line two"; exit 0; fi'}\nexit 0\n`, 0o755);
  const env = (o: Record<string, string> = {}) => ({ PATH: `${bin}:${process.env.PATH}`, BACKUP_DIR: out, ...o }); return { r, out, run: (o: Record<string, string> = {}) => run('bash', [path.join(r, 'deploy/ship-logs.sh')], env(o), r) };
}
test('log bundles: one per service, checksummed, owner-only, readable', () => {
  const h = logHost(); const x = h.run({ LOG_STAMP: '20261108T000000Z' }); assert.equal(x.status, 0, x.stderr + x.stdout); const dir = path.join(h.out, 'logs'); const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['api-20261108T000000Z.log.gz', 'logsum-20261108T000000Z.sha256', 'mysql-20261108T000000Z.log.gz', 'web-20261108T000000Z.log.gz', 'worker-20261108T000000Z.log.gz']); assert.equal(fs.statSync(path.join(dir, 'api-20261108T000000Z.log.gz')).mode & 0o077, 0, 'owner only'); assert.equal(fs.statSync(dir).mode & 0o077, 0);
  assert.equal(run('sha256sum', ['-c', '--quiet', 'logsum-20261108T000000Z.sha256'], {}, dir).status, 0); assert.match(run('bash', ['-c', `gunzip -c ${dir}/worker-20261108T000000Z.log.gz`]).stdout, /worker line two/); assert.match(x.stdout, /log shipping is not configured/);
});
test('log bundles: copied off the server with rsync and verified; a bad target fails loudly but keeps the local bundles; old bundles are pruned', () => {
  const dest = tmp(); const h = logHost(); const ok = h.run({ LOG_STAMP: '20261108T010000Z', LOG_SHIP: 'rsync', LOG_SHIP_TARGET: dest }); if (/rsync is not installed/.test(ok.stdout)) return; assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /copied and verified with rsync/); assert.ok(fs.existsSync(path.join(dest, 'api-20261108T010000Z.log.gz')));
  const bad = h.run({ LOG_STAMP: '20261108T020000Z', LOG_SHIP: 'rsync', LOG_SHIP_TARGET: '/proc/definitely/not/writable' }); assert.notEqual(bad.status, 0); assert.ok(fs.existsSync(path.join(h.out, 'logs', 'api-20261108T020000Z.log.gz')), 'the local bundle survives a failed copy');
  const old = path.join(h.out, 'logs', 'api-OLD.log.gz'); fs.writeFileSync(old, 'x'); const past = new Date(Date.now() - 40 * 86400000); fs.utimesSync(old, past, past); h.run({ LOG_STAMP: '20261108T030000Z' }); assert.ok(!fs.existsSync(old), 'older than LOG_KEEP_DAYS is removed'); assert.ok(fs.existsSync(path.join(h.out, 'logs', 'api-20261108T030000Z.log.gz')));
  assert.equal(h.run({ LOG_KEEP_DAYS: 'soon' }).status, 2); assert.notEqual(h.run({ LOG_SHIP: 'carrier-pigeon', LOG_STAMP: '20261108T040000Z' }).status, 0);
});
test('log bundles: when docker cannot give any logs nothing is claimed', () => { const h = logHost({ dockerFails: true }); const x = h.run(); assert.notEqual(x.status, 0); assert.match(x.stdout, /no log bundles were written/); });
test('the nightly schedule includes the log job', () => { const x = run('bash', [path.join(DEPLOY, 'install-cron.sh'), '--dry-run']); assert.equal(x.status, 0); assert.match(x.stdout, /ship-logs\.sh/); assert.match(x.stdout, /backup\.sh/); });

// ---------- read-only self-check ----------
test('verify-readonly passes when the root filesystem refuses writes, and fails when it does not', () => {
  const mk = (writable: boolean) => { const r = path.join(tmp(), 'grc'); for (const f of ['lib.sh', 'verify-readonly.sh']) put(r, 'deploy/' + f, fs.readFileSync(path.join(DEPLOY, f), 'utf8'), 0o755); put(r, '.env', 'DOMAIN=x\n'); const bin = tmp();
    put(bin, 'docker', `#!/usr/bin/env bash\n[ "$1" = compose ] || exit 0\ncase "$*" in *"/etc/.rw-probe"*) ${writable ? 'exit 0' : 'exit 1'};; *) exit 0;; esac\n`, 0o755); return run('bash', [path.join(r, 'deploy/verify-readonly.sh')], { PATH: `${bin}:${process.env.PATH}` }, r); };
  const good = mk(false); assert.equal(good.status, 0, good.stdout); assert.match(good.stdout, /api filesystem is read-only/); const bad = mk(true); assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL: api can write to its own filesystem/);
});

// ---------- staging safety ----------
function stagingDir(env: string, withOverlay = true) { const r = path.join(tmp(), 'grc'); put(r, 'deploy/staging.sh', fs.readFileSync(path.join(DEPLOY, 'staging.sh'), 'utf8'), 0o755); put(r, 'docker-compose.yml', 'services: {}\n'); if (withOverlay) put(r, 'docker-compose.staging.yml', 'name: x\n'); put(r, '.env', env); const bin = tmp(); put(bin, 'docker', '#!/usr/bin/env bash\necho "$*" >> "$STUB_LOG"\nexit 0\n', 0o755); const log = path.join(bin, 'docker.log');
  return { r, log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''), sh: (...a: string[]) => run('bash', [path.join(r, 'deploy/staging.sh'), ...a], { PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log }, r) }; }
test('staging refuses to start unless it is clearly staging: APP_ENV, no SMTP, no webhook key, overlay present', () => {
  assert.equal(stagingDir('APP_ENV=staging\nDOMAIN=s.x\n').sh('check').status, 0); const no = stagingDir('DOMAIN=grc.x\n'); const a = no.sh('up'); assert.notEqual(a.status, 0); assert.match(a.stderr, /APP_ENV=staging is not set/); assert.equal(no.log(), '', 'docker is never called');
  assert.match(stagingDir('APP_ENV=staging\nSMTP_HOST=smtp.gmail.com\n').sh('check').stderr, /Staging must not send email/); assert.match(stagingDir('APP_ENV=staging\nWEBHOOK_ENC_KEY=abc\n').sh('check').stderr, /Webhooks must stay off/); assert.match(stagingDir('APP_ENV=staging\n', false).sh('check').stderr, /overlay|docker-compose\.staging\.yml/);
  assert.equal(stagingDir('APP_ENV=staging\nSMTP_HOST=\n').sh('check').status, 0, 'an empty SMTP_HOST is fine');
});
test('staging refresh refuses a damaged backup before touching anything', () => {
  const s = stagingDir('APP_ENV=staging\nDOMAIN=s.x\n'); const b = tmp(); fs.writeFileSync(path.join(b, 'db-2026-11-01-0200.sql.gz'), 'not what was backed up'); fs.writeFileSync(path.join(b, 'manifest-2026-11-01-0200.sha256'), '0'.repeat(64) + '  db-2026-11-01-0200.sql.gz\n');
  const x = s.sh('refresh', b); assert.equal(x.status, 5); assert.match(x.stderr, /checksum mismatch/); assert.equal(s.log(), '', 'no database was touched'); assert.equal(s.sh('refresh', tmp()).status, 4, 'no backup found');
});

// ---------- the scrub SQL against a real database ----------
test('scrub SQL: nobody keeps a real address, password, session, queued mail, API key or webhook; business data stays', async () => {
  const env = await freshEnv({ requireMfaForPlatform: false } as any); try { const w = await world(env); const q = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
    await q("INSERT INTO jobs(type,payload) VALUES ('email','{}')"); await q("INSERT INTO email_log(template,to_email,subject,status) VALUES ('invite','real.person@client.com','Hello','sent')");
    await q("INSERT INTO api_keys(tenant_id,id,name,prefix,key_hash,scopes,created_by) VALUES (?,UUID(),'k','abcd1234',?,'[]',?)", [w.A, 'a'.repeat(64), w.ids.aAdmin]); await q("INSERT INTO webhook_endpoints(tenant_id,id,name,url,secret_enc,events,created_by) VALUES (?,UUID(),'h','https://client.example/hook','enc','[]',?)", [w.A, w.ids.aAdmin]);
    const before = { orgs: (await q('SELECT COUNT(*) n FROM organizations'))[0].n, users: (await q('SELECT COUNT(*) n FROM users'))[0].n, sessions: (await q('SELECT COUNT(*) n FROM sessions'))[0].n }; assert.ok(before.sessions > 0);
    const trig = async () => JSON.stringify(await q("SELECT TRIGGER_NAME n, ACTION_STATEMENT s FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY 1")); const trigBefore = await trig();
    const sql = fs.readFileSync(path.join(DEPLOY, 'staging-scrub.sql'), 'utf8').replace(/^--.*$/gm, ''); for (const st of sql.split(';').map(s => s.trim()).filter(Boolean)) await q(st);
    assert.equal((await q("SELECT COUNT(*) n FROM users WHERE email NOT LIKE '%@staging.invalid'"))[0].n, 0); assert.equal((await q("SELECT COUNT(*) n FROM users WHERE password_hash <> '!scrubbed'"))[0].n, 0); assert.equal((await q('SELECT COUNT(DISTINCT email) n FROM users'))[0].n, before.users, 'scrubbed addresses stay unique');
    assert.equal((await q('SELECT COUNT(*) n FROM sessions'))[0].n, 0); assert.equal((await q('SELECT COUNT(*) n FROM jobs'))[0].n, 0); assert.equal((await q("SELECT COUNT(*) n FROM email_log WHERE to_email LIKE '%client.com'"))[0].n, 0); assert.equal((await q('SELECT COUNT(*) n FROM invitations'))[0].n, 0);
    assert.equal((await q('SELECT COUNT(*) n FROM api_keys WHERE revoked_at IS NULL'))[0].n, 0); const wh = (await q('SELECT active, url, secret_enc FROM webhook_endpoints'))[0]; assert.equal(wh.active, 0); assert.match(wh.url, /staging\.invalid/); assert.equal(wh.secret_enc, 'scrubbed');
    assert.equal(await trig(), trigBefore, 'every append-only trigger is back, unchanged'); await q("INSERT INTO audit_events(action,ip) VALUES ('probe','1.2.3.4')"); await q("INSERT INTO email_log(template,to_email,subject,status) VALUES ('probe','x@staging.invalid','s','sent')"); await assert.rejects(q('DELETE FROM audit_events'), /append-only/); await assert.rejects(q("UPDATE audit_events SET ip=NULL"), /append-only/); await assert.rejects(q("UPDATE email_log SET subject='x'"), /append-only/); await assert.rejects(q('DELETE FROM email_log'), /append-only/);
    assert.equal((await q("SELECT COUNT(*) n FROM audit_events WHERE ip IS NOT NULL AND action <> 'probe'"))[0].n, 0); assert.equal((await q('SELECT COUNT(*) n FROM organizations'))[0].n, before.orgs, 'business data is kept');
    const login = await env.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a-admin@x.test', password: 'whatever-it-was' } }); assert.ok([400, 401].includes(login.statusCode), 'nobody can sign in with an old password: ' + login.statusCode);
  } finally { await env.close(); }
});

// ---------- smoke test against a local server ----------
function site(over: { drop?: string; env?: string; ready?: number; me?: number; version?: string } = {}): Promise<{ url: string; close: () => void }> {
  const h: Record<string, string> = { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'" }; if (over.drop) delete h[over.drop];
  const s = http.createServer((req, res) => { if (req.url === '/api/ready') { res.writeHead(over.ready ?? 200); return res.end('{"ok":true}'); } if (req.url === '/api/me') { res.writeHead(over.me ?? 401); return res.end('{}'); } if (req.url === '/api/environment') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ environment: over.env ?? 'production', version: over.version ?? '11F' })); } res.writeHead(200, h); res.end('<html></html>'); });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() })));
}
const smoke = async (args: string[], over = {}) => { const s = await site(over); try { return await new Promise<{ status: number | null; out: string }>(r => { const p = require_spawn(path.join(DEPLOY, 'smoke.sh'), [s.url, ...args]); r(p); }); } finally { s.close(); } };
const require_spawn = (f: string, a: string[]) => new Promise<{ status: number | null; out: string }>(r => { const c = spawnAsync('bash', [f, ...a]); c.on('close', (code, out) => r({ status: code, out })); });
import { spawn } from 'node:child_process';
function spawnAsync(cmd: string, args: string[]) { const c = spawn(cmd, args, { env: { PATH: process.env.PATH! } }); let out = ''; c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (out += d)); const o = { on: (_e: string, f: (code: number | null, out: string) => void) => c.on('close', code => f(code, out)) }; return o; }
test('smoke test: a healthy site passes; a missing header, a failing database, a wrong environment or version each fail it', async () => {
  const ok = await smoke(['--expect-env', 'production', '--expect-version', '11F']); assert.equal(ok.status, 0, ok.out); assert.match(ok.out, /running version: 11F/);
  const hdr = await smoke([], { drop: 'content-security-policy' }); assert.equal(hdr.status, 1); assert.match(hdr.out, /FAIL: header content-security-policy is missing/);
  assert.equal((await smoke([], { ready: 503 })).status, 1); assert.equal((await smoke([], { me: 200 })).status, 1);
  const wrongEnv = await smoke(['--expect-env', 'staging']); assert.equal(wrongEnv.status, 1); assert.match(wrongEnv.out, /expected 'staging'/); assert.equal((await smoke(['--expect-version', '12A'])).status, 1);
  assert.equal(run('bash', [path.join(DEPLOY, 'smoke.sh'), 'ftp://x']).status, 2); assert.equal(run('bash', [path.join(DEPLOY, 'smoke.sh'), 'https://x;rm -rf /']).status, 2);
});
