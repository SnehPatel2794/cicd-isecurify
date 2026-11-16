// Demo organizations, Phase 13C: marked at creation, wiped completely and permanently; a real organization can never be wiped or have rows deleted.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { freshEnv, world, frameworkFixtures, mpf, PDF, PW } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any;
let D = '', dAdmin = '', dStaff = '', dAdminId = '', key = ''; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-wipe-'));
const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
const wipe = (c: any, id: string, o: any = {}) => c.call('POST', `/platform/organizations/${id}/wipe`, { confirmName: 'Demo Corp', password: PW, removePeople: true, ...o });
async function fill(orgId: string, adminC: any, name: string) { const E = (await adminC.call('POST', `/t/${orgId}/engagements`, { name, primaryReleaseId: fx.X.releaseId })).body.id; const items = (await adminC.call('GET', `/t/${orgId}/engagements/${E}/checklist`)).body.items;
  await adminC.call('POST', `/t/${orgId}/engagements/${E}/tasks`, { title: 'Demo task one' }); const rq = await adminC.call('POST', `/t/${orgId}/checklist/${items[0].id}/evidence-requests`, { title: 'Evidence' }); const m = mpf('e.pdf', PDF(name), {});
  const up = await adminC.call('POST', `/t/${orgId}/evidence-requests/${rq.body.id}/versions`, m.payload, m.headers); assert.equal(up.status, 201, JSON.stringify(up.body)); return E; }
