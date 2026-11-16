// Patch tooling: build a patch between two releases and apply it on a "server", with a stand-in for docker.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const DEPLOY = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../deploy'); const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'patch-'));
const run = (cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH!, ...env } });
const put = (root: string, rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const COMPOSE = (extra = '') => `services:\n  api:\n    environment:\n      MFA_ENC_KEY: \${MFA_ENC_KEY:?set in .env}\n${extra}`;
function release(version: string, tweak: (r: string) => void = () => {}) {
  const r = path.join(tmp(), 'grc'); put(r, 'api/src/a.ts', 'a1'); put(r, 'api/src/gone.ts', 'old'); put(r, 'web/src/w.tsx', 'w1'); put(r, 'migrations/001.sql', 'select 1;'); put(r, 'docs/README.md', 'd1'); put(r, 'docker-compose.yml', COMPOSE()); put(r, '.env.example', 'MFA_ENC_KEY=\n');
  for (const f of ['apply-patch.sh', 'make-patch.sh', 'make-manifest.sh']) { fs.mkdirSync(path.join(r, 'deploy'), { recursive: true }); fs.copyFileSync(path.join(DEPLOY, f), path.join(r, 'deploy', f)); }
  put(r, 'deploy/backup.sh', '#!/usr/bin/env bash\necho "backup at version $(cat VERSION)" >> "$BACKUP_MARK"\n[ -z "${BACKUP_FAIL:-}" ]\n'); fs.chmodSync(path.join(r, 'deploy/backup.sh'), 0o755);
  tweak(r); put(r, 'node_modules/x/index.js', 'ignored'); put(r, '.env', 'SECRET=never'); assert.equal(run('bash', [path.join(DEPLOY, 'make-manifest.sh'), r, version]).status, 0); return r;
}
const V1 = () => release('1.0'); const V2 = (extra: (r: string) => void = () => {}) => release('2.0', r => { put(r, 'api/src/a.ts', 'a2'); put(r, 'api/src/new.ts', 'n'); fs.rmSync(path.join(r, 'api/src/gone.ts')); put(r, 'migrations/002.sql', 'select 2;'); put(r, '.env.example', 'MFA_ENC_KEY=\nWEBHOOK_ENC_KEY=\nNEEDED_KEY=\n'); put(r, 'docker-compose.yml', COMPOSE('      NEEDED_KEY: ${NEEDED_KEY:?set in .env}\n      WEBHOOK_ENC_KEY: ${WEBHOOK_ENC_KEY:-}\n')); put(r, 'deploy/apply-patch.sh', fs.readFileSync(path.join(DEPLOY, 'apply-patch.sh'), 'utf8') + '\n# 2.0 touch\n'); extra(r); });
const mkPatch = (a: string, b: string) => { const out = tmp(); const r = run('bash', [path.join(DEPLOY, 'make-patch.sh'), a, b, out]); assert.equal(r.status, 0, r.stderr + r.stdout); return path.join(out, fs.readdirSync(out)[0]); };
function server(src: string) { const s = path.join(tmp(), 'grc'); fs.cpSync(src, s, { recursive: true }); put(s, '.env', 'MFA_ENC_KEY=abc\n'); const bin = tmp(); const log = path.join(bin, 'docker.log');
  put(bin, 'docker', '#!/usr/bin/env bash\n[ "$1" = compose ] || exit 0; shift; echo "$*" >> "$STUB_LOG"\nif [ "$1" = exec ]; then [ "$(cat VERSION)" = "$STUB_OK_VERSION" ]; exit $?; fi\nexit 0\n'); fs.chmodSync(path.join(bin, 'docker'), 0o755);
  const mark = path.join(bin, 'backup.mark'); const env = (o: Record<string, string> = {}) => ({ PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_OK_VERSION: '2.0', BACKUP_MARK: mark, PATCH_WAIT_TRIES: '2', PATCH_WAIT_SLEEP: '0', ...o });
  return { dir: s, log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''), mark: () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : ''), apply: (patch: string, args: string[] = [], o: Record<string, string> = {}) => run('bash', [path.join(s, 'deploy/apply-patch.sh'), patch, ...args], env(o), s), rollback: (o: Record<string, string> = {}) => run('bash', [path.join(s, 'deploy/apply-patch.sh'), '--rollback'], env(o), s),
    verify: () => run('sha256sum', ['-c', '--quiet', 'MANIFEST.sha256'], {}, s).status === 0, version: () => fs.readFileSync(path.join(s, 'VERSION'), 'utf8').trim() }; }
const rd = (r: string, f: string) => fs.readFileSync(path.join(r, f), 'utf8');

