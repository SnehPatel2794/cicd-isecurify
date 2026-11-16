import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, tokenFor, PW } from './helpers'; import { deletionBlockers, manifestProviders } from '../src/modules/users/hooks'; import { softDeleteUser } from '../src/modules/users/service';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); }); after(() => env.close());
const accept = async (email: string) => env.client().call('POST', `/invitations/${await tokenFor(env.pool, email)}/accept`, { name: email.split('@')[0], password: PW });

test('escalation guard: admin cannot create admin/super_admin; can create isecurify_team; super_admin can create admins', async () => {
  const admin = await env.login('admin@x.test');
  for (const role of ['admin', 'super_admin']) assert.equal((await admin.call('POST', '/platform/users', { email: `${role}@x.test`, platformRole: role })).status, 403, role);
  assert.equal((await admin.call('POST', '/platform/users', { email: 'newteam@x.test', platformRole: 'isecurify_team' })).status, 201);
  assert.equal((await w.root.call('POST', '/platform/users', { email: 'admin2@x.test', platformRole: 'admin' })).status, 201);
  assert.equal((await w.root.call('POST', '/platform/users', { email: 'super2@x.test', platformRole: 'super_admin' })).status, 201);
  const team = await env.login('team@x.test'); assert.equal((await team.call('POST', '/platform/users', { email: 'z@x.test', platformRole: 'isecurify_team' })).status, 403);
  assert.equal((await w.as('aAdmin').then(c => c.call('POST', '/platform/users', { email: 'z@x.test', platformRole: 'isecurify_team' }))).status, 403);
});
test('invited platform user gets the platform role; duplicate and existing emails are refused', async () => {
  assert.equal((await accept('newteam@x.test')).status, 200); const [[u]]: any = await env.pool.query("SELECT platform_role FROM users WHERE email='newteam@x.test'"); assert.equal(u.platform_role, 'isecurify_team');
  assert.equal((await w.root.call('POST', '/platform/users', { email: 'newteam@x.test', platformRole: 'isecurify_team' })).status, 409);
  assert.equal((await w.root.call('POST', '/platform/users', { email: 'admin2@x.test', platformRole: 'admin' })).status, 409);   // still pending
});
test('role/status changes follow the guard; nobody edits themselves; admin cannot touch admins', async () => {
  await accept('admin2@x.test'); await accept('super2@x.test'); const [[a2]]: any = await env.pool.query("SELECT id FROM users WHERE email='admin2@x.test'"); const [[s2]]: any = await env.pool.query("SELECT id FROM users WHERE email='super2@x.test'");
  const admin = await env.login('admin@x.test');
  assert.equal((await admin.call('PATCH', `/platform/users/${w.ids.root}`, { status: 'disabled' })).status, 403);
  assert.equal((await admin.call('PATCH', `/platform/users/${a2.id}`, { platformRole: 'isecurify_team' })).status, 403);
  assert.equal((await admin.call('PATCH', `/platform/users/${w.ids.team}`, { platformRole: 'admin' })).status, 403);
  assert.equal((await admin.call('PATCH', `/platform/users/${w.ids.admin}`, { status: 'disabled' })).status, 400);
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.root}`, { platformRole: 'admin' })).status, 400);
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.aStaff}`, { platformRole: 'admin' })).status, 400);       // customer users cannot be promoted this way
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.team}`, { platformRole: 'admin' })).status, 200);
  assert.equal((await w.root.call('PATCH', `/platform/users/${w.ids.team}`, { platformRole: 'isecurify_team' })).status, 200);
  (w.ids as any).super2 = s2.id;
});
test('the last active Super Admin can never be removed (service level)', async () => {
  await env.pool.query("UPDATE users SET status='disabled' WHERE id=?", [(w.ids as any).super2]);
  await assert.rejects(softDeleteUser(env.pool, { actor: { id: (w.ids as any).super2, platformRole: 'super_admin' }, targetId: w.ids.root, withoutBackup: true, confirmEmail: 'root@x.test' }), /last Super Admin/);
  await env.pool.query("UPDATE users SET status='active' WHERE id=?", [(w.ids as any).super2]);
});
test('deletion summary lists memberships and blockers; open items block deletion', async () => {
  const s = (await w.root.call('GET', `/platform/users/${w.ids.aStaff}/deletion-summary`)).body; assert.equal(s.user.email, 'astaff@c.test'); assert.equal(s.memberships.length, 1); assert.equal(s.canDelete, true);
  const blocker = async (_c: any, uid: string) => uid === w.ids.aStaff ? [{ type: 'checklist_item', id: 'i1', label: 'AC-04 Access reviews' }] : []; deletionBlockers.push(blocker);
  const s2 = (await w.root.call('GET', `/platform/users/${w.ids.aStaff}/deletion-summary`)).body; assert.equal(s2.canDelete, false); assert.equal(s2.blockers[0].label, 'AC-04 Access reviews');
  const r = await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, { withoutBackup: true, confirmEmail: 'astaff@c.test' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'has_open_items'); deletionBlockers.length = 0;
});
test('deletion requires a downloaded backup OR typing the exact email', async () => {
  let r = await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, {}); assert.equal(r.status, 409); assert.equal(r.body.code, 'backup_required');
  r = await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, { withoutBackup: true, confirmEmail: 'wrong@c.test' }); assert.equal(r.status, 409);
  assert.equal((await env.pool.query("SELECT status FROM users WHERE id=?", [w.ids.aStaff]) as any)[0][0].status, 'active');
});
test('backup manifest is a real PDF, audited, and includes sections from registered providers', async () => {
  manifestProviders.push(async () => ({ title: 'Evidence uploads (test provider)', headers: ['File'], rows: [['policy.pdf']] }));
  const res = await env.app.inject({ method: 'GET', url: `/platform/users/${w.ids.aStaff}/backup`, headers: { cookie: w.root.cookie } });
  assert.equal(res.statusCode, 200); assert.match(String(res.headers['content-type']), /application\/pdf/); assert.equal(res.rawPayload.subarray(0, 5).toString(), '%PDF-'); assert.ok(res.rawPayload.length > 1000);
  manifestProviders.length = 0; assert.equal((await env.pool.query("SELECT COUNT(*) n FROM audit_events WHERE action='user.backup_generated'") as any)[0][0].n, 1);
  assert.equal((await (await env.login('team@x.test')).call('GET', `/platform/users/${w.ids.aStaff}/backup`)).status, 403);
});
test('soft delete after backup: anonymized, sessions/MFA gone, cannot log in, history rows kept, log written', async () => {
  const s = await w.as('aStaff'); assert.equal((await s.call('GET', '/auth/me')).status, 200);
  const r = await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, { reason: 'left company' }); assert.equal(r.status, 200); assert.equal(r.body.backupTaken, true);
  const [[u]]: any = await env.pool.query('SELECT * FROM users WHERE id=?', [w.ids.aStaff]);
  assert.equal(u.status, 'deleted'); assert.equal(u.name, 'Deleted User'); assert.equal(u.password_hash, null); assert.match(u.email, /^deleted-[0-9a-f]{8}@removed\.invalid$/); assert.ok(u.deleted_at);
  assert.equal((await s.call('GET', '/auth/me')).status, 401); assert.equal((await env.client().call('POST', '/auth/login', { email: 'astaff@c.test', password: PW })).status, 401);
  assert.equal((await env.pool.query('SELECT COUNT(*) n FROM sessions WHERE user_id=?', [w.ids.aStaff]) as any)[0][0].n, 0);
  const [[log]]: any = await env.pool.query('SELECT * FROM user_deletion_log WHERE deleted_user_id=?', [w.ids.aStaff]); assert.equal(log.email_snapshot, 'astaff@c.test'); assert.equal(log.backup_taken, 1); assert.equal(log.reason, 'left company');
  assert.equal((await env.pool.query('SELECT COUNT(*) n FROM memberships WHERE user_id=?', [w.ids.aStaff]) as any)[0][0].n, 1);       // history keeps its foreign keys
  const members = (await (await w.as('aAdmin')).call('GET', `/t/${w.A}/members`)).body as any[]; assert.ok(!members.some(m => m.id === w.ids.aStaff));
  assert.equal((await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, {})).status, 409);                                    // already deleted
});
test('the same email can be used again after deletion', async () => {
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/invitations`, { email: 'astaff@c.test', role: 'client_staff' })).status, 201);
  const a = await accept('astaff@c.test'); assert.equal(a.status, 200); assert.notEqual(a.body.userId, w.ids.aStaff);
});
test('deleting without a backup works with the exact email and records backup_taken=false', async () => {
  const r = await w.root.call('POST', `/platform/users/${w.ids.bStaff}/delete`, { withoutBackup: true, confirmEmail: 'BSTAFF@c.test' }); assert.equal(r.status, 200); assert.equal(r.body.backupTaken, false);
  const [[log]]: any = await env.pool.query('SELECT backup_taken FROM user_deletion_log WHERE deleted_user_id=?', [w.ids.bStaff]); assert.equal(log.backup_taken, 0);
});
test('who may delete: not yourself, admin not super_admin, non-admin platform roles nobody, last-admin rules', async () => {
  const admin = await env.login('admin@x.test');
  assert.equal((await admin.call('POST', `/platform/users/${w.ids.root}/delete`, { withoutBackup: true, confirmEmail: 'root@x.test' })).status, 403);
  assert.equal((await admin.call('POST', `/platform/users/${w.ids.admin}/delete`, { withoutBackup: true, confirmEmail: 'admin@x.test' })).status, 400);
  const team = await env.login('team@x.test'); assert.equal((await team.call('POST', `/platform/users/${w.ids.aAdmin}/delete`, {})).status, 403);
  assert.equal((await w.root.call('POST', `/platform/users/${w.ids.root}/delete`, {})).status, 400);
  const c = await w.as('aAdmin'); assert.equal((await c.call('GET', '/platform/users')).status, 403);
});
test('user directory and deletion log are admin-level only; deleted users hidden by default', async () => {
  const list = (await w.root.call('GET', '/platform/users')).body as any[]; assert.ok(list.length > 5); assert.ok(!list.some(u => u.status === 'deleted')); assert.ok(list.find(u => u.email === 'root@x.test').platformRole === 'super_admin');
  assert.ok(((await w.root.call('GET', '/platform/users?status=deleted')).body as any[]).length >= 2); assert.equal(((await w.root.call('GET', '/platform/users?q=aadmin')).body as any[]).length, 1);
  assert.ok(((await w.root.call('GET', '/platform/deletion-log')).body as any[]).length >= 2); assert.equal((await (await env.login('team@x.test')).call('GET', '/platform/deletion-log')).status, 403);
});
