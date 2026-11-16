import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import ExcelJS from 'exceljs';
import { freshEnv, world, frameworkFixtures, mpf, PDF } from './helpers'; import { latin } from '../src/modules/reports/pdf'; import { LIMITS } from '../src/modules/reports/build';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, otherAuditor: any; let E: string, E2: string, items: any[];
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[]; const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const exp = (c: any, e = E, body: any = { format: 'pdf' }) => c.call('POST', url(`/engagements/${e}/exports`), body);
const pdfText = (buf: Buffer) => { const f = path.join(os.tmpdir(), `r${Date.now()}${Math.random()}.pdf`); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  await w.join(w.A, 'second-auditor@c.test', 'tp_auditor'); otherAuditor = await env.login('second-auditor@c.test');
  E = (await aAdmin.call('POST', url('/engagements'), { name: 'Annual ISO <27001> audit', primaryReleaseId: fx.X.releaseId, document: { documentNumber: 'DOC-7', classification: 'Confidential' } })).body.id; E2 = (await aAdmin.call('POST', url('/engagements'), { name: 'Second', primaryReleaseId: fx.X.releaseId })).body.id;
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); items = (await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).body.items;
  await aAdmin.call('PATCH', url(`/checklist/${items[0].id}`), { accountableUserId: w.ids.aVendor, readiness: 'implemented' });
  const rid = (await aAdmin.call('POST', url(`/checklist/${items[0].id}/evidence-requests`), { title: '=HYPERLINK("http://evil.test","click")' })).body.id; const m = mpf('policy.pdf', PDF('p'), {}); const u = await vendor.call('POST', url(`/evidence-requests/${rid}/versions`), m.payload, m.headers); await auditor.call('POST', url(`/evidence-requests/${rid}/review`), { versionId: u.body.versionId, decision: 'accepted', note: 'ok' });
  await team.call('POST', url(`/checklist/${items[1].id}/findings`), { title: 'Weak password policy — “smart quotes” ✓ गुजराती', description: 'Passwords may be 6 characters.', severity: 'high', recommendation: 'Raise to 12.' });
  await aAdmin.call('PATCH', url(`/soa/x`), {}).catch(() => {});
}); after(() => env.close());

