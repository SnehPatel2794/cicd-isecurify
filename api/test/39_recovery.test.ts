import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world } from './helpers'; import { recoverAdmin, RecoveryError } from '../src/recovery';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>;
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[]; const tokenOf = (link: string) => decodeURIComponent(link.split('token=')[1]);
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); }); after(() => env.close());
test('a locked-out administrator is unlocked, signed out everywhere, and can set a new password with the one-time link', async () => {
  const sess = await env.login('admin@x.test'); assert.equal((await sess.call('GET', '/auth/me')).status, 200); await env.pool.query("UPDATE users SET failed_logins=9, locked_until=NOW() + INTERVAL 1 HOUR WHERE email='admin@x.test'");
  assert.equal((await env.client().call('POST', '/auth/login', { email: 'admin@x.test', password: 'whatever-Pass-1' })).status, 423);
  const r = await recoverAdmin(env.pool as any, { email: ' ADMIN@x.test ', resetMfa: false, origin: 'https://grc.example.com/' }); assert.match(r.link, /^https:\/\/grc\.example\.com\/reset-password\?token=[\w-]{30,}$/); assert.equal(r.expiresInMinutes, 30);
  const [u] = await rows("SELECT failed_logins f, locked_until l FROM users WHERE email='admin@x.test'"); assert.deepEqual([u.f, u.l], [0, null]); assert.equal((await sess.call('GET', '/auth/me')).status, 401, 'old sessions are ended');
  const reset = await env.client().call('POST', '/auth/password/reset', { token: tokenOf(r.link), newPassword: 'Brand-New-Pass-123' }); assert.equal(reset.status, 200); assert.equal((await env.client().call('POST', '/auth/password/reset', { token: tokenOf(r.link), newPassword: 'Another-Pass-1234' })).status, 400, 'the link works once');
  const login = await env.client().call('POST', '/auth/login', { email: 'admin@x.test', password: 'Brand-New-Pass-123' }); assert.equal(login.status, 200);
  const [a] = await rows("SELECT actor_id, detail FROM audit_events WHERE action='auth.admin_recovery'"); assert.equal(a.actor_id, null); assert.match(JSON.stringify(a.detail), /server operator/);
});
test('a new link replaces the old one; the token is stored only as a hash', async () => {
  const a = await recoverAdmin(env.pool as any, { email: 'root@x.test', resetMfa: false, origin: 'https://g.example.com' }); const b = await recoverAdmin(env.pool as any, { email: 'root@x.test', resetMfa: false, origin: 'https://g.example.com', minutes: 5 });
  assert.equal((await env.client().call('POST', '/auth/password/reset', { token: tokenOf(a.link), newPassword: 'Brand-New-Pass-123' })).status, 400); assert.equal(b.expiresInMinutes, 5);
  const [r] = await rows('SELECT token_hash FROM password_resets WHERE used_at IS NULL'); assert.ok(!JSON.stringify(r).includes(tokenOf(b.link)));
});
test('reset-mfa removes lost two-step verification and recovery codes, and only then', async () => {
  const [u] = await rows("SELECT id FROM users WHERE email='admin@x.test'"); await env.pool.query("INSERT INTO mfa_secrets(user_id,secret_enc,enabled) VALUES (?,?,1)", [u.id, 'x']); await env.pool.query("INSERT INTO recovery_codes(user_id,code_hash) VALUES (?,?)", [u.id, 'h'.repeat(64)]);
  await recoverAdmin(env.pool as any, { email: 'admin@x.test', resetMfa: false, origin: 'https://g.example.com' }); assert.equal((await rows('SELECT * FROM mfa_secrets')).length, 1); assert.equal((await rows('SELECT * FROM recovery_codes')).length, 1);
  const r = await recoverAdmin(env.pool as any, { email: 'admin@x.test', resetMfa: true, origin: 'https://g.example.com' }); assert.equal(r.mfaReset, true); assert.equal((await rows('SELECT * FROM mfa_secrets')).length, 0); assert.equal((await rows('SELECT * FROM recovery_codes')).length, 0);
});
test('refuses ordinary users, unknown, disabled and bad origins; nothing changes', async () => {
  const before = (await rows('SELECT COUNT(*) n FROM password_resets'))[0].n;
  for (const email of ['aadmin@x.test', 'nobody@x.test']) await assert.rejects(recoverAdmin(env.pool as any, { email, resetMfa: true, origin: 'https://g.example.com' }), RecoveryError);
  await env.pool.query("UPDATE users SET status='disabled' WHERE email='admin@x.test'"); await assert.rejects(recoverAdmin(env.pool as any, { email: 'admin@x.test', resetMfa: false, origin: 'https://g.example.com' }), RecoveryError); await env.pool.query("UPDATE users SET status='active' WHERE email='admin@x.test'");
  await assert.rejects(recoverAdmin(env.pool as any, { email: 'admin@x.test', resetMfa: false, origin: '' }), /APP_ORIGIN/); assert.equal((await rows('SELECT COUNT(*) n FROM password_resets'))[0].n, before);
});
import crypto from 'node:crypto'; import { rotateMfaKey, parseKey } from '../src/rotatekey'; import { encrypt, decrypt } from '../src/platform/crypto';
test('MFA key rotation: dry run changes nothing, apply re-encrypts every secret, a wrong old key changes nothing', async () => {
  const oldK = crypto.randomBytes(32), newK = crypto.randomBytes(32); await env.pool.query('DELETE FROM mfa_secrets'); const ids = (await rows('SELECT id FROM users LIMIT 3')).map(r => r.id);
  for (const [i, id] of ids.entries()) await env.pool.query('INSERT INTO mfa_secrets(user_id,secret_enc,enabled) VALUES (?,?,1)', [id, encrypt('SECRET' + i, oldK)]);
  const snap = JSON.stringify(await rows('SELECT user_id, secret_enc FROM mfa_secrets ORDER BY user_id')); assert.deepEqual(await rotateMfaKey(env.pool as any, oldK, newK, false), { secrets: 3, applied: false }); assert.equal(JSON.stringify(await rows('SELECT user_id, secret_enc FROM mfa_secrets ORDER BY user_id')), snap);
  await assert.rejects(rotateMfaKey(env.pool as any, crypto.randomBytes(32), newK, true), /cannot open the secret/); assert.equal(JSON.stringify(await rows('SELECT user_id, secret_enc FROM mfa_secrets ORDER BY user_id')), snap, 'all or nothing');
  await env.pool.query('UPDATE mfa_secrets SET secret_enc=? WHERE user_id=?', ['garbage', ids[2]]); await assert.rejects(rotateMfaKey(env.pool as any, oldK, newK, true), /Nothing was changed/); await env.pool.query('UPDATE mfa_secrets SET secret_enc=? WHERE user_id=?', [encrypt('SECRET2', oldK), ids[2]]);
  assert.deepEqual(await rotateMfaKey(env.pool as any, oldK, newK, true), { secrets: 3, applied: true }); const after = await rows('SELECT user_id, secret_enc FROM mfa_secrets ORDER BY user_id'); assert.equal(after.length, 3);
  const plains = after.map(r => decrypt(r.secret_enc, newK)).sort(); assert.deepEqual(plains, ['SECRET0', 'SECRET1', 'SECRET2']); for (const r of after) assert.throws(() => decrypt(r.secret_enc, oldK));
  await assert.rejects(rotateMfaKey(env.pool as any, newK, newK, true), /same/); assert.throws(() => parseKey('AAAA', 'K'), /32 bytes/); assert.throws(() => parseKey(Buffer.alloc(32, 7).toString('base64'), 'K'), /placeholder/); assert.equal(parseKey(newK.toString('base64'), 'K').length, 32);
});
