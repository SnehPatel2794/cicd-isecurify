import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let rels: string[]; let team: any;
const N = 3000; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); team = await env.login('team@x.test'); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true });
  // two large frameworks inserted directly for speed (the API path is covered elsewhere): 3,000 controls each, every 3rd mapped to a shared common control pool of 500
  const cc: string[] = []; for (let i = 0; i < 500; i++) { const id = crypto.randomUUID(); cc.push(id); }
  await env.pool.query('INSERT INTO common_controls(id,title,created_by) VALUES ?', [cc.map((id, i) => [id, 'Common ' + i, w.ids.root])]); rels = [];
  for (const fw of ['Big A', 'Big B']) {
    const fid = crypto.randomUUID(), rid = crypto.randomUUID(); await env.pool.query('INSERT INTO frameworks(id,name,created_by) VALUES (?,?,?)', [fid, fw, w.ids.root]); await env.pool.query('INSERT INTO framework_releases(id,framework_id,version) VALUES (?,?,1)', [rid, fid]);
    const ctl = Array.from({ length: N }, (_, i) => [crypto.randomUUID(), rid, `${fw[4]}-${i}`, `Domain ${i % 40}`, `Requirement ${i} of ${fw}`, i + 1]); for (let i = 0; i < N; i += 500) await env.pool.query('INSERT INTO framework_controls(id,release_id,ref,domain,title,sort_order) VALUES ?', [ctl.slice(i, i + 500)]);
    await env.pool.query('INSERT INTO control_mappings(control_id,common_control_id,mapped_by) VALUES ?', [ctl.filter((_, i) => i % 6 === 0).map((c, k) => [c[0], cc[k % 500], w.ids.root])]); await env.pool.query("UPDATE framework_releases SET status='published', published_at=NOW(3) WHERE id=?", [rid]); rels.push(rid);
  }
}); after(() => env.close());

test(`two ${N}-control frameworks: creation, merge, checklist, SOA and dashboard stay fast`, async () => {
  const t0 = Date.now(); const r = await team.call('POST', `/t/${w.A}/engagements`, { name: 'Big', primaryReleaseId: rels[0], additionalReleaseIds: [rels[1]] }); const createMs = Date.now() - t0; assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.applied[0].created, N); assert.equal(r.body.applied[1].merged, 500); assert.equal(r.body.applied[1].created, N - 500); // B's mapped controls collapse into A's items (same 500 common controls)
  const E = r.body.id; assert.equal((await rows('SELECT COUNT(*) n FROM checklist_items WHERE tenant_id=? AND engagement_id=?', [w.A, E]))[0].n, 2 * N - 500); assert.equal((await rows('SELECT COUNT(*) n FROM soa_entries WHERE tenant_id=? AND engagement_id=?', [w.A, E]))[0].n, 2 * N);
  const time = async (fn: () => Promise<any>) => { const t = Date.now(); const x = await fn(); return [Date.now() - t, x] as const; };
  const [listMs, list] = await time(() => team.call('GET', `/t/${w.A}/engagements/${E}/checklist`)); const [dashMs, dash] = await time(() => team.call('GET', `/t/${w.A}/dashboard`)); const [soaMs] = await time(() => team.call('GET', `/t/${w.A}/engagements/${E}/soa`)); const [prevMs] = await time(() => team.call('GET', `/t/${w.A}/engagements/overlap-preview?releaseIds=${rels.join(',')}`));
  assert.equal(list.body.items.length, 2 * N - 500); assert.equal(dash.body.summary.total, 2 * N - 500); console.log(`      timings: create=${createMs}ms checklist=${listMs}ms soa=${soaMs}ms dashboard=${dashMs}ms overlap-preview=${prevMs}ms`);
  assert.ok(createMs < 20000, 'create ' + createMs); assert.ok(listMs < 3000, 'checklist ' + listMs); assert.ok(dashMs < 1500, 'dashboard ' + dashMs); assert.ok(soaMs < 3000, 'soa ' + soaMs); assert.ok(prevMs < 3000, 'preview ' + prevMs);
});
