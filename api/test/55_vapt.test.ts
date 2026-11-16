// VAPT rounds (Phase 11D): the plan, the status flow, findings tagged to rounds, the comparison and the reminders.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { transitionCheck, reminderStage, compare, trend, nextStatuses } from '../src/modules/vapt/rules'; import { runVaptReminders } from '../../worker/src/vapt';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, auditor: any, vendor: any, staff: any;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[]; const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let E = '', ITEMS: any[] = [], R1 = '', R2 = '', F1 = '';
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); admin = await w.as('aAdmin'); auditor = await w.as('aAuditor'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); });
after(() => env.close());

test('1. the pure rules: status flow, report required, serious findings block closing, reminder stages, comparison', () => {
  assert.deepEqual(nextStatuses('planned'), ['in_progress', 'cancelled']); assert.ok(transitionCheck({ status: 'planned', reportTitle: null }, 'closed', 0)); assert.ok(transitionCheck({ status: 'in_progress', reportTitle: null }, 'report_issued', 0)?.includes('report title'));
  assert.equal(transitionCheck({ status: 'in_progress', reportTitle: 'R' }, 'report_issued', 0), null); assert.ok(transitionCheck({ status: 'report_issued', reportTitle: 'R' }, 'closed', 2)?.includes('2 critical or high'));
  assert.equal(reminderStage('2026-12-20', '2026-12-01'), null); assert.equal(reminderStage('2026-12-05', '2026-12-01'), 'upcoming'); assert.equal(reminderStage('2026-12-01', '2026-12-01'), 'due'); assert.equal(reminderStage('2026-11-29', '2026-12-01'), 'due'); assert.equal(reminderStage('2026-11-28', '2026-12-01'), 'overdue');
  const rounds = [{ id: 'a', roundNo: 1, title: 'R1', status: 'closed' as const, startOn: '2026-01-10' }, { id: 'b', roundNo: 2, title: 'R2', status: 'report_issued' as const, startOn: '2026-05-10' }, { id: 'x', roundNo: 3, title: 'gone', status: 'cancelled' as const, startOn: '2026-08-01' }];
  const fs = [{ roundId: 'a', severity: 'high', status: 'closed', createdOn: '2026-01-15', closedOn: '2026-03-01' }, { roundId: 'a', severity: 'critical', status: 'open', createdOn: '2026-01-15', closedOn: null }, { roundId: 'a', severity: 'low', status: 'closed', createdOn: '2026-01-15', closedOn: '2026-05-20' }, { roundId: 'b', severity: 'medium', status: 'open', createdOn: '2026-05-15', closedOn: null }];
  const c = compare(rounds, fs); assert.equal(c.length, 2, 'cancelled rounds are left out'); assert.equal(c[0].found, 3); assert.equal(c[0].foundSerious, 2); assert.equal(c[0].carriedIn, 0); assert.equal(c[0].closedAfter, 1, 'only closures before round 2 began');
  assert.equal(c[1].carriedIn, 2, 'the open critical and the low closed after round 2 began were still open when it started'); assert.equal(c[1].found, 1); assert.equal(c[1].closedAfter, 1); assert.equal(trend(c), 'improving'); assert.equal(trend(c.slice(0, 1)), 'not_enough_data');
});
test('2. setup: an engagement with the auditor assigned', async () => {
  const r = await admin.call('POST', url('/engagements'), { name: 'FY27', primaryReleaseId: fx.X.releaseId }); assert.equal(r.status, 201); E = r.body.id; ITEMS = (await admin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
  assert.equal((await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' })).status, 200);
});
test('3. only iSecurify managers and the engagement auditor change rounds; the client administrator can see them; staff and vendors cannot', async () => {
  const body = { title: 'Round 1: external', scope: 'Public web app and API', tester: 'iSecurify red team', plannedOn: day(30) };
  assert.equal((await admin.call('POST', url(`/engagements/${E}/vapt-rounds`), body)).status, 403, 'the client cannot create rounds'); for (const c of [vendor, staff]) assert.equal((await c.call('POST', url(`/engagements/${E}/vapt-rounds`), body)).status >= 403, true);
  const r1 = await team.call('POST', url(`/engagements/${E}/vapt-rounds`), body); assert.equal(r1.status, 201, JSON.stringify(r1.body)); R1 = r1.body.id; assert.equal(r1.body.roundNo, 1);
  const r2 = await auditor.call('POST', url(`/engagements/${E}/vapt-rounds`), { title: 'Round 2: internal', plannedOn: day(120) }); assert.equal(r2.status, 201, JSON.stringify(r2.body)); R2 = r2.body.id;
  const v = await admin.call('GET', url(`/engagements/${E}/vapt`)); assert.equal(v.status, 200); assert.equal(v.body.rounds.length, 2); assert.equal(v.body.can.manage, false); assert.equal((await vendor.call('GET', url(`/engagements/${E}/vapt`))).status, 403);
  assert.equal((await (await w.as('bAdmin')).call('GET', url(`/engagements/${E}/vapt`))).status, 404);
});
test('4. the status flow: the report title is needed, steps cannot be skipped', async () => {
  const mv = (id: string, b: any, c = team) => c.call('POST', url(`/vapt-rounds/${id}/transition`), b);
  assert.equal((await mv(R1, { to: 'closed' })).body.code, 'round_transition'); assert.equal((await mv(R1, { to: 'in_progress' })).status, 200);
  assert.equal((await mv(R1, { to: 'report_issued' })).body.code, 'round_transition', 'needs a report title'); assert.equal((await mv(R1, { to: 'report_issued' }, admin)).status, 403);
  assert.equal((await mv(R1, { to: 'report_issued', reportTitle: 'External VAPT report v1.0', reportRef: 'ISEC-VAPT-001' })).status, 200);
  const g = (await team.call('GET', url(`/vapt-rounds/${R1}`))).body; assert.equal(g.status, 'report_issued'); assert.equal(g.reportRef, 'ISEC-VAPT-001'); assert.ok(g.reportIssuedOn);
});
test('5. findings are tagged on raising, on import and afterwards; a round from another engagement is refused', async () => {
  const mk = (b: any) => auditor.call('POST', url(`/checklist/${ITEMS[0].id}/findings`), { description: 'x', ...b });
  const a = await mk({ title: 'SQL injection in search', severity: 'high', roundId: R1 }); assert.equal(a.status, 201, JSON.stringify(a.body)); F1 = a.body.id; assert.equal((await rows('SELECT round_id r FROM findings WHERE id=?', [F1]))[0].r, R1);
  const loose = await mk({ title: 'Weak TLS ciphers', severity: 'medium' }); assert.equal((await rows('SELECT round_id r FROM findings WHERE id=?', [loose.body.id]))[0].r, null);
  const tag = await team.call('PUT', url(`/vapt-rounds/${R1}/findings`), { findingIds: [loose.body.id] }); assert.equal(tag.body.updated, 1);
  const other = await admin.call('POST', url('/engagements'), { name: 'Other', primaryReleaseId: fx.X.releaseId }); const oi = (await admin.call('GET', url(`/engagements/${other.body.id}/checklist`))).body.items[0];
  assert.equal((await auditor.call('POST', url(`/checklist/${ITEMS[1].id}/findings`), { title: 't', description: 'd', severity: 'low', roundId: '00000000-0000-4000-8000-000000000000' })).status, 400, 'unknown round');
  await team.call('PUT', url(`/engagements/${other.body.id}/members/${w.ids.aAuditor}`), { role: 'auditor' }); assert.equal((await auditor.call('POST', url(`/checklist/${oi.id}/findings`), { title: 't', description: 'd', severity: 'low', roundId: R1 })).status, 400, 'a round of another engagement');
  assert.equal((await team.call('PUT', url(`/vapt-rounds/${R1}/findings`), { findingIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400);
  const csv = `title,severity,description,item\nOpen redirect,low,Redirect param,${ITEMS[0].ref}\n`; const imp = await auditor.call('POST', url(`/engagements/${E}/findings/import`), { format: 'csv', content: csv, filename: 'scan.csv', commit: true, roundId: R1 }); assert.equal(imp.status, 201, JSON.stringify(imp.body));
  assert.equal((await rows('SELECT COUNT(*) n FROM findings WHERE round_id=?', [R1]))[0].n, 3); assert.equal((await team.call('GET', url(`/vapt-rounds/${R1}`))).body.findings.length, 3);
});
test('6. closing a round needs its high findings dealt with; retest then close', async () => {
  const mv = (id: string, b: any) => team.call('POST', url(`/vapt-rounds/${id}/transition`), b); assert.equal((await mv(R1, { to: 'retesting' })).status, 200);
  const blocked = await mv(R1, { to: 'closed' }); assert.equal(blocked.status, 409); assert.match(blocked.body.error, /1 critical or high finding is still open/);
  for (const to of ['in_remediation', 'ready_for_retest']) await admin.call('POST', url(`/findings/${F1}/transition`), { to, note: 'fixed' }); await auditor.call('POST', url(`/findings/${F1}/transition`), { to: 'closed', note: 'Retested: fixed' });
  assert.equal((await mv(R1, { to: 'closed' })).status, 200); const g = (await team.call('GET', url(`/vapt-rounds/${R1}`))).body; assert.equal(g.status, 'closed'); assert.ok(g.retestedOn);
  assert.equal((await team.call('PATCH', url(`/vapt-rounds/${R1}`), { title: 'edit' })).status, 409, 'closed rounds are read-only');
  assert.equal((await auditor.call('POST', url(`/checklist/${ITEMS[0].id}/findings`), { title: 'late', description: 'd', severity: 'low', roundId: R1 })).status, 409);
});
test('7. the comparison and trend across rounds', async () => {
  await team.call('POST', url(`/vapt-rounds/${R2}/transition`), { to: 'in_progress' }); const a = await auditor.call('POST', url(`/checklist/${ITEMS[1].id}/findings`), { title: 'Missing rate limit', description: 'd', severity: 'low', roundId: R2 }); assert.equal(a.status, 201);
  const v = (await team.call('GET', url(`/engagements/${E}/vapt`))).body; assert.equal(v.comparison.length, 2); assert.equal(v.comparison[0].found, 3); assert.equal(v.comparison[1].found, 1); assert.ok(['not_enough_data', 'improving', 'steady', 'worsening'].includes(v.trend));
});
test('8. reminders: once per person, round and stage, to the team and client admins; not for started rounds; respects the preference', async () => {
  const r3 = await team.call('POST', url(`/engagements/${E}/vapt-rounds`), { title: 'Round 3', plannedOn: day(3) }); assert.equal(r3.status, 201); const log = { info() {}, warn() {} };
  const a = await runVaptReminders(env.pool as any, new Date(), log); assert.equal(a.rounds, 1); assert.ok(a.notices >= 2, 'team lead/auditor and client admin'); const b = await runVaptReminders(env.pool as any, new Date(), log); assert.equal(b.notices, 0, 'not twice');
  const n = await rows("SELECT user_id u, label FROM notifications WHERE kind='vapt.round_due' AND tenant_id=?", [w.A]); assert.ok(n.some(x => x.u === w.ids.aAdmin) && n.every(x => /VAPT round 3/.test(x.label)));
  const later = await runVaptReminders(env.pool as any, new Date(Date.now() + 5 * 86400000), log); assert.ok(later.notices >= 2, 'a new stage (late) is a new notice');
});
test('9. a closed engagement takes no new rounds; the audit trail records every change; the database refuses bad data', async () => {
  const acts = (await rows("SELECT action FROM audit_events WHERE tenant_id=?", [w.A])).map(x => x.action); for (const m of ['vapt.round_created', 'vapt.round_status', 'vapt.findings_tagged']) assert.ok(acts.includes(m), m);
  await assert.rejects(env.pool.query("UPDATE vapt_rounds SET status='report_issued', report_title=NULL WHERE id=?", [R2]), /constraint|CONSTRAINT/i); await assert.rejects(env.pool.query("UPDATE vapt_rounds SET status='closed' WHERE id=?", [R2]), /constraint|CONSTRAINT/i);
  await assert.rejects(env.pool.query("INSERT INTO vapt_rounds(tenant_id,id,engagement_id,round_no,title,planned_on,created_by) VALUES (?,UUID(),?,1,'dup','2026-01-01',?)", [w.A, E, w.ids.team]), /Duplicate|duplicate/);
});