test('pure: text outside the PDF fonts becomes ? and control characters become spaces', () => { assert.equal(latin('Café — “ok” ✓ ग'), 'Café — “ok” ? ?'); assert.equal(latin('a\u0000b\tc'), 'a b c'); assert.equal(latin(null), ''); });
test('PDF export: a real PDF with the engagement, findings, checklist and evidence; the header hash equals the file hash; the file is not stored but its hash is logged and audited', async () => {
  const r = await exp(aAdmin); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.headers['content-type'], 'application/pdf'); assert.match(String(r.headers['content-disposition']), /attachment; filename="annual-iso-27001-audit-report-\d{4}-\d{2}-\d{2}\.pdf"/); assert.equal(r.headers['cache-control'], 'no-store');
  const buf = r.raw; assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.equal(r.headers['x-report-sha256'], sha(buf));
  const t = pdfText(buf); for (const s of ['Audit readiness report', 'Org A', 'Annual ISO <27001> audit', 'DOC-7', 'Confidential', 'Weak password policy', 'Passwords may be 6 characters', 'Raise to 12', 'Control checklist', 'Statement of applicability', 'Evidence index', 'policy.pdf', 'Open, phase 1']) assert.ok(t.includes(s), `missing: ${s}`);
  assert.ok(t.includes('=HYPERLINK'), 'hostile text is printed as text'); assert.match(t, /Page 1 of \d+/); assert.ok(!t.includes('गुजराती'), 'unsupported script is replaced, not garbled'); assert.match(t, /\?/);
  const log = await rows('SELECT * FROM report_exports WHERE id=?', [r.headers['x-report-id']]); assert.equal(log.length, 1); assert.equal(log[0].sha256, sha(buf)); assert.equal(Number(log[0].size_bytes), buf.length); assert.equal(log[0].format, 'pdf'); assert.equal(log[0].generated_by, w.ids.aAdmin);
  const au = await rows("SELECT detail FROM audit_events WHERE action='report.exported'"); assert.equal(au.length >= 1, true); assert.ok(JSON.stringify(au[au.length - 1].detail).includes(sha(buf))); const sha2 = sha((await exp(aAdmin)).raw); assert.notEqual(sha2, sha(buf), 'every export is its own record (ids and times differ)');
});
test('Excel export: Summary, Checklist, Findings, SOA and Evidence sheets; formula-looking text stays text; counts match', async () => {
  const r = await exp(aAdmin, E, { format: 'xlsx' }); assert.equal(r.status, 200); assert.match(String(r.headers['content-type']), /spreadsheetml/); assert.equal(r.headers['x-report-sha256'], sha(r.raw)); assert.equal(r.raw.subarray(0, 2).toString(), 'PK');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.raw as any); assert.deepEqual(wb.worksheets.map(s => s.name), ['Summary', 'Checklist', 'Findings', 'SOA', 'Evidence']);
  const ev = wb.getWorksheet('Evidence')!; assert.equal(ev.rowCount, 2); const cell = ev.getRow(2).getCell(2); assert.equal(cell.type, ExcelJS.ValueType.String); assert.equal(cell.value, '=HYPERLINK("http://evil.test","click")'); assert.equal(ev.getRow(2).getCell(10).value, sha(PDF('p')), 'file fingerprint recorded at upload');
  const f = wb.getWorksheet('Findings')!; assert.equal(f.rowCount, 2); assert.equal(f.getRow(2).getCell(1).value, 'F-001'); assert.equal(f.getRow(2).getCell(13).value ?? null, null); assert.equal(f.getRow(2).getCell(5).value, 'Weak password policy — “smart quotes” ✓ गुजराती', 'Excel keeps full Unicode');
  assert.equal(wb.getWorksheet('Checklist')!.rowCount, items.length + 1); const sum = wb.getWorksheet('Summary')!; const kv = Object.fromEntries(sum.getRows(1, sum.rowCount)!.map(r => [String(r.getCell(1).value), r.getCell(2).value])); assert.equal(kv['Findings'], 1); assert.equal(kv['Checklist items'], items.length); assert.equal(kv['Organization'], 'Org A');
});
test('who may export: client admin, managing iSecurify staff and the engagement\'s own TP auditor; nobody else; other organizations and non-member auditors see "not found"', async () => {
  for (const c of [team, auditor]) assert.equal((await exp(c)).status, 200); for (const c of [vendor, staff]) assert.equal((await exp(c)).status, 403, 'client staff / vendor');
  assert.equal((await exp(bAdmin)).status, 404, 'other organization'); assert.equal((await exp(otherAuditor)).status, 404, 'an auditor who is not on this engagement'); assert.equal((await exp(env.client())).status, 401);
  assert.equal((await exp(aAdmin, E, { format: 'docx' })).status, 400); assert.equal((await exp(aAdmin, '00000000-0000-0000-0000-000000000000')).status, 404);
  for (const c of [vendor, staff]) assert.equal((await c.call('GET', url(`/engagements/${E}/exports`))).status, 403);
});
test('history and verification: a genuine file matches its record; any change to it does not; unknown hashes and bad input are handled; scoped to what the caller can see', async () => {
  const a = await exp(aAdmin); const id = a.headers['x-report-id']; const list = (await aAdmin.call('GET', url(`/engagements/${E}/exports`))).body.exports; assert.ok(list.length >= 3); assert.equal(list[0].id, id, 'newest first'); assert.equal(list[0].sha256, sha(a.raw)); assert.equal(list[0].generatedBy, 'aadmin'); assert.ok(list[0].counts.findings === 1 && list[0].engagementStatus === 'active');
  const ok = (await aAdmin.call('POST', url('/exports/verify'), { sha256: sha(a.raw).toUpperCase() })).body; assert.equal(ok.match, true); assert.equal(ok.exports[0].id, id); assert.equal(ok.exports[0].engagementName, 'Annual ISO <27001> audit');
  const tampered = Buffer.concat([a.raw, Buffer.from(' ')]); assert.equal((await aAdmin.call('POST', url('/exports/verify'), { sha256: sha(tampered) })).body.match, false);
  assert.equal((await aAdmin.call('POST', url('/exports/verify'), { sha256: 'abc' })).status, 400); assert.equal((await bAdmin.call('POST', url('/exports/verify'), { sha256: sha(a.raw) })).status, 404); assert.equal((await vendor.call('POST', url('/exports/verify'), { sha256: sha(a.raw) })).status, 403);
  const e2 = await exp(aAdmin, E2); assert.equal((await auditor.call('POST', url('/exports/verify'), { sha256: sha(e2.raw) })).body.match, false, 'an auditor cannot learn about exports of engagements they are not on'); assert.equal((await aAdmin.call('POST', url('/exports/verify'), { sha256: sha(e2.raw) })).body.match, true);
  assert.ok((await rows("SELECT 1 FROM audit_events WHERE action='report.verified'")).length >= 3);
});
test('the export log is append-only for everyone (triggers), and an export of a closed engagement says so', async () => {
  await assert.rejects(env.pool.query("UPDATE report_exports SET format='xlsx'"), /append-only/); await assert.rejects(env.pool.query('DELETE FROM report_exports'), /append-only/);
  await env.pool.query("UPDATE engagements SET status='closed' WHERE id=?", [E2]); const r = await exp(aAdmin, E2); assert.equal(r.status, 200); assert.ok(!pdfText(r.raw).includes('Open, phase')); assert.equal((await rows('SELECT engagement_status s FROM report_exports WHERE id=?', [r.headers['x-report-id']]))[0].s, 'closed');
});
test('safety limits: a very large engagement is refused with 413, and exports are rate limited per person', async () => {
  const keep = LIMITS.findings; LIMITS.findings = 0; const r = await exp(aAdmin); LIMITS.findings = keep; assert.equal(r.status, 413); assert.equal(r.body.code, 'report_too_large');
  let last = 200; for (let i = 0; i < 25 && last === 200; i++) last = (await exp(auditor, E, { format: 'xlsx' })).status; assert.equal(last, 429);
});
