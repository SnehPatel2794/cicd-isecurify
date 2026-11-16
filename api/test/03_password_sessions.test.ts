import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, PW } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); await env.mkUser('u@x.test'); }); after(() => env.close());
const NEWPW = 'Brand-New-Passw0rd';

test('change password: needs current password, revokes other sessions, keeps current', async () => {
  const a = await env.login('u@x.test'), b = await env.login('u@x.test');
  assert.equal((await a.call('POST', '/auth/password/change', { currentPassword: 'wrong-Wrong-1', newPassword: NEWPW })).status, 403);
  assert.equal((await a.call('POST', '/auth/password/change', { currentPassword: PW, newPassword: 'short' })).status, 400);
  assert.equal((await a.call('POST', '/auth/password/change', { currentPassword: PW, newPassword: NEWPW })).status, 200);
  assert.equal((await a.call('GET', '/auth/me')).status, 200); assert.equal((await b.call('GET', '/auth/me')).status, 401);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'u@x.test', password: PW })).status, 401);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'u@x.test', password: NEWPW })).status, 200);
});
test('reset request gives the same answer for known and unknown emails; only known creates a token + job', async () => {
  const a = await env.client().call('POST', '/auth/password/reset-request', { email: 'u@x.test' }), b = await env.client().call('POST', '/auth/password/reset-request', { email: 'ghost@x.test' });
  assert.equal(a.status, 200); assert.deepEqual(a.body, b.body);
  assert.equal((await env.pool.query('SELECT COUNT(*) n FROM password_resets') as any)[0][0].n, 1); assert.equal((await env.pool.query("SELECT COUNT(*) n FROM jobs WHERE type='email.password_reset'") as any)[0][0].n, 1);
});
test('reset: token is single-use, hashed in DB, kills all sessions, unlocks the account', async () => {
  const [[j]]: any = await env.pool.query("SELECT payload FROM jobs WHERE type='email.password_reset' ORDER BY id DESC LIMIT 1"); const token = (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload).token;
  const [[r]]: any = await env.pool.query('SELECT token_hash FROM password_resets'); assert.notEqual(r.token_hash, token);
  const s = await env.login('u@x.test', NEWPW); await env.pool.query("UPDATE users SET locked_until = NOW() + INTERVAL 10 MINUTE WHERE email='u@x.test'");
  assert.equal((await env.client().call('POST', '/auth/password/reset', { token, newPassword: 'weak' })).status, 400);
  assert.equal((await env.client().call('POST', '/auth/password/reset', { token, newPassword: 'Reset-Passw0rd-OK' })).status, 200);
  assert.equal((await env.client().call('POST', '/auth/password/reset', { token, newPassword: 'Another-Passw0rd-OK' })).status, 400);
  assert.equal((await s.call('GET', '/auth/me')).status, 401);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'u@x.test', password: 'Reset-Passw0rd-OK' })).status, 200);
});
test('expired reset token is refused', async () => {
  await env.client().call('POST', '/auth/password/reset-request', { email: 'u@x.test' });
  const [[j]]: any = await env.pool.query("SELECT payload FROM jobs WHERE type='email.password_reset' ORDER BY id DESC LIMIT 1"); const token = (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload).token;
  await env.pool.query('UPDATE password_resets SET expires_at = NOW() - INTERVAL 1 MINUTE'); assert.equal((await env.client().call('POST', '/auth/password/reset', { token, newPassword: 'Late-Passw0rd-OK1' })).status, 400);
});
test('sessions: list shows current; revoke one; revoke others', async () => {
  const a = await env.login('u@x.test', 'Reset-Passw0rd-OK'), b = await env.login('u@x.test', 'Reset-Passw0rd-OK'), c = await env.login('u@x.test', 'Reset-Passw0rd-OK');
  const list = (await a.call('GET', '/auth/sessions')).body; assert.ok(list.length >= 3); assert.equal(list.filter((s: any) => s.current).length, 1);
  const other = list.find((s: any) => !s.current); assert.equal((await a.call('DELETE', `/auth/sessions/${other.id}`)).status, 200);
  assert.equal((await a.call('POST', '/auth/sessions/revoke-others', {})).status, 200); assert.equal((await a.call('GET', '/auth/me')).status, 200);
  assert.equal(((await a.call('GET', '/auth/sessions')).body as any[]).length, 1);
});
test('a user cannot revoke another user\'s session', async () => {
  await env.mkUser('v@x.test'); const v = await env.login('v@x.test'); const a = await env.login('u@x.test', 'Reset-Passw0rd-OK'); const id = (await v.call('GET', '/auth/sessions')).body[0].id;
  assert.equal((await a.call('DELETE', `/auth/sessions/${id}`)).status, 404); assert.equal((await v.call('GET', '/auth/me')).status, 200);
});
