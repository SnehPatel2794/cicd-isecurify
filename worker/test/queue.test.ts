import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshDb } from './helpers'; import { enqueue, claim, runOnce, reapStale, fail, backoffSeconds } from '../src/queue'; import { handlers } from '../src/handlers';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool;
before(async () => { db = await freshDb(); }); after(() => db.close());
const row = async (id: number) => ((await pool().query('SELECT * FROM jobs WHERE id=?', [id]))[0] as any)[0];
const lastId = async () => ((await pool().query('SELECT MAX(id) id FROM jobs'))[0] as any)[0].id;

test('idempotency key prevents duplicate jobs', async () => {
  await enqueue(pool(), { type: 'noop', idempotencyKey: 'k1' }); await enqueue(pool(), { type: 'noop', idempotencyKey: 'k1' });
  assert.equal(((await pool().query("SELECT COUNT(*) n FROM jobs WHERE idempotency_key='k1'"))[0] as any)[0].n, 1);
});
test('a successful job is marked done; empty queue returns false', async () => {
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'noop' }); assert.equal(await runOnce(pool(), handlers), true); const r = await row(await lastId());
  assert.equal(r.status, 'done'); assert.equal(await runOnce(pool(), handlers), false);
});
test('failing job retries with backoff, then goes dead after max attempts and drops its payload', async () => {
  await pool().query('DELETE FROM jobs'); let calls = 0; const h = { boom: async () => { calls++; throw new Error('kaput'); } };
  await enqueue(pool(), { type: 'boom', payload: { secret: 's' }, maxAttempts: 3 }); const id = await lastId();
  for (let i = 1; i <= 3; i++) { assert.equal(await runOnce(pool(), h), true); const r = await row(id); if (i < 3) { assert.equal(r.status, 'pending'); assert.ok(new Date(r.run_at) > new Date()); await pool().query('UPDATE jobs SET run_at=NOW(3) WHERE id=?', [id]); } }
  const r = await row(id); assert.equal(r.status, 'dead'); assert.equal(r.attempts, 3); assert.equal(calls, 3); assert.match(r.last_error, /kaput/); assert.equal(r.payload, null);
  assert.equal(backoffSeconds(1), 20); assert.equal(backoffSeconds(20), 3600);
});
test('unknown job type fails safely', async () => {
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'nope', maxAttempts: 1 }); await runOnce(pool(), handlers); assert.equal((await row(await lastId())).status, 'dead');
});
test('future jobs are not claimed', async () => { await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'noop', runAt: new Date(Date.now() + 3600_000) }); assert.equal(await claim(pool()), null); });
test('concurrent workers never run the same job twice (SKIP LOCKED)', async () => {
  await pool().query('DELETE FROM jobs'); const N = 40; for (let i = 0; i < N; i++) await enqueue(pool(), { type: 'work', payload: { i } });
  const seen: number[] = []; const h = { work: async (j: any) => { seen.push(j.payload.i); await new Promise(r => setTimeout(r, 5)); } };
  await Promise.all([1, 2, 3, 4, 5].map(async () => { while (await runOnce(pool(), h)); }));
  assert.equal(seen.length, N); assert.equal(new Set(seen).size, N); assert.equal(((await pool().query("SELECT COUNT(*) n FROM jobs WHERE status='done'"))[0] as any)[0].n, N);
});
test('crashed worker: stale running jobs are recovered; poison jobs end up dead', async () => {
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'noop' }); const j = await claim(pool()); assert.ok(j);
  assert.equal(await reapStale(pool(), 10), 0); await pool().query('UPDATE jobs SET locked_at = NOW() - INTERVAL 11 MINUTE WHERE id=?', [j!.id]);
  assert.equal(await reapStale(pool(), 10), 1); assert.equal((await row(j!.id)).status, 'pending');
  await pool().query('UPDATE jobs SET status=\'running\', attempts=max_attempts, locked_at = NOW() - INTERVAL 11 MINUTE WHERE id=?', [j!.id]); await reapStale(pool(), 10); assert.equal((await row(j!.id)).status, 'dead');
});
test('email job payload (one-time token) is erased after delivery', async () => {
  process.env.EMAIL_DEV_LOG = 'true'; delete process.env.SMTP_HOST;   // no SMTP in this test: development logging mode
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'email.password_reset', payload: { to: 'a@b.test', token: 'secret-token-value' } }); await runOnce(pool(), handlers);
  const r = await row(await lastId()); assert.equal(r.status, 'done'); assert.equal(r.payload, null);
});
test('invitation email job is handled and its one-time token is erased after delivery', async () => {
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'email.invitation', payload: { to: 'n@c.test', token: 'invite-secret-token', role: 'client_staff', orgName: 'Org', kind: 'tenant' } });
  assert.equal(await runOnce(pool(), handlers), true); const r = await row(await lastId()); assert.equal(r.status, 'done'); assert.equal(r.payload, null);
});
test('cleanup job removes expired sessions and old finished jobs', async () => {
  await pool().query('DELETE FROM jobs'); await pool().query("INSERT INTO users(id,email,name) VALUES ('u1','c@b.test','C')");
  await pool().query("INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES ('s-old',REPEAT('a',64),'u1',NOW() - INTERVAL 3 DAY),('s-new',REPEAT('b',64),'u1',NOW() + INTERVAL 1 DAY)");
  await pool().query("INSERT INTO jobs(type,status,finished_at) VALUES ('noop','done',NOW() - INTERVAL 40 DAY)");
  await enqueue(pool(), { type: 'maintenance.cleanup' }); await runOnce(pool(), handlers);
  assert.deepEqual(((await pool().query('SELECT id FROM sessions'))[0] as any[]).map(r => r.id), ['s-new']);
  assert.equal(((await pool().query("SELECT COUNT(*) n FROM jobs WHERE finished_at < NOW() - INTERVAL 30 DAY"))[0] as any)[0].n, 0);
});
test('cleanup removes notifications read more than 90 days ago and any older than 180 days, and keeps recent ones', async () => {
  await pool().query('DELETE FROM jobs'); await pool().query("INSERT IGNORE INTO users(id,email,name) VALUES ('u1','c@b.test','C')"); await pool().query("INSERT IGNORE INTO organizations(id,name) VALUES ('o1','Org')");
  const ins = (label: string, created: string, read: string) => pool().query(`INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,label,created_at,read_at) VALUES ('o1','u1','finding.comment','finding','f1',?,${created},${read})`, [label]);
  await ins('old-read', 'NOW() - INTERVAL 100 DAY', 'NOW() - INTERVAL 95 DAY'); await ins('old-unread', 'NOW() - INTERVAL 200 DAY', 'NULL'); await ins('recent-read', 'NOW() - INTERVAL 20 DAY', 'NOW() - INTERVAL 10 DAY'); await ins('recent-unread', 'NOW() - INTERVAL 5 DAY', 'NULL'); await ins('unread-120d', 'NOW() - INTERVAL 120 DAY', 'NULL');
  await enqueue(pool(), { type: 'maintenance.cleanup' }); await runOnce(pool(), handlers);
  assert.deepEqual(((await pool().query('SELECT label FROM notifications ORDER BY label'))[0] as any[]).map(r => r.label), ['recent-read', 'recent-unread', 'unread-120d']);
});
