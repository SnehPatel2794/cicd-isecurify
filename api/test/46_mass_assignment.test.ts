// Threat model: mass assignment. A caller must not be able to set fields they are not offered (tenant, role, status, ownership, evidence outcome, ids) by adding them to a request body.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, tokenFor, PW } from './helpers'; import { listRoutes, withIds } from './routes_util';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let aAdmin: any, bAdmin: any, vendor: any, staff: any, team: any, root: any, E: string, ITEMS: any[];
const A = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => ((await env.pool.query(sql, p)) as any)[0] as any[];
const EVIL = (extra: any = {}) => ({ tenantId: w.B, tenant_id: w.B, orgId: w.B, id: '11111111-1111-4111-8111-111111111111', role: 'client_admin', platformRole: 'super_admin', platform_role: 'super_admin', isAdmin: true, manage: true, canManage: true, readEvidence: true, canReadEvidence: true, mfaEnabled: false, passwordHash: 'x', password_hash: 'x', createdBy: w.ids.bAdmin, created_by: w.ids.bAdmin, raisedBy: w.ids.bAdmin, actorId: w.ids.bAdmin, closedAt: '2020-01-01T00:00:00Z', ...extra });
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root); root = w.root; aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff');
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test');
  E = (await aAdmin.call('POST', A('/engagements'), { name: 'Mass', primaryReleaseId: fx.X.releaseId })).body.id; ITEMS = (await aAdmin.call('GET', A(`/engagements/${E}/checklist`))).body.items; await aAdmin.call('PATCH', A(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor });
}); after(() => env.close());

