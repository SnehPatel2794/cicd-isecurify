import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, totpNow, PW } from './helpers'; import { hotp, verifyTotp, b32encode } from '../src/platform/totp';
let env: Awaited<ReturnType<typeof freshEnv>>; before(async () => { env = await freshEnv(); }); after(() => env.close());

test('TOTP implementation matches RFC 6238 test vector', () => {
  const secret = Buffer.from('12345678901234567890'); assert.equal(hotp(secret, Math.floor(59 / 30), 8), '94287082'); assert.equal(hotp(secret, Math.floor(1111111109 / 30), 8), '07081804');
  assert.equal(verifyTotp(b32encode(secret), '287082', 59_000), 1); assert.equal(verifyTotp(b32encode(secret), '000000', 59_000), null);
});
test('platform user without MFA is blocked everywhere except enrollment', async () => {
  await env.mkUser('admin@x.test', 'admin'); const c = await env.login('admin@x.test');
  const me = await c.call('GET', '/auth/me'); assert.equal(me.status, 200); assert.equal(me.body.mfaEnrollmentRequired, true);
  const pw = await c.call('POST', '/auth/password/change', { currentPassword: PW, newPassword: 'Another-Str0ng-Pw' }); assert.equal(pw.status, 403); assert.equal(pw.body.code, 'mfa_enrollment_required');
  assert.equal((await c.call('POST', '/auth/mfa/enroll', {})).status, 200);
});
let secret = '', codes: string[] = [];
test('enrollment: wrong code rejected, correct code enables MFA and returns 10 one-time recovery codes', async () => {
  const c = await env.login('admin@x.test'); const e = await c.call('POST', '/auth/mfa/enroll', {}); secret = e.body.secret; assert.match(e.body.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal((await c.call('POST', '/auth/mfa/confirm', { code: '000000' })).status, 400);
  const ok = await c.call('POST', '/auth/mfa/confirm', { code: totpNow(secret) }); assert.equal(ok.status, 200); codes = ok.body.recoveryCodes; assert.equal(codes.length, 10);
  const [[m]]: any = await env.pool.query("SELECT secret_enc FROM mfa_secrets WHERE enabled=1"); assert.ok(!m.secret_enc.includes(secret));            // encrypted at rest
  const [rc]: any = await env.pool.query('SELECT code_hash FROM recovery_codes'); assert.ok(rc.every((r: any) => r.code_hash.length === 64 && !codes.includes(r.code_hash)));
  assert.equal((await c.call('GET', '/auth/me')).body.mfaEnrollmentRequired, false);
});
test('login with MFA: pending session cannot access anything; verify rotates the session', async () => {
  const c = env.client(); const l = await c.call('POST', '/auth/login', { email: 'admin@x.test', password: PW }); assert.equal(l.body.mfaRequired, true);
  const pendingCookie = c.cookie; const me = await c.call('GET', '/auth/me'); assert.equal(me.status, 401); assert.equal(me.body.code, 'mfa_required');
  assert.equal((await c.call('GET', '/auth/sessions')).status, 401);
  assert.equal((await c.call('POST', '/auth/mfa/verify', { code: '123456' })).status, 401);
  // advance past the replay window used at enrollment: the next step's code is accepted (+-1 step drift)
  const v = await c.call('POST', '/auth/mfa/verify', { code: totpNow(secret, 1) }); assert.equal(v.status, 200);
  assert.notEqual(c.cookie, pendingCookie); assert.equal((await c.call('GET', '/auth/me')).status, 200);
  const old = env.client(); old.cookie = pendingCookie; assert.equal((await old.call('GET', '/auth/me')).status, 401);
});
test('TOTP replay: a code (time step) cannot be used twice', async () => {
  const code = totpNow(secret, 1);   // step +1 already consumed in previous test -> must fail
  const c = env.client(); await c.call('POST', '/auth/login', { email: 'admin@x.test', password: PW }); assert.equal((await c.call('POST', '/auth/mfa/verify', { code })).status, 401);
  assert.equal((await c.call('POST', '/auth/mfa/verify', { code: totpNow(secret, 0) })).status, 401);   // older than last_step
});
test('recovery code works exactly once', async () => {
  const c = env.client(); await c.call('POST', '/auth/login', { email: 'admin@x.test', password: PW }); assert.equal((await c.call('POST', '/auth/mfa/verify', { code: codes[0].toLowerCase() })).status, 200);
  const d = env.client(); await d.call('POST', '/auth/login', { email: 'admin@x.test', password: PW }); assert.equal((await d.call('POST', '/auth/mfa/verify', { code: codes[0] })).status, 401);
  assert.equal((await d.call('POST', '/auth/mfa/verify', { code: codes[1] })).status, 200);
});
test('MFA attempts are rate limited', async () => {
  const e = await freshEnv({ limits: { login: 100, reset: 5, mfa: 3 } }); try {
    await e.mkUser('m@x.test', 'none'); const c = await e.login('m@x.test'); await c.call('POST', '/auth/mfa/enroll', {}); const s = (await e.pool.query('SELECT 1')) && null;
    const [[row]]: any = await e.pool.query('SELECT secret_enc FROM mfa_secrets'); const { decrypt } = await import('../src/platform/crypto'); const sec = decrypt(row.secret_enc, e.cfg.mfaKey);
    await c.call('POST', '/auth/mfa/confirm', { code: totpNow(sec) }); const d = e.client(); await d.call('POST', '/auth/login', { email: 'm@x.test', password: PW });
    const r = []; for (let i = 0; i < 5; i++) r.push((await d.call('POST', '/auth/mfa/verify', { code: '000000' })).status); assert.deepEqual(r, [401, 401, 401, 429, 429]);
  } finally { await e.close(); }
});
test('platform users cannot disable MFA; normal users can with password + code', async () => {
  const a = await env.login('admin@x.test').catch(() => null); // may need MFA; use direct path
  const c = env.client(); await c.call('POST', '/auth/login', { email: 'admin@x.test', password: PW }); await c.call('POST', '/auth/mfa/verify', { code: codes[2] });
  assert.equal((await c.call('POST', '/auth/mfa/disable', { password: PW, code: totpNow(secret, 2) })).status, 403);
  const e = await freshEnv(); try {
    await e.mkUser('n@x.test'); const u = await e.login('n@x.test'); const en = await u.call('POST', '/auth/mfa/enroll', {}); await u.call('POST', '/auth/mfa/confirm', { code: totpNow(en.body.secret) });
    assert.equal((await u.call('POST', '/auth/mfa/disable', { password: 'Wrong-Pass-123', code: totpNow(en.body.secret, 1) })).status, 403);
    assert.equal((await u.call('POST', '/auth/mfa/disable', { password: PW, code: totpNow(en.body.secret, 1) })).status, 200);
    assert.equal((await e.pool.query('SELECT COUNT(*) n FROM mfa_secrets') as any)[0][0].n, 0);
  } finally { await e.close(); }
});
