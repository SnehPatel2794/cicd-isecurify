import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { zipSync } from 'fflate';
import { freshEnv, world, newFramework, mp, xlsxBuf, HDR } from './helpers'; import { csvTemplate, xlsxTemplate } from '../src/modules/frameworks/importer';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let team: any; let rel: string;
before(async () => { env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); team = await env.login('team@x.test'); rel = (await newFramework(w.root, 'Import Target')).releaseId; }); after(() => env.close());
const count = async (id = rel) => ((await env.pool.query('SELECT COUNT(*) n FROM framework_controls WHERE release_id=?', [id]) as any)[0][0].n as number);
const post = (who: any, id: string, name: string, buf: Buffer, confirm = false) => { const m = mp(name, buf); return who.call('POST', `/releases/${id}/import${confirm ? '?confirm=true' : ''}`, m.payload, m.headers); };
const csv = (...lines: string[]) => Buffer.from(lines.join('\n'));
const GOOD = csv('Ref #,Domain / Clause,Requirement,Owner (Department),Evidence / Reference,Additional Evidence Notes,Remarks', 'G-1,Governance,"Policy is approved, reviewed yearly",CISO,Signed policy,Type II: all periods,first', 'G-2,Governance,Roles assigned,HR,,,', 'A-1,Access,"Quarterly review\nof access",IT,Review report,,');

