import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { refreshDue } from '../../worker/src/summaries'; import { isStale, STALE_MINUTES } from '../../shared/readiness'; import { worstFreshness } from '../src/modules/summary/service';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let aAdmin: any, vendor: any, team: any; let E: string, ITEMS: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const dash = async (c = aAdmin) => (await c.call('GET', url('/dashboard'))).body; const age = () => env.pool.query("UPDATE summary_dirty SET marked_at=DATE_SUB(marked_at, INTERVAL 10 SECOND)");
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'Main', primaryReleaseId: fx.X.releaseId })).body.id; ITEMS = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
  await aAdmin.call('PATCH', url(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor, readiness: 'implemented' }); await aAdmin.call('PATCH', url(`/checklist/${ITEMS[1].id}`), { readiness: 'in_progress' });
}); after(() => env.close());

test('pure: stale after more than 15 minutes; worst freshness takes the oldest and any stale', () => {
  const now = Date.parse('2026-10-29T10:00:00Z'); assert.equal(STALE_MINUTES, 15); assert.equal(isStale(now - 15 * 60_000, now), false); assert.equal(isStale(now - 15 * 60_000 - 1, now), true);
  const f = (s: string, at: string | null, stale: boolean) => ({ source: s as any, computedAt: at, ageMinutes: at ? 1 : null, stale, staleAfterMinutes: 15 });
  assert.deepEqual(worstFreshness([]).source, 'live'); const m = worstFreshness([f('summary', '2026-10-29T09:50:00.000Z', false), f('summary', '2026-10-29T09:40:00.000Z', true), f('live', null, false)]);
  assert.equal(m.computedAt, '2026-10-29T09:40:00.000Z'); assert.equal(m.stale, true); assert.equal(m.source, 'mixed');
});
test('with no summary yet, the numbers are computed live and say so', async () => {
  const d = await dash(); assert.equal(d.freshness.source, 'live'); assert.equal(d.freshness.computedAt, null); assert.equal(d.freshness.stale, false); assert.ok(d.summary.applicable > 0);
});
test('after the worker refreshes, the SAME numbers are served from the summary table', async () => {
  const live = await dash(); await age(); assert.ok(await refreshDue(env.pool as any) >= 1); const d = await dash();
  assert.equal(d.freshness.source, 'summary'); assert.ok(d.freshness.computedAt); assert.equal(d.freshness.stale, false); assert.deepEqual(d.summary, live.summary); assert.deepEqual(d.perEngagement, live.perEngagement);
  const list = (await aAdmin.call('GET', url('/engagements'))).body; assert.deepEqual(list[0].summary, live.perEngagement[0].summary); assert.deepEqual((await aAdmin.call('GET', url(`/engagements/${E}`))).body.summary, live.perEngagement[0].summary);
});
test('proof it really reads the table: a stored value that differs from the live one is what is returned', async () => {
  const [r] = await rows('SELECT summary FROM engagement_summary WHERE engagement_id=?', [E]); const s = typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary;
  await env.pool.query('UPDATE engagement_summary SET summary=? WHERE engagement_id=?', [JSON.stringify({ ...s, overdue: 99 }), E]); assert.equal((await dash()).summary.overdue, 99);
  await env.pool.query('UPDATE engagement_summary SET summary=? WHERE engagement_id=?', [JSON.stringify(s), E]);
});
test('a change marks the engagement dirty and the API stops trusting the stored numbers at once; the worker then catches up', async () => {
  const before = await dash(); await aAdmin.call('PATCH', url(`/checklist/${ITEMS[1].id}`), { readiness: 'implemented' });
  assert.equal((await rows('SELECT COUNT(*) n FROM summary_dirty WHERE engagement_id=?', [E]))[0].n > 0, true, 'the trigger marked it');
  const d = await dash(); assert.equal(d.freshness.source, 'live', 'computed live while the mark is pending'); assert.notDeepEqual(d.summary, before.summary, 'shows the change immediately');
  await age(); await refreshDue(env.pool as any); const d2 = await dash(); assert.equal(d2.freshness.source, 'summary'); assert.deepEqual(d2.summary, d.summary, 'worker result equals the live result');
});
test('stale: a stored summary older than 15 minutes is flagged but still served', async () => {
  await env.pool.query('UPDATE engagement_summary SET computed_at=DATE_SUB(NOW(3), INTERVAL 20 MINUTE) WHERE engagement_id=?', [E]); const d = await dash();
  assert.equal(d.freshness.stale, true); assert.equal(d.freshness.source, 'summary'); assert.ok(d.freshness.ageMinutes >= 19); await refreshDue(env.pool as any); assert.equal((await dash()).freshness.stale, false, 'the catch-up refresh clears it');
});
test('a person who sees only their own items always gets live, personal numbers', async () => {
  const v = await dash(vendor); assert.equal(v.freshness.source, 'live'); assert.equal(v.scope, 'assigned'); assert.equal(v.summary.total, 1); assert.ok((await dash()).summary.total > 1);
});
test('platform overview takes finding counts from the summary and carries freshness', async () => {
  const [item] = ITEMS; await team.call('POST', url(`/checklist/${item.id}/findings`), { title: 'Crit', description: 'd', severity: 'critical' }); await age(); await refreshDue(env.pool as any);
  const p = (await team.call('GET', '/platform/analytics')).body; const o = p.organizations.find((x: any) => x.id === w.A); assert.equal(o.criticalUnresolved, 1); assert.equal(o.unresolvedFindings, 1); assert.ok(p.freshness); assert.equal(p.freshness.source, 'summary');
  await env.pool.query('UPDATE engagement_summary SET findings_critical=7 WHERE engagement_id=?', [E]); assert.equal((await team.call('GET', '/platform/analytics')).body.organizations.find((x: any) => x.id === w.A).criticalUnresolved, 7, 'read from the table');
  await env.pool.query('UPDATE engagement_summary SET findings_critical=1 WHERE engagement_id=?', [E]);
});
test('every table that feeds readiness has insert/update triggers that mark dirty', async () => {
  const t = (await rows("SELECT DISTINCT event_object_table t FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name LIKE 'sd\\_%'")).map(r => r.t ?? r.T); for (const x of ['checklist_items', 'checklist_item_controls', 'soa_entries', 'evidence_requests', 'findings', 'engagements']) assert.ok(t.includes(x), x);
});
