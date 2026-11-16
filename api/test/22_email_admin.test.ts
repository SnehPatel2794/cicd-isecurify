import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { freshEnv, world } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>, w: Awaited<ReturnType<typeof world>>; let admin: any, team: any, aAdmin: any; let prod: Awaited<ReturnType<typeof freshEnv>>, pRoot: any;
const rows = async (e: any, sql: string, p: any[] = []) => (await e.pool.query(sql, p) as any)[0] as any[];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, mail: { configured: true, host: 'smtp.example.com', port: 587, tls: 'starttls', from: 'iSecurify <noreply@example.com>' }, origin: 'https://grc.example.com' } as any); w = await world(env);
  admin = await env.login('admin@x.test'); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin');
  prod = await freshEnv({ requireMfaForPlatform: false, production: true } as any); await prod.mkUser('root@x.test', 'super_admin'); pRoot = await prod.login('root@x.test');
}); after(async () => { await env.close(); await prod.close(); });

test('only platform administrators can see the email page or send a test; others get 403', async () => {
  for (const c of [team, aAdmin]) { assert.equal((await c.call('GET', '/platform/email')).status, 403); assert.equal((await c.call('POST', '/platform/email/test', { to: 'x@example.org' })).status, 403); }
  assert.equal((await env.client().call('GET', '/platform/email')).status, 401); assert.equal((await w.root.call('GET', '/platform/email')).status, 200); assert.equal((await admin.call('GET', '/platform/email')).status, 200);
});
test('status shows the configuration (never a password), queue counts and the delivery log with a status filter', async () => {
  await env.pool.query("INSERT INTO email_log(job_id,template,to_email,subject,status,message_id) VALUES (1,'email.test','a@x.test','Hello','sent','<1@x>')"); await env.pool.query("INSERT INTO email_log(job_id,template,to_email,subject,status,error,attempts) VALUES (2,'email.invitation','b@x.test','Hi','failed','550 no such user',1)");
  const b = (await w.root.call('GET', '/platform/email')).body; assert.deepEqual([b.configured, b.host, b.port, b.tls, b.origin], [true, 'smtp.example.com', 587, 'starttls', 'https://grc.example.com']); assert.ok(!JSON.stringify(b).toLowerCase().includes('password'));
  assert.ok(b.queue.pending >= 0 && 'dead' in b.queue && 'running' in b.queue); assert.ok(b.log.length >= 2); assert.ok(b.log.every((l: any) => !('body' in l) && !('token' in l)));
  const f = (await w.root.call('GET', '/platform/email?status=failed')).body.log; assert.ok(f.length >= 1 && f.every((l: any) => l.status === 'failed')); assert.equal(f[0].error.length > 0, true); assert.equal((await w.root.call('GET', '/platform/email?status=bogus')).status, 400);
});
test('send test: queued for the worker, audited, validated, rate limited to 10 an hour per administrator', async () => {
  assert.equal((await w.root.call('POST', '/platform/email/test', { to: 'not-an-email' })).status, 400); await env.pool.query('DELETE FROM jobs');
  const r = await w.root.call('POST', '/platform/email/test', { to: ' Me@Example.org ' }); assert.equal(r.status, 200); const j = await rows(env, "SELECT type, max_attempts FROM jobs WHERE type='email.test'"); assert.equal(j.length, 1); assert.equal(j[0].max_attempts, 3);
  const p = await rows(env, "SELECT payload FROM jobs WHERE type='email.test'"); assert.equal(JSON.parse(typeof p[0].payload === 'string' ? p[0].payload : JSON.stringify(p[0].payload)).to, 'me@example.org');
  const a = await rows(env, "SELECT detail FROM audit_events WHERE action='email.test_requested'"); assert.equal(a.length, 1);
  for (let i = 0; i < 9; i++) assert.equal((await w.root.call('POST', '/platform/email/test', { to: 'me@example.org' })).status, 200); assert.equal((await w.root.call('POST', '/platform/email/test', { to: 'me@example.org' })).status, 429);
  assert.equal((await admin.call('POST', '/platform/email/test', { to: 'me@example.org' })).status, 200, 'the limit is per user');
});
test('production without SMTP: a test is refused with a clear 409 instead of queueing a message that cannot be sent', async () => {
  const r = await pRoot.call('POST', '/platform/email/test', { to: 'me@example.org' }); assert.equal(r.status, 409); assert.equal(r.body.code ?? r.body.error?.code ?? r.body.error, 'email_not_configured'); assert.equal((await rows(prod, "SELECT 1 FROM jobs WHERE type='email.test'")).length, 0);
  const s = (await pRoot.call('GET', '/platform/email')).body; assert.equal(s.configured, false); assert.equal(s.host, null);
});
