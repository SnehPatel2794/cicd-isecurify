import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { emailDefault, EMAIL_DEFAULT, KIND_LIST } from '../src/modules/notifications/kinds'; import { emit } from '../src/platform/outbox';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, vendor: any, auditor: any; let E: string, items: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const events = (type = 'notification.created') => rows('SELECT id, tenant_id, type, payload, dedupe_key, processed_at, dead_at FROM outbox_events WHERE type=? ORDER BY id', [type]).then(r => r.map(x => ({ ...x, payload: typeof x.payload === 'string' ? JSON.parse(x.payload) : x.payload })));
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'One', primaryReleaseId: fx.X.releaseId })).body.id; await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' });
  items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
}); after(() => env.close());

test('pure: the emailed kinds are real kinds, and the quiet ones are not emailed', () => {
  for (const k of EMAIL_DEFAULT) assert.ok(KIND_LIST.includes(k as any), k); assert.ok(emailDefault('evidence.malware')); assert.ok(emailDefault('finding.assigned')); assert.ok(!emailDefault('finding.comment')); assert.ok(!emailDefault('evidence.accepted'));
});
test('a notification writes one outbox event in the same transaction, carrying the id and the email default', async () => {
  await env.pool.query('DELETE FROM outbox_events'); await env.pool.query('DELETE FROM notifications'); await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor });
  const [n] = await rows('SELECT id FROM notifications'); const ev = await events(); assert.equal(ev.length, 1); assert.equal(ev[0].payload.notificationId, n.id); assert.equal(ev[0].payload.emailDefault, true); assert.equal(ev[0].dedupe_key, `n:${n.id}`); assert.equal(ev[0].tenant_id, w.A); assert.equal(ev[0].processed_at, null);
  assert.ok(!JSON.stringify(ev[0].payload).includes('@'), 'no addresses or text in the event');
  await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor }); assert.equal((await events()).length, 1, 'nothing new happened, nothing is announced');
});
test('emit is idempotent by key and never throws into the caller', async () => {
  const c = await env.pool.getConnection(); try { assert.equal(await emit(c, { type: 'x.test', dedupeKey: 'k1' }), true); assert.equal(await emit(c, { type: 'x.test', dedupeKey: 'k1' }), true); assert.equal(await emit(c, { type: 'x'.repeat(200), payload: { a: 1 } }), true); } finally { c.release(); }
  assert.equal((await events('x.test')).length, 1); const bad: any = { query: async () => { throw new Error('db down'); } }; assert.equal(await emit(bad, { type: 'x' }), false);
});
test('preferences: email defaults by kind, can be switched either way, in-app and email are independent', async () => {
  let k = (await vendor.call('GET', '/me/notification-prefs')).body.kinds; const by = (kind: string) => k.find((x: any) => x.kind === kind);
  assert.equal(by('finding.assigned').email, true); assert.equal(by('finding.comment').email, false); assert.equal(by('evidence.malware').email, true); assert.ok(by('engagement.phase_advanced')); assert.equal(by('finding.comment').inApp, true);
  assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.comment', email: true })).status, 200); assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', email: false })).status, 200);
  k = (await vendor.call('GET', '/me/notification-prefs')).body.kinds; assert.deepEqual([by('finding.comment').email, by('finding.comment').inApp, by('finding.assigned').email, by('finding.assigned').inApp], [true, true, false, true]);
  assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', inApp: false })).status, 200); k = (await vendor.call('GET', '/me/notification-prefs')).body.kinds; assert.deepEqual([by('finding.assigned').email, by('finding.assigned').inApp], [false, false], 'turning the app off keeps the email choice');
  assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', inApp: true })).status, 200);
  for (const bad of [{ kind: 'nope', email: true }, { kind: 'finding.assigned' }, { kind: 'finding.assigned', email: 'yes' }]) assert.equal((await vendor.call('PUT', '/me/notification-prefs', bad)).status, 400);
  assert.equal((await env.client().call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', email: true })).status, 401);
});
test('advancing the phase tells the engagement members (not the person who advanced it) and the link opens the engagement', async () => {
  await env.pool.query('DELETE FROM notifications'); await env.pool.query('DELETE FROM outbox_events'); const r = await team.call('POST', url(`/engagements/${E}/advance-phase`), { acknowledge: true, note: 'Reviewed and accepted for this test' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = (await auditor.call('GET', '/me/notifications')).body.notifications; assert.equal(n.length, 1); assert.equal(n[0].kind, 'engagement.phase_advanced'); assert.equal(n[0].entityType, 'engagement'); assert.equal(n[0].engagementId, E); assert.match(n[0].label, /One moved to/);
  assert.equal((await team.call('GET', '/me/notifications')).body.notifications.filter((x: any) => x.kind === 'engagement.phase_advanced').length, 0); assert.equal((await events()).length, 1);
});
test('dead outbox events show on the email screen and can be revived by an admin only; processed events are never touched', async () => {
  await env.pool.query('DELETE FROM outbox_events'); await env.pool.query("INSERT INTO outbox_events(type,payload,attempts,last_error,dead_at) VALUES ('notification.created','{}',5,'boom',NOW(3))"); await env.pool.query("INSERT INTO outbox_events(type,payload,processed_at) VALUES ('notification.created','{}',NOW(3))");
  let b = (await w.root.call('GET', '/platform/email')).body; assert.deepEqual([b.outbox.pending, b.outbox.dead, b.outbox.done], [0, 1, 1]); assert.equal(b.outbox.deadEvents[0].lastError, 'boom'); assert.equal(b.outbox.deadEvents[0].attempts, 5);
  for (const c of [aAdmin, vendor]) assert.equal((await c.call('POST', '/platform/email/outbox/retry')).status, 403); assert.equal((await env.client().call('POST', '/platform/email/outbox/retry')).status, 401);
  assert.equal((await w.root.call('POST', '/platform/email/outbox/retry')).body.retried, 1); b = (await w.root.call('GET', '/platform/email')).body; assert.deepEqual([b.outbox.pending, b.outbox.dead, b.outbox.done], [1, 0, 1]);
  const [a] = await rows("SELECT action FROM audit_events WHERE action='email.outbox_retry'"); assert.ok(a);
});
test('database: outbox rows cannot share a key, and the app and worker accounts can use the table', async () => {
  await env.pool.query("INSERT INTO outbox_events(type,dedupe_key) VALUES ('t','dup-1')"); await assert.rejects(env.pool.query("INSERT INTO outbox_events(type,dedupe_key) VALUES ('t','dup-1')"), /Duplicate/);
});
