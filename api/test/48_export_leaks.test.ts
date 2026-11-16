// Threat model: data leaving the system. Exports must contain only the caller's own organization, respect roles, neutralise spreadsheet formulas and never be cached.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world } from './helpers'; import { listRoutes, withIds } from './routes_util';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let aAdmin: any, bAdmin: any, vendor: any, staff: any, anon: any;
const MARK = 'ZZ-ORG-B-SECRET-MARKER'; const FORMULA = '=HYPERLINK("http://evil.test","x")'; const rows = async (sql: string, p: any[] = []) => ((await env.pool.query(sql, p)) as any)[0] as any[];
const EXPORTS = ['risks/export', 'incidents/export', 'policies/export', 'vendors/export', 'findings-export'];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); anon = env.client();
  const mk = async (c: any, t: string, tag: string) => {
    assert.equal((await c.call('POST', `/t/${t}/risks`, { title: `${tag} risk`, description: 'd', category: 'security', likelihood: 2, impact: 2 })).status, 201);
    assert.equal((await c.call('POST', `/t/${t}/incidents`, { title: `${tag} incident`, description: 'd', category: 'malware', severity: 'low' })).status, 201);
    assert.equal((await c.call('POST', `/t/${t}/policies`, { title: `${tag} policy`, category: 'security', body: 'b' })).status, 201);
    assert.equal((await c.call('POST', `/t/${t}/vendors`, { name: `${tag} vendor`, service: 's', category: 'cloud', criticality: 'low', dataAccess: 'none' })).status, 201);
  };
  await mk(bAdmin, w.B, MARK); await mk(aAdmin, w.A, FORMULA);
}); after(() => env.close());

test('each export holds only the caller\'s organization; the other organization sees its own data in its own export', async () => {
  for (const p of EXPORTS) {
    const a = await aAdmin.call('GET', `/t/${w.A}/${p}`); assert.equal(a.status, 200, p); assert.equal(a.raw.includes(MARK), false, `${p}: no data from the other organization`);
    const b = await bAdmin.call('GET', `/t/${w.B}/${p}`); assert.equal(b.status, 200, p); if (p !== 'findings-export') assert.equal(b.raw.includes(MARK), true, `${p}: own data present`);
  }
});
test('nobody can export another organization by id, whatever their role', async () => {
  for (const p of EXPORTS) { for (const c of [aAdmin, vendor, staff]) assert.equal((await c.call('GET', `/t/${w.B}/${p}`)).status, 404, p); assert.equal((await bAdmin.call('GET', `/t/${w.A}/${p}`)).status, 404, p); assert.equal((await anon.call('GET', `/t/${w.A}/${p}`)).status, 401, p); }
});
test('vendors cannot export registers they may not see', async () => { for (const p of ['risks/export', 'vendors/export', 'policies/export', 'incidents/export']) { const r = await vendor.call('GET', `/t/${w.A}/${p}`); assert.ok([403, 200].includes(r.status), `${p} ${r.status}`); if (r.status === 200) assert.equal(String(r.raw).includes(MARK), false); } assert.equal((await vendor.call('GET', `/t/${w.A}/risks/export`)).status, 403); assert.equal((await vendor.call('GET', `/t/${w.A}/vendors/export`)).status, 403); });
test('spreadsheet formulas in user text are neutralised in CSV', async () => {
  for (const p of ['risks/export', 'incidents/export', 'policies/export', 'vendors/export']) { const r = await aAdmin.call('GET', `/t/${w.A}/${p}`); assert.equal(r.status, 200); const body = String(r.raw).replace(/^﻿/, ''); assert.ok(body.includes('HYPERLINK'), `${p} has the title`); for (const line of body.split(/\r?\n/)) for (const cell of line.split(',')) assert.equal(/^"?[=+@]/.test(cell) || /^"?-[A-Za-z(]/.test(cell), false, `${p}: unneutralised cell ${cell}`); }
});
test('exports are downloads, never cached, never sniffed, with a safe filename', async () => {
  for (const p of EXPORTS) { const r = await aAdmin.call('GET', `/t/${w.A}/${p}`); const h = r.headers; assert.match(String(h['cache-control']), /no-store/, p); assert.equal(h['x-content-type-options'], 'nosniff', p); const d = String(h['content-disposition']); assert.match(d, /^attachment/, p); assert.match(d.replace(/filename\*=.*$/, ''), /filename="[A-Za-z0-9._-]+"/, p); }
});
test('every route that returns a file refuses anonymous callers and other organizations\' administrators', async () => {
  const FILE = listRoutes(env.app).filter(r => /export|download|\/pdf|backup|template/.test(r.path) && !r.path.startsWith('/public') && !/verify$/.test(r.path)); assert.ok(FILE.length >= 8, String(FILE.length));
  for (const r of FILE) { const path = withIds(r.path, w.A); const u = await anon.call(r.method, path, r.method === 'GET' ? undefined : {}); assert.ok([401, 404].includes(u.status), `anon ${r.method} ${r.path} ${u.status}`); if (r.path.startsWith('/t/')) { const x = await bAdmin.call(r.method, path, r.method === 'GET' ? undefined : {}); assert.ok([403, 404].includes(x.status) , `other org ${r.method} ${r.path} ${x.status}`); } }
});
test('platform-only downloads (account backup, platform exports) are closed to organization users', async () => {
  for (const r of listRoutes(env.app).filter(r => r.path.startsWith('/platform/') && /backup|export|download/.test(r.path))) for (const c of [aAdmin, vendor]) { const x = await c.call(r.method, withIds(r.path, w.A), r.method === 'GET' ? undefined : {}); assert.ok([403, 404].includes(x.status), `${r.method} ${r.path} ${x.status}`); }
});
test('a lookup of a certificate by code gives nothing beyond what is meant to be public, and an unknown code is a plain 404', async () => {
  const r = await anon.call('GET', '/public/certificates/NOPE-0000'); assert.equal(r.status, 404); assert.equal(String(r.raw).includes(MARK), false); assert.doesNotMatch(String(r.raw), /tenant_id|password|email/i);
});
test('error responses on download routes do not echo stack traces or SQL', async () => {
  for (const p of ['risks/export?format=%27%3B--', 'findings-export?format=../../etc/passwd', 'vendors/export?status[]=x']) { const r = await aAdmin.call('GET', `/t/${w.A}/${p}`); assert.ok(r.status < 500, `${p} ${r.status}`); assert.doesNotMatch(String(r.raw), /ER_[A-Z_]{3,}|at \S+ \(|node_modules|SELECT |sqlMessage/); }
});
