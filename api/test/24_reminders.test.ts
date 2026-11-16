import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers';
import { runDaily, candidates } from '../../worker/src/reminders/scan'; import { stageFor, reminderLabel, digestDue, groupItems, daysBetween, scanDue, SOON_DAYS, PER_GROUP } from '../../worker/src/reminders/rules'; import { render } from '../../worker/src/mail/templates';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, vendor: any, staff: any, auditor: any; let E: string, items: any[]; const R: Record<string, string> = {}, F: Record<string, string> = {};
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[]; const log = { info() {}, warn() {} };
const TODAY = '2026-10-24'; const at = (n: number) => new Date(Date.parse(TODAY + 'T04:00:00Z') + n * 86400000); const day = (n: number) => at(n).toISOString().slice(0, 10);
const mailOn: any = { config: () => ({ host: 'x' }), devLogEnabled: () => false }; const mailOff: any = { config: () => null, devLogEnabled: () => false };
const notesOf = (uid: string, kindLike = 'reminder.%') => rows('SELECT kind, entity_type, entity_id, label, actor_id, read_at FROM notifications WHERE user_id=? AND kind LIKE ? ORDER BY id', [uid, kindLike]);
const reset = async () => { await env.pool.query('DELETE FROM notifications'); await env.pool.query('DELETE FROM reminder_log'); await env.pool.query('DELETE FROM user_digest'); await env.pool.query("DELETE FROM jobs WHERE type='email.digest'"); };
const upload = (c: any, rid: string, n: string) => { const m = mpf(n, PDF(n), {}); return c.call('POST', url(`/evidence-requests/${rid}/versions`), m.payload, m.headers); };
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'One', primaryReleaseId: fx.X.releaseId })).body.id; await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' });
  items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items; await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor });
  const mk = async (k: string, due: string | null) => { R[k] = (await aAdmin.call('POST', url(`/checklist/${items[0].id}/evidence-requests`), { title: `Req ${k}` })).body.id; if (due) await env.pool.query('UPDATE evidence_requests SET due_date=? WHERE id=?', [due, R[k]]); };
  await mk('soon', day(2)); await mk('late', day(-3)); await mk('far', day(10)); await mk('accepted', day(-5)); await mk('submitted', day(-5)); await mk('rejected', day(-1)); await mk('nodate', null);
  const a = await upload(vendor, R.accepted, 'a.pdf'); await auditor.call('POST', url(`/evidence-requests/${R.accepted}/review`), { versionId: a.body.versionId, decision: 'accepted', note: 'ok' });
  await upload(vendor, R.submitted, 's.pdf'); const r = await upload(vendor, R.rejected, 'r.pdf'); await auditor.call('POST', url(`/evidence-requests/${R.rejected}/review`), { versionId: r.body.versionId, decision: 'rejected', note: 'no' });
  const fnd = async (k: string, item: any, due: string | null, owner: string | null) => { F[k] = (await team.call('POST', url(`/checklist/${item.id}/findings`), { title: `Finding ${k}`, description: 'D', severity: 'high', ownerUserId: owner, dueDate: null })).body.id; if (due) await env.pool.query('UPDATE findings SET due_date=? WHERE id=?', [due, F[k]]); };
  await fnd('soon', items[1], day(1), w.ids.aVendor); await fnd('late', items[1], day(-10), w.ids.aStaff); await fnd('closed', items[2], day(-10), w.ids.aVendor); await fnd('noowner', items[2], day(-2), null);
  for (const [c, to] of [[vendor, 'in_remediation'], [vendor, 'ready_for_retest'], [auditor, 'closed']] as const) assert.equal((await c.call('POST', url(`/findings/${F.closed}/transition`), { to, note: 'ok' })).status, 200);
}); after(() => env.close());

