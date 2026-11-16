// Dashboards, Phase 13C: the platform overview for administrators (all organizations) and staff (assigned only), the engagement dashboard, and task figures in organization analytics.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { freshEnv, world, frameworkFixtures } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, vendor: any, auditor: any, bAdmin: any, E = '';
const url = (p: string) => `/t/${w.A}${p}`; const ymd = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); admin = await w.as('aAdmin'); vendor = await w.as('aVendor'); auditor = await w.as('aAuditor'); bAdmin = await w.as('bAdmin');
  E = (await admin.call('POST', url('/engagements'), { name: 'Techify FY27', primaryReleaseId: fx.X.releaseId })).body.id; await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' });
  const mk = (b: any) => team.call('POST', url(`/engagements/${E}/tasks`), b);
  await mk({ title: 'Late for the vendor', assigneeId: w.ids.aVendor, dueDate: ymd(-3), phase: 1 }); await mk({ title: 'Due soon for the vendor', assigneeId: w.ids.aVendor, dueDate: ymd(4), phase: 1 }); await mk({ title: 'Nobody has this', phase: 2 });
  const done = await mk({ title: 'Already finished', assigneeId: w.ids.aStaff, phase: 1 }); await team.call('PATCH', url(`/tasks/${done.body.id}`), { status: 'done' }); });
after(() => env.close());

test('1. the engagement dashboard counts tasks, workload, phases and what is urgent', async () => {
  const r = await team.call('GET', url(`/engagements/${E}/dashboard`)); assert.equal(r.status, 200, JSON.stringify(r.body)); const d = r.body, t = d.tasks;
  assert.equal(d.engagement.name, 'Techify FY27'); assert.equal(d.engagement.phases.length, 5); assert.equal(t.total, 4); assert.equal(t.open, 3); assert.equal(t.done, 1); assert.equal(t.overdue, 1); assert.equal(t.dueThisWeek, 1); assert.equal(t.unassigned, 1);
  assert.deepEqual(t.byAssignee.map((x: any) => [x.name.length > 0, x.open, x.overdue]), [[true, 2, 1]]); assert.deepEqual(t.byPhase, [{ phase: 1, done: 1, open: 2 }, { phase: 2, done: 0, open: 1 }]);
  assert.deepEqual(t.overdueList.map((x: any) => x.title), ['Late for the vendor']); assert.deepEqual(t.upcoming.map((x: any) => x.title), ['Due soon for the vendor']); assert.equal(t.overdueList[0].engagementName, 'Techify FY27');
  assert.ok('readinessPercent' in d.readiness); assert.ok(d.findings.unresolvedBySeverity); assert.ok(d.evidence.byStatus); assert.ok(d.certificates);
});
test('2. who may open the engagement dashboard', async () => {
  assert.equal((await admin.call('GET', url(`/engagements/${E}/dashboard`))).status, 200); assert.equal((await auditor.call('GET', url(`/engagements/${E}/dashboard`))).status, 200); assert.equal((await vendor.call('GET', url(`/engagements/${E}/dashboard`))).status, 403, 'a vendor sees only their own work');
  assert.equal((await bAdmin.call('GET', url(`/engagements/${E}/dashboard`))).status, 404); assert.equal((await team.call('GET', url('/engagements/00000000-0000-4000-8000-000000000000/dashboard'))).status, 404);
});
test('3. organization analytics carries the task figures and per-engagement counts', async () => {
  const d = (await admin.call('GET', url('/analytics'))).body; assert.equal(d.tasks.open, 3); assert.equal(d.tasks.overdue, 1); assert.equal(d.tasks.dueThisWeek, 1); assert.equal(d.tasks.phaseNames.length, 5); assert.equal(d.tasks.byEngagement, undefined);
  assert.deepEqual(d.engagements.perEngagement[0].tasks, { total: 4, open: 3, done: 1, overdue: 1 }); assert.equal((await vendor.call('GET', url('/analytics'))).status, 403);
});
test('4. the portfolio: administrators see every organization as counts, staff only those assigned, with tasks and demo marks', async () => {
  const demo = (await w.root.call('POST', '/platform/organizations', { name: 'Demo Corp', isDemo: true })).body.id;
  const all = (await w.root.call('GET', '/platform/analytics')).body; assert.equal(all.scope, 'all'); const ids = all.organizations.map((o: any) => o.id); for (const id of [w.A, w.B, demo]) assert.ok(ids.includes(id));
  const a = all.organizations.find((o: any) => o.id === w.A), dm = all.organizations.find((o: any) => o.id === demo); assert.equal(a.assigned, false, 'the Super Admin is not assigned to A'); assert.deepEqual(a.tasks, { open: 3, overdue: 1 }); assert.ok(a.attention.includes('1 task overdue')); assert.equal(dm.isDemo, true); assert.equal(a.isDemo, false);
  assert.equal(all.totals.openTasks, 3); assert.equal(all.totals.overdueTasks, 1); assert.equal(all.totals.organizations, all.organizations.length);
  const mine = (await team.call('GET', '/platform/analytics')).body; assert.equal(mine.scope, 'assigned'); assert.deepEqual(mine.organizations.map((o: any) => o.id), [w.A]); assert.equal(mine.organizations[0].assigned, true);
  assert.equal((await admin.call('GET', '/platform/analytics')).status, 403, 'client people have no portfolio');
});
