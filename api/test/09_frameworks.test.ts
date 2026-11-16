import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, newFramework } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let team: any; let fw: { id: string; releaseId: string };
const C = [{ ref: 'A-1', domain: 'Access', title: 'MFA for admins' }, { ref: 'A-2', domain: 'Access', title: 'Quarterly access review' }, { ref: 'B-1', domain: 'Backup', title: 'Daily backups' }];
before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); team = await env.login('team@x.test'); fw = await newFramework(w.root, 'Demo Framework', C); }); after(() => env.close());
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];

test('library access: platform users only; customers and anonymous are refused', async () => {
  const cust = await w.as('aAdmin'); for (const u of ['/frameworks', `/releases/${fw.releaseId}/controls`, '/common-controls']) { assert.equal((await cust.call('GET', u)).status, 403, u); assert.equal((await env.client().call('GET', u)).status, 401, u); }
  assert.equal((await cust.call('POST', '/frameworks', { name: 'x' })).status, 403);
});
test('only admin-level users can write; isecurify_team can read published content only', async () => {
  assert.equal((await team.call('POST', '/frameworks', { name: 'Nope' })).status, 403); assert.equal((await team.call('POST', `/releases/${fw.releaseId}/controls`, { ref: 'Z', domain: 'd', title: 't' })).status, 403);
  assert.equal((await team.call('GET', `/releases/${fw.releaseId}/controls`)).status, 404);            // draft is invisible to non-admins
  assert.equal((await team.call('GET', '/frameworks')).body.some((f: any) => f.id === fw.id), false);   // framework with no published release is hidden
  assert.equal((await team.call('GET', `/frameworks/${fw.id}`)).status, 404);
});
test('create framework: draft v1, unique name, colour validated', async () => {
  assert.equal((await w.root.call('POST', '/frameworks', { name: 'Demo Framework' })).status, 409); assert.equal((await w.root.call('POST', '/frameworks', { name: 'Bad Colour', color: 'red' })).status, 400);
  const d = (await w.root.call('GET', `/frameworks/${fw.id}`)).body; assert.equal(d.releases.length, 1); assert.equal(d.releases[0].status, 'draft'); assert.equal(d.releases[0].version, 1);
});
test('draft editing: add, duplicate ref refused, update, delete, bulk', async () => {
  assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/controls`, { ref: 'C-1', domain: 'Ops', title: 'Change control', ownerDepartment: 'IT' })).status, 201);
  assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/controls`, { ref: 'C-1', domain: 'Ops', title: 'dup' })).status, 409);
  const list = (await w.root.call('GET', `/releases/${fw.releaseId}/controls`)).body; const c1 = list.find((c: any) => c.ref === 'C-1'); assert.equal(c1.owner_department, 'IT');
  assert.equal((await w.root.call('PATCH', `/releases/${fw.releaseId}/controls/${c1.id}`, { title: 'Change management', remarks: 'edited' })).status, 200);
  assert.equal((await w.root.call('GET', `/releases/${fw.releaseId}/controls`)).body.find((c: any) => c.ref === 'C-1').title, 'Change management');
  assert.equal((await w.root.call('DELETE', `/releases/${fw.releaseId}/controls/${c1.id}`)).status, 200); assert.equal((await w.root.call('DELETE', `/releases/${fw.releaseId}/controls/${c1.id}`)).status, 404);
  assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/controls`, { ref: '', domain: 'd', title: 't' })).status, 400);
  assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/controls/bulk`, { controls: [{ ref: 'X-1', domain: 'd', title: 't' }, { ref: 'A-1', domain: 'd', title: 'clash' }] })).status, 409);
  assert.equal((await rows('SELECT COUNT(*) n FROM framework_controls WHERE release_id=?', [fw.releaseId]))[0].n, 3);   // failed bulk rolled back completely
});
test('publish: needs controls, locks the release, cannot be repeated', async () => {
  const empty = (await w.root.call('POST', '/frameworks', { name: 'Empty FW' })).body; assert.equal((await w.root.call('POST', `/releases/${empty.draftReleaseId}/publish`)).status, 400);
  assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/publish`)).status, 200); assert.equal((await w.root.call('POST', `/releases/${fw.releaseId}/publish`)).status, 409);
  const [r] = await rows('SELECT status,published_at,published_by FROM framework_releases WHERE id=?', [fw.releaseId]); assert.equal(r.status, 'published'); assert.ok(r.published_at); assert.equal(r.published_by, w.ids.root);
});
test('PUBLISHED release cannot be edited, extended or deleted through the API', async () => {
  const ctl = (await w.root.call('GET', `/releases/${fw.releaseId}/controls`)).body[0];
  for (const [m, u, b] of [['POST', `/releases/${fw.releaseId}/controls`, { ref: 'N', domain: 'd', title: 't' }], ['POST', `/releases/${fw.releaseId}/controls/bulk`, { controls: [{ ref: 'N', domain: 'd', title: 't' }] }], ['PATCH', `/releases/${fw.releaseId}/controls/${ctl.id}`, { title: 'hack' }], ['DELETE', `/releases/${fw.releaseId}/controls/${ctl.id}`]] as const) {
    const r = await w.root.call(m, u, b); assert.equal(r.status, 409, `${m} ${u}`); assert.equal(r.body.code, 'release_immutable'); }
  assert.equal((await w.root.call('DELETE', `/releases/${fw.releaseId}`)).status, 404); assert.equal((await w.root.call('DELETE', `/frameworks/${fw.id}`)).status, 404);   // no delete routes exist
});
test('PUBLISHED release cannot be changed even with direct SQL (database triggers)', async () => {
  const P = env.pool; const [c] = await rows('SELECT id FROM framework_controls WHERE release_id=? LIMIT 1', [fw.releaseId]);
  await assert.rejects(P.query("UPDATE framework_controls SET title='x' WHERE release_id=?", [fw.releaseId]), /immutable/); await assert.rejects(P.query('DELETE FROM framework_controls WHERE release_id=?', [fw.releaseId]), /immutable/);
  await assert.rejects(P.query("INSERT INTO framework_controls(id,release_id,ref,domain,title) VALUES (UUID(),?,'Z','d','t')", [fw.releaseId]), /immutable/);
  await assert.rejects(P.query("UPDATE framework_releases SET status='draft', published_at=NULL WHERE id=?", [fw.releaseId]), /immutable/); await assert.rejects(P.query('DELETE FROM framework_releases WHERE id=?', [fw.releaseId]), /immutable/);
  const other = (await w.root.call('POST', '/frameworks', { name: 'Other' })).body; await w.root.call('POST', `/releases/${other.draftReleaseId}/controls`, { ref: 'O-1', domain: 'd', title: 't' });
  await assert.rejects(P.query('UPDATE framework_controls SET release_id=? WHERE release_id=? LIMIT 1', [fw.releaseId, other.draftReleaseId]), /immutable/);        // cannot smuggle a control INTO a published release
  assert.ok(c.id);
});
test('new draft: copy of the published release, one open draft per framework (API and database)', async () => {
  assert.equal((await team.call('POST', `/releases/${fw.releaseId}/new-draft`)).status, 403);
  const d = await w.root.call('POST', `/releases/${fw.releaseId}/new-draft`); assert.equal(d.status, 201); assert.equal(d.body.version, 2); assert.equal(d.body.controls, 3);
  const again = await w.root.call('POST', `/releases/${fw.releaseId}/new-draft`); assert.equal(again.status, 409); assert.equal(again.body.code, 'draft_exists');
  await assert.rejects(env.pool.query("INSERT INTO framework_releases(id,framework_id,version) VALUES (UUID(),?,99)", [fw.id]), /Duplicate/i);
  assert.equal((await w.root.call('POST', `/releases/${d.body.id}/new-draft`)).status, 409);   // source must be published
  (fw as any).draft = d.body.id;
});
test('editing the new draft leaves the published release byte-for-byte unchanged', async () => {
  const snap = async () => JSON.stringify(await rows('SELECT id,ref,domain,title,description,owner_department,secondary_guidance_note,remarks,sort_order FROM framework_controls WHERE release_id=? ORDER BY id', [fw.releaseId]));
  const before = await snap(); const draft = (fw as any).draft; const list = (await w.root.call('GET', `/releases/${draft}/controls`)).body;
  await w.root.call('PATCH', `/releases/${draft}/controls/${list.find((c: any) => c.ref === 'A-1').id}`, { title: 'MFA for ALL users', ownerDepartment: 'Security' });
  await w.root.call('DELETE', `/releases/${draft}/controls/${list.find((c: any) => c.ref === 'B-1').id}`); await w.root.call('POST', `/releases/${draft}/controls`, { ref: 'D-1', domain: 'Data', title: 'Encryption' });
  assert.equal(await snap(), before);
  assert.equal((await w.root.call('POST', `/releases/${draft}/publish`)).status, 200);
  const rel = (await w.root.call('GET', `/frameworks/${fw.id}`)).body.releases; assert.deepEqual(rel.map((r: any) => `${r.version}:${r.status}`), ['2:published', '1:published']); assert.equal(await snap(), before);
});
test('comparison is correct, deterministic and symmetric', async () => {
  const v1 = fw.releaseId, v2 = (fw as any).draft; const runs = []; for (let i = 0; i < 4; i++) runs.push(JSON.stringify((await team.call('GET', `/releases/${v1}/compare/${v2}`)).body));
  assert.equal(new Set(runs).size, 1); const r = JSON.parse(runs[0]);
  assert.deepEqual(r.added.map((x: any) => x.ref), ['D-1']); assert.deepEqual(r.removed.map((x: any) => x.ref), ['B-1']); assert.deepEqual(r.changed.map((x: any) => x.ref), ['A-1']); assert.equal(r.unchanged, 1);
  assert.deepEqual(r.changed[0].changes.map((c: any) => c.field), ['title', 'owner_department']); assert.deepEqual(r.summary, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  const rev = (await team.call('GET', `/releases/${v2}/compare/${v1}`)).body; assert.deepEqual(rev.added.map((x: any) => x.ref), ['B-1']); assert.deepEqual(rev.removed.map((x: any) => x.ref), ['D-1']);
  assert.equal((await team.call('GET', `/releases/${v1}/compare/${v1}`)).body.summary.changed, 0);
});
test('comparison rules: same framework only; drafts hidden from non-admins', async () => {
  const other = await newFramework(w.root, 'Compare Other', [{ ref: 'Q-1', domain: 'd', title: 't' }], true); assert.equal((await w.root.call('GET', `/releases/${fw.releaseId}/compare/${other.releaseId}`)).status, 400);
  const d = (await w.root.call('POST', `/releases/${(fw as any).draft}/new-draft`)).body; void d;   // v3 draft
  const v3 = (await w.root.call('GET', `/frameworks/${fw.id}`)).body.releases.find((r: any) => r.status === 'draft').id;
  assert.equal((await team.call('GET', `/releases/${fw.releaseId}/compare/${v3}`)).status, 404); assert.equal((await w.root.call('GET', `/releases/${fw.releaseId}/compare/${v3}`)).status, 200); (fw as any).v3 = v3;
});
test('archive hides a framework but keeps every release and row; restore brings it back; edits to archived frameworks are blocked', async () => {
  const n = async () => (await rows('SELECT COUNT(*) n FROM framework_releases WHERE framework_id=?', [fw.id]))[0].n; const before = await n();
  assert.equal((await w.root.call('PATCH', `/frameworks/${fw.id}`, { archived: true })).status, 200);
  assert.equal((await team.call('GET', '/frameworks')).body.some((f: any) => f.id === fw.id), false); assert.equal((await w.root.call('GET', '/frameworks')).body.some((f: any) => f.id === fw.id), false);
  assert.equal((await w.root.call('GET', '/frameworks?includeArchived=true')).body.some((f: any) => f.id === fw.id), true); assert.equal((await team.call('GET', `/frameworks/${fw.id}`)).status, 404);
  const r = await w.root.call('POST', `/releases/${(fw as any).v3}/controls`, { ref: 'Z-9', domain: 'd', title: 't' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'framework_archived');
  assert.equal((await w.root.call('POST', `/releases/${(fw as any).draft}/new-draft`)).status, 409); assert.equal(await n(), before);
  assert.equal((await w.root.call('PATCH', `/frameworks/${fw.id}`, { archived: false })).status, 200); assert.equal((await team.call('GET', '/frameworks')).body.some((f: any) => f.id === fw.id), true);
});
test('framework list shows latest published version, control count and (admin only) the open draft', async () => {
  const t = (await team.call('GET', '/frameworks')).body.find((f: any) => f.id === fw.id); assert.equal(t.latestPublished, 2); assert.equal(t.controlCount, 3); assert.equal(t.draftReleaseId, undefined);
  const a = (await w.root.call('GET', '/frameworks')).body.find((f: any) => f.id === fw.id); assert.equal(a.draftReleaseId, (fw as any).v3);
});
test('framework metadata can be edited; every change is audited', async () => {
  assert.equal((await w.root.call('PATCH', `/frameworks/${fw.id}`, { region: 'EU', color: '#112233', description: 'updated' })).status, 200);
  const d = (await w.root.call('GET', `/frameworks/${fw.id}`)).body; assert.equal(d.region, 'EU'); assert.equal(d.color, '#112233');
  const actions = (await w.root.call('GET', '/platform/audit?limit=200')).body.actions as string[]; for (const a of ['framework.created', 'control.added', 'control.bulk_added', 'control.updated', 'control.deleted', 'release.published', 'release.draft_created', 'framework.archived', 'framework.restored', 'framework.updated']) assert.ok(actions.includes(a), 'missing ' + a);
});
