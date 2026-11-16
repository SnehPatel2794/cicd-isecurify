import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, PW } from './helpers'; import { migrate } from '../src/migrate';
let env: Awaited<ReturnType<typeof freshEnv>>; before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); }); after(() => env.close());

test('migrations are idempotent', async () => { assert.deepEqual(await migrate(env.pool), []); });
test('setup: once only, strong password required', async () => {
  const c = env.client();
  assert.equal((await c.call('GET', '/setup')).body.needsSetup, true);
  assert.equal((await c.call('POST', '/setup', { email: 'root@x.test', name: 'Root', password: 'weak' })).status, 400);
  assert.equal((await c.call('POST', '/setup', { email: 'root@x.test', name: 'Root', password: PW })).status, 201);
  assert.equal((await c.call('POST', '/setup', { email: 'two@x.test', name: 'Two', password: PW })).status, 403);
  assert.equal((await c.call('GET', '/setup')).body.needsSetup, false);
});
test('concurrent setup creates exactly one super_admin', async () => {
  const e2 = await freshEnv(); try {
    const rs = await Promise.all([1, 2, 3, 4].map(i => e2.client().call('POST', '/setup', { email: `u${i}@x.test`, name: 'U', password: PW })));
    assert.equal(rs.filter(r => r.status === 201).length, 1); assert.equal((await e2.pool.query('SELECT COUNT(*) n FROM users') as any)[0][0].n, 1);
  } finally { await e2.close(); }
});
test('password is stored as argon2id', async () => { const [[u]]: any = await env.pool.query("SELECT password_hash FROM users WHERE email='root@x.test'"); assert.match(u.password_hash, /^\$argon2id\$/); });
test('login: HttpOnly + SameSite=Strict cookie; only the token hash is stored', async () => {
  const c = env.client(); const r = await c.call('POST', '/auth/login', { email: 'root@x.test', password: PW }); assert.equal(r.status, 200);
  const sc = String(r.headers['set-cookie']); assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  const tok = /sid=([^;]+)/.exec(sc)![1]; const [rows]: any = await env.pool.query('SELECT token_hash FROM sessions'); assert.ok(rows.every((x: any) => x.token_hash !== tok && x.token_hash.length === 64));
  assert.equal((await c.call('GET', '/auth/me')).status, 200);
  assert.equal((await c.call('POST', '/auth/logout')).status, 200); assert.equal((await c.call('GET', '/auth/me')).status, 401);
});
test('production cookie uses __Host- prefix and Secure', async () => {
  const e3 = await freshEnv({ production: true, requireMfaForPlatform: false }); try {
    await e3.mkUser('p@x.test'); const r = await e3.client().call('POST', '/auth/login', { email: 'p@x.test', password: PW }); const sc = String(r.headers['set-cookie']);
    assert.match(sc, /__Host-sid=/); assert.match(sc, /Secure/i); assert.match(sc, /Path=\//);
  } finally { await e3.close(); }
});
test('unauthenticated requests are rejected', async () => { for (const u of ['/auth/me', '/auth/sessions']) assert.equal((await env.client().call('GET', u)).status, 401); });
test('unknown user and wrong password are indistinguishable', async () => {
  const a = await env.client().call('POST', '/auth/login', { email: 'nobody@x.test', password: 'Whatever12345' }); const b = await env.client().call('POST', '/auth/login', { email: 'root@x.test', password: 'Whatever12345' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.deepEqual(a.body, b.body);
});
test('CSRF: state-changing request without or with wrong token is rejected', async () => {
  const c = await env.login('root@x.test');
  assert.equal((await c.call('POST', '/auth/sessions/revoke-others', {}, { 'x-csrf-token': null as any })).status, 403);
  assert.equal((await c.call('POST', '/auth/sessions/revoke-others', {}, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await c.call('POST', '/auth/sessions/revoke-others', {})).status, 200);
});
test('CSRF token is bound to the session (another session\'s token fails)', async () => {
  const a = await env.login('root@x.test'), b = await env.login('root@x.test');
  assert.equal((await a.call('POST', '/auth/sessions/revoke-others', {}, { 'x-csrf-token': b.csrf })).status, 403);
});
test('Origin mismatch and non-JSON bodies are rejected', async () => {
  const e4 = await freshEnv({ origin: 'https://grc.example.com' }); try {
    assert.equal((await e4.client().call('POST', '/auth/login', { email: 'a@b.test', password: 'x' }, { origin: 'https://evil.example' })).status, 403);
    const r = await e4.app.inject({ method: 'POST', url: '/auth/login', payload: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } }); assert.equal(r.statusCode, 400);
  } finally { await e4.close(); }
});
test('lockout after 5 failures; correct password refused while locked; unlocks after expiry', async () => {
  await env.mkUser('lock@x.test');
  for (let i = 0; i < 5; i++) assert.equal((await env.client().call('POST', '/auth/login', { email: 'lock@x.test', password: 'Wrong-Password-1' })).status, 401);
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'lock@x.test', password: PW })).status, 423);
  await env.pool.query("UPDATE users SET locked_until = NOW() - INTERVAL 1 MINUTE WHERE email='lock@x.test'");
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'lock@x.test', password: PW })).status, 200);
});
test('login rate limit per IP', async () => {
  const e5 = await freshEnv({ limits: { login: 3, reset: 5, mfa: 10 } }); try {
    const r = []; for (let i = 0; i < 5; i++) r.push((await e5.client().call('POST', '/auth/login', { email: 'x@x.test', password: 'Nope-Nope-123' })).status);
    assert.deepEqual(r, [401, 401, 401, 429, 429]);
  } finally { await e5.close(); }
});
test('expired session rejected; disabled user loses access immediately', async () => {
  await env.mkUser('exp@x.test'); const c = await env.login('exp@x.test'); assert.equal((await c.call('GET', '/auth/me')).status, 200);
  await env.pool.query("UPDATE users SET status='disabled' WHERE email='exp@x.test'"); assert.equal((await c.call('GET', '/auth/me')).status, 401);
  await env.pool.query("UPDATE users SET status='active' WHERE email='exp@x.test'"); assert.equal((await c.call('GET', '/auth/me')).status, 200);
  await env.pool.query('UPDATE sessions SET expires_at = NOW() - INTERVAL 1 MINUTE'); assert.equal((await c.call('GET', '/auth/me')).status, 401);
});
test('audit trail written for setup, failures, lock and login', async () => {
  const [rows]: any = await env.pool.query('SELECT DISTINCT action FROM audit_events'); const a = rows.map((r: any) => r.action);
  for (const x of ['setup.super_admin_created', 'auth.login', 'auth.login_failed', 'auth.account_locked']) assert.ok(a.includes(x), x);
});
test('audit_events is append-only (trigger)', async () => {
  await assert.rejects(env.pool.query("UPDATE audit_events SET action='x'"), /append-only/); await assert.rejects(env.pool.query('DELETE FROM audit_events'), /append-only/);
});
test('logs never contain passwords, session tokens or cookies', async () => {
  await env.mkUser('log@x.test'); const c = env.client(); await c.call('POST', '/auth/login', { email: 'log@x.test', password: PW }); await c.call('GET', '/auth/me');
  const all = env.logs.join('\n'); assert.ok(all.length > 0); assert.ok(!all.includes(PW)); assert.ok(!all.includes(c.cookie.split('=')[1])); assert.ok(!/set-cookie/i.test(all) || all.includes('[redacted]'));
});
test('health and readiness endpoints', async () => { assert.equal((await env.client().call('GET', '/health')).status, 200); assert.equal((await env.client().call('GET', '/ready')).status, 200); });
