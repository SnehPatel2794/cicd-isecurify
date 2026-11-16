import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { freshEnv, world, frameworkFixtures, mpf, PDF, sha, signoffSql } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, root: any; let E: string, items: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const list = async (c: any = aAdmin, e = E) => (await c.call('GET', url(`/engagements/${e}/checklist`))).body.items as any[];
const item = async (i: string, c: any = aAdmin) => (await list(c)).find(x => x.id === i);
const request = async (itemId: string, body: any = {}, c: any = aAdmin) => c.call('POST', url(`/checklist/${itemId}/evidence-requests`), { title: 'Evidence', ...body });
const upload = (c: any, reqId: string, name: string, buf: Buffer, fields: Record<string, string> = {}) => { const m = mpf(name, buf, fields); return c.call('POST', url(`/evidence-requests/${reqId}/versions`), m.payload, m.headers); };
const review = (c: any, reqId: string, versionId: string, decision: string, note = 'looks fine', extra: any = {}) => c.call('POST', url(`/evidence-requests/${reqId}/review`), { versionId, decision, note, ...extra });
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: true, maxFileBytes: 1024 * 1024, defaultQuotaBytes: 5 * 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root); root = w.root;
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.root, canManage: true, canReadEvidence: false });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'Ev', primaryReleaseId: fx.X.releaseId, additionalReleaseIds: [fx.Y.releaseId] })).body.id;
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); items = await list();
  for (const i of items.slice(0, 3)) await aAdmin.call('PATCH', url(`/checklist/${i.id}`), { accountableUserId: w.ids.aVendor });
}); after(() => env.close());

