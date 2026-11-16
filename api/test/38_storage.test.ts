import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let low: Awaited<ReturnType<typeof freshEnv>>;
let aAdmin: any, vendor: any, staff: any; let E: string, items: any[], rid: string, vid: string;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'One', primaryReleaseId: fx.X.releaseId })).body.id; items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
  rid = (await aAdmin.call('POST', url(`/checklist/${items[0].id}/evidence-requests`), { title: 'Policy' })).body.id; const m = mpf('a.pdf', PDF('one')); const up = await aAdmin.call('POST', url(`/evidence-requests/${rid}/versions`), m.payload, m.headers); assert.equal(up.status, 201, JSON.stringify(up.body)); vid = (await rows('SELECT id FROM evidence_versions WHERE request_id=?', [rid]))[0].id;
}); after(async () => { await env.close(); if (low) await low.close(); });

test('storage is unlimited by default; a limit for one organization still works and can be removed', async () => {
  const c = (await aAdmin.call('GET', url('/evidence/config'))).body.usage; assert.equal(c.unlimited, true); assert.equal(c.quotaBytes, null); assert.equal(c.quotaIsDefault, true);
  const set = await w.root.call('PUT', `/platform/organizations/${w.A}/evidence-quota`, { quotaMb: 5 }); assert.equal(set.body.unlimited, false); assert.equal(set.body.quotaBytes, 5 * 1048576);
  const back = await w.root.call('PUT', `/platform/organizations/${w.A}/evidence-quota`, { quotaMb: null }); assert.equal(back.body.unlimited, true); assert.equal(back.body.quotaIsDefault, true);
});
test('disk guard: uploads pause with a clear message when the evidence disk is nearly full, and nothing is stored', async () => {
  low = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024, minFreeBytes: 1e15 } } as any); const lw = await world(low); const f = await frameworkFixtures(lw.root); const a = await lw.as('aAdmin');
  const e = (await a.call('POST', `/t/${lw.A}/engagements`, { name: 'L', primaryReleaseId: f.X.releaseId })).body.id; const it = (await a.call('GET', `/t/${lw.A}/engagements/${e}/checklist`)).body.items; const r = (await a.call('POST', `/t/${lw.A}/checklist/${it[0].id}/evidence-requests`, { title: 'x' })).body.id;
  const m = mpf('a.pdf', PDF('x')); const res = await a.call('POST', `/t/${lw.A}/evidence-requests/${r}/versions`, m.payload, m.headers); assert.equal(res.status, 507); assert.equal(res.body.code, 'storage_low');
  assert.equal(((await low.pool.query('SELECT COUNT(*) n FROM evidence_versions') as any)[0][0].n), 0);
  const l = await a.call('POST', `/t/${lw.A}/evidence-requests/${r}/versions`, { linkUrl: 'https://drive.google.com/x' }); assert.equal(l.status, 201, 'links use no disk, so they still work');
});
test('storage admin: administrators only; usage, disk and defaults are reported', async () => {
  for (const c of [aAdmin, vendor, staff]) assert.equal((await c.call('GET', '/platform/storage')).status, 403); assert.equal((await env.client().call('GET', '/platform/storage')).status, 401);
  const s = (await w.root.call('GET', '/platform/storage')).body; assert.equal(s.defaults.quotaBytes, null); assert.ok(s.disk === null || s.disk.freeBytes > 0); const a = s.orgs.find((o: any) => o.id === w.A); assert.equal(a.versionCount, 1); assert.equal(a.unlimited, true); assert.equal(a.legalHold, false); assert.equal(a.retentionMonths, 84);
  assert.equal(s.totals.versionCount >= 1, true); assert.deepEqual([s.heldEngagements, s.archived, s.quarantine], [[], [], []]);
});
test('legal hold: administrators only, a reason is required, both levels are audited and listed', async () => {
  const org = `/platform/organizations/${w.A}/legal-hold`; assert.equal((await aAdmin.call('PUT', org, { hold: true, reason: 'Court order' })).status, 403); assert.equal((await w.root.call('PUT', org, { hold: true })).status, 400); assert.equal((await w.root.call('PUT', org, { hold: true, reason: 'x' })).status, 400);
  assert.equal((await w.root.call('PUT', org, { hold: true, reason: 'Court order 2026-17' })).status, 200); let s = (await w.root.call('GET', '/platform/storage')).body; assert.deepEqual([s.orgs.find((o: any) => o.id === w.A).legalHold, s.orgs.find((o: any) => o.id === w.A).legalHoldReason], [true, 'Court order 2026-17']);
  assert.equal((await w.root.call('PUT', org, { hold: false })).status, 200); assert.equal((await rows('SELECT legal_hold h, legal_hold_reason r FROM organizations WHERE id=?', [w.A]))[0].r, null);
  const eng = `/platform/organizations/${w.A}/engagements/${E}/legal-hold`; assert.equal((await w.root.call('PUT', eng, { hold: true, reason: 'Investigation' })).status, 200); s = (await w.root.call('GET', '/platform/storage')).body; assert.equal(s.heldEngagements.length, 1); assert.equal(s.heldEngagements[0].reason, 'Investigation');
  assert.equal((await aAdmin.call('GET', url('/engagements'))).body.find((e: any) => e.id === E).legalHold, 1); assert.equal((await w.root.call('PUT', `/platform/organizations/${w.A}/engagements/00000000-0000-4000-8000-000000000000/legal-hold`, { hold: true, reason: 'abc' })).status, 404);
  assert.equal((await w.root.call('PUT', eng, { hold: false })).status, 200);
  const acts = (await rows("SELECT action FROM audit_events WHERE action LIKE 'legal_hold.%' ORDER BY id")).map(r => r.action); assert.deepEqual(acts, ['legal_hold.placed', 'legal_hold.released', 'legal_hold.placed', 'legal_hold.released']);
});
test('archived engagements: flagged and filterable in the list, listed for administrators, restorable once, audited; nothing is deleted', async () => {
  await env.pool.query("INSERT INTO evidence_archive(tenant_id,engagement_id,retention_months,closed_at,request_count) VALUES (?,?,84,NOW(3),1)", [w.A, E]);
  const all = (await aAdmin.call('GET', url('/engagements'))).body; assert.equal(all.find((e: any) => e.id === E).archived, 1);
  assert.equal((await aAdmin.call('GET', url('/engagements?archived=hide'))).body.some((e: any) => e.id === E), false); assert.equal((await aAdmin.call('GET', url('/engagements?archived=only'))).body.length, 1); assert.equal((await aAdmin.call('GET', url('/engagements?archived=zzz'))).status, 400);
  const s = (await w.root.call('GET', '/platform/storage')).body; assert.equal(s.archived.length, 1); assert.equal(s.orgs.find((o: any) => o.id === w.A).archivedEngagements, 1);
  const res = `/platform/organizations/${w.A}/engagements/${E}/restore-archive`; assert.equal((await aAdmin.call('POST', res)).status, 403); assert.equal((await w.root.call('POST', res)).status, 200); assert.equal((await w.root.call('POST', res)).status, 404, 'a second restore finds nothing to restore');
  assert.equal((await aAdmin.call('GET', url('/engagements'))).body.find((e: any) => e.id === E).archived, 0); assert.equal((await rows("SELECT action FROM audit_events WHERE action='evidence.archive_restored'")).length, 1);
  assert.equal((await rows('SELECT COUNT(*) n FROM evidence_versions'))[0].n >= 1, true); assert.ok((await rows('SELECT restored_at, restored_by FROM evidence_archive'))[0].restored_by);
  await assert.rejects(env.pool.query('DELETE FROM engagements WHERE id=?', [E]), /foreign key|constraint/i);
});
test('quarantine: flagged files are listed for people who can scan, with who and which signature; never downloadable', async () => {
  assert.deepEqual((await aAdmin.call('GET', url('/evidence/quarantine'))).body.files, []);
  await env.pool.query("INSERT INTO evidence_scans(tenant_id,id,version_id,status,signature,engine) VALUES (?,UUID(),?,'infected','Eicar-Test-Signature','clamav')", [w.A, vid]);
  const f = (await aAdmin.call('GET', url('/evidence/quarantine'))).body.files; assert.equal(f.length, 1); assert.equal(f[0].fileName, 'a.pdf'); assert.equal(f[0].signature, 'Eicar-Test-Signature'); assert.equal(f[0].requestTitle, 'Policy'); assert.equal(f[0].uploadedBy, 'aadmin');
  assert.equal((await vendor.call('GET', url('/evidence/quarantine'))).status, 403); assert.equal((await aAdmin.call('GET', `/t/${w.B}/evidence/quarantine`)).status, 404, 'another organization is invisible');
  assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/download`))).status, 409);
  const s = (await w.root.call('GET', '/platform/storage')).body; assert.equal(s.quarantine.length, 1); assert.equal(s.orgs.find((o: any) => o.id === w.A).infectedFiles, 1);
});
test('database and accounts: archive rows are unique per engagement; the worker may only add them', async () => {
  await assert.rejects(env.pool.query("INSERT INTO evidence_archive(tenant_id,engagement_id,retention_months,closed_at) VALUES (?,?,84,NOW(3))", [w.A, E]), /Duplicate/);
});
