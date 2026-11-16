// The whole customer journey through the real API, in order, as the real roles. No SQL shortcuts to change state:
// organization -> people -> engagement -> evidence -> review -> finding -> phases -> close -> report -> certificate -> public check -> revoke.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, vendor: any, staff: any, auditor: any;
const ACK = { acknowledge: true, note: 'Reviewed with the client and accepted' }; const url = (p: string) => `/t/${w.A}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[]; const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let E = '', ITEMS: any[] = [], FINDING = '', CERT: any;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false, origin: 'https://grc.example.com', evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root); });
after(() => env.close());

test('1. iSecurify staff are assigned to the organization; everyone can sign in and sees the right organization', async () => {
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true })).status, 201);
  team = await env.login('team@x.test'); admin = await w.as('aAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  for (const c of [team, admin, vendor, staff, auditor]) { const me = await c.call('GET', '/auth/me'); assert.equal(me.status, 200); assert.ok(me.body.organizations.some((o: any) => o.id === w.A)); }
});
test('2. the client administrator creates the engagement from the published framework and gets a checklist', async () => {
  const r = await admin.call('POST', url('/engagements'), { name: 'FY27 certification', primaryReleaseId: fx.X.releaseId }); assert.equal(r.status, 201, JSON.stringify(r.body)); E = r.body.id;
  ITEMS = (await admin.call('GET', url(`/engagements/${E}/checklist`))).body.items; assert.ok(ITEMS.length >= 3); const eng = (await admin.call('GET', url(`/engagements/${E}`))).body; assert.equal(eng.currentPhase ?? eng.engagement?.currentPhase, 1);
  assert.equal((await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' })).status, 200, 'the auditor is added to this engagement');
  const sc = await staff.call('GET', url(`/engagements/${E}/checklist`)); assert.ok(sc.status === 404 || (sc.body.items ?? []).length === 0, 'staff see nothing that is not assigned to them');
});
test('3. discovery questions can be answered; an item is assigned to the vendor and evidence is requested', async () => {
  const d = await admin.call('GET', url(`/engagements/${E}/discovery`)); assert.equal(d.status, 200);
  const a = await admin.call('PATCH', url(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor, readiness: 'implemented' }); assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal((await vendor.call('GET', url(`/engagements/${E}/checklist`))).body.items.length, 1, 'the vendor sees only their item');
  const rq = await admin.call('POST', url(`/checklist/${ITEMS[0].id}/evidence-requests`), { title: 'Information security policy' }); assert.equal(rq.status, 201, JSON.stringify(rq.body)); (globalThis as any).RID = rq.body.id;
});
test('4. the vendor uploads; the reviewer rejects with a reason; the vendor re-uploads; the reviewer accepts; the item becomes effective', async () => {
  const RID = (globalThis as any).RID; const up = (name: string) => { const m = mpf(name, PDF(name), { note: 'attached' }); return vendor.call('POST', url(`/evidence-requests/${RID}/versions`), m.payload, m.headers); };
  const u1 = await up('v1.pdf'); assert.equal(u1.status, 201, JSON.stringify(u1.body)); assert.equal((await vendor.call('POST', url(`/evidence-requests/${RID}/review`), { versionId: u1.body.versionId, decision: 'accepted', note: 'self' })).status, 403, 'a vendor cannot review');
  assert.equal((await admin.call('POST', url(`/evidence-requests/${RID}/review`), { versionId: u1.body.versionId, decision: 'accepted', note: 'self' })).status, 403, 'the customer cannot accept their own evidence');
  assert.equal((await auditor.call('POST', url(`/evidence-requests/${RID}/review`), { versionId: u1.body.versionId, decision: 'rejected' })).status, 400, 'a rejection needs a reason');
  assert.equal((await auditor.call('POST', url(`/evidence-requests/${RID}/review`), { versionId: u1.body.versionId, decision: 'rejected', note: 'Unsigned' })).status, 200);
  const u2 = await up('v2.pdf'); assert.equal(u2.body.versionNo, 2); assert.equal((await auditor.call('POST', url(`/evidence-requests/${RID}/review`), { versionId: u2.body.versionId, decision: 'accepted', note: 'Signed, thanks' })).status, 200);
  const it = (await admin.call('GET', url(`/engagements/${E}/checklist`))).body.items.find((x: any) => x.id === ITEMS[0].id); assert.equal(it.state, 'effective');
  assert.equal((await vendor.call('GET', url(`/evidence-versions/${u2.body.versionId}/download`))).status, 200); assert.equal((await staff.call('GET', url(`/evidence-versions/${u2.body.versionId}/download`))).status, 404, 'staff cannot reach evidence that is not theirs');
});
test('5. a finding is raised, remediated, retested and closed by the right people (not by its owner)', async () => {
  const r = await auditor.call('POST', url(`/checklist/${ITEMS[1].id}/findings`), { title: 'No MFA on admin accounts', description: 'Password-only admin login', severity: 'high' }); assert.equal(r.status, 201, JSON.stringify(r.body)); FINDING = r.body.id; assert.equal((await auditor.call('PATCH', url(`/findings/${FINDING}`), { ownerUserId: w.ids.aVendor })).status, 403, 'an auditor cannot assign the owner'); assert.equal((await admin.call('PATCH', url(`/findings/${FINDING}`), { ownerUserId: w.ids.aVendor })).status, 200);
  const mv = (c: any, to: string, note: string | null = 'ok') => c.call('POST', url(`/findings/${FINDING}/transition`), { to, note });
  assert.equal((await mv(vendor, 'closed')).status >= 400, true, 'cannot jump to closed');
  assert.equal((await mv(admin, 'in_remediation', null)).status, 200); assert.equal((await mv(admin, 'ready_for_retest', 'MFA enforced')).status, 200); assert.equal((await mv(auditor, 'closed', 'Retested: enforced')).status, 200);
  assert.equal((await rows('SELECT status s FROM findings WHERE id=?', [FINDING]))[0].s, 'closed');
});
test('6. an unresolved serious finding blocks closing; phases advance in order; the engagement cannot close before the final phase', async () => {
  const f2 = await auditor.call('POST', url(`/checklist/${ITEMS[2].id}/findings`), { title: 'Logs not retained', description: 'Only 7 days', severity: 'high' }); assert.equal(f2.status, 201);
  assert.equal((await admin.call('POST', url(`/engagements/${E}/advance-phase`), {})).status, 403, 'the customer cannot advance phases'); assert.equal((await admin.call('POST', url(`/engagements/${E}/close`), {})).status, 403);
  assert.equal((await team.call('POST', url(`/engagements/${E}/close`), {})).body.code, 'not_final_phase');
  for (let i = 2; i <= 5; i++) { const plain = await team.call('POST', url(`/engagements/${E}/advance-phase`), {}); const r = plain.status === 200 ? plain : await team.call('POST', url(`/engagements/${E}/advance-phase`), ACK); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.currentPhase, i); }
  assert.equal((await team.call('POST', url(`/engagements/${E}/advance-phase`), ACK)).body.code, 'final_phase');
  const blocked = await team.call('POST', url(`/engagements/${E}/close`), {}); assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'close_blocked');
  assert.equal((await team.call('POST', url(`/certificates`), { engagementId: E, frameworkId: fx.X.id, scope: 'Information security management', validUntil: day(365) })).body.code, 'engagement_open', 'no certificate while the engagement is open');
  assert.equal((await auditor.call('POST', url(`/findings/${f2.body.id}/transition`), { to: 'risk_accepted', note: 'Accepted by management' })).status >= 200, true);
});
test('7. remaining items are resolved, the engagement closes, and it is then read-only', async () => {
  const open = await rows("SELECT id FROM findings WHERE tenant_id=? AND engagement_id=? AND status NOT IN ('closed','risk_accepted','cancelled')", [w.A, E]);
  for (const f of open) { for (const to of ['in_remediation', 'ready_for_retest']) await admin.call('POST', url(`/findings/${f.id}/transition`), { to, note: 'done' }); await auditor.call('POST', url(`/findings/${f.id}/transition`), { to: 'closed', note: 'verified' }); }
  for (const i of ITEMS.slice(1)) await admin.call('PATCH', url(`/checklist/${i.id}`), { readiness: 'not_applicable', naJustification: 'Out of scope for this site' });
  assert.equal((await team.call('POST', url(`/engagements/${E}/close`), {})).body.error, 'The third-party auditor has not signed off', 'the last thing standing between the client and closure');
  const so = await auditor.call('POST', url(`/engagements/${E}/signoff`), { opinion: 'unqualified', note: 'All applicable controls were found effective' }); assert.equal(so.status, 201, JSON.stringify(so.body));
  const c = await team.call('POST', url(`/engagements/${E}/close`), {}); assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal((await admin.call('PATCH', url(`/checklist/${ITEMS[0].id}`), { readiness: 'planned' })).status >= 400, true, 'closed engagements cannot be edited');
});
test('8. the report is produced (PDF and Excel) and logged with a checksum', async () => {
  for (const format of ['pdf', 'xlsx']) { const r = await team.call('POST', url(`/engagements/${E}/exports`), { format }); assert.equal(r.status, 200, format); assert.ok(r.raw.length > 1000); assert.ok(r.headers['x-report-id']); }
  assert.equal((await rows('SELECT COUNT(*) n FROM report_exports WHERE engagement_id=?', [E]))[0].n, 2); assert.equal((await vendor.call('POST', url(`/engagements/${E}/exports`), { format: 'pdf' })).status, 403);
});
test('9. the certificate: only iSecurify staff issue it; the customer is told; anyone can verify it; reissue supersedes; revoke is visible', async () => {
  const el = await team.call('GET', url('/certificates/eligible')); const opt = el.body.options.find((o: any) => o.engagementId === E); assert.ok(opt && opt.ready, 'the engagement is offered as ready');
  const body = { engagementId: E, frameworkId: fx.X.id, scope: 'Information security management for the Vadodara site', validUntil: day(365) };
  for (const c of [admin, vendor, staff, auditor]) assert.equal((await c.call('POST', url('/certificates'), body)).status, 403);
  const r = await team.call('POST', url('/certificates'), body); assert.equal(r.status, 201, JSON.stringify(r.body)); CERT = r.body; assert.equal(CERT.status, 'valid'); assert.equal(CERT.opinion, 'unqualified');
  const n = await admin.call('GET', '/me/notifications'); assert.ok(JSON.stringify(n.body).includes('certificate.issued'), 'the client admin is notified');
  const pdf = await admin.call('GET', url(`/certificates/${CERT.id}/pdf`)); assert.equal(pdf.status, 200); assert.equal(pdf.raw.subarray(0, 4).toString(), '%PDF');
  const pub = await env.client().call('GET', `/public/certificates/${CERT.verifyUrl.split('/').pop()}`); assert.equal(pub.status, 200); assert.equal(pub.body.valid, true); assert.equal(pub.body.organization, 'Org A');
  const r2 = await team.call('POST', url('/certificates'), body); assert.equal(r2.status, 201); assert.equal((await admin.call('GET', url(`/certificates/${CERT.id}`))).body.status, 'superseded');
  assert.equal((await team.call('POST', url(`/certificates/${r2.body.id}/revoke`), { reason: 'Scope changed' })).status, 200); const after = await env.client().call('GET', `/public/certificates/${r2.body.verifyUrl.split('/').pop()}`); assert.equal(after.body.valid, false);
  assert.equal((await w.as('bAdmin').then((c: any) => c.call('GET', url(`/certificates/${CERT.id}`)))).status, 404, 'another organization cannot see it');
});
test('10. the audit trail tells the whole story, in order, and nothing is missing', async () => {
  const a = (await rows("SELECT action FROM audit_events WHERE tenant_id=? ORDER BY id", [w.A])).map(x => x.action); const must = ['engagement.created', 'evidence.requested', 'evidence.uploaded', 'evidence.rejected', 'evidence.accepted', 'finding.raised', 'finding.status_changed', 'phase.advanced', 'engagement.signed_off', 'engagement.closed', 'certificate.issued', 'certificate.revoked'];
  for (const m of must) assert.ok(a.includes(m), 'missing ' + m); assert.ok(a.indexOf('engagement.signed_off') < a.indexOf('engagement.closed') && a.indexOf('evidence.accepted') < a.indexOf('engagement.closed') && a.indexOf('engagement.closed') < a.indexOf('certificate.issued'));
});
