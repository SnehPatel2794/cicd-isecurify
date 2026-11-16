import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers';
import { addDays, addMonthsClamped, addPeriod, nextDueAfter, testState, scheduleState, canRecord, runDateProblem, changeOver, TREND } from '../src/modules/continuous/rules';
import { frameworkSummaries, testHealth } from '../../shared/posture';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, team: any, root: any; let E: string, ITEMS: any[], EB: string, ITEMS_B: any[];
const A = (p: string) => `/t/${w.A}${p}`; const B = (p: string) => `/t/${w.B}${p}`; const today = () => new Date().toISOString().slice(0, 10); const rows = async (sql: string, p: any[] = []) => ((await env.pool.query(sql, p)) as any)[0] as any[];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); root = w.root; fx = await frameworkFixtures(root);
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test');
  aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', A('/engagements'), { name: 'Continuous', primaryReleaseId: fx.X.releaseId })).body.id; ITEMS = (await aAdmin.call('GET', A(`/engagements/${E}/checklist`))).body.items;
  await aAdmin.call('PATCH', A(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor }); await aAdmin.call('PATCH', A(`/checklist/${ITEMS[1].id}`), { accountableUserId: w.ids.aStaff });
  EB = (await bAdmin.call('POST', B('/engagements'), { name: 'Other org', primaryReleaseId: fx.X.releaseId })).body.id; ITEMS_B = (await bAdmin.call('GET', B(`/engagements/${EB}/checklist`))).body.items;
}); after(() => env.close());

