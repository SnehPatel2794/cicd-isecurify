// Guards for two faults only a real image build shows: a file importing something the Docker image does not contain, and a Caddyfile Caddy cannot read.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
import { reminderStage as apiStage } from '../src/modules/vapt/rules'; import { reminderStage as workerStage } from '../../worker/src/vaptRules';
const ROOT = path.resolve(import.meta.dirname, '../..');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === 'dist' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
const exists = (p: string) => ['', '.ts', '.tsx', '.js', '/index.ts'].some(x => fs.existsSync(p + x) && fs.statSync(p + x).isFile());
/** Imports in non-test source that leave the folders a Docker image contains. api image: api/ + shared/ + migrations/. worker image: worker/ + shared/. */
function escapes(dir: 'api' | 'worker') {
  const allowed = dir === 'api' ? ['api', 'shared', 'migrations'] : ['worker', 'shared']; const bad: string[] = [];
  for (const f of walk(path.join(ROOT, dir, 'src'))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:import|export)[^'"`;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2]; const target = path.resolve(path.dirname(f), spec); const top = path.relative(ROOT, target).split(path.sep)[0];
    if (!allowed.includes(top)) bad.push(`${path.relative(ROOT, f)} imports ${spec}`); else if (!exists(target)) bad.push(`${path.relative(ROOT, f)} imports ${spec} which does not exist`); }
  return bad;
}
test('the worker image only contains worker/ and shared/: no source file imports from anywhere else', () => { assert.deepEqual(escapes('worker'), []); });
test('the api image only contains api/, shared/ and migrations/: no source file imports from anywhere else', () => { assert.deepEqual(escapes('api'), []); });
test('the worker copy of the VAPT reminder rule gives the same answer as the api rule on every day around a planned date', () => {
  for (let n = -12; n <= 14; n++) { const planned = new Date(Date.UTC(2026, 10, 20 + n)).toISOString().slice(0, 10); assert.equal(workerStage(planned, '2026-11-20'), apiStage(planned, '2026-11-20'), planned); }
});
test('Caddyfiles have no one-line { ... } blocks (Caddy rejects them) and balanced braces', () => {
  for (const f of ['web/Caddyfile', 'web/Caddyfile.staging']) { const txt = fs.readFileSync(path.join(ROOT, f), 'utf8'); let depth = 0;
    txt.split('\n').forEach((line, i) => { const l = line.replace(/\{\$[A-Z_]+\}/g, '').replace(/"[^"]*"/g, '""').replace(/\{path\}/g, '').trim(); assert.ok(!/\{[^}]+\}/.test(l.replace(/^\{$/, '')), `${f}:${i + 1} has a block on one line: ${line.trim()}`); depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length; assert.ok(depth >= 0, `${f}:${i + 1} closes too many`); });
    assert.equal(depth, 0, `${f} has unbalanced braces`); }
});
