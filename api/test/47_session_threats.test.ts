// Threat model: session fixation, theft and replay.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshEnv, world, PW } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; const A = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => ((await env.pool.query(sql, p)) as any)[0] as any[];
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex'); const cookieOf = (r: any) => String(([] as string[]).concat(r.headers['set-cookie'] ?? []).join(';'));
before(async () => { env = await freshEnv({ requireMfaForPlatform: false, origin: 'https://app.example.test' } as any); w = await world(env); }); after(() => env.close());

test('fixation: a session cookie chosen by an attacker is never adopted; login always issues a new secret', async () => {
  const c = env.client(); c.cookie = 'sid=attacker-chosen-value-123'; const r = await c.call('POST', '/auth/login', { email: 'aadmin@c.test', password: PW }, { origin: 'https://app.example.test' }); assert.equal(r.status, 200);
  assert.ok(c.cookie.startsWith('sid=') && c.cookie !== 'sid=attacker-chosen-value-123'); assert.equal((await rows('SELECT COUNT(*) n FROM sessions WHERE token_hash=?', [sha('attacker-chosen-value-123')]))[0].n, 0);
  const attacker = env.client(); attacker.cookie = 'sid=attacker-chosen-value-123'; assert.equal((await attacker.call('GET', '/auth/me')).status, 401);
  const a = await env.login('aadmin@c.test'), b = await env.login('aadmin@c.test'); assert.notEqual(a.cookie, b.cookie, 'each login is a different session');
});
test('the session secret is only ever stored hashed, and never appears in a response body', async () => {
  const c = env.client(); const r = await c.call('POST', '/auth/login', { email: 'aadmin@c.test', password: PW }); const secret = c.cookie.replace('sid=', ''); assert.equal((await rows('SELECT COUNT(*) n FROM sessions WHERE token_hash=?', [secret]))[0].n, 0); assert.equal((await rows('SELECT COUNT(*) n FROM sessions WHERE token_hash=?', [sha(secret)]))[0].n, 1);
  assert.equal(JSON.stringify(r.body).includes(secret), false); const list = (await c.call('GET', '/auth/sessions')).body; const text = JSON.stringify(list); assert.equal(text.includes(secret) || text.includes(sha(secret)) || /token/i.test(text), false, 'the session list shows no secrets');
});
test('cookie attributes: HttpOnly, SameSite=Strict, path, expiry; in production Secure and the __Host- prefix', async () => {
  const dev = cookieOf(await env.client().call('POST', '/auth/login', { email: 'aadmin@c.test', password: PW })); assert.match(dev, /^sid=/); assert.match(dev, /HttpOnly/i); assert.match(dev, /SameSite=Strict/i); assert.match(dev, /Path=\//); assert.match(dev, /Max-Age=\d+/);
  const prod = await freshEnv({ production: true, requireMfaForPlatform: false } as any); try { const pw = await world(prod); const c = prod.client(); const r = await c.call('POST', '/auth/login', { email: 'aadmin@c.test', password: PW }); assert.equal(r.status, 200); const ck = cookieOf(r); assert.match(ck, /^__Host-sid=/); assert.match(ck, /Secure/i); assert.match(ck, /HttpOnly/i); assert.match(ck, /SameSite=Strict/i); assert.equal(pw.A.length, 36); } finally { await prod.close(); }
});
test('a request carrying the cookie but not the matching CSRF token (the cross-site case) cannot change anything; tokens from another session or user are useless', async () => {
  const victim = await env.login('aadmin@c.test'); const victim2 = await env.login('aadmin@c.test'); const other = await env.login('bstaff@c.test');
  const thief = env.client(); thief.cookie = victim.cookie; const OK = { origin: 'https://app.example.test' }; const NEW = { title: 'x', description: 'd', category: 'security', likelihood: 1, impact: 1 }; const nt = await thief.call('POST', A('/risks'), NEW, OK); assert.equal(nt.status, 403); assert.equal(nt.body.code, 'csrf');
  thief.csrf = victim2.csrf; assert.equal((await thief.call('POST', A('/risks'), NEW, OK)).status, 403, 'the other session\'s token'); thief.csrf = other.csrf; assert.equal((await thief.call('POST', A('/risks'), NEW, OK)).status, 403, 'another user\'s token');
  thief.csrf = ''; assert.equal((await thief.call('POST', A('/risks'), { title: 'x', description: 'd', category: 'security', likelihood: 1, impact: 1 }, { ...OK, 'x-csrf-token': 'AAAA' })).status, 403);
  assert.equal((await rows("SELECT COUNT(*) n FROM risks WHERE title='x'"))[0].n, 0);
});
test('a stolen session stops working the moment the victim logs out, revokes it, changes the password or is disabled', async () => {
  const mk = async () => { const v = await env.login('astaff@c.test'); const t = env.client(); t.cookie = v.cookie; t.csrf = v.csrf; assert.equal((await t.call('GET', '/auth/me')).status, 200); return { v, t }; };
  let s = await mk(); await s.v.call('POST', '/auth/logout', {}); assert.equal((await s.t.call('GET', '/auth/me')).status, 401, 'logout');
  s = await mk(); const list = (await s.v.call('GET', '/auth/sessions')).body; const cur = (list.sessions ?? list).find((x: any) => x.current)?.id; assert.ok(cur); await s.v.call('DELETE', `/auth/sessions/${cur}`); assert.equal((await s.t.call('GET', '/auth/me')).status, 401, 'revoke');
  s = await mk(); const other = await env.login('astaff@c.test'); assert.equal((await other.call('POST', '/auth/password/change', { currentPassword: PW, newPassword: 'An0therStr0ng!Pass' })).status, 200); assert.equal((await s.t.call('GET', '/auth/me')).status, 401, 'password change'); assert.equal((await other.call('GET', '/auth/me')).status, 200, 'the session that changed it stays');
  await env.pool.query("UPDATE users SET status='disabled' WHERE email='bstaff@c.test'"); const dead = await env.client().call('POST', '/auth/login', { email: 'bstaff@c.test', password: PW }); assert.ok([401, 403].includes(dead.status)); await env.pool.query("UPDATE users SET status='active' WHERE email='bstaff@c.test'");
  const v = await env.login('bstaff@c.test'); await env.pool.query("UPDATE users SET status='disabled' WHERE email='bstaff@c.test'"); assert.equal((await v.call('GET', '/auth/me')).status, 401, 'disabled while signed in'); await env.pool.query("UPDATE users SET status='active' WHERE email='bstaff@c.test'");
});
test('expired sessions are refused', async () => { const v = await env.login('aauditor@c.test'); await env.pool.query("UPDATE sessions SET expires_at=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE user_id=?", [w.ids.aAuditor]); assert.equal((await v.call('GET', '/auth/me')).status, 401); });
test('a session waiting for the second factor cannot reach any data', async () => {
  const u = await env.login('aadmin@c.test'); const enr = await u.call('POST', '/auth/mfa/enroll', {}); const { totpNow } = await import('./helpers'); await u.call('POST', '/auth/mfa/confirm', { code: totpNow(enr.body.secret) });
  const c = env.client(); const l = await c.call('POST', '/auth/login', { email: 'aadmin@c.test', password: PW }); assert.equal(l.body.mfaRequired, true); for (const p of [A('/dashboard'), A('/engagements'), '/auth/sessions']) { const r = await c.call('GET', p); assert.equal(r.status, 401, p); assert.equal(r.body.code, 'mfa_required'); }
  assert.equal((await c.call('POST', A('/risks'), { title: 'y', description: 'd', category: 'security', likelihood: 1, impact: 1 })).status, 401);
});
test('cross-site request forgery: a form post, a foreign Origin or a missing token cannot change anything', async () => {
  const v = await env.login('aauditor@c.test'); const body = JSON.stringify({ name: 'z' });
  const form = await env.app.inject({ method: 'POST', url: A('/risks'), headers: { cookie: v.cookie, 'content-type': 'application/x-www-form-urlencoded', 'content-length': '5' }, payload: 'a=b&c' }); assert.ok([400, 403].includes(form.statusCode)); const evil = await v.call('POST', A('/risks'), { title: 'q', description: 'd', category: 'security', likelihood: 1, impact: 1 }, { origin: 'https://evil.example' }); assert.equal(evil.status, 403);
  assert.equal((await v.call('POST', A('/risks'), { title: 'q', description: 'd', category: 'security', likelihood: 1, impact: 1 }, { 'x-csrf-token': null as any })).status, 403); void body;
});
test('login does not reveal which part was wrong, and the same answer comes back for unknown and known accounts', async () => {
  const a = await env.client().call('POST', '/auth/login', { email: 'nobody@c.test', password: PW }); const b = await env.client().call('POST', '/auth/login', { email: 'aadmin@c.test', password: 'wrong-Password-1!' }); assert.equal(a.status, b.status); assert.deepEqual(a.body, b.body);
});

test('honest limit: whoever holds the full session cookie can read /auth/me, learn the CSRF token and act as that user; HttpOnly + SameSite + revocation are what contain that', async () => {
  const v = await env.login('avendor@c.test'); const t = env.client(); t.cookie = v.cookie; assert.equal((await t.call('GET', '/auth/me')).status, 200); assert.ok(t.csrf, 'the token is handed to the cookie holder'); const sessions = (await v.call('GET', '/auth/sessions')).body; assert.ok(JSON.stringify(sessions).length > 2, 'and the owner can see and revoke their sessions');
});
