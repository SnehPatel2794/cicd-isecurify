import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { fanOut, deliverDue, cleanup, type Env } from '../src/webhooks'; import { encrypt } from '../../api/src/platform/crypto'; import { verify } from '../../shared/webhooks';
let db: Awaited<ReturnType<typeof freshDb>>; const KEY = crypto.randomBytes(32); const U = crypto.randomUUID(), T = crypto.randomUUID(), T2 = crypto.randomUUID(), SECRET = 'whsec_testsecret';
const q = (s: string, p: any[] = []) => db.pool.query(s, p) as Promise<any>; const rows = async (s: string, p: any[] = []) => (await q(s, p))[0] as any[];
type Call = { url: string; init: any }; let calls: Call[] = []; let answer: (url: string) => Response | Promise<Response> = () => new Response('ok', { status: 200 });
const env = (o: Partial<Env> = {}): Env => ({ key: KEY, allowHttp: false, timeoutMs: 200, log: { info() {}, warn() {} }, resolve: async () => ['93.184.216.34'], fetch: (async (url: any, init: any) => { calls.push({ url: String(url), init }); return answer(String(url)); }) as any, ...o });
const mkEp = async (tenant: string, events: string[], url = 'https://hooks.example.com/in', active = 1) => { const id = crypto.randomUUID(); await q('INSERT INTO webhook_endpoints(tenant_id,id,name,url,secret_enc,events,active,created_by) VALUES (?,?,?,?,?,?,?,?)', [tenant, id, 'ep', url, encrypt(SECRET, KEY), JSON.stringify(events), active, U]); return id; };
const audit = async (tenant: string | null, action: string) => ((await q('INSERT INTO audit_events(tenant_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?)', [tenant, action, 'finding', 'f1', JSON.stringify({ title: 'x' })]))[0].insertId as number);
const due = () => q("UPDATE webhook_deliveries SET next_attempt_at=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE status='pending'");
before(async () => { db = await freshDb(); await q('INSERT INTO users(id,email,name) VALUES (?,?,?)', [U, 'u@x.test', 'U']); await q('INSERT INTO organizations(id,name) VALUES (?,?),(?,?)', [T, 'A', T2, 'B']); }); after(() => db.close());

