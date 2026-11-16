import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers'; import { KINDS, KIND_LIST, cleanLabel, pickRecipients } from '../src/modules/notifications/kinds'; import { purgeUser } from '../src/modules/notifications/data';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any; let E: string, items: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const notes = async (c: any, qs = '') => (await c.call('GET', `/me/notifications${qs}`)).body; const count = async (c: any) => (await c.call('GET', '/me/notifications/count')).body.unread as number;
const raise = (c: any, itemId: string, body: any = {}) => c.call('POST', url(`/checklist/${itemId}/findings`), { title: 'Weak password policy', description: 'D', severity: 'high', ...body });
const move = (c: any, id: string, to: string, note: string | null = 'ok') => c.call('POST', url(`/findings/${id}/transition`), { to, note });
const clear = () => env.pool.query('DELETE FROM notifications');
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'One', primaryReleaseId: fx.X.releaseId })).body.id; await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' });
  items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
}); after(() => env.close());

test('pure rules: every kind has text, recipients exclude the actor, duplicates and people who switched the kind off; labels are one clean line', () => {
  for (const k of KIND_LIST) assert.ok(KINDS[k].label.length > 10 && KINDS[k].group);
  assert.deepEqual(pickRecipients(['a', 'b', null, 'a', undefined, 'c', 'd'], 'b', new Set(['d'])), ['a', 'c']); assert.equal(cleanLabel('x\r\ny\u0000  z'), 'x y z'); assert.equal(cleanLabel(''), '(untitled)'); assert.equal(cleanLabel('q'.repeat(500)).length, 200);
});
test('a checklist item assigned to someone notifies them (not the person who did it); reassigning to yourself or to the same person adds nothing', async () => {
  await clear(); const it = items[0]; await aAdmin.call('PATCH', url(`/checklist/${it.id}`), { accountableUserId: w.ids.aVendor });
  const n = await notes(vendor); assert.equal(n.unread, 1); assert.equal(n.notifications[0].kind, 'item.assigned'); assert.equal(n.notifications[0].entityType, 'checklist_item'); assert.equal(n.notifications[0].entityId, it.id); assert.equal(n.notifications[0].tenantId, w.A); assert.equal(n.notifications[0].actorName, 'aadmin'); assert.ok(n.notifications[0].label.includes(it.ref));
  assert.equal(await count(aAdmin), 0, 'the actor is not told about their own action'); await aAdmin.call('PATCH', url(`/checklist/${it.id}`), { accountableUserId: w.ids.aVendor }); assert.equal(await count(vendor), 1, 'no change, no new notification');
  await aAdmin.call('PATCH', url(`/checklist/${items[1].id}`), { accountableUserId: w.ids.aAdmin }); assert.equal(await count(aAdmin), 0, 'self-assignment is silent');
});
test('evidence: request -> accountable person; upload -> requester; accept / reject -> uploader', async () => {
  await clear(); const it = items[0]; const r = await aAdmin.call('POST', url(`/checklist/${it.id}/evidence-requests`), { title: 'Password policy PDF' }); const rid = r.body.id;
  let n = await notes(vendor); assert.deepEqual(n.notifications.map((x: any) => x.kind), ['evidence.requested']); assert.equal(n.notifications[0].entityType, 'evidence_request'); assert.equal(n.notifications[0].entityId, rid); assert.ok(n.notifications[0].label.includes('Password policy PDF'));
  const m = mpf('p.pdf', PDF('x'), {}); const u = await vendor.call('POST', url(`/evidence-requests/${rid}/versions`), m.payload, m.headers); assert.equal(u.status, 201);
  n = await notes(aAdmin); assert.deepEqual(n.notifications.map((x: any) => x.kind), ['evidence.submitted']); assert.equal(await count(vendor), 1, 'the uploader gets nothing for their own upload');
  assert.equal((await auditor.call('POST', url(`/evidence-requests/${rid}/review`), { versionId: u.body.versionId, decision: 'rejected', note: 'unsigned' })).status, 200);
  n = await notes(vendor); assert.equal(n.notifications[0].kind, 'evidence.rejected'); const m2 = mpf('p2.pdf', PDF('y'), {}); const u2 = await vendor.call('POST', url(`/evidence-requests/${rid}/versions`), m2.payload, m2.headers);
  await auditor.call('POST', url(`/evidence-requests/${rid}/review`), { versionId: u2.body.versionId, decision: 'accepted', note: 'ok' }); n = await notes(vendor); assert.deepEqual(n.notifications.map((x: any) => x.kind).filter((k: string) => k !== 'evidence.requested'), ['evidence.accepted', 'evidence.rejected']);
});
test('findings: assigned, ready for retest, closed, reopened, comments; the actor never hears about their own action', async () => {
  await clear(); const it = items[2]; const f = (await raise(auditor, it.id, { ownerUserId: undefined })).body.id; assert.equal(await count(vendor), 0, 'no owner yet');
  assert.equal((await aAdmin.call('PATCH', url(`/findings/${f}`), { ownerUserId: w.ids.aVendor })).status, 200); let n = await notes(vendor); assert.equal(n.notifications[0].kind, 'finding.assigned'); assert.match(n.notifications[0].label, /^F-001 Weak password policy$/); assert.equal(await count(aAdmin), 0);
  assert.equal((await move(vendor, f, 'in_remediation')).status, 200); assert.equal((await move(vendor, f, 'ready_for_retest')).status, 200); assert.deepEqual((await notes(auditor)).notifications.map((x: any) => x.kind), ['finding.ready_for_retest'], 'the person who raised it');
  assert.equal((await move(auditor, f, 'in_remediation', 'still failing')).status, 200); assert.ok((await notes(vendor)).notifications.some((x: any) => x.kind === 'finding.reopened'));
  await move(vendor, f, 'ready_for_retest'); assert.equal((await move(auditor, f, 'closed')).status, 200); assert.ok((await notes(vendor)).notifications.some((x: any) => x.kind === 'finding.closed'));
  await clear(); const g = (await raise(team, items[0].id, { ownerUserId: w.ids.aVendor })).body.id; await clear();
  await aAdmin.call('POST', url(`/findings/${g}/comments`), { note: 'one' }); await aAdmin.call('POST', url(`/findings/${g}/comments`), { note: 'two' });
  assert.equal(await count(vendor), 1, 'a burst of comments is one unread line'); assert.equal(await count(team), 1, 'the person who raised it'); assert.equal(await count(aAdmin), 0);
  await vendor.call('POST', '/me/notifications/read', { all: true }); await aAdmin.call('POST', url(`/findings/${g}/comments`), { note: 'three' }); assert.equal(await count(vendor), 1, 'after reading, a new comment notifies again');
  await vendor.call('POST', url(`/findings/${g}/comments`), { note: 'mine' }); assert.equal(await count(vendor), 1, 'own comment is silent');
});
test('reading: list, unread filter, per-organization filter, paging and marking read', async () => {
  await clear(); for (let i = 0; i < 5; i++) { const f = (await raise(team, items[i % 3].id, { title: `T${i}`, ownerUserId: w.ids.aVendor })).body.id; assert.ok(f); }
  const all = await notes(vendor, '?limit=2'); assert.equal(all.notifications.length, 2); assert.ok(all.nextBefore); assert.equal(all.unread, 5); assert.deepEqual(all.unreadByTenant, { [w.A]: 5 });
  const page2 = await notes(vendor, `?limit=10&before=${all.nextBefore}`); assert.equal(page2.notifications.length, 3); assert.equal(page2.nextBefore, null); assert.ok(page2.notifications.every((x: any) => x.id < all.nextBefore));
  const first = all.notifications[0].id; assert.equal((await vendor.call('POST', '/me/notifications/read', { ids: [first] })).body.marked, 1); assert.equal((await notes(vendor, '?unread=true')).notifications.length, 4); assert.equal((await notes(vendor)).notifications.find((x: any) => x.id === first).read, true);
  assert.equal((await vendor.call('POST', '/me/notifications/read', { ids: [first] })).body.marked, 0, 'already read'); assert.equal((await vendor.call('POST', '/me/notifications/read', { })).status, 400); assert.equal((await vendor.call('POST', '/me/notifications/read', { all: true, ids: [1] })).status, 400);
  assert.equal((await notes(vendor, `?tenantId=${w.B}`)).notifications.length, 0); assert.equal((await vendor.call('GET', '/me/notifications?limit=500')).status, 400); assert.equal((await env.client().call('GET', '/me/notifications/count')).status, 401);
});
test('isolation: nobody can read or mark someone else\'s notifications, and losing access to the organization hides them', async () => {
  await clear(); await raise(team, items[0].id, { ownerUserId: w.ids.aVendor }); const mine = (await notes(vendor)).notifications[0].id;
  assert.equal(await count(bAdmin), 0); assert.equal((await notes(bAdmin)).notifications.length, 0); assert.equal((await bAdmin.call('POST', '/me/notifications/read', { ids: [mine] })).body.marked, 0); assert.equal((await rows('SELECT read_at FROM notifications WHERE id=?', [mine]))[0].read_at, null);
  assert.equal((await aAdmin.call('POST', '/me/notifications/read', { all: true })).body.marked, 0, 'all means all of MY notifications'); assert.equal(await count(vendor), 1);
  await env.pool.query('DELETE FROM engagement_members WHERE user_id=?', [w.ids.aVendor]); const m = await rows('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', [w.A, w.ids.aVendor]);
  await env.pool.query('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', [w.A, w.ids.aVendor]); assert.equal(await count(vendor), 0, 'no access, nothing shown'); assert.equal((await notes(vendor)).notifications.length, 0);
  await env.pool.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,?)', [w.A, w.ids.aVendor, m[0].role]); assert.equal(await count(vendor), 1, 'access restored, still there (nothing was lost)');
});
test('nobody without access to the organization is ever notified', async () => {
  await clear(); const f = (await raise(auditor, items[0].id)).body.id; await env.pool.query('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', [w.A, w.ids.aStaff]);
  await env.pool.query('UPDATE findings SET owner_user_id=? WHERE id=?', [w.ids.aStaff, f]).catch(() => {}); await aAdmin.call('POST', url(`/findings/${f}/comments`), { note: 'hello' }); assert.equal((await rows('SELECT 1 FROM notifications WHERE user_id=?', [w.ids.aStaff])).length, 0);
  await env.pool.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,?)', [w.A, w.ids.aStaff, 'client_staff']);
});
test('preferences: all kinds on by default; switching one off stops it (and only it) for that person; unknown kinds are refused', async () => {
  await clear(); const p = (await vendor.call('GET', '/me/notification-prefs')).body.kinds; assert.equal(p.length, KIND_LIST.length); assert.ok(p.every((k: any) => k.inApp === true && k.label && k.group));
  assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', inApp: false })).status, 200); assert.equal((await vendor.call('GET', '/me/notification-prefs')).body.kinds.find((k: any) => k.kind === 'finding.assigned').inApp, false);
  await raise(team, items[0].id, { ownerUserId: w.ids.aVendor }); assert.equal(await count(vendor), 0, 'switched off'); await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aStaff }); await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor }); assert.equal(await count(vendor), 1, 'other kinds still arrive');
  assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.assigned', inApp: true })).status, 200); assert.equal((await vendor.call('PUT', '/me/notification-prefs', { kind: 'nope', inApp: true })).status, 400); assert.equal((await aAdmin.call('GET', '/me/notification-prefs')).body.kinds.find((k: any) => k.kind === 'finding.assigned').inApp, true, 'per person');
});
test('database: only read_at can change; the app can mark read but a notification cannot be rewritten; account deletion removes a person\'s notifications and preferences', async () => {
  await clear(); await raise(team, items[0].id, { ownerUserId: w.ids.aVendor }); const id = (await rows('SELECT id FROM notifications LIMIT 1'))[0].id;
  await assert.rejects(env.pool.query("UPDATE notifications SET label='tampered' WHERE id=?", [id]), /only read_at/); await assert.rejects(env.pool.query('UPDATE notifications SET user_id=? WHERE id=?', [w.ids.aStaff, id]), /only read_at/); await env.pool.query('UPDATE notifications SET read_at=NOW(3) WHERE id=?', [id]);
  await vendor.call('PUT', '/me/notification-prefs', { kind: 'finding.comment', inApp: false }); await purgeUser(env.pool, w.ids.aVendor); assert.equal((await rows('SELECT 1 FROM notifications WHERE user_id=?', [w.ids.aVendor])).length, 0); assert.equal((await rows('SELECT 1 FROM notification_prefs WHERE user_id=?', [w.ids.aVendor])).length, 0);
});