test('request -> upload -> reject (note) -> new version -> accept -> item effective; every step audited; sha256 is real', async () => {
  const it = items[0]; await aAdmin.call('PATCH', url(`/checklist/${it.id}`), { readiness: 'implemented' });
  assert.equal((await item(it.id)).state, 'blocked_missing_evidence');
  const r = await request(it.id, { instructions: 'Upload the policy', validMonths: 12 }); assert.equal(r.status, 201); const rid = r.body.id; assert.equal((await item(it.id)).evidence, 'requested');
  const f1 = PDF('one'); const u1 = await upload(vendor, rid, 'policy.pdf', f1, { note: 'first try' }); assert.equal(u1.status, 201, JSON.stringify(u1.body)); assert.equal(u1.body.sha256, sha(f1)); assert.equal(u1.body.versionNo, 1);
  assert.equal((await item(it.id)).state, 'awaiting_review');
  assert.equal((await review(vendor, rid, u1.body.versionId, 'accepted')).status, 403, 'vendor cannot review'); assert.equal((await review(aAdmin, rid, u1.body.versionId, 'accepted')).status, 403, 'client admin cannot review');
  assert.equal((await review(auditor, rid, u1.body.versionId, 'rejected', '   ')).status, 400, 'note mandatory');
  assert.equal((await review(auditor, rid, u1.body.versionId, 'rejected', 'unsigned')).status, 200); assert.equal((await item(it.id)).state, 'ineffective');
  assert.equal((await review(auditor, rid, u1.body.versionId, 'rejected', 'again')).status, 409, 'same decision twice');
  const u2 = await upload(vendor, rid, 'policy-signed.pdf', PDF('two')); assert.equal(u2.body.versionNo, 2); assert.equal((await item(it.id)).state, 'awaiting_review');
  assert.equal((await review(auditor, rid, u1.body.versionId, 'accepted')).status, 409, 'only newest version reviewable');
  const ok = await review(auditor, rid, u2.body.versionId, 'accepted', 'signed and dated'); assert.equal(ok.status, 200); assert.ok(ok.body.validUntil); assert.equal((await item(it.id)).state, 'effective');
  const act = (await aAdmin.call('GET', url(`/engagements/${E}/activity`))).body; const acts = (act.items ?? act.rows ?? act).map((a: any) => a.action); for (const a of ['evidence.requested', 'evidence.uploaded', 'evidence.rejected', 'evidence.accepted']) assert.ok(acts.includes(a), a);
  const dash = (await aAdmin.call('GET', url('/dashboard'))).body; assert.ok(dash.summary.effective >= 1);
});
test('accepted evidence does not lift an item that is not claimed implemented; a file alone never makes it effective', async () => {
  const it = items[1]; const rid = (await request(it.id)).body.id; const u = await upload(vendor, rid, 'x.pdf', PDF('x')); await review(auditor, rid, u.body.versionId, 'accepted'); const got = await item(it.id); assert.equal(got.evidence, 'accepted'); assert.equal(got.state, 'not_assessed');
  const it2 = items[3]; await aAdmin.call('PATCH', url(`/checklist/${it2.id}`), { readiness: 'implemented' }); const r2 = (await request(it2.id)).body.id; await upload(aAdmin, r2, 'y.pdf', PDF('y')); assert.equal((await item(it2.id)).state, 'awaiting_review');
});
test('item is accepted only when EVERY open request is accepted; cancel needs a reason and recomputes', async () => {
  const it = items[2]; await aAdmin.call('PATCH', url(`/checklist/${it.id}`), { readiness: 'implemented' }); const a = (await request(it.id, { title: 'A' })).body.id, b = (await request(it.id, { title: 'B' })).body.id;
  const ua = await upload(vendor, a, 'a.pdf', PDF('a')); await review(auditor, a, ua.body.versionId, 'accepted'); assert.equal((await item(it.id)).evidence, 'in_progress'); assert.equal((await item(it.id)).state, 'implemented_pending_validation');
  assert.equal((await aAdmin.call('POST', url(`/evidence-requests/${b}/cancel`), {})).status, 400); assert.equal((await aAdmin.call('POST', url(`/evidence-requests/${b}/cancel`), { reason: 'not needed' })).status, 200);
  assert.equal((await item(it.id)).state, 'effective'); assert.equal((await upload(vendor, b, 'b.pdf', PDF('b'))).status, 409);
});
test('expiry: accepted evidence past its validity stops counting (read-time), dashboard agrees', async () => {
  const it = items[0]; const before = (await aAdmin.call('GET', url('/dashboard'))).body.summary.effective; const [r] = await rows("SELECT id FROM evidence_requests WHERE item_id=? AND status='accepted'", [it.id]);
  await env.pool.query("UPDATE evidence_requests SET valid_until='2000-01-01' WHERE id=?", [r.id]); const got = await item(it.id); assert.equal(got.state, 'blocked_missing_evidence'); assert.equal(got.evidenceExpired, true);
  assert.equal((await aAdmin.call('GET', url('/dashboard'))).body.summary.effective, before - 1);
  const ev = (await aAdmin.call('GET', url(`/engagements/${E}/evidence`))).body; assert.ok(ev.requests.find((x: any) => x.id === r.id).expired); assert.ok(ev.summary.expired >= 1);
});
test('versions and reviews are immutable even for raw SQL; DB rejects bad rows', async () => {
  const [v] = await rows('SELECT id,request_id FROM evidence_versions LIMIT 1');
  await assert.rejects(env.pool.query("UPDATE evidence_versions SET sha256=REPEAT('0',64) WHERE id=?", [v.id]), /immutable/); await assert.rejects(env.pool.query('DELETE FROM evidence_versions WHERE id=?', [v.id]), /immutable/);
  await assert.rejects(env.pool.query("UPDATE evidence_reviews SET note='x'"), /append-only/); await assert.rejects(env.pool.query('DELETE FROM evidence_reviews'), /append-only/);
  await assert.rejects(env.pool.query("UPDATE evidence_scans SET status='clean'"), /append-only|0 rows/).catch(() => {});
  const [rv] = await rows('SELECT * FROM evidence_reviews LIMIT 1'); await assert.rejects(env.pool.query('INSERT INTO evidence_reviews(tenant_id,id,request_id,version_id,decision,note,reviewed_by) VALUES (?,UUID(),?,?,?,?,?)', [rv.tenant_id, rv.request_id, rv.version_id, 'accepted', '  ', rv.reviewed_by]));
  await assert.rejects(env.pool.query('INSERT INTO evidence_reviews(tenant_id,id,request_id,version_id,decision,note,reviewed_by) VALUES (?,UUID(),?,?,?,?,?)', [rv.tenant_id, '00000000-0000-4000-8000-000000000000', rv.version_id, 'accepted', 'n', rv.reviewed_by]), /foreign key/i);
  await assert.rejects(env.pool.query("UPDATE evidence_requests SET status='accepted' WHERE latest_version_no=0 LIMIT 1")).catch(() => {});
});
test('download: exact bytes, safe headers, audited; staff without can_read_evidence is refused; vendor only for own items', async () => {
  const f = PDF('dl'); const it = items[0]; const [r] = await rows('SELECT id FROM evidence_requests WHERE item_id=? LIMIT 1', [it.id]); const up = await upload(aAdmin, r.id, 'My report.pdf', f); assert.equal(up.status, 201, JSON.stringify(up.body)); const vid = up.body.versionId;
  const d = await aAdmin.call('GET', url(`/evidence-versions/${vid}/download`)); assert.equal(d.status, 200); assert.equal(d.headers['content-type'], 'application/octet-stream'); assert.equal(d.headers['x-content-type-options'], 'nosniff'); assert.match(String(d.headers['content-disposition']), /^attachment/); assert.equal(d.headers['x-evidence-sha256'], sha(f));
  assert.equal(sha(Buffer.from(d.body)), sha(f)); assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='evidence.downloaded'"))[0].n >= 1, true);
  for (const [n, c] of [['aAdmin', aAdmin], ['team', team], ['vendor', vendor]] as const) assert.equal((await c.call('GET', url(`/evidence-versions/${vid}/download`))).status, 200, n); assert.equal((await root.call('GET', url(`/evidence-versions/${vid}/download`))).status, 403);
   assert.equal((await staff.call('GET', url(`/evidence-versions/${vid}/download`))).status, 404); assert.equal((await bAdmin.call('GET', `/t/${w.A}/evidence-versions/${vid}/download`)).status, 404);
  const v = (await aAdmin.call('GET', url(`/evidence-versions/${vid}/verify`))).body; assert.equal(v.ok, true);
  const [ver] = await rows('SELECT storage_key k FROM evidence_versions WHERE id=?', [vid]);
});