before(async () => { env = await freshEnv({ requireMfaForPlatform: false, limits: { login: 1000, reset: 1000, mfa: 1000 }, evidence: { dir, scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); admin = await w.as('aAdmin'); team = await env.login('team@x.test'); await fill(w.A, admin, 'Real A');
  D = (await w.root.call('POST', '/platform/organizations', { name: 'Demo Corp', isDemo: true })).body.id; dAdminId = await w.join(D, 'dadmin@c.test', 'client_admin'); await w.join(D, 'dstaff@c.test', 'client_staff'); dAdmin = 'dadmin@c.test'; dStaff = 'dstaff@c.test';
  const da = await env.login(dAdmin); await fill(D, da, 'Demo run'); await da.call('POST', `/t/${D}/engagements/${(await da.call('GET', `/t/${D}/engagements`)).body[0].id}/tasks`, { title: 'Second demo task', assigneeId: (await rows('SELECT id FROM users WHERE email=?', [dStaff]))[0].id }); });
after(() => env.close());

test('1. an organization is marked demo when it is created, shown in the list, and the mark can never change', async () => {
  const l = (await w.root.call('GET', '/platform/organizations')).body; assert.equal(l.find((o: any) => o.id === D).isDemo, true); assert.equal(l.find((o: any) => o.id === w.A).isDemo, false);
  await assert.rejects(env.pool.query('UPDATE organizations SET is_demo=1 WHERE id=?', [w.A]), /cannot be changed/); await assert.rejects(env.pool.query('UPDATE organizations SET is_demo=0 WHERE id=?', [D]), /cannot be changed/);
  assert.equal((await w.root.call('GET', '/platform/demo')).body.wipeConfigured, true); assert.equal((await team.call('GET', '/platform/demo')).body.canWipe, false);
});
test('2. a real organization is protected: no wipe, no purge mark, no row deletes, even with full database rights', async () => {
  const r = await wipe(w.root, w.A, { confirmName: 'Org A' }); assert.equal(r.status, 409); assert.match(r.body.error, /real organization/);
  await assert.rejects(env.pool.query('UPDATE organizations SET purge_started_at=NOW(3) WHERE id=?', [w.A]), /only a demo organization/); await assert.rejects(env.pool.query('DELETE FROM organizations WHERE id=?', [w.A]), /being wiped/);
  for (const t of ['audit_events', 'evidence_versions']) { assert.ok((await rows(`SELECT COUNT(*) n FROM ${t} WHERE tenant_id=?`, [w.A]))[0].n > 0); await assert.rejects(env.pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [w.A]), /append-only|immutable/, t); }
  await assert.rejects(env.pool.query('DELETE FROM audit_events WHERE tenant_id=?', [D]), /append-only/, 'even a demo organization is protected until its wipe starts');
});
test('3. only the Super Admin, with the right password and the exact name', async () => {
  assert.equal((await wipe(team, D)).status, 403); const adm = await env.login('admin@x.test'); assert.equal((await wipe(adm, D)).status, 403); assert.equal((await wipe(admin, D)).status, 403);
  assert.equal((await wipe(w.root, D, { password: 'Wrong-Password-123!' })).status, 403); assert.equal((await wipe(w.root, D, { confirmName: 'demo corp' })).status, 400); assert.equal((await wipe(w.root, '00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await rows('SELECT COUNT(*) n FROM organizations WHERE id=?', [D]))[0].n, 1, 'nothing was removed by the refused attempts');
});
test('4. the wipe removes every row, the files and the demo-only people, keeps real organizations and platform users, and leaves one record', async () => {
  const before = (await rows('SELECT storage_key k FROM evidence_versions WHERE tenant_id=?', [D])); assert.equal(before.length, 1); key = before[0].k; assert.ok(fs.existsSync(path.join(dir, key)), 'the file is on disk');
  const realAudit = (await rows('SELECT COUNT(*) n FROM audit_events WHERE tenant_id=?', [w.A]))[0].n; const realTasks = (await rows('SELECT COUNT(*) n FROM tasks WHERE tenant_id=?', [w.A]))[0].n;
  const r = await wipe(w.root, D); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.filesRemoved, 1); assert.equal(r.body.filesFailed, 0); assert.ok(r.body.rowsTotal > 10); assert.equal(r.body.peopleRemoved, 2); assert.equal(r.body.rows.tasks, 2);
  assert.equal(fs.existsSync(path.join(dir, key)), false, 'the file is gone');
  const tables = (await rows("SELECT DISTINCT table_name t FROM information_schema.columns WHERE table_schema=? AND column_name='tenant_id' AND table_name<>'organizations'", [env.name])).map(x => x.t ?? x.T ?? x.TABLE_NAME);
  for (const t of tables) assert.equal((await rows(`SELECT COUNT(*) n FROM \`${t}\` WHERE tenant_id=?`, [D]))[0].n, 0, t);
  assert.equal((await rows('SELECT COUNT(*) n FROM organizations WHERE id=?', [D]))[0].n, 0); assert.equal((await rows('SELECT COUNT(*) n FROM users WHERE email IN (?,?)', [dAdmin, dStaff]))[0].n, 0);
  assert.equal((await rows('SELECT COUNT(*) n FROM users WHERE email IN (?,?,?)', ['root@x.test', 'team@x.test', 'aadmin@c.test']))[0].n, 3, 'platform users and real people stay');
  assert.equal((await rows('SELECT COUNT(*) n FROM audit_events WHERE tenant_id=?', [w.A]))[0].n >= realAudit, true); assert.equal((await rows('SELECT COUNT(*) n FROM tasks WHERE tenant_id=?', [w.A]))[0].n, realTasks);
  const a = await rows("SELECT tenant_id, entity_id, detail FROM audit_events WHERE action='org.wiped'"); assert.equal(a.length, 1); assert.equal(a[0].tenant_id, null); assert.equal(a[0].entity_id, D); const det = typeof a[0].detail === 'string' ? JSON.parse(a[0].detail) : a[0].detail; assert.equal(det.name, 'Demo Corp'); assert.equal(det.files, 1);
  assert.equal((await w.root.call('GET', '/platform/organizations')).body.some((o: any) => o.id === D), false); assert.equal((await wipe(w.root, D)).status, 404);
  assert.equal((await env.client().call('POST', '/auth/login', { email: dAdmin, password: PW })).status, 401, 'removed people can no longer sign in');
});
test('5. people who also belong to a real organization are kept; removePeople=false keeps everyone', async () => {
  const D2 = (await w.root.call('POST', '/platform/organizations', { name: 'Demo Corp', isDemo: true })).body.id; const mk = async (org: string, email: string) => { const id = (await rows('SELECT id FROM users WHERE email=?', [email]))[0]?.id ?? await env.mkUser(email, 'none'); await env.pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,'client_staff')", [org, id]); return id; };
  await mk(D2, 'shared@c.test'); await env.pool.query("INSERT INTO memberships(tenant_id,user_id,role) SELECT ?, id, 'client_staff' FROM users WHERE email='shared@c.test' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.tenant_id=?)", [w.A, w.A]);
  await mk(D2, 'only@c.test'); const r = await wipe(w.root, D2, { removePeople: false }); assert.equal(r.status, 200); assert.equal(r.body.peopleRemoved, 0); assert.equal((await rows('SELECT COUNT(*) n FROM users WHERE email IN (?,?)', ['shared@c.test', 'only@c.test']))[0].n, 2);
  assert.equal((await rows('SELECT COUNT(*) n FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?', ['shared@c.test']))[0].n, 1, 'only the real membership is left');
  const D3 = (await w.root.call('POST', '/platform/organizations', { name: 'Demo Corp', isDemo: true })).body.id; await mk(D3, 'shared2@c.test'); await mk(w.B, 'shared2@c.test');
  const r3 = await wipe(w.root, D3); assert.equal(r3.body.peopleRemoved, 0, 'a person who is in a real organization too is never removed'); assert.equal((await rows('SELECT COUNT(*) n FROM users WHERE email=?', ['shared2@c.test']))[0].n, 1);
});
test('6. when the purge account is not set up the wipe says so and removes nothing', async () => {
  const e2 = await freshEnv({ requireMfaForPlatform: false, purgePool: undefined } as any); try { const w2 = await world(e2); const d = (await w2.root.call('POST', '/platform/organizations', { name: 'Demo Corp', isDemo: true })).body.id;
    assert.equal((await w2.root.call('GET', '/platform/demo')).body.wipeConfigured, false); const r = await w2.root.call('POST', `/platform/organizations/${d}/wipe`, { confirmName: 'Demo Corp', password: PW }); assert.equal(r.status, 503); assert.equal(r.body.code, 'not_configured'); assert.equal(((await e2.pool.query('SELECT COUNT(*) n FROM organizations WHERE id=?', [d])) as any)[0][0].n, 1); } finally { await e2.close(); }
});