test('pure rules: stages and weekly overdue buckets, labels, digest frequency, grouping and the daily schedule', () => {
  assert.equal(daysBetween('2026-10-24', '2026-10-27'), 3); assert.equal(stageFor(day(SOON_DAYS + 1), TODAY), null); assert.deepEqual(stageFor(day(3), TODAY), { stage: 'due_soon', bucket: 0, days: 3 }); assert.deepEqual(stageFor(TODAY, TODAY), { stage: 'due_soon', bucket: 0, days: 0 });
  for (const [late, bucket] of [[1, 0], [7, 0], [8, 1], [14, 1], [15, 2], [30, 4]]) assert.equal(stageFor(day(-late), TODAY)!.bucket, bucket, `late ${late}`);
  assert.equal(reminderLabel('X', day(0), stageFor(day(0), TODAY)!), 'X — due today'); assert.match(reminderLabel('X', day(2), stageFor(day(2), TODAY)!), /in 2 days/); assert.match(reminderLabel('X', day(-1), stageFor(day(-1), TODAY)!), /overdue by 1 day \(was due/);
  const now = at(0); assert.equal(digestDue('off', null, now), false); assert.equal(digestDue('daily', null, now), true); assert.equal(digestDue('daily', at(-1), now), true); assert.equal(digestDue('daily', new Date(now.getTime() - 3 * 3600000), now), false); assert.equal(digestDue('weekly', at(-3), now), false); assert.equal(digestDue('weekly', at(-7), now), true);
  assert.equal(scanDue(new Date('2026-10-24T02:59:00Z')), false); assert.equal(scanDue(new Date('2026-10-24T03:00:00Z')), true);
  const many = Array.from({ length: 14 }, (_, i) => ({ org: 'B', tenantId: 'tb', label: `L${i}`, due: day(-i - 1), stage: 'overdue' as const, days: i + 1 })); const g = groupItems([...many, { org: 'A', tenantId: 'ta', label: 'soon', due: day(1), stage: 'due_soon', days: 1 }]);
  assert.deepEqual(g.map(x => x.org), ['A', 'B']); assert.equal(g[1].overdue.length, PER_GROUP); assert.equal(g[1].more, 4); assert.match(g[1].overdue[0], /^L13/, 'most overdue first'); assert.equal(g[0].dueSoon.length, 1);
});
test('the scan finds exactly the open evidence requests and findings that are due within 3 days or late, for people who can still act', async () => {
  const c = await candidates(env.pool, TODAY); const names = c.map(x => x.base).sort();
  const have = (re: RegExp) => names.some(n => re.test(n)); assert.ok(have(/Req soon/) && have(/Req late/) && have(/Req rejected/)); assert.ok(!have(/Req far/) && !have(/Req accepted/) && !have(/Req submitted/) && !have(/Req nodate/), 'far, accepted, submitted and undated are not reminders');
  assert.ok(have(/Finding soon/) && have(/Finding late/)); assert.ok(!have(/Finding closed/) && !have(/Finding noowner/), 'closed and ownerless findings are not reminders');
});
test('reminders: one notification per stage, to the responsible person, with a clear label, and none for the wrong people', async () => {
  await reset(); const r = await runDaily(env.pool, at(0), mailOff, log); assert.equal(r.reminders, 5, JSON.stringify(r)); const v = await notesOf(w.ids.aVendor); const byEntity = new Map(v.map(x => [x.entity_id, x]));
  assert.equal(byEntity.get(R.soon).kind, 'reminder.due_soon'); assert.match(byEntity.get(R.soon).label, /Req soon — due 2026-10-26 \(in 2 days\)/); assert.equal(byEntity.get(R.late).kind, 'reminder.overdue'); assert.match(byEntity.get(R.late).label, /overdue by 3 days/); assert.equal(byEntity.get(R.rejected).kind, 'reminder.overdue');
  assert.equal(byEntity.get(F.soon).kind, 'reminder.due_soon'); assert.equal(byEntity.get(F.soon).entity_type, 'finding'); assert.match(byEntity.get(F.soon).label, /^F-001 Finding soon — due/); assert.ok(v.every(x => x.actor_id === null)); assert.equal(v.length, 4);
  const s = await notesOf(w.ids.aStaff); assert.deepEqual(s.map(x => x.entity_id), [F.late]); assert.equal(s[0].kind, 'reminder.overdue'); assert.equal((await notesOf(w.ids.aAdmin)).length, 0, 'only the responsible person');
});
test('running again changes nothing; an overdue item repeats weekly (once read), a due-soon item never repeats, and a moved due date reminds again', async () => {
  await reset(); await runDaily(env.pool, at(0), mailOff, log); const first = (await rows('SELECT COUNT(*) n FROM notifications'))[0].n; await runDaily(env.pool, at(0), mailOff, log); await runDaily(env.pool, at(1), mailOff, log); assert.equal((await rows('SELECT COUNT(*) n FROM notifications'))[0].n, first, 'same day and next day: no repeats');
  await runDaily(env.pool, at(7), mailOff, log); assert.equal((await notesOf(w.ids.aVendor)).filter(x => x.entity_id === R.late).length, 1, 'a week later but still unread: the overdue item is not piled up'); assert.equal((await rows('SELECT COUNT(*) n FROM notifications'))[0].n, first + 3, 'only things that moved stage: two went from due soon to overdue, one from far to due soon'); assert.ok((await rows('SELECT COUNT(*) n FROM reminder_log'))[0].n > first - 1);
  await env.pool.query("UPDATE notifications SET read_at=NOW(3) WHERE kind='reminder.overdue'"); await runDaily(env.pool, at(14), mailOff, log); const late = (await notesOf(w.ids.aVendor)).filter(x => x.entity_id === R.late); assert.equal(late.length, 2, 'after reading, the weekly nudge arrives'); assert.match(late[1].label, /overdue by 17 days/);
  assert.equal((await notesOf(w.ids.aVendor)).filter(x => x.entity_id === R.soon && x.kind === 'reminder.due_soon').length, 1);
  const before = (await rows('SELECT COUNT(*) n FROM notifications'))[0].n; await env.pool.query('UPDATE evidence_requests SET due_date=? WHERE id=?', [day(15), R.far]); await env.pool.query("UPDATE notifications SET read_at=NOW(3)"); await runDaily(env.pool, at(14), mailOff, log); assert.ok((await rows('SELECT COUNT(*) n FROM notifications'))[0].n > before, 'new due date, new reminder'); await env.pool.query('UPDATE evidence_requests SET due_date=? WHERE id=?', [day(10), R.far]);
});
test('a person who switched a reminder kind off gets no notification for it, and it is not retried later', async () => {
  await reset(); await vendor.call('PUT', '/me/notification-prefs', { kind: 'reminder.overdue', inApp: false }); await runDaily(env.pool, at(0), mailOff, log); const v = await notesOf(w.ids.aVendor); assert.ok(v.length && v.every(x => x.kind === 'reminder.due_soon'));
  await vendor.call('PUT', '/me/notification-prefs', { kind: 'reminder.overdue', inApp: true }); await runDaily(env.pool, at(1), mailOff, log); assert.ok((await notesOf(w.ids.aVendor)).every(x => x.kind === 'reminder.due_soon'), 'the missed stage is not replayed');
});
test('no reminders for closed engagements, suspended organizations, disabled users, or people who lost access', async () => {
  await reset(); const base = (await candidates(env.pool, TODAY)).length; assert.ok(base >= 5);
  await env.pool.query("UPDATE users SET status='disabled' WHERE id=?", [w.ids.aVendor]); assert.equal((await candidates(env.pool, TODAY)).length, base - 4); await env.pool.query("UPDATE users SET status='active' WHERE id=?", [w.ids.aVendor]);
  await env.pool.query("UPDATE organizations SET status='suspended' WHERE id=?", [w.A]); assert.equal((await candidates(env.pool, TODAY)).length, 0); await env.pool.query("UPDATE organizations SET status='active' WHERE id=?", [w.A]);
  await env.pool.query("UPDATE engagements SET status='closed' WHERE id=?", [E]); assert.equal((await candidates(env.pool, TODAY)).length, 0); await env.pool.query("UPDATE engagements SET status='active' WHERE id=?", [E]);
  const m = (await rows('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', [w.A, w.ids.aVendor]))[0].role; await env.pool.query('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', [w.A, w.ids.aVendor]); assert.equal((await candidates(env.pool, TODAY)).length, base - 4); await env.pool.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,?)', [w.A, w.ids.aVendor, m]);
});
test('digest: one email per person per day with their items grouped by organization; off, weekly and unconfigured email are respected', async () => {
  await reset(); const r = await runDaily(env.pool, at(0), mailOn, log); assert.equal(r.queued, 2, 'vendor and staff');
  const jobs = await rows("SELECT payload, max_attempts, idempotency_key k FROM jobs WHERE type='email.digest'"); const pay = (e: string) => { const j = jobs.find(x => (typeof x.payload === 'string' ? JSON.parse(x.payload) : x.payload).to === e); return typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload; };
  const v = pay('avendor@c.test'); assert.equal(v.groups.length, 1); assert.equal(v.groups[0].org, 'Org A'); assert.equal(v.overdue, 2); assert.equal(v.dueSoon, 2); assert.equal(v.unread, 4); assert.ok(v.groups[0].overdue.length === 2 && v.groups[0].dueSoon.length === 2); assert.ok(jobs.every(j => j.max_attempts === 3 && /^digest:.+:2026-10-24$/.test(j.k)));
  assert.equal((await runDaily(env.pool, at(0), mailOn, log)).queued, 0, 'same day: not twice'); assert.equal((await runDaily(env.pool, at(1), mailOn, log)).queued, 2, 'next day'); await env.pool.query("DELETE FROM jobs WHERE type='email.digest'");
  assert.equal((await vendor.call('PUT', '/me/email-digest', { frequency: 'off' })).status, 200); assert.equal((await runDaily(env.pool, at(5), mailOn, log)).queued, 1, 'staff only'); assert.equal((await vendor.call('PUT', '/me/email-digest', { frequency: 'weekly' })).status, 200);
  assert.equal((await runDaily(env.pool, at(8), mailOn, log)).queued, 2, 'staff daily, and the weekly person is due again after 7 days');
  assert.equal((await runDaily(env.pool, at(9), mailOn, log)).queued, 1, 'the weekly person is not sent another within a week'); await reset(); const off = await runDaily(env.pool, at(0), mailOff, log); assert.equal(off.queued, 0); assert.equal(off.skipped, 'email_not_configured'); assert.equal((await rows("SELECT 1 FROM jobs WHERE type='email.digest'")).length, 0); assert.ok(off.reminders > 0, 'in-app reminders still go out without email');
});
test('digest email: subject counts, items listed, a link to the app only, escaped text, and a cap with "and N more"', () => {
  const g = groupItems([{ org: 'Acme <b>', tenantId: 't', label: 'Evil <script>alert(1)</script>\r\nBcc: x@y.z', due: day(-2), stage: 'overdue', days: 2 }, ...Array.from({ length: 12 }, (_, i) => ({ org: 'Acme <b>', tenantId: 't', label: `Item ${i}`, due: day(1), stage: 'due_soon' as const, days: 1 }))]);
  const m = render('email.digest', { name: 'Priya', groups: g, unread: 3, overdue: 1, dueSoon: 12 }, 'https://grc.example.com'); assert.equal(m.subject, 'Your iSecurify GRC digest: 1 overdue, 12 due soon, 3 unread notifications'); assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.text, /Hello Priya/); assert.match(m.text, /overdue by 2 days/); assert.match(m.text, /… and 3 more/); assert.ok(m.text.includes('https://grc.example.com/notifications')); assert.ok(!m.html.includes('<script>')); assert.ok(!m.html.includes('<b>'));
  for (const href of [...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1])) assert.ok(href.startsWith('https://grc.example.com/'), href); assert.equal(render('email.digest', { groups: [], unread: 0 }, 'https://x.test').subject, 'Your iSecurify GRC digest: nothing urgent');
});
test('digest settings: default daily, can be changed, nothing else is accepted; every person has their own', async () => {
  await reset(); assert.deepEqual((await vendor.call('GET', '/me/email-digest')).body, { frequency: 'daily', lastSentAt: null }); assert.equal((await vendor.call('PUT', '/me/email-digest', { frequency: 'weekly' })).status, 200); assert.equal((await vendor.call('GET', '/me/email-digest')).body.frequency, 'weekly'); assert.equal((await aAdmin.call('GET', '/me/email-digest')).body.frequency, 'daily');
  assert.equal((await vendor.call('PUT', '/me/email-digest', { frequency: 'hourly' })).status, 400); assert.equal((await env.client().call('GET', '/me/email-digest')).status, 401); const k = (await vendor.call('GET', '/me/notification-prefs')).body.kinds; assert.ok(k.some((x: any) => x.kind === 'reminder.overdue' && x.group === 'Reminders'));
});
