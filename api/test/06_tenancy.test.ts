import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, tokenFor, PW } from './helpers'; import { deletionBlockers } from '../src/modules/users/hooks';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); }); after(() => env.close());
const UUID = '00000000-0000-4000-8000-000000000000';

test('client of org A gets 404 on every org B route (no existence leak), also for unknown tenants', async () => {
  const a = await w.as('aAdmin');
  const calls: [string, string, any?][] = [['GET', `/t/${w.B}/members`], ['GET', `/t/${w.B}/invitations`], ['POST', `/t/${w.B}/invitations`, { email: 'x@y.test', role: 'client_staff' }],
    ['GET', `/t/${w.B}/audit`], ['PATCH', `/t/${w.B}/members/${w.ids.bStaff}`, { role: 'third_party_vendor' }], ['DELETE', `/t/${w.B}/members/${w.ids.bStaff}`], ['DELETE', `/t/${w.B}/invitations/${UUID}`], ['GET', `/t/${UUID}/members`]];
  for (const [m, u, b] of calls) assert.equal((await a.call(m, u, b)).status, 404, `${m} ${u}`);
});
test('IDOR: ids from another tenant are not reachable through your own tenant path', async () => {
  const a = await w.as('aAdmin'), b = await w.as('bAdmin');
  const inv = (await a.call('POST', `/t/${w.A}/invitations`, { email: 'idor@c.test', role: 'client_staff' })).body.id;
  assert.equal((await b.call('DELETE', `/t/${w.B}/invitations/${inv}`)).status, 404);
  assert.equal((await b.call('PATCH', `/t/${w.B}/members/${w.ids.aStaff}`, { role: 'third_party_vendor' })).status, 404);
  assert.equal((await b.call('DELETE', `/t/${w.B}/members/${w.ids.aStaff}`)).status, 404);
  assert.equal(((await b.call('GET', `/t/${w.B}/members`)).body as any[]).some(m => m.id === w.ids.aStaff), false);
  assert.equal((await a.call('DELETE', `/t/${w.A}/invitations/${inv}`)).status, 200);
});
test('platform admin without assignment gets 404 on tenant data but can use platform metadata; non-admin platform user gets 403', async () => {
  for (const u of ['root', 'admin']) { const c = await env.login(`${u}@x.test`); for (const p of ['members', 'invitations', 'audit']) assert.equal((await c.call('GET', `/t/${w.A}/${p}`)).status, 404, `${u} ${p}`); assert.equal((await c.call('GET', '/platform/organizations')).status, 200); }
  const team = await env.login('team@x.test'); assert.equal((await team.call('GET', '/platform/organizations')).status, 403); assert.equal((await team.call('GET', '/platform/users')).status, 403);
});
test('platform org list is metadata only (counts, no people)', async () => {
  const list = (await w.root.call('GET', '/platform/organizations')).body; const a = list.find((o: any) => o.id === w.A); assert.equal(a.memberCount, 4); assert.ok(!('members' in a));
});
test('staff assignment grants access; expiry and revocation take effect immediately; other tenants stay closed', async () => {
  const team = await env.login('team@x.test'); assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 404);
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: false })).status, 201);
  assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 200); assert.equal((await team.call('GET', `/t/${w.B}/members`)).status, 404);
  assert.deepEqual(((await team.call('GET', '/auth/me')).body.organizations as any[]).map(o => o.id), [w.A]);
  await env.pool.query('UPDATE staff_assignments SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE user_id=?', [w.ids.team]); assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 404);
  await env.pool.query('UPDATE staff_assignments SET expires_at = NULL WHERE user_id=?', [w.ids.team]); assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 200);
  assert.equal((await w.root.call('DELETE', `/platform/organizations/${w.A}/staff/${w.ids.team}`)).status, 200); assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 404);
});
test('staff assignment validation: only active iSecurify users, expiry must be in the future', async () => {
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.aAdmin })).status, 400);
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
  assert.equal((await w.root.call('POST', `/platform/organizations/${UUID}/staff`, { userId: w.ids.team })).status, 404);
});
test('staff without can_manage can enter the tenant but cannot manage it', async () => {
  const team = await env.login('team@x.test'); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: false });
  assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 403); assert.equal((await team.call('POST', `/t/${w.A}/invitations`, { email: 'n@c.test', role: 'client_staff' })).status, 403);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true }); assert.equal((await team.call('GET', `/t/${w.A}/members`)).status, 200);
  assert.equal((await team.call('POST', `/t/${w.A}/invitations`, { email: 'byteam@c.test', role: 'tp_auditor' })).status, 201);   // iSecurify manager may appoint auditors
  await w.root.call('DELETE', `/platform/organizations/${w.A}/staff/${w.ids.team}`);
});
test('client_admin: may invite staff/vendor only; client_staff, vendor and auditor cannot manage', async () => {
  const a = await w.as('aAdmin');
  assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'v1@c.test', role: 'third_party_vendor' })).status, 201);
  for (const role of ['tp_auditor', 'client_admin']) assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: `x-${role}@c.test`, role })).status, 403, role);
  for (const who of ['aStaff', 'aVendor']) { const c = await w.as(who); assert.equal((await c.call('GET', `/t/${w.A}/members`)).status, 403, who); assert.equal((await c.call('POST', `/t/${w.A}/invitations`, { email: 'z@c.test', role: 'client_staff' })).status, 403); assert.equal((await c.call('GET', `/t/${w.A}/audit`)).status, 403); }
  const au = await w.as('aAuditor'); assert.equal((await au.call('GET', `/t/${w.A}/members`)).status, 200); assert.equal((await au.call('POST', `/t/${w.A}/invitations`, { email: 'z@c.test', role: 'client_staff' })).status, 403);
});
test('role changes: client_admin limited to staff<->vendor, cannot change self; last client_admin is protected', async () => {
  const a = await w.as('aAdmin');
  assert.equal((await a.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'third_party_vendor' })).status, 200);
  assert.equal((await a.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'client_admin' })).status, 403);
  assert.equal((await a.call('PATCH', `/t/${w.A}/members/${w.ids.aAuditor}`, { role: 'client_staff' })).status, 403);
  assert.equal((await a.call('PATCH', `/t/${w.A}/members/${w.ids.aAdmin}`, { role: 'client_staff' })).status, 400);
  assert.equal((await a.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'client_staff' })).status, 200);
  const team = await env.login('team@x.test'); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team });
  assert.equal((await team.call('PATCH', `/t/${w.A}/members/${w.ids.aAdmin}`, { role: 'client_staff' })).status, 409);   // would leave no client admin
  assert.equal((await team.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'client_admin' })).status, 200);
  assert.equal((await team.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'client_staff' })).status, 200);
  await w.root.call('DELETE', `/platform/organizations/${w.A}/staff/${w.ids.team}`);
});
test('removal: not yourself, not above your rank, blocked by open items, removed user loses access', async () => {
  const a = await w.as('aAdmin'); const v = await w.as('aVendor');
  assert.equal((await a.call('DELETE', `/t/${w.A}/members/${w.ids.aAdmin}`)).status, 400); assert.equal((await a.call('DELETE', `/t/${w.A}/members/${w.ids.aAuditor}`)).status, 403);
  const blocker = async (_c: any, uid: string, t: string | null) => uid === w.ids.aVendor && (t === null || t === w.A) ? [{ type: 'checklist_item', id: 'i1', label: 'AC-04' }] : [];
  deletionBlockers.push(blocker); const r = await a.call('DELETE', `/t/${w.A}/members/${w.ids.aVendor}`); assert.equal(r.status, 409); assert.equal(r.body.code, 'has_open_items'); deletionBlockers.length = 0;
  assert.equal((await v.call('GET', '/auth/me')).body.organizations.length, 1);
  assert.equal((await a.call('DELETE', `/t/${w.A}/members/${w.ids.aVendor}`)).status, 200);
  assert.equal((await v.call('GET', '/auth/me')).body.organizations.length, 0); assert.equal((await v.call('GET', `/t/${w.A}/members`)).status, 404);
});
test('suspended/archived organizations are closed to everyone; archive/restore needs a Super Admin', async () => {
  const a = await w.as('aAdmin'), admin = await env.login('admin@x.test');
  assert.equal((await admin.call('PATCH', `/platform/organizations/${w.A}`, { status: 'suspended' })).status, 200);
  const r = await a.call('GET', `/t/${w.A}/members`); assert.equal(r.status, 403); assert.equal(r.body.code, 'org_inactive');
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/invitations`, { email: 'late@c.test', role: 'client_staff' })).status, 409);
  assert.equal((await admin.call('PATCH', `/platform/organizations/${w.A}`, { status: 'archived' })).status, 403); assert.equal((await w.root.call('PATCH', `/platform/organizations/${w.A}`, { status: 'archived' })).status, 200);
  assert.equal((await admin.call('PATCH', `/platform/organizations/${w.A}`, { status: 'active' })).status, 403); assert.equal((await w.root.call('PATCH', `/platform/organizations/${w.A}`, { status: 'active' })).status, 200);
  assert.equal((await a.call('GET', `/t/${w.A}/members`)).status, 200);
  assert.equal((await w.root.call('PATCH', `/platform/organizations/${w.B}`, { name: 'Org A' })).status, 409);   // unique name
});
test('one user in several organizations: sees both, and only their own role in each', async () => {
  await w.root.call('POST', `/platform/organizations/${w.B}/invitations`, { email: 'aadmin@c.test', role: 'client_staff' }); const token = await tokenFor(env.pool, 'aadmin@c.test');
  assert.equal((await env.client().call('POST', `/invitations/${token}/accept`, {})).status, 409);                       // must sign in first
  const b = await w.as('bAdmin'); assert.equal((await b.call('POST', `/invitations/${token}/accept`, {})).status, 409);   // wrong signed-in user
  const a = await w.as('aAdmin'); assert.equal((await a.call('POST', `/invitations/${token}/accept`, {})).status, 200);
  const me = (await a.call('GET', '/auth/me')).body.organizations as any[]; assert.deepEqual(me.map(o => `${o.name}:${o.role}`).sort(), ['Org A:client_admin', 'Org B:client_staff']);
  assert.equal((await a.call('GET', `/t/${w.B}/members`)).status, 403); assert.equal((await a.call('GET', `/t/${w.A}/members`)).status, 200);
});
test('disabled user loses access immediately and can be re-enabled', async () => {
  const s = await w.as('aStaff'); assert.equal((await s.call('GET', '/auth/me')).status, 200);
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.aStaff}`, { status: 'disabled' })).status, 200); assert.equal((await s.call('GET', '/auth/me')).status, 401);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'astaff@c.test', password: PW })).status, 401);
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.aStaff}`, { status: 'active' })).status, 200); assert.equal((await env.client().call('POST', '/auth/login', { email: 'astaff@c.test', password: PW })).status, 200);
});
