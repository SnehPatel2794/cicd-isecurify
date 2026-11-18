import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import mysql from 'mysql2/promise';
import { freshEnv, world, newFramework, ADMIN_URL } from './helpers'; import { seedSample, SAMPLE_NAME } from '../src/modules/frameworks/sample'; import { applyGrants } from '../src/grants';
const testDbUrl = new URL(ADMIN_URL);
const TEST_DB_HOST = testDbUrl.hostname;
const TEST_DB_PORT = Number(testDbUrl.port || 3306);
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let team: any; let A: any, B: any; let ctl: Record<string, string>;
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); team = await env.login('team@x.test');
  A = await newFramework(w.root, 'Framework A', [{ ref: 'A-1', domain: 'Access', title: 'MFA' }, { ref: 'A-2', domain: 'Access', title: 'Reviews' }], true);
  B = await newFramework(w.root, 'Framework B', [{ ref: 'B-1', domain: 'Auth', title: 'Strong authentication' }, { ref: 'B-2', domain: 'Ops', title: 'Backups' }], true);
  const get = async (rid: string) => (await w.root.call('GET', `/releases/${rid}/controls`)).body as any[]; ctl = {}; for (const [rid, p] of [[A.releaseId, 'A'], [B.releaseId, 'B']]) for (const c of await get(rid)) ctl[c.ref] = c.id;
}); after(() => env.close());
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];

