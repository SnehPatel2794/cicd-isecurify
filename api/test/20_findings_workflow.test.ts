import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, root: any; let E: string, items: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const list = async (c: any = aAdmin, e = E) => (await c.call('GET', url(`/engagements/${e}/checklist`))).body.items as any[];
const item = async (i: string, c: any = aAdmin) => (await list(c)).find(x => x.id === i);
const raise = (c: any, itemId: string, body: any = {}) => c.call('POST', url(`/checklist/${itemId}/findings`), { title: 'No MFA on admin accounts', description: 'Admin console allows password-only login', severity: 'high', ...body });
const move = (c: any, id: string, to: string, note: string | null = 'ok') => c.call('POST', url(`/findings/${id}/transition`), { to, note });
const get = async (c: any, id: string) => c.call('GET', url(`/findings/${id}`));
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false } } as any); w = await world(env); fx = await frameworkFixtures(w.root); root = w.root;
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'F', primaryReleaseId: fx.X.releaseId })).body.id;
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); items = await list();
  for (const i of items.slice(0, 2)) await aAdmin.call('PATCH', url(`/checklist/${i.id}`), { accountableUserId: w.ids.aVendor });
}); after(() => env.close());

test('full lifecycle: raise -> assign -> remediate -> retest fails -> remediate -> close; every step is an append-only event and is audited', async () => {
  const it = items[0]; const r = await raise(auditor, it.id, { dueDate: '2030-01-01' }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.ref, 'F-001'); const id = r.body.id;
  assert.equal((await raise(auditor, it.id, { title: 'Second' })).body.ref, 'F-002', 'numbers run per engagement');
  assert.equal((await move(vendor, id, 'in_remediation')).status, 403, 'not the owner yet'); assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: w.ids.aVendor })).status, 200);
  assert.equal((await move(vendor, id, 'in_remediation')).status, 200); assert.equal((await vendor.call('PATCH', url(`/findings/${id}`), { remediationPlan: 'Enforce MFA by Friday' })).status, 200);
  assert.equal((await move(vendor, id, 'ready_for_retest', '  ')).status, 400, 'note mandatory'); assert.equal((await move(vendor, id, 'ready_for_retest', 'MFA enforced')).status, 200);
  assert.equal((await move(vendor, id, 'closed', 'self')).status, 403, 'owner cannot close'); assert.equal((await move(aAdmin, id, 'closed', 'x')).status, 403, 'client admin cannot close');
  assert.equal((await move(auditor, id, 'in_remediation', 'still reachable without MFA from VPN')).status, 200, 'retest failed'); assert.equal((await move(vendor, id, 'ready_for_retest', 'fixed VPN too')).status, 200);
  assert.equal((await move(auditor, id, 'closed', 'verified')).status, 200); const f = (await get(auditor, id)).body; assert.equal(f.status, 'closed'); assert.ok(f.closedAt);
  assert.deepEqual(f.events.map((e: any) => e.kind + ':' + (e.toStatus ?? '')), ['raised:open', 'assigned:', 'status:in_remediation', 'edited:', 'status:ready_for_retest', 'status:in_remediation', 'status:ready_for_retest', 'status:closed']);
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action LIKE 'finding.%'"))[0].n >= 8, true);
  assert.equal((await vendor.call('PATCH', url(`/findings/${id}`), { remediationPlan: 'x' })).status, 409, 'closed findings are frozen'); assert.equal((await move(auditor, id, 'open', 'regressed')).status, 200, 'but can be reopened'); assert.equal((await get(auditor, id)).body.closedAt, null);
});
test('who may raise: auditor and managing staff only; clients, vendors, view-only and outsiders cannot', async () => {
  const it = items[2];
  for (const c of [aAdmin, vendor, staff]) assert.equal((await raise(c, it.id)).status, 403); assert.equal((await raise(bAdmin, it.id)).status, 404, 'other organization');
  assert.equal((await raise(team, it.id)).status, 201); assert.equal((await raise(auditor, it.id, { ownerUserId: w.ids.aVendor })).status, 403, 'auditors do not assign owners'); assert.equal((await raise(team, it.id, { ownerUserId: w.ids.aAuditor })).status, 400, 'an auditor cannot own remediation');
  assert.equal((await raise(auditor, it.id, { severity: 'catastrophic' })).status, 400); assert.equal((await raise(auditor, it.id, { title: '   ' })).status, 400); assert.equal((await raise(auditor, it.id, { dueDate: '2030-02-31' })).status, 400);
});
test('control status: an unresolved high finding turns an effective control ineffective; closing it or accepting the risk restores it; low and observation never block', async () => {
  const it = items[1]; await aAdmin.call('PATCH', url(`/checklist/${it.id}`), { readiness: 'implemented' });
  const rq = await aAdmin.call('POST', url(`/checklist/${it.id}/evidence-requests`), { title: 'Proof' }); const { mpf, PDF } = await import('./helpers'); const m = mpf('p.pdf', PDF('f'), { note: 'n' });
  const up = await vendor.call('POST', url(`/evidence-requests/${rq.body.id}/versions`), m.payload, m.headers); assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal((await auditor.call('POST', url(`/evidence-requests/${rq.body.id}/review`), { versionId: up.body.versionId, decision: 'accepted', note: 'ok' })).status, 200); assert.equal((await item(it.id)).state, 'effective');
  const low = (await raise(auditor, it.id, { severity: 'low' })).body.id; const obs = (await raise(auditor, it.id, { severity: 'observation' })).body.id; assert.equal((await item(it.id)).state, 'effective', 'low/observation do not block');
  const hi = (await raise(auditor, it.id, { severity: 'high' })).body.id; let x = await item(it.id); assert.equal(x.state, 'ineffective'); assert.equal(x.blockingFindings, true);
  const sum = async () => (await aAdmin.call('GET', url(`/engagements/${E}/summary`))).body; const before = await sum();
  assert.equal((await move(auditor, hi, 'risk_accepted', 'Accepted by CISO ticket 123')).status, 200); assert.equal((await item(it.id)).state, 'effective', 'accepted risk does not block');
  assert.equal((await move(auditor, hi, 'open', 'risk no longer acceptable')).status, 200); assert.equal((await item(it.id)).state, 'ineffective');
  const med = await auditor.call('PATCH', url(`/findings/${hi}`), { severity: 'low', note: 'downgraded after review' }); assert.equal(med.status, 200); assert.equal((await item(it.id)).state, 'effective');
  assert.equal((await auditor.call('PATCH', url(`/findings/${hi}`), { severity: 'critical' })).status, 400, 'severity change needs a note'); assert.ok(before);
  await auditor.call('PATCH', url(`/findings/${hi}`), { severity: 'critical', note: 'worse than thought' }); assert.equal((await item(it.id)).state, 'ineffective'); assert.equal((await move(auditor, hi, 'cancelled', 'raised in error')).status, 200); assert.equal((await item(it.id)).state, 'effective'); assert.ok(low && obs);
});
test('visibility: vendors and staff see only findings they own or on items assigned to them (404 otherwise); auditors only on their engagements; other organizations never', async () => {
  const mine = (await raise(auditor, items[0].id, { title: 'Mine' })).body.id; const notMine = (await raise(auditor, items[2].id, { title: 'Not mine' })).body.id;
  const v = (await vendor.call('GET', url(`/engagements/${E}/findings`))).body; assert.ok(v.findings.some((x: any) => x.id === mine)); assert.ok(!v.findings.some((x: any) => x.id === notMine)); assert.equal(v.summary.total, v.findings.length);
  assert.equal((await vendor.call('GET', url(`/findings/${notMine}`))).status, 404); assert.equal((await vendor.call('GET', url(`/checklist/${items[2].id}/findings`))).status, 404); assert.equal((await staff.call('GET', url(`/findings/${mine}`))).status, 404);
  assert.equal((await vendor.call('POST', url(`/findings/${notMine}/comments`), { note: 'hi' })).status, 404); assert.equal((await move(vendor, notMine, 'in_remediation')).status, 404);
  assert.equal((await bAdmin.call('GET', url(`/findings/${mine}`))).status, 404); assert.equal((await bAdmin.call('GET', url(`/engagements/${E}/findings`))).status, 404);
  const E2 = (await aAdmin.call('POST', url('/engagements'), { name: 'Other', primaryReleaseId: fx.X.releaseId })).body.id; assert.equal((await auditor.call('GET', url(`/engagements/${E2}/findings`))).status, 404, 'auditor not a member');
  const ad = (await aAdmin.call('GET', url(`/engagements/${E}/findings`))).body; assert.ok(ad.findings.some((x: any) => x.id === notMine)); assert.equal(ad.canRaise, false); assert.equal((await auditor.call('GET', url(`/engagements/${E}/findings`))).body.canRaise, true);
  const unresolved = (await aAdmin.call('GET', url(`/engagements/${E}/findings?unresolved=true&severity=high`))).body.findings; assert.ok(unresolved.every((x: any) => x.severity === 'high' && x.blocking));
});
test('comments: anyone who can see the finding may comment; blank comments and closed engagements are refused', async () => {
  const id = (await raise(auditor, items[0].id, { title: 'Comment target' })).body.id;
  assert.equal((await vendor.call('POST', url(`/findings/${id}/comments`), { note: 'we are on it' })).status, 201); assert.equal((await auditor.call('POST', url(`/findings/${id}/comments`), { note: '   ' })).status, 400);
  const ev = (await get(vendor, id)).body.events; assert.equal(ev[ev.length - 1].kind, 'comment'); assert.equal(ev[ev.length - 1].actorName, 'avendor');
});
test('owner candidates: only active client-side members of this organization', async () => {
  const id = (await raise(auditor, items[0].id, { title: 'Owner target' })).body.id;
  assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: w.ids.bAdmin })).status, 400); assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: w.ids.team })).status, 400); assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: w.ids.aStaff })).status, 200);
  assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: w.ids.aStaff })).status, 200, 'no-op patch is fine'); assert.equal((await aAdmin.call('PATCH', url(`/findings/${id}`), { title: 'hijack' })).status, 403, 'client admins cannot rewrite the auditor\'s finding');
  const del = await aAdmin.call('DELETE', url(`/members/${w.ids.aStaff}`)); assert.equal(del.status, 409, 'a person who owns an unresolved finding cannot be removed'); assert.equal(del.body.code, 'has_open_items');
});
test('not-applicable items cannot get findings; findings reference real items only', async () => {
  const na = items[2]; await aAdmin.call('PATCH', url(`/checklist/${na.id}`), { readiness: 'not_applicable', naJustification: 'Out of scope' }); assert.equal((await raise(auditor, na.id)).status, 409); assert.equal((await raise(auditor, '00000000-0000-4000-8000-000000000000')).status, 404);
});
test('database: findings are never deleted, identity is permanent, events are append-only, status/closed_at stay in step (raw SQL)', async () => {
  const f = (await rows('SELECT tenant_id, id, engagement_id, item_id FROM findings ORDER BY created_at, id LIMIT 1'))[0];
  await assert.rejects(() => env.pool.query('DELETE FROM findings WHERE id=?', [f.id]), /never deleted/); await assert.rejects(() => env.pool.query('UPDATE findings SET finding_no=999 WHERE id=?', [f.id]), /identity/); await assert.rejects(() => env.pool.query('UPDATE findings SET item_id=? WHERE id=?', [items.find(i => i.id !== f.item_id).id, f.id]), /identity/);
  await assert.rejects(() => env.pool.query("UPDATE findings SET status='closed' WHERE id=?", [f.id])); await assert.rejects(() => env.pool.query("UPDATE findings SET closed_at=NOW() WHERE id=? AND status='open'", [f.id]));
  await assert.rejects(() => env.pool.query("UPDATE finding_events SET note='x'"), /append-only/); await assert.rejects(() => env.pool.query('DELETE FROM finding_events'), /append-only/);
  await assert.rejects(() => env.pool.query("INSERT INTO finding_events(tenant_id,id,finding_id,kind,actor_id) VALUES (?,UUID(),?,'status',?)", [f.tenant_id, f.id, w.ids.team]), undefined, 'a status event needs from and to');
});
test('engagement closure is blocked by unresolved findings (and member removal by owned ones, above)', async () => {
  await env.pool.query("UPDATE engagements SET current_phase=5 WHERE id=?", [E]); const open = await rows("SELECT COUNT(*) n FROM findings WHERE engagement_id=? AND status IN ('open','in_remediation','ready_for_retest') AND severity IN ('critical','high','medium')", [E]); assert.ok(open[0].n > 0);
  const c = await team.call('POST', url(`/engagements/${E}/close`)); assert.equal(c.status, 409); assert.equal(c.body.code, 'close_blocked'); assert.match(c.body.error ?? c.body.message ?? '', /unresolved finding/);
  for (const fr of await rows("SELECT id, status FROM findings WHERE engagement_id=? AND status IN ('open','in_remediation','ready_for_retest')", [E])) { await env.pool.query("UPDATE findings SET status='cancelled', closed_at=NOW(3) WHERE id=?", [fr.id]); }
  assert.equal((await auditor.call('POST', url(`/engagements/${E}/signoff`), { opinion: 'qualified', note: 'Exceptions noted: see the findings register for this engagement' })).status, 201); const c2 = await team.call('POST', url(`/engagements/${E}/close`)); assert.equal(c2.status, 200, JSON.stringify(c2.body));
  const g = await raise(auditor, items[0].id); assert.equal(g.status, 409, 'closed engagement refuses new findings'); assert.equal((await auditor.call('POST', url(`/findings/${(await rows('SELECT id FROM findings LIMIT 1'))[0].id}/comments`), { note: 'x' })).status, 409);
});