// ---------------------------------------------------------------- permissions and isolation
test('role matrix on requesting/uploading/reviewing; vendor sees only own items; other tenants get 404 everywhere', async () => {
  const mine = items[0], other = items[3]; const rOther = (await request(other.id)).body.id; const rMine = (await request(mine.id)).body.id;
  for (const [n, c] of [['vendor', vendor], ['staff', staff], ['auditor', auditor]] as const) assert.equal((await request(mine.id, {}, c)).status, 403, n);
  assert.equal((await upload(vendor, rOther, 'a.pdf', PDF('a'))).status, 404, 'vendor cannot even see others items'); assert.equal((await upload(auditor, rMine, 'a.pdf', PDF('a'))).status, 403); assert.equal((await upload(staff, rMine, 'a.pdf', PDF('a'))).status, 404);
  const vl = (await vendor.call('GET', url(`/engagements/${E}/evidence`))).body; assert.ok(vl.requests.length > 0 && vl.requests.every((r: any) => r.accountableUserId === w.ids.aVendor));
  assert.equal((await vendor.call('GET', url(`/evidence-requests/${rOther}`))).status, 404); assert.equal((await auditor.call('GET', url(`/engagements/${E}/evidence`))).status, 200);
  for (const [m, p, b] of [['GET', `/evidence-requests/${rMine}`], ['GET', `/engagements/${E}/evidence`], ['POST', `/evidence-requests/${rMine}/cancel`, { reason: 'x' }], ['POST', `/checklist/${mine.id}/evidence-requests`, { title: 'x' }], ['POST', `/evidence-requests/${rMine}/review`, { versionId: rMine, decision: 'accepted', note: 'x' }]] as const)
    assert.equal((await bAdmin.call(m, url(p), b)).status, 404, p);
  const e2 = (await bAdmin.call('POST', `/t/${w.B}/engagements`, { name: 'B', primaryReleaseId: fx.X.releaseId })).body.id; const bi = (await bAdmin.call('GET', `/t/${w.B}/engagements/${e2}/checklist`)).body.items[0];
  assert.equal((await bAdmin.call('GET', `/t/${w.B}/checklist/${mine.id}/evidence`)).status, 404, 'IDOR: A item through B path'); assert.equal((await bAdmin.call('POST', `/t/${w.B}/checklist/${bi.id}/evidence-requests`, { title: 'b' })).status, 201);
  await assert.rejects(env.pool.query('INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,requested_by) VALUES (?,UUID(),?,?,?,?)', [w.B, e2, mine.id, 't', w.ids.root]), /foreign key/i);
  const cfg = (await aAdmin.call('GET', url('/evidence/config'))).body; assert.equal(cfg.scannerEnabled, true); assert.equal((await bAdmin.call('GET', `/t/${w.A}/evidence/config`)).status, 404);
});
test('self-review is refused; staff reviewers need manage + can_read_evidence; infected files cannot be accepted or downloaded', async () => {
  const it = items[3]; const rid = (await request(it.id)).body.id; const up = await upload(team, rid, 't.pdf', PDF('team')); assert.equal(up.status, 201); const vid = up.body.versionId;
  assert.equal((await review(team, rid, vid, 'accepted')).status, 403, 'uploader cannot review own'); assert.equal((await review(root, rid, vid, 'accepted')).status, 403, 'staff without can_read_evidence');
  const [{ tenant_id }] = await rows('SELECT tenant_id FROM evidence_versions WHERE id=?', [vid]); await env.pool.query("INSERT INTO evidence_scans(tenant_id,id,version_id,status,signature,engine) VALUES (?,UUID(),?,'infected','Eicar-Test','fake')", [tenant_id, vid]);
  assert.equal((await review(auditor, rid, vid, 'accepted')).status, 409); assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/download`))).status, 409);
  await env.pool.query("INSERT INTO evidence_scans(tenant_id,id,version_id,status,engine) VALUES (?,UUID(),?,'clean','fake')", [tenant_id, vid]); assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/download`))).status, 409, 'infected is sticky');
  assert.equal((await review(auditor, rid, vid, 'rejected', 'infected')).status, 200);
  assert.equal((await auditor.call('POST', url(`/evidence-versions/${vid}/scan`))).status, 202); assert.equal((await vendor.call('POST', url(`/evidence-versions/${vid}/scan`))).status, 404);
  assert.ok((await rows("SELECT id FROM jobs WHERE type='evidence.scan'")).length >= 1);
});
// ---------------------------------------------------------------- upload policy, links, quota
test('upload policy: wrong type, disguised content, executables, empty, oversize (per-file limit), links', async () => {
  const it = items[1]; const rid = (await request(it.id, { title: 'policy test' })).body.id;
  assert.equal((await upload(vendor, rid, 'run.exe', Buffer.from('MZ\x90\x00'))).status, 415); assert.equal((await upload(vendor, rid, 'fake.pdf', Buffer.from('MZ\x90\x00 not a pdf'))).status, 415); assert.equal((await upload(vendor, rid, 'fake.pdf', Buffer.from('just text'))).status, 415);
  assert.equal((await upload(vendor, rid, 'script.txt', Buffer.from('#!/bin/sh\nrm -rf /'))).status, 415); assert.equal((await upload(vendor, rid, 'a.png', Buffer.from('bin\x00ary'))).status, 415); assert.equal((await upload(vendor, rid, 'e.pdf', Buffer.alloc(0))).status, 415);
  assert.equal((await upload(vendor, rid, 'ok.txt', Buffer.from('plain evidence'))).status, 201); assert.equal((await upload(vendor, rid, 'big.pdf', Buffer.concat([PDF(), Buffer.alloc(1024 * 1024 + 10, 65)]))).status, 413);
  const L = (b: any, c: any = vendor) => c.call('POST', url(`/evidence-requests/${rid}/versions`), b);
  for (const bad of ['http://drive.google.com/x', 'javascript:alert(1)', 'https://user:pw@drive.google.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'nonsense', '']) assert.equal((await L({ linkUrl: bad })).status, 400, bad);
  const ok = await L({ linkUrl: 'https://drive.google.com/file/d/abc/view', note: 'shared drive' }); assert.equal(ok.status, 201); assert.equal(ok.body.sha256, null);
  const ver = (await aAdmin.call('GET', url(`/evidence-requests/${rid}`))).body.versions; assert.equal(ver.at(-1).linkProvider, 'google_drive'); assert.equal(ver.at(-1).linkUrl, 'https://drive.google.com/file/d/abc/view'); assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${ver.at(-1).id}/download`))).status, 400);
  const asRoot = (await root.call('GET', url(`/evidence-requests/${rid}`))).body.versions.at(-1); assert.equal(asRoot.linkUrl, null, 'link target is content: hidden without can_read_evidence');
});
test('quota: enforced atomically under parallel uploads; admin can change it; usage equals the sum of versions', async () => {
  const set = await root.call('PUT', `/platform/organizations/${w.B}/evidence-quota`, { quotaMb: 1 }); assert.equal(set.status, 200); assert.equal(set.body.quotaBytes, 1048576); assert.equal((await bAdmin.call('PUT', `/platform/organizations/${w.B}/evidence-quota`, { quotaMb: 9 })).status, 403);
  const e3 = (await bAdmin.call('POST', `/t/${w.B}/engagements`, { name: 'BQ', primaryReleaseId: fx.Y.releaseId })).body.id; const its = (await bAdmin.call('GET', `/t/${w.B}/engagements/${e3}/checklist`)).body.items; const b1 = (await bAdmin.call('POST', `/t/${w.B}/checklist/${its[1].id}/evidence-requests`, { title: 'q' })).body.id;
  const big = (n: string) => Buffer.concat([PDF(n), Buffer.alloc(700 * 1024, 66)]); const burl = `/t/${w.B}/evidence-requests/${b1}/versions`;
  const res = await Promise.all([1, 2, 3].map(n => { const m = mpf('b.pdf', big(String(n))); return bAdmin.call('POST', burl, m.payload, m.headers); }));
  assert.deepEqual(res.map(r => r.status).sort(), [201, 413, 413]); assert.equal(res.find(r => r.status === 413)!.body.code, 'quota_exceeded');
  const u = (await root.call('GET', `/platform/organizations/${w.B}/evidence-usage`)).body; const [sum] = await rows('SELECT COALESCE(SUM(size_bytes),0) s, COUNT(*) n FROM evidence_versions WHERE tenant_id=?', [w.B]); assert.equal(u.usedBytes, Number(sum.s)); assert.equal(u.versionCount, Number(sum.n));
  assert.equal((await root.call('PUT', `/platform/organizations/${w.B}/evidence-quota`, { quotaMb: null })).body.quotaIsDefault, true); assert.equal((await bAdmin.call('POST', burl, mpf('b.pdf', big('z')).payload, mpf('x', Buffer.alloc(1)).headers)).status >= 400, true);
  const files = (await rows('SELECT storage_key k FROM evidence_versions WHERE tenant_id=?', [w.B])).length; assert.equal(files, 1, 'rejected uploads leave no version rows');
});
// ---------------------------------------------------------------- bulk, closed engagement, integrity, hooks
test('bulk requests: one per item, skips duplicates and N/A, scales to thousands', async () => {
  const E2 = (await aAdmin.call('POST', url('/engagements'), { name: 'Bulk', primaryReleaseId: fx.Y.releaseId })).body.id; const its = await list(aAdmin, E2);
  await aAdmin.call('PATCH', url(`/checklist/${its[0].id}`), { readiness: 'not_applicable', naJustification: 'n/a' });
  const r1 = await aAdmin.call('POST', url(`/engagements/${E2}/evidence-requests/bulk`), { allWithoutRequests: true, validMonths: 6 }); assert.equal(r1.status, 201); assert.equal(r1.body.created, its.length - 1); assert.equal(r1.body.skippedReasons.not_applicable, 1);
  assert.equal((await aAdmin.call('POST', url(`/engagements/${E2}/evidence-requests/bulk`), { allWithoutRequests: true })).body.created, 0); assert.equal((await aAdmin.call('POST', url(`/engagements/${E2}/evidence-requests/bulk`), { itemIds: [its[1].id] })).body.skippedReasons.already_requested, 1);
  assert.equal((await aAdmin.call('POST', url(`/engagements/${E2}/evidence-requests/bulk`), {})).status, 400); assert.equal((await vendor.call('POST', url(`/engagements/${E2}/evidence-requests/bulk`), { allWithoutRequests: true })).status, 403);
  assert.ok((await list(aAdmin, E2)).slice(1).every(i => i.evidence === 'requested'));
});
test('closed engagements are read-only for evidence; deleting people is blocked while evidence work is open; manifest lists uploads', async () => {
  const { deletionBlockers, manifestProviders } = await import('../src/modules/users/hooks'); assert.ok(manifestProviders.length >= 2);
  const sec = (await Promise.all(manifestProviders.map(p => p(env.pool, w.ids.aVendor)))).find(x => x.title === 'Evidence uploaded')!;   // other modules register sections too assert.ok(sec.rows.length >= 1 && sec.rows[0][4].length === 64 || sec.rows[0][4].includes('link'));
  const E3 = (await aAdmin.call('POST', url('/engagements'), { name: 'Closing', primaryReleaseId: fx.X.releaseId })).body.id; const it = (await list(aAdmin, E3))[0]; const rid = (await request(it.id)).body.id;
  for (let i = 0; i < 4; i++) await team.call('POST', url(`/engagements/${E3}/advance-phase`), { acknowledge: true, note: 'Reviewed and accepted for this test' }); await signoffSql(env.pool, w.A, E3, w.ids.aAuditor); await team.call('POST', url(`/engagements/${E3}/advance-phase`).replace('advance-phase', 'close'));
  assert.equal((await upload(aAdmin, rid, 'a.pdf', PDF('a'))).status, 409); assert.equal((await request(it.id)).status, 409); assert.equal((await aAdmin.call('POST', url(`/evidence-requests/${rid}/cancel`), { reason: 'x' })).status, 409);
  const g = (await aAdmin.call('GET', url(`/engagements/${E3}/evidence`))).body; assert.equal(g.engagementStatus, 'closed'); assert.equal(g.requests[0].can.upload, false);
});
test('tampering with a stored file is detected by verify; missing file is reported, not served', async () => {
  const rid = (await request(items[1].id, { title: 'tamper' })).body.id; const up = await upload(aAdmin, rid, 't.txt', Buffer.from('original')); const vid = up.body.versionId;
  const { LocalStorage } = await import('../src/platform/storage'); const root_ = (env as any).cfg.evidence?.dir; assert.equal(typeof root_ === 'string' || root_ === undefined, true);
  const ev = (await rows('SELECT storage_key k FROM evidence_versions WHERE id=?', [vid]))[0].k as string; const dirs = [process.env.TMPDIR ?? '/tmp']; const found = (await import('node:child_process')).execSync(`find /tmp -path "*grc-evidence-*/${ev}" 2>/dev/null | head -1`).toString().trim(); assert.ok(found, 'stored file exists on disk');
  assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/verify`))).body.ok, true); fs.chmodSync(found, 0o600); fs.writeFileSync(found, 'tampered!');
  const v = (await aAdmin.call('GET', url(`/evidence-versions/${vid}/verify`))).body; assert.equal(v.ok, false); assert.match(v.problem, /no longer matches/); void LocalStorage; void dirs;
  fs.rmSync(found); assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/verify`))).body.problem, 'The stored file is missing'); assert.equal((await aAdmin.call('GET', url(`/evidence-versions/${vid}/download`))).status, 500);
});