test('common controls: admin-level write, platform read, customers refused, unique titles', async () => {
  const mk = await w.root.call('POST', '/common-controls', { title: 'Multi-factor authentication', description: 'MFA everywhere' }); assert.equal(mk.status, 201); (ctl as any).mfa = mk.body.id;
  assert.equal((await w.root.call('POST', '/common-controls', { title: 'Multi-factor authentication' })).status, 409); assert.equal((await team.call('POST', '/common-controls', { title: 'X' })).status, 403);
  assert.equal((await team.call('GET', '/common-controls')).status, 200); assert.equal((await (await w.as('aAdmin')).call('GET', '/common-controls')).status, 403);
  assert.equal((await w.root.call('PATCH', `/common-controls/${mk.body.id}`, { description: 'MFA for all admin and remote access' })).status, 200);
});
test('mapping works on PUBLISHED controls (metadata) without touching the immutable control; one control maps to one common control', async () => {
  const before = JSON.stringify(await rows('SELECT * FROM framework_controls WHERE release_id IN (?,?) ORDER BY id', [A.releaseId, B.releaseId]));
  for (const ref of ['A-1', 'B-1']) assert.equal((await w.root.call('PUT', `/controls/${ctl[ref]}/mapping`, { commonControlId: (ctl as any).mfa, rationale: 'same requirement' })).status, 200);
  assert.equal(JSON.stringify(await rows('SELECT * FROM framework_controls WHERE release_id IN (?,?) ORDER BY id', [A.releaseId, B.releaseId])), before);
  await assert.rejects(env.pool.query('INSERT INTO control_mappings(control_id,common_control_id,mapped_by) VALUES (?,?,?)', [ctl['A-1'], (ctl as any).mfa, w.ids.root]), /Duplicate/i);
  assert.equal((await team.call('PUT', `/controls/${ctl['A-2']}/mapping`, { commonControlId: (ctl as any).mfa })).status, 403);
  assert.equal((await w.root.call('PUT', `/controls/${ctl['A-2']}/mapping`, { commonControlId: '00000000-0000-4000-8000-000000000000' })).status, 404);
});
test('one common control spans several frameworks; listing and detail reflect it', async () => {
  const d = (await team.call('GET', `/common-controls/${(ctl as any).mfa}`)).body; assert.deepEqual(d.controls.map((c: any) => `${c.frameworkName}:${c.ref}`), ['Framework A:A-1', 'Framework B:B-1']); assert.equal(d.controls[0].rationale, 'same requirement');
  const l = (await team.call('GET', '/common-controls')).body.find((c: any) => c.id === (ctl as any).mfa); assert.equal(l.mappedCount, 2); assert.equal(l.frameworkCount, 2);
});
test('mapping changes are recorded in an append-only history (map -> change -> unmap)', async () => {
  const other = (await w.root.call('POST', '/common-controls', { title: 'Access review' })).body.id; (ctl as any).review = other;
  assert.equal((await w.root.call('PUT', `/controls/${ctl['A-2']}/mapping`, { commonControlId: (ctl as any).mfa })).status, 200); assert.equal((await w.root.call('PUT', `/controls/${ctl['A-2']}/mapping`, { commonControlId: other, rationale: 'was mapped wrongly' })).status, 200);
  assert.equal((await w.root.call('DELETE', `/controls/${ctl['A-2']}/mapping`)).status, 200); assert.equal((await w.root.call('DELETE', `/controls/${ctl['A-2']}/mapping`)).status, 404);
  const h = (await w.root.call('GET', `/controls/${ctl['A-2']}/mapping-history`)).body; assert.deepEqual(h.map((x: any) => x.action), ['map', 'change', 'unmap']); assert.equal(h[1].previous_common_control_id, (ctl as any).mfa); assert.equal(h[1].rationale, 'was mapped wrongly');
  await assert.rejects(env.pool.query("UPDATE control_mapping_history SET action='map'"), /append-only/); await assert.rejects(env.pool.query('DELETE FROM control_mapping_history'), /append-only/);
  assert.equal((await team.call('GET', `/controls/${ctl['A-2']}/mapping-history`)).status, 403);
});
test('a common control with mappings cannot be deleted; after unmapping it can', async () => {
  const r = await w.root.call('DELETE', `/common-controls/${(ctl as any).mfa}`); assert.equal(r.status, 409); assert.equal(r.body.code, 'has_mappings');
  for (const ref of ['A-1', 'B-1']) await w.root.call('DELETE', `/controls/${ctl[ref]}/mapping`); assert.equal((await w.root.call('DELETE', `/common-controls/${(ctl as any).mfa}`)).status, 200);
  assert.equal((await w.root.call('DELETE', `/common-controls/${(ctl as any).review}`)).status, 200);   // 'review' has no mappings left
});
test('deleting a DRAFT control removes its mapping and records it; archived frameworks cannot be remapped', async () => {
  const D = await newFramework(w.root, 'Draft FW', [{ ref: 'D-1', domain: 'd', title: 't' }]); const dc = (await w.root.call('GET', `/releases/${D.releaseId}/controls`)).body[0].id; const cc = (await w.root.call('POST', '/common-controls', { title: 'Temp common' })).body.id;
  await w.root.call('PUT', `/controls/${dc}/mapping`, { commonControlId: cc }); assert.equal((await w.root.call('DELETE', `/releases/${D.releaseId}/controls/${dc}`)).status, 200);
  assert.deepEqual((await rows('SELECT action FROM control_mapping_history WHERE control_id=? ORDER BY id', [dc])).map(r => r.action), ['map', 'unmap']); assert.equal((await rows('SELECT COUNT(*) n FROM control_mappings WHERE control_id=?', [dc]))[0].n, 0);
  await w.root.call('PATCH', `/frameworks/${B.id}`, { archived: true }); const r = await w.root.call('PUT', `/controls/${ctl['B-2']}/mapping`, { commonControlId: cc }); assert.equal(r.status, 409); await w.root.call('PATCH', `/frameworks/${B.id}`, { archived: false });
});
test('drafts: mapping carries over to the next draft; non-admins never see draft-release controls in common-control detail', async () => {
  const cc = (await w.root.call('POST', '/common-controls', { title: 'Carry over' })).body.id; await w.root.call('PUT', `/controls/${ctl['A-1']}/mapping`, { commonControlId: cc, rationale: 'carry' });
  const d = (await w.root.call('POST', `/releases/${A.releaseId}/new-draft`)).body; const nd = (await w.root.call('GET', `/releases/${d.id}/controls`)).body.find((c: any) => c.ref === 'A-1'); assert.equal(nd.common_control_id, cc);
  const adm = (await w.root.call('GET', `/common-controls/${cc}`)).body.controls; const tm = (await team.call('GET', `/common-controls/${cc}`)).body.controls; assert.equal(adm.length, 2); assert.equal(tm.length, 1); assert.equal(tm[0].releaseStatus, 'published');
});
test('sample seed: fictional framework + 5 common controls, published and immutable, idempotent', async () => {
  const a = await seedSample(env.pool, w.ids.root) as any; assert.equal(a.created, true); assert.equal(a.controls, 8); assert.equal(a.commonControls, 5); assert.equal((await seedSample(env.pool, w.ids.root)).created, false);
  const f = (await team.call('GET', '/frameworks')).body.find((x: any) => x.name === SAMPLE_NAME); assert.ok(f); assert.equal(f.latestPublished, 1); assert.equal(f.controlCount, 8);
  const ctrls = (await team.call('GET', `/releases/${f.latestPublishedReleaseId}/controls`)).body; assert.equal(ctrls.filter((c: any) => c.common_control_id).length, 5); assert.ok(ctrls.every((c: any) => /^SAMPLE-/.test(c.ref)));
  await assert.rejects(env.pool.query("UPDATE framework_controls SET title='x' WHERE release_id=?", [f.latestPublishedReleaseId]), /immutable/);
});
test('app DB account cannot rewrite mapping history or touch published releases at privilege level', async () => {
  const au = 'a' + env.name.slice(-8), wu = 'w' + env.name.slice(-8); await applyGrants(env.pool, env.name, au, 'app-pw-123', wu, 'worker-pw-123', '%');

const app = await mysql.createConnection({
  host: TEST_DB_HOST,
  port: TEST_DB_PORT,
  user: au,
  password: 'app-pw-123',
  database: env.name
});
  try { await assert.rejects(app.query("UPDATE control_mapping_history SET action='map'"), /denied/i); await assert.rejects(app.query('DELETE FROM control_mapping_history'), /denied/i); await assert.rejects(app.query("UPDATE framework_controls SET title='x' WHERE release_id=?", [A.releaseId]), /immutable/); await app.query('SELECT COUNT(*) FROM framework_controls'); }
  finally {
  await app.end();
  for (const u of [au, wu]) {
    await env.pool.query('DROP USER IF EXISTS ?@?', [u, '%']);
  }
}
});
