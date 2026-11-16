import { test } from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const DEPLOY = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../deploy'); const sh = (script: string, env: Record<string, string> = {}) => spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH!, ...env }, encoding: 'utf8' });
const hasRsync = spawnSync('which', ['rsync']).status === 0;
test('every deploy script is valid shell', () => { for (const f of fs.readdirSync(DEPLOY).filter(f => f.endsWith('.sh'))) assert.equal(spawnSync('bash', ['-n', path.join(DEPLOY, f)]).status, 0, f); });
test('install-cron: nightly backup, weekly drill, health probe; as the chosen user; refuses odd user names; dry run writes nothing', () => {
  const out = execFileSync('bash', [path.join(DEPLOY, 'install-cron.sh'), '--dry-run', '--user', 'deploy'], { encoding: 'utf8' }); const lines = out.split('\n').filter(l => /^[\d*]/.test(l)); assert.equal(lines.length, 4);
  for (const l of lines) assert.match(l, /^(\S+\s+){5}deploy\s+\/.+\.sh /, l); assert.match(lines[0], /^15 2 \* \* \*\s+deploy.*backup\.sh/); assert.match(lines[1], /^45 2 \* \* \*\s+deploy.*ship-logs\.sh/); assert.match(lines[2], /^30 3 \* \* 0\s+deploy.*restore-drill\.sh/); assert.match(lines[3], /^\*\/10 \* \* \* \*\s+deploy.*monitor\.sh/);
  assert.notEqual(spawnSync('bash', [path.join(DEPLOY, 'install-cron.sh'), '--dry-run', '--user', 'x; rm -rf /']).status, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-')); const f = path.join(dir, 'isecurify'); assert.equal(spawnSync('bash', [path.join(DEPLOY, 'install-cron.sh')], { env: { PATH: process.env.PATH!, CRON_FILE: f, LOG_DIR: dir } }).status, 0); assert.match(fs.readFileSync(f, 'utf8'), /backup\.sh/);
});
test('offsite: none by default, command mode kept for older setups, bad values refused', () => {
  const run = (env: Record<string, string>) => sh('. "$D/offsite.sh"; offsite_mode; echo; offsite_push /tmp S1; echo "rc=$?"', { D: DEPLOY, ...env });
  let r = run({}); assert.match(r.stdout, /^none\n/); assert.match(r.stdout, /not configured\nrc=0/); r = run({ BACKUP_PUSH_CMD: 'true' }); assert.match(r.stdout, /^command\n/); assert.match(r.stdout, /not verified/);
  r = run({ BACKUP_OFFSITE: 'ftp' }); assert.match(r.stdout, /must be none, rclone, rsync or command\nrc=1/); r = run({ BACKUP_OFFSITE: 'rsync' }); assert.match(r.stdout, /BACKUP_OFFSITE_TARGET is not set\nrc=1/); r = run({ BACKUP_OFFSITE: 'rclone' }); assert.match(r.stdout, /not set\nrc=1/);
  r = run({ BACKUP_OFFSITE: 'command', BACKUP_PUSH_CMD: 'exit 3' }); assert.match(r.stdout, /copy command failed\nrc=1/);
});
test('offsite via rsync: copies only that backup, verifies it, and notices a changed target', { skip: !hasRsync }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'off-')); const out = path.join(d, 'out'), dest = path.join(d, 'dest'); fs.mkdirSync(out); fs.mkdirSync(dest);
  for (const f of ['db-S1.sql.gz', 'evidence-S1.tar.gz', 'manifest-S1.sha256', 'db-S0.sql.gz', 'manifest-S0.sha256']) fs.writeFileSync(path.join(out, f), f + ' data');
  const push = () => sh('. "$D/offsite.sh"; offsite_push "$O" S1; echo "rc=$?"', { D: DEPLOY, O: out, BACKUP_OFFSITE: 'rsync', BACKUP_OFFSITE_TARGET: dest });
  const r = push(); assert.match(r.stdout, /copied and verified with rsync\nrc=0/); assert.deepEqual(fs.readdirSync(dest).sort(), ['db-S1.sql.gz', 'evidence-S1.tar.gz', 'manifest-S1.sha256']);
  fs.writeFileSync(path.join(dest, 'db-S1.sql.gz'), 'tampered'); const r2 = push(); assert.match(r2.stdout, /rc=0/); assert.equal(fs.readFileSync(path.join(dest, 'db-S1.sql.gz'), 'utf8'), 'db-S1.sql.gz data', 'a changed copy is replaced and re-verified');
  assert.match(sh('. "$D/offsite.sh"; offsite_push "$O" S1; echo "rc=$?"', { D: DEPLOY, O: out, BACKUP_OFFSITE: 'rsync', BACKUP_OFFSITE_TARGET: '/proc/nonexistent/x' }).stdout, /rsync copy failed\nrc=1/);
});
test('backup.sh: local backup is recorded first, the off-server copy has its own result and exit code; monitor checks it', () => {
  const b = fs.readFileSync(path.join(DEPLOY, 'backup.sh'), 'utf8'); assert.match(b, /offsite\.sh/); assert.match(b, /record offsite 1/); assert.match(b, /record offsite 0/); assert.match(b, /exit 10/); assert.ok(b.indexOf('record backup 1') < b.indexOf('offsite_push'));
  const m = fs.readFileSync(path.join(DEPLOY, 'monitor.sh'), 'utf8'); assert.match(m, /kind=\\"offsite\\"/); assert.match(m, /off-server copy/);
});
