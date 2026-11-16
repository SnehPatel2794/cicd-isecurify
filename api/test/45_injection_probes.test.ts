// Threat model: injection. Every GET route is sent every query-string name the code reads, filled with SQL, template and control-character payloads, signed in and signed out, and with the payloads in path parameters.
// Passing means: never a server error, never a database message or stack trace in the answer, no delay from an injected SLEEP, and no table or row count changes afterwards.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { listRoutes, withIds, queryKeys } from './routes_util';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let root: any, aAdmin: any, team: any, vendor: any, ROUTES: { method: string; path: string }[], KEYS: string[];
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src'); const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
const PAYLOADS = ["' OR '1'='1", "1; DROP TABLE users; --", "' UNION SELECT password_hash,2,3 FROM users -- ", "1' AND SLEEP(4) AND '1'='1", "\\", '"`${7*7}{{7*7}}', '%00%27', '%', '_', '../../etc/passwd'];
const LEAK_I = /(sql syntax|mysql|mariadb|sqlstate|stack trace|at \S+\.ts|node_modules|password_hash|\$argon|scrypt\$)/i, LEAK_CS = /\bER_[A-Z_]{3,}\b/; const LEAK = { test: (t: string) => LEAK_I.test(t) || LEAK_CS.test(t) };
const counts = async () => { const q = async (s: string) => ((await env.pool.query(s)) as any)[0]; return JSON.stringify([await q('SELECT COUNT(*) n FROM users'), await q('SELECT COUNT(*) n FROM organizations'), await q('SELECT COUNT(*) n FROM sessions'), await q('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE()')]); };
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root); root = w.root; aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor');
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); await aAdmin.call('POST', `/t/${w.A}/engagements`, { name: 'Probe', primaryReleaseId: fx.X.releaseId });
  ROUTES = listRoutes(env.app); KEYS = queryKeys(walk(src).map(f => ({ text: fs.readFileSync(f, 'utf8') })));
}); after(() => env.close());

test('the route list and key list are real (so the probes below actually run)', () => { const gets = ROUTES.filter(r => r.method === 'GET'); assert.ok(gets.length >= 100, `found ${gets.length} GET routes`); assert.ok(ROUTES.filter(r => r.method !== 'GET').length >= 100); const want = ['q', 'status', 'engagementId', 'frameworkId', 'ownerId', 'from', 'to', 'limit', 'page']; assert.ok(KEYS.length >= 60 && want.every(k => KEYS.includes(k)), `missing: ${want.filter(k => !KEYS.includes(k))} of ${KEYS.length}`);
  assert.ok(gets.some(r => r.path === '/t/:tenantId/search') && gets.some(r => r.path === '/auth/password/reset-request') === false); });
const probe = async (client: any, label: string, who: string) => {
  const before = await counts(); let n = 0; const chunks: string[][] = []; for (let i = 0; i < KEYS.length; i += 40) chunks.push(KEYS.slice(i, i + 40));
  for (const r of ROUTES.filter(x => x.method === 'GET')) { const base = withIds(r.path, w.A); const isT = r.path.startsWith('/t/'); if (who === 'tenant' && !isT) continue; if (who === 'platform' && isT) continue;
    for (const [pi, p] of PAYLOADS.entries()) for (const ch of (pi % 3 === 0 ? chunks : [chunks[pi % chunks.length]])) {
      const qs = ch.map(k => `${k}=${encodeURIComponent(p)}`).join('&'); const t0 = Date.now(); const res = await client.call('GET', `${base}?${qs}`); n++;
      assert.ok(res.status < 500, `${label} ${r.path} -> ${res.status} for ${p}`); assert.ok(Date.now() - t0 < 3500, `${label} ${r.path} was slow for ${p}`); const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body); assert.equal(LEAK.test(text), false, `${label} ${r.path}: ${text.slice(0, 200)}`); } }
  assert.equal(await counts(), before, `${label}: nothing changed`); return n;
};
test('signed out: every GET route refuses or ignores injected query strings', async () => { assert.ok(await probe(env.client(), 'anon', 'all') > 500); });
test('client admin: tenant routes', async () => { assert.ok(await probe(aAdmin, 'admin', 'tenant') > 500); });
test('vendor: tenant routes', async () => { assert.ok(await probe(vendor, 'vendor', 'tenant') > 300); });
test('iSecurify staff: tenant routes', async () => { assert.ok(await probe(team, 'staff', 'tenant') > 500); });
test('platform administrator: platform routes', async () => { assert.ok(await probe(root, 'root', 'platform') > 100); });
test('payloads in path parameters on every route (all methods) never cause a server error', async () => {
  const c = aAdmin; for (const r of ROUTES) { for (const p of ["' OR 1=1 --", '%27%3B%20DROP%20TABLE%20users%3B--', '../../..', 'x'.repeat(300)]) { const url = r.path.replace(':tenantId', w.A).replace(/:[A-Za-z]+/g, encodeURIComponent(p)); const res = await c.call(r.method, url, r.method === 'GET' ? undefined : {}); assert.ok(res.status < 500, `${r.method} ${r.path} -> ${res.status} for ${p.slice(0, 20)}`); } }
});
test('free-text filters are parameters: an injection string behaves exactly like any other text that matches nothing', async () => {
  for (const u of ['/search?q=', '/items?q=', '/timeline?status=']) { const a = (await aAdmin.call('GET', `/t/${w.A}${u}${encodeURIComponent("' OR '1'='1")}`)); const b = (await aAdmin.call('GET', `/t/${w.A}${u}${encodeURIComponent('zzqq nothing')}`)); assert.equal(a.status, b.status, u); if (a.status === 200) assert.deepEqual(a.body.groups ?? a.body.items?.length ?? a.body.total, b.body.groups ?? b.body.items?.length ?? b.body.total, u); }
});
test('JSON bodies: injection in the login fields is just a wrong password', async () => { const c = env.client(); for (const email of ["admin@x.test' OR '1'='1", "' OR 1=1 --@x.test"]) { const r = await c.call('POST', '/auth/login', { email, password: "' OR '1'='1" }); assert.ok([400, 401].includes(r.status), String(r.status)); } assert.equal((await c.call('POST', '/auth/login', { email: { $ne: null }, password: { $ne: null } })).status, 400); });
test('static check: request data is never pasted into SQL text', () => {
  const bad: string[] = []; for (const f of walk(src)) { const t = fs.readFileSync(f, 'utf8'); for (const line of t.split('\n')) { if (/p\.push\(|params\.push\(|likeOf\(/.test(line)) continue; for (const m of line.matchAll(/\$\{[^}]*\b(req\.(query|params|body)|\bp\.q\b|\bf\.q\b)[^}]*\}/g)) bad.push(`${path.relative(src, f)}: ${m[0]}`); } }
  assert.deepEqual(bad, [], 'a request value is interpolated into a template string; use a ? placeholder');
});