test('fan-out: matches by pattern and tenant, skips never-sent events, only newer than the cursor, idempotent', async () => {
  const e1 = await mkEp(T, ['finding.*']); const e2 = await mkEp(T, ['*']); const e3 = await mkEp(T2, ['*']); await mkEp(T, ['*'], 'https://x.example.com', 0);
  await audit(T, 'finding.raised'); await audit(T, 'risk.created'); await audit(T, 'auth.login'); await audit(T, 'api_key.created'); await audit(null, 'platform.org_created');
  const r = await fanOut(db.pool); assert.equal(r.scanned, 5); const d = await rows('SELECT endpoint_id, event_type FROM webhook_deliveries ORDER BY id');
  assert.deepEqual(d.filter(x => x.endpoint_id === e1).map(x => x.event_type), ['finding.raised']); assert.deepEqual(d.filter(x => x.endpoint_id === e2).map(x => x.event_type).sort(), ['finding.raised', 'risk.created']); assert.equal(d.filter(x => x.endpoint_id === e3).length, 0, 'another organization gets nothing'); assert.equal(d.length, 3, 'inactive endpoint gets nothing');
  assert.deepEqual(await fanOut(db.pool), { scanned: 0, queued: 0 }); const id = await audit(T, 'finding.closed'); await q('UPDATE webhook_cursor SET last_audit_id=?', [id - 1]); const again = await fanOut(db.pool); assert.equal(again.queued, 2); await q('UPDATE webhook_cursor SET last_audit_id=?', [id - 1]); assert.equal((await fanOut(db.pool)).queued, 0, 'unique (endpoint, audit event)');
  const p = JSON.parse(JSON.stringify((await rows('SELECT payload FROM webhook_deliveries ORDER BY id LIMIT 1'))[0].payload)); assert.match(p.id, /^evt_\d+$/); assert.equal(p.organizationId, T); assert.equal(p.type, 'finding.raised');
});
test('delivery: signed body that the receiver can verify, right headers, no redirects, then marked delivered', async () => {
  await q('DELETE FROM webhook_deliveries'); await q('DELETE FROM webhook_endpoints'); await mkEp(T, ['probe.*']); await audit(T, 'probe.one'); await fanOut(db.pool); calls = []; await due();
  const r = await deliverDue(db.pool, env()); assert.equal(r.delivered, 1); const c = calls[0]; assert.equal(c.url, 'https://hooks.example.com/in'); assert.equal(c.init.method, 'POST'); assert.equal(c.init.redirect, 'manual'); assert.equal(c.init.headers['x-isg-event'], 'probe.one'); assert.match(c.init.headers['content-type'], /json/);
  assert.ok(verify(SECRET, c.init.body, c.init.headers['x-isg-signature']), 'signature verifies'); assert.equal(verify('wrong', c.init.body, c.init.headers['x-isg-signature']), false);
  const d = (await rows("SELECT * FROM webhook_deliveries WHERE event_type='probe.one'"))[0]; assert.equal(d.status, 'delivered'); assert.equal(d.attempts, 1); assert.equal(d.last_status, 200); assert.equal((await deliverDue(db.pool, env())).delivered, 0, 'not sent twice');
});
test('failure: retried with back-off, parked as dead after 8 tries, endpoint switched off after 15 failures in a row', async () => {
  await q('DELETE FROM webhook_deliveries'); await q('DELETE FROM webhook_endpoints'); const ep = await mkEp(T, ['probe.*']); answer = () => new Response('no', { status: 500 });
  await audit(T, 'probe.fail'); await fanOut(db.pool); await due(); let r = await deliverDue(db.pool, env()); assert.deepEqual(r, { delivered: 0, failed: 1, dead: 0 }); let d = (await rows('SELECT * FROM webhook_deliveries'))[0]; assert.equal(d.status, 'pending'); assert.equal(d.attempts, 1); assert.match(d.last_error, /500/); assert.equal((await deliverDue(db.pool, env())).failed, 0, 'waits for its back-off');
  for (let i = 0; i < 6; i++) { await due(); await deliverDue(db.pool, env()); } await due(); r = await deliverDue(db.pool, env()); assert.equal(r.dead, 1); d = (await rows('SELECT * FROM webhook_deliveries'))[0]; assert.equal(d.status, 'dead'); assert.equal(d.attempts, 8);
  assert.equal((await rows('SELECT active FROM webhook_endpoints WHERE id=?', [ep]))[0].active, 1, '8 failures: still on');
  for (let i = 0; i < 7; i++) { await audit(T, 'probe.more' + i); } await fanOut(db.pool); for (let i = 0; i < 3; i++) { await due(); await deliverDue(db.pool, env()); }
  const e = (await rows('SELECT * FROM webhook_endpoints WHERE id=?', [ep]))[0]; assert.equal(e.active, 0); assert.match(e.disabled_reason, /repeated failures/); assert.ok(e.consecutive_failures >= 15);
  answer = () => new Response('ok', { status: 200 });
});
test('a success resets the failure count; redirects, timeouts and network errors count as failures', async () => {
  await q('DELETE FROM webhook_deliveries'); await q('DELETE FROM webhook_endpoints'); const ep = await mkEp(T, ['probe.*']); await q('UPDATE webhook_endpoints SET consecutive_failures=5 WHERE id=?', [ep]);
  await audit(T, 'probe.a'); await fanOut(db.pool); await due(); await deliverDue(db.pool, env()); assert.equal((await rows('SELECT consecutive_failures n FROM webhook_endpoints WHERE id=?', [ep]))[0].n, 0);
  for (const [name, mk, re] of [['redirect', () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } }), /redirect/i], ['timeout', () => new Promise<Response>(() => {}), /10 seconds|did not answer/], ['network', () => { throw new Error('ECONNRESET'); }, /ECONNRESET/]] as const) {
    await q('DELETE FROM webhook_deliveries'); answer = mk as any; await audit(T, 'probe.' + name); await fanOut(db.pool); await due(); const e2 = env({ fetch: (async (u: any, i: any) => { calls.push({ url: String(u), init: i }); const a: any = answer(String(u)); if (name === 'timeout') return new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))); return a; }) as any });
    const r = await deliverDue(db.pool, e2); assert.equal(r.failed, 1, name); assert.match((await rows('SELECT last_error e FROM webhook_deliveries'))[0].e, re, name);
  } answer = () => new Response('ok');
});
test('private addresses are refused at delivery time (even if the name was fine when saved); nothing is sent', async () => {
  await q('DELETE FROM webhook_deliveries'); await q('DELETE FROM webhook_endpoints'); await mkEp(T, ['probe.*']); await audit(T, 'probe.ssrf'); await fanOut(db.pool); await due(); calls = [];
  const r = await deliverDue(db.pool, env({ resolve: async () => ['10.0.0.5'] })); assert.equal(r.failed, 1); assert.equal(calls.length, 0); assert.match((await rows('SELECT last_error e FROM webhook_deliveries'))[0].e, /private address/);
  await due(); assert.equal((await deliverDue(db.pool, env({ resolve: async () => ['8.8.8.8', '127.0.0.1'] }))).failed, 1, 'any private answer refuses'); await due(); assert.equal((await deliverDue(db.pool, env({ resolve: async () => { throw new Error('nx'); } }))).failed, 1); assert.equal(calls.length, 0);
});
test('test events still go to a switched-off endpoint; ordinary events wait; without the key nothing is sent', async () => {
  await q('DELETE FROM webhook_deliveries'); await q('DELETE FROM webhook_endpoints'); const ep = await mkEp(T, ['probe.*'], 'https://hooks.example.com/in', 0); calls = [];
  await q("INSERT INTO webhook_deliveries(tenant_id,endpoint_id,audit_id,event_type,payload) VALUES (?,?,1,'webhook.test','{}'),(?,?,2,'probe.x','{}')", [T, ep, T, ep]); await due();
  assert.equal((await deliverDue(db.pool, env())).delivered, 1); assert.equal(calls.length, 1); assert.equal((await rows("SELECT status FROM webhook_deliveries WHERE event_type='probe.x'"))[0].status, 'pending');
  await q("UPDATE webhook_deliveries SET status='pending', next_attempt_at=DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE event_type='webhook.test'"); calls = []; assert.deepEqual(await deliverDue(db.pool, env({ key: undefined })), { delivered: 0, failed: 0, dead: 0 }); assert.equal(calls.length, 0);
});
test('cleanup removes deliveries older than 30 days only', async () => {
  await q('DELETE FROM webhook_deliveries'); const ep = await mkEp(T, ['*']); await q("INSERT INTO webhook_deliveries(tenant_id,endpoint_id,audit_id,event_type,payload,created_at) VALUES (?,?,11,'a','{}',DATE_SUB(NOW(),INTERVAL 40 DAY)),(?,?,12,'b','{}',NOW())", [T, ep, T, ep]); await cleanup(db.pool); assert.deepEqual((await rows('SELECT event_type e FROM webhook_deliveries')).map(x => x.e), ['b']);
});
