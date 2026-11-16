// Renewal: a closed engagement is the starting point of next year's. Decisions carry over, evidence never does.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, signoffSql } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, auditor: any;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
let E = '', ITEMS: any[] = [], R = '';
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); admin = await w.as('aAdmin'); auditor = await w.as('aAuditor'); });
after(() => env.close());

test('1. only a closed engagement can be renewed, and only by someone who manages it', async () => {
  const r = await admin.call('POST', url('/engagements'), { name: 'FY27', primaryReleaseId: fx.X.releaseId }); assert.equal(r.status, 201); E = r.body.id;
  ITEMS = (await admin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' });
  assert.equal((await admin.call('POST', url(`/engagements/${E}/renew`), { name: 'FY28' })).body.code, 'engagement_open');
  assert.equal((await (await w.as('aVendor')).call('POST', url(`/engagements/${E}/renew`), { name: 'FY28' })).status, 403);
});
test('2. decisions are made, the engagement closes', async () => {
  assert.equal((await admin.call('PATCH', url(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor })).status, 200);
  assert.equal((await admin.call('PATCH', url(`/checklist/${ITEMS[1].id}`), { readiness: 'not_applicable', naJustification: 'No such site' })).status, 200);
  const f = await auditor.call('POST', url(`/checklist/${ITEMS[0].id}/findings`), { title: 'Logs not retained', description: 'Only 7 days', severity: 'medium' }); assert.equal(f.status, 201);
  const f2 = await auditor.call('POST', url(`/checklist/${ITEMS[1].id}/findings`), { title: 'Other', description: 'On an N/A item', severity: 'low' });
  await env.pool.query("UPDATE findings SET status='closed', closed_at=NOW(3) WHERE id=?", [f2.body.id]);
  await env.pool.query("UPDATE engagements SET current_phase=5 WHERE tenant_id=? AND id=?", [w.A, E]);
  await auditor.call('POST', url(`/findings/${f.body.id}/transition`), { to: 'risk_accepted', note: 'x' }).catch(() => 0);
  await env.pool.query("UPDATE findings SET status='open', closed_at=NULL WHERE id=?", [f.body.id]);
  await signoffSql(env.pool, w.A, E, w.ids.aAuditor, 'qualified'); await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE tenant_id=? AND id=?", [w.A, E]);
});
test('3. renewal creates a fresh engagement and carries decisions, team and open findings, but no evidence', async () => {
  const r = await admin.call('POST', url(`/engagements/${E}/renew`), { name: 'FY28' }); assert.equal(r.status, 201, JSON.stringify(r.body)); R = r.body.id;
  assert.equal(r.body.carried.assignees, 1); assert.equal(r.body.carried.findings, 1); assert.equal(r.body.carried.skippedFindings, 0);
  const e = (await admin.call('GET', url(`/engagements/${R}`))).body; assert.equal(JSON.stringify(e).includes(E), true, 'links to what it renewed');
  const items = (await admin.call('GET', url(`/engagements/${R}/checklist`))).body.items; assert.equal(items.length, ITEMS.length);
  const a = items.find((i: any) => i.ref === ITEMS[0].ref); assert.equal(a.state === 'effective', false); assert.equal((await rows('SELECT COUNT(*) n FROM evidence_requests WHERE engagement_id=?', [R]))[0].n, 0);
  assert.equal((await rows('SELECT readiness_status s FROM checklist_items WHERE engagement_id=? AND ref=?', [R, ITEMS[1].ref]))[0].s, 'not_applicable');
  const fnd = await rows('SELECT description, carried_from cf, status FROM findings WHERE engagement_id=?', [R]); assert.equal(fnd.length, 1); assert.ok(fnd[0].cf); assert.match(fnd[0].description, /Carried over/); assert.equal(fnd[0].status, 'open');
  assert.equal((await rows('SELECT COUNT(*) n FROM engagement_members WHERE engagement_id=? AND user_id=?', [R, w.ids.aAuditor]))[0].n, 1);
  assert.equal((await rows('SELECT COUNT(*) n FROM engagement_signoffs WHERE engagement_id=?', [R]))[0].n, 0, 'no sign-off is inherited');
});
test('4. it can only be renewed once, the original is untouched, and other organizations see nothing', async () => {
  assert.equal((await admin.call('POST', url(`/engagements/${E}/renew`), { name: 'again' })).body.code, 'already_renewed');
  assert.equal((await rows('SELECT status FROM engagements WHERE id=?', [E]))[0].status, 'closed');
  assert.equal((await (await w.as('bAdmin')).call('POST', url(`/engagements/${E}/renew`), { name: 'x' })).status, 404);
  const a = (await rows("SELECT action FROM audit_events WHERE tenant_id=?", [w.A])).map(x => x.action); assert.ok(a.includes('engagement.renewed') && a.includes('engagement.renewal_started'));
});
