import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any; let E: string, E2: string, items: any[], items2: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const raise = (c: any, itemId: string, body: any = {}) => c.call('POST', url(`/checklist/${itemId}/findings`), { title: 'T', description: 'D', severity: 'high', ...body });
const assign = (id: string, owner: string) => aAdmin.call('PATCH', url(`/findings/${id}`), { ownerUserId: owner });
const evReq = (c: any, itemId: string, title = 'Proof') => c.call('POST', url(`/checklist/${itemId}/evidence-requests`), { title });
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'One', primaryReleaseId: fx.X.releaseId })).body.id; E2 = (await aAdmin.call('POST', url('/engagements'), { name: 'Two', primaryReleaseId: fx.X.releaseId })).body.id;
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); // auditor is NOT a member of Two
  items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items; items2 = (await aAdmin.call('GET', url(`/engagements/${E2}/checklist`))).body.items;
  await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor });
}); after(() => env.close());

test('organization-wide list: each role sees exactly its own scope; mine, overdue and awaiting-retest filters; ageing buckets', async () => {
  const f1 = (await raise(auditor, items[0].id, { title: 'Late one', severity: 'critical', dueDate: '2020-01-01' })).body.id; const f2 = (await raise(auditor, items[1].id, { title: 'Not late', severity: 'low', dueDate: '2099-01-01' })).body.id;
  const f3 = (await raise(team, items2[0].id, { title: 'Other engagement', severity: 'medium' })).body.id; await assign(f1, w.ids.aVendor); await assign(f2, w.ids.aStaff);
  const all = async (c: any, qs = '') => (await c.call('GET', url(`/findings${qs}`))).body; const ids = (b: any) => b.findings.map((x: any) => x.id).sort();
  assert.deepEqual(ids(await all(aAdmin)), [f1, f2, f3].sort(), 'client admin sees everything'); assert.deepEqual(ids(await all(team)), [f1, f2, f3].sort(), 'managing staff too');
  assert.deepEqual(ids(await all(auditor)), [f1, f2].sort(), 'auditor only on engagements they belong to');
  assert.deepEqual(ids(await all(vendor)), [f1], 'vendor: own finding / own item only'); assert.deepEqual(ids(await all(staff)), [f2], 'client staff: the finding they own');
  assert.equal((await bAdmin.call('GET', url('/findings'))).status, 404, 'other organization');
  const od = await all(aAdmin, '?overdue=true'); assert.deepEqual(ids(od), [f1]); assert.ok(od.findings[0].daysOverdue > 1000); assert.equal(od.findings[0].overdue, true); assert.equal(od.overdueBuckets['90+'], 1); assert.equal(od.summary.overdue, 1);
  assert.deepEqual(ids(await all(vendor, '?mine=true')), [f1]); assert.deepEqual(ids(await all(aAdmin, '?mine=true')), []); assert.deepEqual(ids(await all(aAdmin, `?engagementId=${E2}`)), [f3]); assert.deepEqual(ids(await all(aAdmin, '?severity=low')), [f2]);
  assert.equal((await all(aAdmin)).findings.find((x: any) => x.id === f3).engagementName, 'Two');
  assert.deepEqual(ids(await all(aAdmin, '?awaitingRetest=true')), []); await assign(f3, w.ids.aVendor);   // vendor owns f3 on an item not assigned to them
  assert.deepEqual(ids(await all(vendor)), [f1, f3].sort(), 'ownership alone grants visibility'); assert.equal((await vendor.call('POST', url(`/findings/${f3}/transition`), { to: 'in_remediation' })).status, 200);
  assert.equal((await vendor.call('POST', url(`/findings/${f3}/transition`), { to: 'ready_for_retest', note: 'done' })).status, 200); assert.deepEqual(ids(await all(aAdmin, '?awaitingRetest=true')), [f3]);
  assert.equal((await all(aAdmin)).summary.total, 3); assert.equal((await all(vendor)).summary.total, 2, 'summary is scoped too'); assert.equal((await aAdmin.call('GET', url('/findings?severity=bogus'))).status, 400);
});
test('remediation evidence: owner attaches a request of the same item; the detail shows its status; rules around duplicates, cancelled requests, other items and closed findings', async () => {
  const f = (await raise(auditor, items[0].id, { title: 'Needs proof' })).body.id; await assign(f, w.ids.aVendor);
  const r1 = (await evReq(aAdmin, items[0].id, 'Screenshot of MFA policy')).body.id; const other = (await evReq(aAdmin, items[1].id, 'Other item')).body.id; const r3 = (await evReq(aAdmin, items[0].id, 'Cancelled one')).body.id;
  await aAdmin.call('POST', url(`/evidence-requests/${r3}/cancel`), { reason: 'not needed' });
  const lk = (await vendor.call('GET', url(`/findings/${f}/linkable-evidence`))).body; assert.deepEqual(lk.map((x: any) => x.requestId), [r1], 'only same-item, non-cancelled requests'); assert.equal((await staff.call('GET', url(`/findings/${f}/linkable-evidence`))).status, 404);
  assert.equal((await vendor.call('POST', url(`/findings/${f}/evidence`), { requestId: other })).status, 400, 'different item'); assert.equal((await vendor.call('POST', url(`/findings/${f}/evidence`), { requestId: r3 })).status, 409, 'cancelled'); assert.equal((await vendor.call('POST', url(`/findings/${f}/evidence`), { requestId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  assert.equal((await staff.call('POST', url(`/findings/${f}/evidence`), { requestId: r1 })).status, 404, 'not theirs'); assert.equal((await vendor.call('POST', url(`/findings/${f}/evidence`), { requestId: r1 })).status, 201);
  assert.equal((await vendor.call('POST', url(`/findings/${f}/evidence`), { requestId: r1 })).status, 409, 'duplicate'); assert.deepEqual((await vendor.call('GET', url(`/findings/${f}/linkable-evidence`))).body, []);
  const d = (await auditor.call('GET', url(`/findings/${f}`))).body; assert.equal(d.evidence.length, 1); assert.equal(d.evidence[0].title, 'Screenshot of MFA policy'); assert.equal(d.evidence[0].status, 'requested'); assert.equal(d.evidence[0].linkedByName, 'avendor'); assert.equal(d.events[d.events.length - 1].kind, 'evidence'); assert.equal(d.can.linkEvidence, true);
  const m = mpf('p.pdf', PDF('z'), { note: 'n' }); const up = await vendor.call('POST', url(`/evidence-requests/${r1}/versions`), m.payload, m.headers); assert.equal(up.status, 201); assert.equal((await auditor.call('GET', url(`/findings/${f}`))).body.evidence[0].status, 'submitted', 'status follows the evidence');
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='finding.evidence_linked'"))[0].n, 1);
  await vendor.call('POST', url(`/findings/${f}/transition`), { to: 'in_remediation' }); await vendor.call('POST', url(`/findings/${f}/transition`), { to: 'ready_for_retest', note: 'proof attached' }); assert.equal((await auditor.call('POST', url(`/findings/${f}/transition`), { to: 'closed', note: 'ok' })).status, 200);
  const r4 = (await evReq(aAdmin, items[0].id, 'After close')).body.id; const closed = await aAdmin.call('POST', url(`/findings/${f}/evidence`), { requestId: r4 }); assert.equal(closed.status, 409); assert.equal(closed.body.code, 'finding_closed');
  assert.equal((await aAdmin.call('GET', url(`/findings/${f}`))).body.can.linkEvidence, false);
});
test('who may attach: client staff who neither own nor manage cannot; view-only staff cannot; auditors and client admins can', async () => {
  const f = (await raise(auditor, items[0].id, { title: 'Roles' })).body.id; const r = (await evReq(aAdmin, items[0].id, 'R')).body.id; await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aStaff });   // staff now accountable for the item => can see the finding but is not the owner
  assert.equal((await staff.call('POST', url(`/findings/${f}/evidence`), { requestId: r })).status, 403); assert.equal((await staff.call('GET', url(`/findings/${f}/linkable-evidence`))).status, 403); assert.equal((await auditor.call('POST', url(`/findings/${f}/evidence`), { requestId: r })).status, 201);
  await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor });
});
test('database: a link can only join a finding and a request of the SAME item; links are permanent (raw SQL)', async () => {
  const f = (await raise(auditor, items[1].id, { title: 'Raw' })).body.id; const rOther = (await evReq(aAdmin, items[2].id, 'Other')).body.id; const rSame = (await evReq(aAdmin, items[1].id, 'Same')).body.id; const fr = (await rows('SELECT tenant_id, item_id FROM findings WHERE id=?', [f]))[0];
  await assert.rejects(() => env.pool.query('INSERT INTO finding_evidence(tenant_id,finding_id,request_id,item_id,linked_by) VALUES (?,?,?,?,?)', [fr.tenant_id, f, rOther, fr.item_id, w.ids.team]), /foreign key/i);
  await env.pool.query('INSERT INTO finding_evidence(tenant_id,finding_id,request_id,item_id,linked_by) VALUES (?,?,?,?,?)', [fr.tenant_id, f, rSame, fr.item_id, w.ids.team]);
  await assert.rejects(() => env.pool.query('UPDATE finding_evidence SET linked_by=? WHERE finding_id=?', [w.ids.aAdmin, f]), /permanent/); await assert.rejects(() => env.pool.query('DELETE FROM finding_evidence WHERE finding_id=?', [f]), /permanent/);
});
test('closed engagements refuse new links', async () => {
  const f = (await raise(team, items2[1].id, { title: 'Closing', severity: 'low' })).body.id; const r = (await evReq(aAdmin, items2[1].id, 'R2')).body.id; await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E2]);
  assert.equal((await team.call('POST', url(`/findings/${f}/evidence`), { requestId: r })).status, 409); assert.equal((await team.call('GET', url(`/findings/${f}`))).body.can.linkEvidence, false);
});