test('PREVIEW never writes: counts and per-row results only', async () => {
  const r = await post(w.root, rel, 'controls.csv', GOOD); assert.equal(r.status, 200); assert.equal(r.body.confirmed, false); assert.deepEqual(r.body.counts, { total: 3, valid: 3, invalid: 0 }); assert.equal(r.body.rows.length, 3);
  assert.equal(await count(), 0); assert.equal((await post(w.root, rel, 'controls.csv', GOOD, false)).status, 200); assert.equal(await count(), 0);
  assert.equal(((await env.pool.query("SELECT COUNT(*) n FROM audit_events WHERE action='release.imported'") as any)[0][0].n), 0);
});
test('CONFIRM imports valid rows with correct field mapping, order, quotes and multi-line cells; audited with file hash', async () => {
  const r = await post(w.root, rel, 'controls.csv', GOOD, true); assert.equal(r.status, 200); assert.deepEqual([r.body.imported, r.body.skipped], [3, 0]); assert.equal(await count(), 3);
  const list = (await w.root.call('GET', `/releases/${rel}/controls`)).body; const g1 = list.find((c: any) => c.ref === 'G-1');
  assert.equal(g1.title, 'Policy is approved, reviewed yearly'); assert.equal(g1.owner_department, 'CISO'); assert.equal(g1.description, 'Signed policy'); assert.equal(g1.secondary_guidance_note, 'Type II: all periods'); assert.equal(g1.remarks, 'first');
  assert.equal(list.find((c: any) => c.ref === 'A-1').title, 'Quarterly review\nof access'); assert.equal(list.find((c: any) => c.ref === 'G-2').description, null);
  assert.deepEqual(list.filter((c: any) => c.domain === 'Governance').map((c: any) => c.ref), ['G-1', 'G-2']);   // file order preserved
  const [[a]]: any = await env.pool.query("SELECT detail FROM audit_events WHERE action='release.imported'"); const d = typeof a.detail === 'string' ? JSON.parse(a.detail) : a.detail; assert.equal(d.imported, 3); assert.equal(d.sha256.length, 64);
});
test('re-importing the same file: every row is flagged as existing; nothing to import', async () => {
  const p = await post(w.root, rel, 'controls.csv', GOOD); assert.deepEqual(p.body.counts, { total: 3, valid: 0, invalid: 3 }); assert.match(p.body.rows[0].errors[0], /already exists/);
  assert.equal((await post(w.root, rel, 'controls.csv', GOOD, true)).status, 422); assert.equal(await count(), 3);
});
test('row validation: required fields, duplicates inside the file, over-long values; valid rows still import', async () => {
  const id = (await newFramework(w.root, 'Validation FW')).releaseId;
  const f = csv('Ref #,Domain,Requirement', 'V-1,Dom,Ok', ',Dom,Missing ref', 'V-3,,Missing domain', 'V-4,Dom,', 'V-1,Dom,Duplicate of first', `V-6,Dom,${'x'.repeat(501)}`, 'V-7,Dom,Fine', ',,,');
  const p = await post(w.root, id, 'v.csv', f); assert.deepEqual(p.body.counts, { total: 7, valid: 2, invalid: 5 }); assert.deepEqual(p.body.rows.map((r: any) => r.valid), [true, false, false, false, false, false, true]);
  assert.match(p.body.rows[4].errors.join(), /duplicate ref/); const c = await post(w.root, id, 'v.csv', f, true); assert.deepEqual([c.body.imported, c.body.skipped], [2, 5]); assert.equal(await count(id), 2);
});
test('header detection: title rows above the header, aliases, semicolon delimiter, BOM, extra unrelated columns', async () => {
  const id = (await newFramework(w.root, 'Header FW')).releaseId;
  const f = Buffer.from('\uFEFFOur company template;;;\n;;;\nInstructions: fill below;;;\nRef #;Status;Domain / Clause;Requirement\nH-1;Done;Dom;Req one\nH-2;-;Dom;Req two\n');
  const p = await post(w.root, id, 'h.csv', f); assert.equal(p.body.headerRow, 4); assert.deepEqual(p.body.counts, { total: 2, valid: 2, invalid: 0 }); assert.equal(p.body.columns.title, 'Requirement'); assert.equal(await count(id), 0);
  const noHeader = await post(w.root, id, 'n.csv', csv('foo,bar', '1,2')); assert.equal(noHeader.status, 422); assert.match(noHeader.body.error, /header row/);
  assert.equal((await post(w.root, id, 'late.csv', csv('', '', '', '', '', '', 'Ref,Domain,Requirement', 'a,b,c'))).status, 422);          // header beyond the first 6 rows is not accepted
});
test('FORMULA INJECTION: cells starting with = + - @ (or tab) are refused in CSV; harmless text is untouched', async () => {
  const id = (await newFramework(w.root, 'Formula FW')).releaseId;
  const f = csv('Ref,Domain,Requirement', 'F-1,Dom,=HYPERLINK("http://evil.example","x")', 'F-2,Dom,+1+1', 'F-3,Dom,-2+3', 'F-4,Dom,@SUM(A1)', 'F-5,Dom,\t=cmd', 'F-6,Dom,Safe = text with = inside', '=F-7,Dom,Ref itself is a formula');
  const p = await post(w.root, id, 'f.csv', f); assert.deepEqual(p.body.rows.map((r: any) => r.valid), [false, false, false, false, false, true, false]); assert.match(p.body.rows[0].errors[0], /formula character/);
  const c = await post(w.root, id, 'f.csv', f, true); assert.equal(c.body.imported, 1); assert.equal(await count(id), 1);
});
test('FORMULA INJECTION in Excel workbooks (text cells) is refused too; unmapped columns are not inspected', async () => {
  const id = (await newFramework(w.root, 'Formula XLSX')).releaseId;
  const x = await xlsxBuf([['Ref #', 'Domain', 'Requirement', 'Status'], ['X-1', 'Dom', '=1+1', 'ok'], ['X-2', 'Dom', 'Clean', '=cmd|calc'], ['X-3', 'Dom', '@evil', '']]);
  const p = await post(w.root, id, 'f.xlsx', x); assert.deepEqual(p.body.rows.map((r: any) => r.valid), [false, true, false]);
});
test('Excel import: numbers become text, columns map, row numbers match the sheet', async () => {
  const id = (await newFramework(w.root, 'XLSX FW')).releaseId; const x = await xlsxBuf([HDR, ['164.308', 'Admin safeguards', 'Risk analysis', 'CISO', 'Risk register', 'Annual', ''], [1.1, 'Numeric', 'Ref given as number', '', '', '', '']]);
  const p = await post(w.root, id, 'e.xlsx', x); assert.equal(p.body.format, 'xlsx'); assert.deepEqual(p.body.counts, { total: 2, valid: 2, invalid: 0 }); assert.deepEqual(p.body.rows.map((r: any) => [r.row, r.ref]), [[2, '164.308'], [3, '1.1']]);
  assert.equal((await post(w.root, id, 'e.xlsx', x, true)).body.imported, 2);
});
test('wrong or disguised files are rejected before parsing', async () => {
  const x = await xlsxBuf([HDR, ['a', 'b', 'c']]); const id = rel;
  for (const [name, buf, why] of [['run.exe', GOOD, 'extension'], ['notes.txt', GOOD, 'extension'], ['noext', GOOD, 'extension'], ['evil.csv.exe', GOOD, 'double extension'], ['fake.xlsx', GOOD, 'csv bytes named xlsx'], ['fake.csv', x, 'xlsx bytes named csv'],
    ['pdf.csv', Buffer.from('%PDF-1.4 hello'), 'pdf as csv'], ['nul.csv', Buffer.concat([GOOD, Buffer.from([0, 1, 2])]), 'binary csv'], ['empty.csv', Buffer.alloc(0), 'empty'], ['latin1.csv', Buffer.from([0x52, 0x65, 0x66, 0x2c, 0x44, 0x6f, 0x6d, 0x61, 0x69, 0x6e, 0x2c, 0x52, 0x65, 0x71, 0x0a, 0x61, 0x2c, 0xe9, 0x2c, 0x63]), 'not utf-8']] as [string, Buffer, string][])
    assert.equal((await post(w.root, id, name, buf)).status, 400, `${name} (${why})`);
  assert.equal((await post(w.root, id, 'corrupt.xlsx', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 7)]))).status, 400);
});
test('ZIP BOMB: a tiny workbook that expands to hundreds of MB is refused without decompressing', async () => {
  const bomb = Buffer.from(zipSync({ 'xl/big.bin': new Uint8Array(60 * 1024 * 1024), 'xl/big2.bin': new Uint8Array(10 * 1024 * 1024) }, { level: 9 })); assert.ok(bomb.length < 200_000, 'bomb is small on the wire: ' + bomb.length);
  const r = await post(w.root, rel, 'bomb.xlsx', bomb); assert.equal(r.status, 400); assert.match(r.body.error, /unreasonable size/);
});
test('size and row limits: >5 MB -> 413; >5000 rows -> 413; exactly 5000 rows import', async () => {
  assert.equal((await post(w.root, rel, 'big.csv', Buffer.concat([GOOD, Buffer.from('\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 97)]))).status, 413);
  const line = (i: number) => `R-${i},Dom,Requirement number ${i}`; const make = (n: number) => csv('Ref,Domain,Requirement', ...Array.from({ length: n }, (_, i) => line(i)));
  assert.equal((await post(w.root, rel, 'many.csv', make(5001))).status, 413);
  const id = (await newFramework(w.root, 'Big FW')).releaseId; const t0 = Date.now(); const r = await post(w.root, id, 'ok.csv', make(5000), true); assert.equal(r.body.imported, 5000); assert.equal(await count(id), 5000); assert.ok(Date.now() - t0 < 20000, 'import took ' + (Date.now() - t0) + 'ms');
});
test('import is draft-only and admin-only; multipart required; CSRF required; bad query rejected', async () => {
  const pub = await newFramework(w.root, 'Published FW', [{ ref: 'P-1', domain: 'd', title: 't' }], true); const r = await post(w.root, pub.releaseId, 'c.csv', GOOD, true); assert.equal(r.status, 409); assert.equal(r.body.code, 'release_immutable');
  for (const who of [team, await w.as('aAdmin')]) assert.equal((await post(who, rel, 'c.csv', GOOD)).status, 403);
  assert.equal((await env.client().call('POST', `/releases/${rel}/import`, {})).status, 401);
  assert.equal((await w.root.call('POST', `/releases/${rel}/import`, { file: 'x' })).status, 400);
  const m = mp('c.csv', GOOD); assert.equal((await w.root.call('POST', `/releases/${rel}/import`, m.payload, { ...m.headers, 'x-csrf-token': null as any })).status, 403);
  assert.equal((await w.root.call('POST', `/releases/${rel}/import?confirm=maybe`, m.payload, m.headers)).status, 400); assert.equal((await post(w.root, '00000000-0000-4000-8000-000000000000', 'c.csv', GOOD)).status, 404);
});
test('downloadable templates are valid: both formats import cleanly into a draft', async () => {
  for (const [fmt, name] of [['csv', 'framework-import-template.csv'], ['xlsx', 'framework-import-template.xlsx']]) {
    const res = await env.app.inject({ method: 'GET', url: `/frameworks/import-template?format=${fmt}`, headers: { cookie: team.cookie } }); assert.equal(res.statusCode, 200); assert.match(String(res.headers['content-disposition']), new RegExp(name));
    const id = (await newFramework(w.root, 'Template ' + fmt)).releaseId; const c = await post(w.root, id, name, res.rawPayload, true); assert.deepEqual([c.body.imported, c.body.skipped], [2, 0], fmt); assert.match((await w.root.call('GET', `/releases/${id}/controls`)).body[0].title, /Example requirement/);
  }
  assert.equal((await w.as('aAdmin').then(c => c.call('GET', '/frameworks/import-template'))).status, 403); assert.equal((await team.call('GET', '/frameworks/import-template?format=pdf')).status, 400);
  assert.ok((await xlsxTemplate()).length > 1000); assert.ok(csvTemplate().startsWith('\uFEFFRef #'));
});
