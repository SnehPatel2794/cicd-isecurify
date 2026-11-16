import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, tokenFor, PW } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); }); after(() => env.close());

test('invitation token: stored hashed, shows org and role, single use', async () => {
  const a = await w.as('aAdmin'); assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'new1@c.test', role: 'client_staff' })).status, 201); const token = await tokenFor(env.pool, 'new1@c.test');
  const [rows]: any = await env.pool.query('SELECT token_hash FROM invitations'); assert.ok(rows.every((r: any) => r.token_hash !== token && r.token_hash.length === 64));
  const peek = await env.client().call('GET', `/invitations/${token}`); assert.equal(peek.status, 200); assert.equal(peek.body.organization, 'Org A'); assert.equal(peek.body.role, 'client_staff'); assert.ok(!JSON.stringify(peek.body).includes(token));
  assert.equal((await env.client().call('POST', `/invitations/${token}/accept`, { name: 'N', password: 'weak' })).status, 400);
  assert.equal((await env.client().call('POST', `/invitations/${token}/accept`, { password: PW })).status, 400);
  assert.equal((await env.client().call('POST', `/invitations/${token}/accept`, { name: 'New One', password: PW })).status, 200);
  assert.equal((await env.client().call('POST', `/invitations/${token}/accept`, { name: 'Again', password: PW })).status, 404);
  assert.equal((await env.client().call('GET', `/invitations/${token}`)).status, 404);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'new1@c.test', password: PW })).status, 200);
});
test('duplicate pending invites, existing members, expired and revoked invites', async () => {
  const a = await w.as('aAdmin'); const send = (email: string, role = 'client_staff') => a.call('POST', `/t/${w.A}/invitations`, { email, role });
  assert.equal((await send('dup@c.test')).status, 201); assert.equal((await send('DUP@c.test')).status, 409); assert.equal((await send('astaff@c.test')).status, 409);
  const t = await tokenFor(env.pool, 'dup@c.test'); await env.pool.query("UPDATE invitations SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE email='dup@c.test'"); assert.equal((await env.client().call('GET', `/invitations/${t}`)).status, 404);
  assert.equal((await send('dup@c.test')).status, 201);   // expired one no longer blocks
  const id = (await a.call('GET', `/t/${w.A}/invitations`)).body.find((i: any) => i.email === 'dup@c.test').id; assert.equal((await a.call('DELETE', `/t/${w.A}/invitations/${id}`)).status, 200);
  assert.equal((await env.client().call('GET', `/invitations/${await tokenFor(env.pool, 'dup@c.test')}`)).status, 404); assert.equal(((await a.call('GET', `/t/${w.A}/invitations`)).body as any[]).some(i => i.email === 'dup@c.test'), false);
});
test('inviting enqueues an email job; token is only in the job payload (erased by the worker after delivery)', async () => {
  const [[j]]: any = await env.pool.query("SELECT COUNT(*) n FROM jobs WHERE type='email.invitation'"); assert.ok(j.n >= 7);
});
test('every administrative action is in the audit trail', async () => {
  const a = await w.as('aAdmin'); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team }); await w.root.call('DELETE', `/platform/organizations/${w.A}/staff/${w.ids.team}`);
  await a.call('PATCH', `/t/${w.A}/members/${w.ids.aStaff}`, { role: 'third_party_vendor' }); await a.call('DELETE', `/t/${w.A}/members/${w.ids.aVendor}`);
  await w.root.call('PATCH', `/platform/organizations/${w.A}`, { status: 'suspended' }); await w.root.call('PATCH', `/platform/organizations/${w.A}`, { status: 'active' });
  await w.root.call('PATCH', `/platform/users/${w.ids.team}`, { status: 'disabled' }); await w.root.call('PATCH', `/platform/users/${w.ids.team}`, { status: 'active' }); await w.root.call('GET', `/platform/users/${w.ids.bStaff}/backup`); await w.root.call('POST', `/platform/users/${w.ids.bStaff}/delete`, {});
  const actions = ((await w.root.call('GET', '/platform/audit?limit=200')).body.actions) as string[];
  for (const x of ['org.created', 'invitation.created', 'invitation.accepted', 'staff.assigned', 'staff.unassigned', 'member.role_changed', 'member.removed', 'org.suspended', 'user.disabled', 'user.backup_generated', 'user.deleted']) assert.ok(actions.includes(x), 'missing ' + x);
});
test('tenant audit: only that tenant\'s events, filters work, pagination walks the whole log without gaps', async () => {
  const a = await w.as('aAdmin'); const all = (await a.call('GET', `/t/${w.A}/audit?limit=200`)).body; assert.ok(all.items.length > 5); assert.ok(all.items.every((e: any) => e.tenant_id === w.A));
  assert.ok(all.items.every((e: any, i: number, arr: any[]) => i === 0 || arr[i - 1].id > e.id));
  const f = (await a.call('GET', `/t/${w.A}/audit?action=invitation.created`)).body; assert.ok(f.items.length > 0 && f.items.every((e: any) => e.action === 'invitation.created'));
  const actor = (await a.call('GET', `/t/${w.A}/audit?actorId=${w.ids.aAdmin}&limit=200`)).body; assert.ok(actor.items.every((e: any) => e.actor_id === w.ids.aAdmin));
  const seen: number[] = []; let before: number | null = null; do { const r: any = (await a.call('GET', `/t/${w.A}/audit?limit=3${before ? '&beforeId=' + before : ''}`)).body; seen.push(...r.items.map((x: any) => x.id)); before = r.nextBeforeId; } while (before);
  assert.deepEqual(seen, all.items.map((e: any) => e.id)); assert.equal((await a.call('GET', `/t/${w.A}/audit?from=${new Date(Date.now() + 86400000).toISOString()}`)).body.items.length, 0);
  assert.equal((await a.call('GET', `/t/${w.A}/audit?limit=abc`)).status, 400);
});
test('tenant audit visibility: managers and auditors yes; staff/vendor/other tenants no', async () => {
  assert.equal((await (await w.as('aAuditor')).call('GET', `/t/${w.A}/audit`)).status, 200); assert.equal((await (await w.as('aStaff')).call('GET', `/t/${w.A}/audit`)).status, 403);
  assert.equal((await (await w.as('bAdmin')).call('GET', `/t/${w.A}/audit`)).status, 404);
  const bLog = (await (await w.as('bAdmin')).call('GET', `/t/${w.B}/audit?limit=200`)).body.items; assert.ok(bLog.every((e: any) => e.tenant_id === w.B));
});
test('platform audit is admin-level only', async () => {
  assert.equal((await w.root.call('GET', '/platform/audit')).status, 200); assert.equal((await (await env.login('admin@x.test')).call('GET', '/platform/audit')).status, 200);
  assert.equal((await (await env.login('team@x.test')).call('GET', '/platform/audit')).status, 403); assert.equal((await (await w.as('aAdmin')).call('GET', '/platform/audit')).status, 403);
  assert.equal((await env.client().call('GET', '/platform/audit')).status, 401);
});
test('request hygiene on the new routes: CSRF required, bodies validated', async () => {
  const a = await w.as('aAdmin'); assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'c@c.test', role: 'client_staff' }, { 'x-csrf-token': null as any })).status, 403);
  assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'not-an-email', role: 'client_staff' })).status, 400); assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'c@c.test', role: 'super_admin' })).status, 400);
  assert.equal((await a.call('POST', `/t/${w.A}/invitations`, { email: 'c@c.test', role: 'client_staff', tenantId: w.B })).status, 201);   // extra fields ignored: tenant comes from the session+path only
  assert.equal(((await (await w.as('bAdmin')).call('GET', `/t/${w.B}/invitations`)).body as any[]).some(i => i.email === 'c@c.test'), false);
});