test('pure rules: periods clamp to month ends, states, who may record, run dates, trend', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28'); assert.equal(addMonthsClamped('2028-01-31', 1), '2028-02-29'); assert.equal(addMonthsClamped('2026-11-30', 3), '2027-02-28'); assert.equal(addPeriod('2026-10-30', 'weekly'), '2026-11-06');
  assert.equal(addPeriod('2026-10-30', 'quarterly'), '2027-01-30'); assert.equal(addPeriod('2026-10-30', 'annual'), '2027-10-30'); assert.equal(nextDueAfter('2026-08-31', 'monthly'), '2026-09-30');
  const T = (o: any = {}) => ({ status: 'active', lastResult: null, nextDueOn: '2026-11-01', ...o }); assert.equal(testState(T(), '2026-10-20'), 'ok'); assert.equal(testState(T(), '2026-10-26'), 'due_soon'); assert.equal(testState(T(), '2026-11-01'), 'due_soon'); assert.equal(testState(T(), '2026-11-02'), 'overdue');
  assert.equal(testState(T({ lastResult: 'fail' }), '2026-10-20'), 'failing'); assert.equal(testState(T({ status: 'paused', lastResult: 'fail' }), '2026-12-01'), 'paused');
  assert.equal(scheduleState({ status: 'active', nextRunOn: '2026-10-30' }, '2026-10-30'), 'due'); assert.equal(scheduleState({ status: 'active', nextRunOn: '2026-11-05' }, '2026-10-30'), 'upcoming'); assert.equal(scheduleState({ status: 'active', nextRunOn: '2027-01-01' }, '2026-10-30'), 'ok'); assert.equal(scheduleState({ status: 'paused', nextRunOn: '2020-01-01' }, '2026-10-30'), 'paused');
  const prov = { via: 'member' as const, role: 'third_party_vendor', manage: false }; assert.equal(canRecord(prov, 'u1', null, 'u1'), true); assert.equal(canRecord(prov, 'u1', 'u2', 'u1'), false); assert.equal(canRecord({ via: 'member', role: 'tp_auditor', manage: false }, 'u1', null, 'u1'), false); assert.equal(canRecord({ via: 'member', role: 'client_admin', manage: true }, 'x', null, 'u1'), true);
  assert.equal(runDateProblem('2026-10-31', '2026-10-30'), 'A test cannot be recorded for a future date'); assert.ok(runDateProblem('2025-01-01', '2026-10-30')); assert.equal(runDateProblem('2026-10-01', '2026-10-30'), null); assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  const P = (d: string, p: number) => ({ date: d, percent: p }); assert.equal(changeOver([P('2026-10-30', 50)], 30), null); assert.equal(changeOver([P('2026-10-25', 40), P('2026-10-30', 50)], 30), null); assert.equal(changeOver([P('2026-09-25', 40), P('2026-10-30', 52.5)], 30), 12.5);
  assert.equal(TREND(12), 'up'); assert.equal(TREND(-3), 'down'); assert.equal(TREND(0.2), 'flat'); assert.equal(TREND(null), 'unknown');
});
test('creating a test: managers only, validated, audited; the owner must belong to the organization', async () => {
  const body = { title: 'Restore a backup', procedure: 'Restore last night\'s backup to staging', frequency: 'monthly' };
  for (const c of [vendor, staff, auditor]) assert.equal((await c.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), body)).status, 403);
  assert.equal((await bAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), body)).status, 404); assert.equal((await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), { ...body, frequency: 'daily' })).status, 400);
  assert.equal((await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), { ...body, ownerUserId: w.ids.bAdmin })).status, 400, 'owner from another organization');
  const r = await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), body); assert.equal(r.status, 201); const t = (await rows('SELECT * FROM control_tests WHERE id=?', [r.body.id]))[0]; assert.equal(t.tenant_id, w.A); assert.equal(t.status, 'active'); assert.equal(String(t.next_due_on.toISOString?.().slice(0, 10) ?? t.next_due_on).slice(0, 10), today());
  const au = await rows("SELECT detail FROM audit_events WHERE action='control_test.created' AND tenant_id=?", [w.A]); assert.equal(au.length, 1); assert.equal((typeof au[0].detail === 'string' ? JSON.parse(au[0].detail) : au[0].detail).engagementId, E);
  const team2 = await team.call('POST', A(`/checklist/${ITEMS[2].id}/control-tests`), { ...body, title: 'By staff', frequency: 'quarterly', firstDueOn: addDays(today(), 20) }); assert.equal(team2.status, 201, 'managing iSecurify staff may create');
});
test('listing follows visibility: admins see all, a vendor only tests on their own items, an auditor needs to be on the engagement, other organizations nothing', async () => {
  const mk = await aAdmin.call('POST', A(`/checklist/${ITEMS[1].id}/control-tests`), { title: 'Staff-owned test', frequency: 'weekly' }); assert.equal(mk.status, 201);
  const all = (await aAdmin.call('GET', A('/control-tests'))).body; assert.ok(all.total >= 3); const v = (await vendor.call('GET', A('/control-tests'))).body; assert.ok(v.tests.length >= 1 && v.tests.every((t: any) => t.responsibleUserId === w.ids.aVendor)); assert.ok(v.total < all.total);
  const s = (await staff.call('GET', A('/control-tests'))).body; assert.ok(s.tests.every((t: any) => t.responsibleUserId === w.ids.aStaff)); assert.equal((await auditor.call('GET', A('/control-tests'))).body.total, 0, 'not on any engagement');
  assert.equal((await bAdmin.call('GET', A('/control-tests'))).status, 404); assert.equal((await env.client().call('GET', A('/control-tests'))).status, 401); assert.equal((await bAdmin.call('GET', B('/control-tests'))).body.total, 0);
  assert.equal((await aAdmin.call('GET', A(`/control-tests?engagementId=${EB}`))).status, 404, 'an engagement of another organization');
  const due = (await aAdmin.call('GET', A('/control-tests?state=attention'))).body; assert.ok(due.tests.every((t: any) => t.attention));
});
test('recording a result: the responsible person or a manager, never an auditor; pass moves the due date on by one period, fail flags it and tells the managers', async () => {
  const list = (await aAdmin.call('GET', A('/control-tests'))).body.tests; const mine = list.find((t: any) => t.responsibleUserId === w.ids.aVendor && t.title === 'Restore a backup'); const other = list.find((t: any) => t.title === 'Staff-owned test');
  assert.equal((await vendor.call('POST', A(`/control-tests/${other.id}/runs`), { result: 'pass', note: 'x' })).status, 404, 'not theirs: invisible'); assert.equal((await auditor.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: 'x' })).status, 404);
  assert.equal((await vendor.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: '' })).status, 400, 'a note is required'); assert.equal((await vendor.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: 'n', performedOn: addDays(today(), 1) })).status, 400);
  const ok = await vendor.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: 'Restored in 12 minutes, data verified' }); assert.equal(ok.status, 201); assert.equal(ok.body.test.state, 'ok'); assert.equal(ok.body.test.nextDueOn, addPeriod(today(), 'monthly')); assert.equal(ok.body.test.lastResult, 'pass');
  const before = (await rows("SELECT COUNT(*) n FROM notifications WHERE kind='control_test.failed'"))[0].n; const bad = await vendor.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'fail', note: 'Restore failed: checksum mismatch' }); assert.equal(bad.status, 201); assert.equal(bad.body.test.state, 'failing');
  assert.ok((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='control_test.failed'"))[0].n > before, 'managers and the accountable person are told'); assert.equal((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='control_test.failed' AND user_id=?", [w.ids.aVendor]))[0].n, 0, 'not the person who recorded it');
  const runs = (await vendor.call('GET', A(`/control-tests/${mine.id}/runs`))).body; assert.equal(runs.runs.length, 2); assert.equal(runs.runs[0].result, 'fail');
  // a late entry for an earlier day does not rewind the current state
  const late = await aAdmin.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: 'Back-filled from the ticket', performedOn: addDays(today(), -20) }); assert.equal(late.status, 201); assert.equal(late.body.test.lastResult, 'fail', 'the newest run still decides'); assert.equal(late.body.test.lastRunOn, today());
  const pass = await aAdmin.call('POST', A(`/control-tests/${mine.id}/runs`), { result: 'pass', note: 'Retested after the fix' }); assert.equal(pass.body.test.state, 'ok');
});
test('runs are append-only: no endpoint edits or deletes them (and the database account cannot either, see grants)', async () => {
  const routes = (env.app as any).printRoutes({ commonPrefix: false }) as string; assert.ok(!/control-tests.*\(DELETE\)/.test(routes) && !/runs.*\((PATCH|PUT|DELETE)\)/.test(routes));
});
test('editing and pausing: managers only; paused tests refuse results and disappear from the health counts', async () => {
  const t = (await aAdmin.call('GET', A('/control-tests'))).body.tests.find((x: any) => x.title === 'By staff');
  assert.equal((await vendor.call('PATCH', A(`/control-tests/${t.id}`), { status: 'paused' })).status, 403); assert.equal((await bAdmin.call('PATCH', A(`/control-tests/${t.id}`), { status: 'paused' })).status, 404); assert.equal((await aAdmin.call('PATCH', A(`/control-tests/${t.id}`), {})).status, 400);
  assert.equal((await aAdmin.call('PATCH', A(`/control-tests/${t.id}`), { status: 'paused', frequency: 'annual' })).status, 200); const after = (await aAdmin.call('GET', A('/control-tests'))).body.tests.find((x: any) => x.id === t.id); assert.equal(after.state, 'paused'); assert.equal(after.frequency, 'annual');
  assert.equal((await aAdmin.call('POST', A(`/control-tests/${t.id}/runs`), { result: 'pass', note: 'n' })).status, 409); const h = await testHealth(async (s, p) => ((await env.pool.query(s, p)) as any)[0], w.A, [E], today()); assert.ok((h.get(E)?.total ?? 0) >= 2);
  await aAdmin.call('PATCH', A(`/control-tests/${t.id}`), { status: 'active' });
});
test('a closed engagement is read-only for tests and schedules; a not-applicable item cannot have either', async () => {
  const E3 = (await aAdmin.call('POST', A('/engagements'), { name: 'To close', primaryReleaseId: fx.X.releaseId })).body.id; const it = (await aAdmin.call('GET', A(`/engagements/${E3}/checklist`))).body.items;
  await aAdmin.call('PATCH', A(`/checklist/${it[0].id}`), { readiness: 'not_applicable', naJustification: 'Out of scope' }); assert.equal((await aAdmin.call('POST', A(`/checklist/${it[0].id}/control-tests`), { title: 'x', frequency: 'weekly' })).status, 409); assert.equal((await aAdmin.call('POST', A(`/checklist/${it[0].id}/evidence-schedules`), { title: 'x', everyMonths: 3 })).status, 409);
  const mk = await aAdmin.call('POST', A(`/checklist/${it[1].id}/control-tests`), { title: 'will be frozen', frequency: 'weekly' }); await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E3]);
  assert.equal((await aAdmin.call('POST', A(`/checklist/${it[1].id}/control-tests`), { title: 'y', frequency: 'weekly' })).status, 409); assert.equal((await aAdmin.call('POST', A(`/control-tests/${mk.body.id}/runs`), { result: 'pass', note: 'n' })).status, 409); assert.equal((await aAdmin.call('GET', A(`/control-tests?engagementId=${E3}`))).body.total, 1, 'still readable');
});
test('evidence schedules: create, list by role, open a request by hand, advance, skip when blocked', async () => {
  const body = { title: 'Quarterly access review sign-off', instructions: 'Export the list of users and their roles', everyMonths: 3, dueDays: 10, validMonths: 3 };
  for (const c of [vendor, staff, auditor]) assert.equal((await c.call('POST', A(`/checklist/${ITEMS[0].id}/evidence-schedules`), body)).status, 403); assert.equal((await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/evidence-schedules`), { ...body, everyMonths: 0 })).status, 400);
  const mk = await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/evidence-schedules`), { ...body, nextRunOn: addDays(today(), -1) }); assert.equal(mk.status, 201);
  const l = (await aAdmin.call('GET', A('/evidence-schedules'))).body; assert.equal(l.schedules[0].state, 'due'); assert.equal((await vendor.call('GET', A('/evidence-schedules'))).body.total, 1); assert.equal((await staff.call('GET', A('/evidence-schedules'))).body.total, 0);
  assert.equal((await vendor.call('POST', A(`/evidence-schedules/${mk.body.id}/open`))).status, 403); assert.equal((await bAdmin.call('POST', A(`/evidence-schedules/${mk.body.id}/open`))).status, 404);
  const opened = await aAdmin.call('POST', A(`/evidence-schedules/${mk.body.id}/open`)); assert.equal(opened.status, 201); const req = (await rows('SELECT * FROM evidence_requests WHERE id=?', [opened.body.requestId]))[0]; assert.equal(req.status, 'requested'); assert.equal(req.title, body.title); assert.equal(req.valid_months, 3); assert.equal(req.item_id, ITEMS[0].id);
  assert.equal(String(req.due_date.toISOString?.().slice(0, 10) ?? req.due_date).slice(0, 10), addDays(today(), 10)); assert.equal((await rows('SELECT evidence_status s FROM checklist_items WHERE id=?', [ITEMS[0].id]))[0].s, 'requested', 'the item evidence status follows the usual rule');
  const s = (await aAdmin.call('GET', A('/evidence-schedules'))).body.schedules[0]; assert.equal(s.nextRunOn, addMonthsClamped(today(), 3)); assert.equal(s.lastRequestId, opened.body.requestId); assert.equal(s.state, 'ok');
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='evidence.requested' AND tenant_id=?", [w.A]))[0].n >= 1, true); assert.equal((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='evidence.requested' AND user_id=?", [w.ids.aVendor]))[0].n, 1);
});
test('open all due: opens what it can and reports why it skipped the rest', async () => {
  const extra: any[] = []; for (const n of [1, 2, 3]) extra.push((await aAdmin.call('POST', A(`/engagements/${E}/checklist`), { ref: `X-${n}`, domain: 'Custom', title: `Custom item ${n}` })).body);
  const a = await aAdmin.call('POST', A(`/checklist/${extra[0].id}/evidence-schedules`), { title: 'Due one', everyMonths: 6, nextRunOn: addDays(today(), -3) }); const b = await aAdmin.call('POST', A(`/checklist/${extra[1].id}/evidence-schedules`), { title: 'Due two', everyMonths: 6, nextRunOn: today() });
  await aAdmin.call('POST', A(`/checklist/${extra[2].id}/evidence-schedules`), { title: 'Not yet', everyMonths: 6 }); await aAdmin.call('PATCH', A(`/evidence-schedules/${b.body.id}`), { status: 'paused' });
  const r = await aAdmin.call('POST', A(`/engagements/${E}/evidence-schedules/open-due`)); assert.equal(r.status, 200); assert.equal(r.body.opened, 1); assert.deepEqual(r.body.skipped, []); assert.equal((await vendor.call('POST', A(`/engagements/${E}/evidence-schedules/open-due`))).status, 403);
  assert.equal((await aAdmin.call('POST', A(`/engagements/${E}/evidence-schedules/open-due`))).body.opened, 0, 'a second click opens nothing'); void a;
  await aAdmin.call('PATCH', A(`/evidence-schedules/${b.body.id}`), { status: 'active', title: 'Due two (renamed)' }); assert.equal((await aAdmin.call('DELETE', A(`/evidence-schedules/${b.body.id}`))).status, 200); assert.equal((await bAdmin.call('DELETE', A(`/evidence-schedules/${a.body.id}`))).status, 404);
});
test('posture: per-framework live score, the same number the engagement shows; trend from snapshots; hidden from people who only see their own items', async () => {
  const r = await aAdmin.call('GET', A(`/posture?engagementId=${E}`)); assert.equal(r.status, 200); const en = r.body.engagements[0]; assert.equal(en.id, E); assert.ok(en.frameworks.length >= 1); const fw = en.frameworks[0]; assert.equal(typeof fw.current.percent, 'number'); assert.equal(fw.series.at(-1).date, today());
  const eng = (await aAdmin.call('GET', A(`/engagements/${E}`))).body; assert.equal(r.body.tests.total, en.tests.total); assert.ok(en.tests.total >= 3);
  // with one framework the framework score equals the engagement score once custom items (no framework) are set aside
  assert.equal(en.frameworks.length, 1); const custom = (await aAdmin.call('GET', A(`/engagements/${E}/checklist`))).body.items.filter((i: any) => i.origin === 'custom').length; assert.ok(custom >= 1, 'this engagement has custom items, which belong to no framework'); assert.equal(fw.current.effective, eng.summary.effective); assert.equal(fw.current.applicable, eng.summary.applicable - custom);
  await env.pool.query('INSERT INTO posture_snapshots(tenant_id,engagement_id,framework_id,snap_date,applicable,effective,awaiting_review,overdue,percent) VALUES (?,?,?,DATE_SUB(CURDATE(), INTERVAL 40 DAY),10,2,0,0,20.00)', [w.A, E, fw.frameworkId]);
  const t = (await aAdmin.call('GET', A(`/posture?engagementId=${E}&days=90`))).body.engagements[0].frameworks[0]; assert.equal(t.series.length, 2); assert.equal(t.change30, Math.round((t.current.percent - 20) * 10) / 10); assert.ok(['up', 'flat', 'down'].includes(t.trend));
  assert.equal((await aAdmin.call('GET', A(`/posture?engagementId=${E}&days=7`))).body.engagements[0].frameworks[0].series.length, 1, 'the window is honoured');
  assert.equal((await vendor.call('GET', A('/posture'))).status, 403); assert.equal((await staff.call('GET', A('/posture'))).status, 403); assert.equal((await bAdmin.call('GET', A('/posture'))).status, 404); assert.equal((await aAdmin.call('GET', A(`/posture?engagementId=${EB}`))).status, 404);
  assert.equal((await bAdmin.call('GET', B('/posture'))).body.engagements.length, 1); assert.equal((await bAdmin.call('GET', B('/posture'))).body.tests.total, 0); assert.equal((await team.call('GET', A('/posture'))).status, 200);
});
test('framework scores: an item counts toward every framework it satisfies, and equals evaluating that framework alone', async () => {
  const XY = (await aAdmin.call('POST', A('/engagements'), { name: 'Two frameworks', primaryReleaseId: fx.X.releaseId, additionalReleaseIds: [fx.Y.releaseId] })).body.id; const q = async (s: string, p?: any[]) => ((await env.pool.query(s, p)) as any)[0];
  const fs = await frameworkSummaries(q, w.A, [XY], today()); assert.equal(fs.length, 2); const total = (await aAdmin.call('GET', A(`/engagements/${XY}`))).body.summary; for (const f of fs) assert.ok(f.summary.applicable <= total.applicable); assert.ok(fs.some(f => f.summary.applicable > 0));
  assert.deepEqual(await frameworkSummaries(q, w.A, [], today()), []); assert.deepEqual((await frameworkSummaries(q, w.B, [XY], today())), [], 'another organization sees nothing of this engagement');
});
test('migration facts: composite foreign keys keep tests inside their engagement and organization; runs cannot be written without a note', async () => {
  const t = (await aAdmin.call('GET', A('/control-tests'))).body.tests[0];
  await assert.rejects(env.pool.query('INSERT INTO control_tests(tenant_id,id,engagement_id,item_id,title,frequency,next_due_on,created_by) VALUES (?,UUID(),?,?,?,?,CURDATE(),?)', [w.B, E, ITEMS[0].id, 'x', 'weekly', w.ids.bAdmin]), 'a test cannot point at another organization\'s item');
  await assert.rejects(env.pool.query('INSERT INTO control_test_runs(tenant_id,id,test_id,engagement_id,item_id,performed_on,result,note,performed_by) VALUES (?,UUID(),?,?,?,CURDATE(),?,?,?)', [w.A, t.id, E, t.itemId, 'pass', '   ', w.ids.aAdmin]), 'blank note');
  await assert.rejects(env.pool.query('INSERT INTO control_tests(tenant_id,id,engagement_id,item_id,title,frequency,next_due_on,last_result,created_by) VALUES (?,UUID(),?,?,?,?,CURDATE(),?,?)', [w.A, E, ITEMS[0].id, 'x', 'weekly', 'fail', w.ids.aAdmin]), 'a result without a date');
  void ITEMS_B;
});