test('every patch script is valid shell', () => { for (const f of ['make-manifest.sh', 'make-patch.sh', 'apply-patch.sh']) assert.equal(run('bash', ['-n', path.join(DEPLOY, f)]).status, 0, f); });
test('manifest: lists project files only (no secrets, dependencies or builds) and refuses odd file names', () => {
  const r = V1(); const m = rd(r, 'MANIFEST.sha256'); assert.ok(m.includes('api/src/a.ts')); for (const bad of ['.env', 'node_modules', 'MANIFEST.sha256']) assert.equal(m.split('\n').some(l => l.endsWith('  ' + bad) || l.includes(bad + '/')), false, bad); assert.equal(rd(r, 'VERSION').trim(), '1.0');
  put(r, 'docs/has space.md', 'x'); const bad = run('bash', [path.join(DEPLOY, 'make-manifest.sh'), r]); assert.notEqual(bad.status, 0);
});
test('make-patch: carries only what changed, says what must be rebuilt, and which new settings are needed', () => {
  const p = mkPatch(V1(), V2()); const x = tmp(); assert.equal(run('tar', ['-xzf', p, '-C', x]).status, 0); const meta = rd(x, 'PATCH.meta'); const plan = rd(x, 'plan.txt').trim().split('\n').map(l => l.split(' '));
  assert.match(meta, /FROM_VERSION=1\.0/); assert.match(meta, /TO_VERSION=2\.0/); assert.match(meta, /REBUILD=init api worker/); assert.match(meta, /MIGRATIONS=yes/); assert.match(meta, /COMPOSE_CHANGED=yes/); assert.match(meta, /NEW_ENV=NEEDED_KEY WEBHOOK_ENC_KEY/);
  const ops = Object.fromEntries(plan.map(l => [l[3], l[0]])); assert.equal(ops['api/src/a.ts'], 'M'); assert.equal(ops['api/src/new.ts'], 'A'); assert.equal(ops['api/src/gone.ts'], 'D'); assert.equal(ops['migrations/002.sql'], 'A'); assert.equal(ops['web/src/w.tsx'], undefined, 'unchanged files are not shipped'); assert.equal(fs.existsSync(path.join(x, 'files/web/src/w.tsx')), false); assert.equal(fs.existsSync(path.join(x, 'files/api/src/gone.ts')), false);
  assert.equal(run('bash', [path.join(DEPLOY, 'make-patch.sh'), V1(), V1(), tmp()]).status !== 0, true, 'identical releases refused');
});
test('dry run: shows the plan and changes nothing', () => { const s = server(V1()); const p = mkPatch(s.dir, V2()); const r = s.apply(p, ['--dry-run'], {}); assert.equal(r.status, 1, 'stops on the missing required setting first: ' + r.stdout + r.stderr); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); const d = s.apply(p, ['--dry-run']); assert.equal(d.status, 0, d.stdout + d.stderr); assert.match(d.stdout, /dry run: nothing changed/); assert.equal(s.version(), '1.0'); assert.equal(s.log(), ''); assert.equal(s.mark(), ''); });
test('apply: backup first, only what changed is rebuilt, files match the new release exactly, .env untouched, old files kept for rollback', () => {
  const s = server(V1()); const newRel = V2(); const p = mkPatch(s.dir, newRel); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); const r = s.apply(p); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(s.version(), '2.0'); assert.equal(s.verify(), true, 'every file equals the new release');
  assert.equal(s.mark().trim(), 'backup at version 1.0', 'the backup ran before anything was replaced'); assert.match(s.log(), /build init api worker\n/); assert.doesNotMatch(s.log(), /build.*web/, 'web did not change'); assert.match(s.log(), /up -d/); assert.equal(rd(s.dir, '.env'), 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); assert.equal(fs.existsSync(path.join(s.dir, 'api/src/gone.ts')), false); assert.equal(rd(s.dir, 'api/src/new.ts'), 'n'); assert.equal(fs.existsSync(path.join(s.dir, '.patches/2.0/rollback/files/api/src/a.ts')), true);
  assert.equal(fs.existsSync(path.join(s.dir, 'api/src/a.ts.patchtmp')), false); assert.match(rd(s.dir, '.patches/history.log'), /patched to 2\.0: the app is ready/); assert.match(rd(s.dir, 'deploy/apply-patch.sh'), /2\.0 touch/, 'the applier updated itself safely');
});
test('refuses: wrong installed version, a damaged patch, files edited on the server, a missing required setting, a failed backup. Nothing is changed in any case', () => {
  const s = server(V1()); const p = mkPatch(s.dir, V2()); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); const untouched = () => { assert.equal(s.version(), '1.0'); assert.equal(s.verify(), true); assert.equal(s.log(), ''); };
  fs.writeFileSync(path.join(s.dir, 'VERSION'), '0.9\n'); let r = s.apply(p); assert.notEqual(r.status, 0); assert.match(r.stdout, /patch is for version 1\.0 but 0\.9/); fs.writeFileSync(path.join(s.dir, 'VERSION'), '1.0\n');
  const x = tmp(); run('tar', ['-xzf', p, '-C', x]); fs.appendFileSync(path.join(x, 'files/api/src/a.ts'), 'tampered'); const bad = path.join(tmp(), 'bad.tar.gz'); run('tar', ['-C', x, '-czf', bad, '.']); r = s.apply(bad); assert.notEqual(r.status, 0); assert.match(r.stdout, /damaged patch: api\/src\/a\.ts/); untouched();
  fs.appendFileSync(path.join(s.dir, 'api/src/a.ts'), ' // hotfix by hand'); r = s.apply(p); assert.notEqual(r.status, 0); assert.match(r.stdout, /locally changed or missing: api\/src\/a\.ts/); fs.writeFileSync(path.join(s.dir, 'api/src/a.ts'), 'a1'); assert.equal(s.verify(), true);
  put(s.dir, '.env', 'MFA_ENC_KEY=abc\n'); r = s.apply(p); assert.notEqual(r.status, 0); assert.match(r.stdout, /add NEEDED_KEY to \.env first/); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); untouched();
  r = s.apply(p, [], { BACKUP_FAIL: '1' }); assert.notEqual(r.status, 0); assert.match(r.stdout, /the backup failed, so nothing was changed/); assert.equal(s.version(), '1.0'); assert.equal(s.verify(), true);
});
test('--force overwrites local edits (and keeps the old copy for rollback)', () => {
  const s = server(V1()); const p = mkPatch(s.dir, V2()); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); fs.writeFileSync(path.join(s.dir, 'api/src/a.ts'), 'edited on server'); const r = s.apply(p, ['--force']); assert.equal(r.status, 0, r.stdout); assert.equal(rd(s.dir, 'api/src/a.ts'), 'a2'); assert.equal(rd(s.dir, '.patches/2.0/rollback/files/api/src/a.ts'), 'edited on server');
});
test('if the app does not come up, the old version is put back by itself, byte for byte, and rebuilt', () => {
  const s = server(V1()); const p = mkPatch(s.dir, V2()); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); const r = s.apply(p, [], { STUB_OK_VERSION: '1.0' }); assert.notEqual(r.status, 0); assert.match(r.stdout, /did not become ready: putting version 1\.0 back/); assert.match(r.stdout, /rolled back to 1\.0 and it is running again/);
  assert.equal(s.version(), '1.0'); assert.equal(s.verify(), true); assert.equal(fs.existsSync(path.join(s.dir, 'api/src/new.ts')), false); assert.equal(rd(s.dir, 'api/src/gone.ts'), 'old'); assert.equal((s.log().match(/build init api worker/g) ?? []).length, 2, 'rebuilt for the new version and again for the old');
  assert.equal(fs.existsSync(path.join(s.dir, '.patches/last')), false, 'nothing left to roll back');
});
test('--rollback undoes a patch that was applied fine; a second rollback has nothing to do', () => {
  const s = server(V1()); const p = mkPatch(s.dir, V2()); put(s.dir, '.env', 'MFA_ENC_KEY=abc\nNEEDED_KEY=1\n'); assert.equal(s.apply(p).status, 0); assert.equal(s.version(), '2.0'); const r = s.rollback({ STUB_OK_VERSION: '1.0' }); assert.equal(r.status, 0, r.stdout); assert.equal(s.version(), '1.0'); assert.equal(s.verify(), true); assert.equal(rd(s.dir, 'api/src/gone.ts'), 'old'); assert.notEqual(s.rollback().status, 0);
});
test('a documentation-only patch changes files but restarts nothing', () => {
  const s = server(V1()); const p = mkPatch(s.dir, release('1.1', r => { put(r, 'docs/README.md', 'd2'); })); const r = s.apply(p, ['--skip-backup'], { STUB_OK_VERSION: '1.1' }); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /documentation-only patch/); assert.equal(rd(s.dir, 'docs/README.md'), 'd2'); assert.equal(s.version(), '1.1'); assert.equal(s.log(), ''); assert.equal(s.mark(), '', 'backup was skipped as asked');
});
test('a web-only patch rebuilds only the web image', () => {
  const s = server(V1()); const p = mkPatch(s.dir, release('1.2', r => { put(r, 'web/src/w.tsx', 'w2'); })); const r = s.apply(p, ['--skip-backup'], { STUB_OK_VERSION: '1.2' }); assert.equal(r.status, 0, r.stdout); assert.match(s.log(), /build web\n/); assert.doesNotMatch(s.log(), /build.*(api|worker|init)/);
});