test('accepting an invitation cannot raise the role or make the person a platform administrator', async () => {
  assert.equal((await aAdmin.call('POST', A('/invitations'), { email: 'new@c.test', role: 'client_staff' })).status, 201); const tok = await tokenFor(env.pool, 'new@c.test');
  const r = await env.client().call('POST', `/invitations/${tok}/accept`, { name: 'New', password: PW, ...EVIL({ role: 'client_admin' }) }); assert.equal(r.status, 200);
  const u = (await rows('SELECT id, platform_role FROM users WHERE email=?', ['new@c.test']))[0]; assert.equal(u.platform_role, 'none'); const m = await rows('SELECT tenant_id, role FROM memberships WHERE user_id=?', [u.id]); assert.deepEqual(m.map((x: any) => [x.tenant_id, x.role]), [[w.A, 'client_staff']]);
});
test('inviting: the organization comes from the URL, never from the body', async () => {
  const r = await aAdmin.call('POST', A('/invitations'), { email: 'x2@c.test', role: 'client_staff', tenantId: w.B, tenant_id: w.B, orgId: w.B }); assert.equal(r.status, 201); const inv = await rows('SELECT tenant_id FROM invitations WHERE email=?', ['x2@c.test']); assert.deepEqual(inv.map((x: any) => x.tenant_id), [w.A]);
});
test('creating an engagement: status, phase, creator, tenant and id are the server\'s', async () => {
  const r = await aAdmin.call('POST', A('/engagements'), { name: 'Evil', primaryReleaseId: fx.X.releaseId, ...EVIL({ status: 'closed', currentPhase: 5, current_phase: 5 }) }); assert.equal(r.status, 201); const e = (await rows('SELECT * FROM engagements WHERE name=?', ['Evil']))[0];
  assert.equal(e.tenant_id, w.A); assert.equal(e.status, 'active'); assert.equal(Number(e.current_phase), 1); assert.equal(e.created_by, w.ids.aAdmin); assert.notEqual(e.id, '11111111-1111-4111-8111-111111111111'); assert.equal(e.closed_at, null);
});
test('a vendor editing their item cannot set the evidence outcome, move it to another engagement or organization, or reassign it', async () => {
  const before = (await rows('SELECT * FROM checklist_items WHERE id=?', [ITEMS[0].id]))[0];
  const r = await vendor.call('PATCH', A(`/checklist/${ITEMS[0].id}`), { readiness: 'implemented', ...EVIL({ evidenceStatus: 'accepted', evidence_status: 'accepted', evidence: 'accepted', engagementId: '22222222-2222-4222-8222-222222222222', accountableUserId: w.ids.aVendor, dueDate: '2020-01-01' }) });
  const a = (await rows('SELECT * FROM checklist_items WHERE id=?', [ITEMS[0].id]))[0]; assert.equal(a.evidence_status, before.evidence_status, `status ${r.status}: evidence outcome untouched`); assert.equal(a.engagement_id, before.engagement_id); assert.equal(a.tenant_id, w.A); assert.equal(a.accountable_user_id, before.accountable_user_id);
  assert.equal((await rows("SELECT COUNT(*) n FROM evidence_requests WHERE status='accepted'"))[0].n, 0);
});
test('staff and vendors cannot change items they do not own, even with a valid-looking body', async () => { const r = await staff.call('PATCH', A(`/checklist/${ITEMS[1].id}`), { readiness: 'implemented', ...EVIL() }); assert.ok([403, 404].includes(r.status), String(r.status)); assert.equal((await rows('SELECT readiness_status s FROM checklist_items WHERE id=?', [ITEMS[1].id]))[0].s, 'not_started'); });
test('risks, incidents, policies, vendors: lifecycle fields, ownership and ids cannot be injected', async () => {
  assert.equal((await aAdmin.call('POST', A('/risks'), { title: 'R0', description: 'd', category: 'security', likelihood: 3, impact: 3, ownerUserId: w.ids.bAdmin })).status, 400, 'an owner from another organization is refused');
  const risk = await aAdmin.call('POST', A('/risks'), { title: 'R', description: 'd', category: 'security', likelihood: 3, impact: 3, ...EVIL({ status: 'closed', riskNo: 999, risk_no: 999, treatment: 'accept', ownerUserId: undefined }) }); assert.equal(risk.status, 201); const r = (await rows('SELECT * FROM risks WHERE id=?', [risk.body.id]))[0]; assert.equal(r.tenant_id, w.A); assert.equal(r.status, 'identified'); assert.equal(Number(r.risk_no), 1); assert.equal(r.created_by, w.ids.aAdmin); assert.notEqual(r.owner_user_id, w.ids.bAdmin); assert.equal(r.closed_at, null); assert.equal((await rows('SELECT COUNT(*) n FROM risks WHERE title=?', ['R0']))[0].n, 0);
  const inc = await staff.call('POST', A('/incidents'), { title: 'I', description: 'd', category: 'malware', severity: 'low', ...EVIL({ status: 'closed', ownerUserId: w.ids.aAdmin, reportedBy: w.ids.aAdmin, incidentNo: 77 }) }); assert.equal(inc.status, 201); const i = (await rows('SELECT * FROM incidents WHERE id=?', [inc.body.id]))[0]; assert.equal(i.status, 'reported'); assert.equal(i.reported_by, w.ids.aStaff); assert.equal(Number(i.incident_no), 1); assert.equal(i.owner_user_id, null);
  const pol = await aAdmin.call('POST', A('/policies'), { title: 'P', category: 'security', body: 'b', ...EVIL({ status: 'published', publishedAt: '2020-01-01T00:00:00Z', archivedAt: null }) }); assert.equal(pol.status, 201); assert.equal((await rows("SELECT COUNT(*) n FROM policy_versions WHERE status='published'"))[0].n, 0, 'nothing is published by a create request');
  assert.equal((await aAdmin.call('POST', A('/vendors'), { name: 'V0', service: 's', category: 'cloud', criticality: 'low', dataAccess: 'none', contactUserId: w.ids.bAdmin })).status, 400, 'a contact from another organization is refused');
  const ven = await aAdmin.call('POST', A('/vendors'), { name: 'V', service: 's', category: 'cloud', criticality: 'critical', dataAccess: 'personal', ...EVIL({ status: 'offboarded', vendorNo: 5, contactUserId: undefined }) }); assert.equal(ven.status, 201); const v = (await rows('SELECT * FROM vendors WHERE id=?', [ven.body.id]))[0]; assert.equal(v.tenant_id, w.A); assert.notEqual(v.status, 'offboarded'); assert.equal(Number(v.vendor_no), 1); assert.notEqual(v.contact_user_id, w.ids.bAdmin);
});
test('findings: raiser, status and owner (from another organization) cannot be injected', async () => {
  const r = await team.call('POST', A(`/checklist/${ITEMS[0].id}/findings`), { title: 'F', description: 'd', severity: 'high', ...EVIL({ status: 'closed', ownerUserId: w.ids.bAdmin }) }); assert.ok([201, 400].includes(r.status), String(r.status)); if (r.status === 201) { const f = (await rows('SELECT * FROM findings WHERE id=?', [r.body.id]))[0]; assert.equal(f.status, 'open'); assert.equal(f.raised_by, w.ids.team); assert.equal(f.tenant_id, w.A); assert.notEqual(f.owner_user_id, w.ids.bAdmin); assert.equal(f.closed_at, null); }
});
test('membership changes: a client admin cannot grant platform roles or other-organization access, and cannot edit their own role upward', async () => {
  const r = await aAdmin.call('PATCH', A(`/members/${w.ids.aStaff}`), { role: 'client_staff', platformRole: 'super_admin', tenantId: w.B }); assert.ok([200, 400, 404].includes(r.status));
  assert.equal((await rows('SELECT platform_role p FROM users WHERE id=?', [w.ids.aStaff]))[0].p, 'none'); assert.equal((await rows('SELECT COUNT(*) n FROM memberships WHERE user_id=? AND tenant_id=?', [w.ids.aStaff, w.B]))[0].n, 0);
  assert.equal((await aAdmin.call('PATCH', A(`/members/${w.ids.aStaff}`), { role: 'super_admin' })).status, 400); assert.equal((await aAdmin.call('PATCH', A(`/members/${w.ids.aStaff}`), { role: 'isecurify_staff' })).status, 400);
  const own = await aAdmin.call('PATCH', '/auth/me', { name: 'Renamed', platformRole: 'super_admin', status: 'active', ...EVIL() }); assert.ok([200, 400, 404, 405].includes(own.status)); assert.equal((await rows('SELECT platform_role p FROM users WHERE id=?', [w.ids.aAdmin]))[0].p, 'none');
});
test('sweep: every write route, called with only privileged extras, creates nothing in another organization and changes nobody\'s platform role', async () => {
  const ROUTES = listRoutes(env.app).filter(r => r.method !== 'GET' && !r.path.startsWith('/auth/') && !/logout|setup/.test(r.path)); assert.ok(ROUTES.length >= 100);
  const snap = async () => JSON.stringify([await rows('SELECT id, platform_role, status FROM users ORDER BY id'), await rows('SELECT tenant_id, user_id, role FROM memberships ORDER BY tenant_id, user_id'), await rows('SELECT COUNT(*) n FROM engagements WHERE tenant_id=?', [w.B]), await rows('SELECT COUNT(*) n FROM risks WHERE tenant_id=?', [w.B]), await rows('SELECT COUNT(*) n FROM organizations'), await rows('SELECT COUNT(*) n FROM staff_assignments')]);
  const before = await snap();
  for (const c of [env.client(), aAdmin, vendor, staff]) for (const r of ROUTES) { const res = await c.call(r.method, withIds(r.path, w.A), EVIL()); assert.ok(res.status < 500, `${r.method} ${r.path} -> ${res.status}`); }
  assert.equal(await snap(), before);
});
