import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { parseCsv, parseImport, mapSeverity, importKey, MAX_ROWS } from '../src/modules/findings/import';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, aAdmin: any, auditor: any, vendor: any, bAdmin: any, other: any; let E: string, E2: string, CLOSED: string;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const imp = (c: any, body: any, eid = E) => c.call('POST', url(`/engagements/${eid}/findings/import`), { format: 'csv', filename: 'scan.csv', ...body });
const NESSUS = 'Plugin ID,CVE,CVSS v2.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution\n12345,CVE-2024-0001,9.3,Critical,10.0.0.5,tcp,443,TLS 1.0 enabled,Weak protocol,"Server accepts TLS 1.0,\nwhich is insecure.",Disable TLS 1.0\n12346,,5.0,Medium,10.0.0.6,tcp,22,SSH weak ciphers,Weak ciphers,Weak ciphers offered,Remove them\n12347,,0,None,10.0.0.5,tcp,0,Banner disclosure,Info,Version in banner,\n';
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); auditor = await w.as('aAuditor'); await w.join(w.A, 'second-auditor@c.test', 'tp_auditor'); other = await env.login('second-auditor@c.test');
  const mk = async (name: string) => (await aAdmin.call('POST', url('/engagements'), { name, primaryReleaseId: fx.X.releaseId })).body.id; E = await mk('Pentest'); E2 = await mk('Other'); CLOSED = await mk('Done');
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); await env.pool.query("UPDATE engagements SET status='closed' WHERE id=?", [CLOSED]);
}); after(() => env.close());

test('CSV parser: quotes, doubled quotes, newlines inside quotes, CRLF, BOM, blank lines; unclosed quote is an error', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n\r\n"l1\nl2",z'), [['a', 'b'], ['x,1', 'he said "hi"'], ['l1\nl2', 'z']]); assert.throws(() => parseCsv('a,b\n"open'), /not closed/);
});
test('severity mapping: scanner wording, ZAP "Medium (High)", numeric levels, CVSS only when no wording, unknown is refused', () => {
  const m = mapSeverity; assert.deepEqual(['Critical', 'HIGH', 'Medium (High)', 'Moderate', 'Low', 'Informational', 'None', 'Info'].map(s => m(s)), ['critical', 'high', 'medium', 'medium', 'low', 'observation', 'observation', 'observation']);
  assert.deepEqual([m('', '9.8'), m('', '7.0'), m(null, '4'), m('', '0.1'), m('', '0'), m('', '11'), m('bogus', '9.9'), m('', null)], ['critical', 'high', 'medium', 'low', 'observation', null, null, null]);
});
test('parseImport: header aliases, description built from the facts, bad rows reported with their row number, size and row limits, JSON shapes', () => {
  const p: any = parseImport('csv', NESSUS); assert.equal(p.ok, true); assert.equal(p.total, 3); assert.equal(p.errors.length, 0); const d = p.drafts[0];
  assert.deepEqual([d.title, d.severity, d.host, d.port, d.cve, d.cvss, d.pluginId, d.recommendation, d.itemRef], ['TLS 1.0 enabled', 'critical', '10.0.0.5', '443', 'CVE-2024-0001', '9.3', '12345', 'Disable TLS 1.0', null]);
  assert.match(d.description, /Server accepts TLS 1\.0,\nwhich is insecure\.\n\nAffected: 10\.0\.0\.5:443\nCVE: CVE-2024-0001\nCVSS: 9\.3\nScanner ID: 12345/); assert.equal(p.drafts[2].severity, 'observation'); assert.ok(!p.drafts[2].description.includes(':0'), 'port 0 is not shown'); assert.equal(p.drafts[2].recommendation, null);
  const bad: any = parseImport('csv', 'Title,Severity\nok,high\n,high\nx,weird\ny,\n'); assert.deepEqual(bad.errors, [{ row: 2, message: 'Missing title' }, { row: 3, message: 'Unknown severity "weird"' }, { row: 4, message: 'Missing severity' }]); assert.equal(bad.drafts.length, 1);
  for (const [fmt, txt, re] of [['csv', '', /empty/], ['csv', 'Title,Severity\n', /no rows/], ['csv', 'Foo,Bar\n1,2', /No title column/], ['json', '{oops', /not valid JSON/], ['json', '{"a":1}', /list of findings/], ['json', '[1]', /must be an object/], ['json', '[]', /no findings/]] as const) assert.match((parseImport(fmt, txt) as any).message, re);
  assert.match((parseImport('csv', 'Title,Severity\n' + 'a,low\n'.repeat(MAX_ROWS + 1)) as any).message, /limit is 500/); assert.match((parseImport('csv', 'Title,Severity\n' + 'x'.repeat(2 * 1024 * 1024)) as any).message, /2 MB/);
  const j: any = parseImport('json', JSON.stringify({ findings: [{ name: 'SQLi', risk: 'High', item: 'X-1', url: 'https://a/b', solution: 'Parameterise' }] })); assert.equal(j.drafts[0].itemRef, 'X-1'); assert.equal(j.drafts[0].host, 'https://a/b'); assert.equal(parseImport('json', JSON.stringify([{ title: 't', severity: 'low' }])).ok, true);
});
test('import key: same finding in the same place matches regardless of case; a different host, port or item does not', () => {
  const b = { title: 'TLS 1.0', host: '10.0.0.5', port: '443', cve: null, pluginId: '1' }; assert.equal(importKey(b, 'i1'), importKey({ ...b, title: ' tls 1.0 ', host: '10.0.0.5' }, 'i1')); for (const o of [{ host: '10.0.0.6' }, { port: '444' }, { pluginId: '2' }]) assert.notEqual(importKey(b, 'i1'), importKey({ ...b, ...o }, 'i1')); assert.notEqual(importKey(b, 'i1'), importKey(b, 'i2'));
});
test('who may import: auditor on the engagement and managing staff; not client admins, vendors, an auditor not on it, or another organization; closed engagements refuse the commit', async () => {
  const body = { content: NESSUS, defaultItemRef: 'X-1' }; for (const c of [aAdmin, vendor]) assert.equal((await imp(c, body)).status, 403); assert.equal((await imp(bAdmin, body)).status, 404); assert.equal((await imp(env.client(), body)).status, 401); assert.equal((await imp(other, body)).status, 404, 'auditor not on the engagement');
  assert.equal((await imp(auditor, body)).status, 200); assert.equal((await imp(team, body)).status, 200); assert.equal((await imp(team, { ...body, commit: true }, CLOSED)).status, 409); assert.equal((await imp(team, body, CLOSED)).status, 200, 'preview of a closed engagement is harmless');
  assert.equal((await aAdmin.call('GET', url(`/engagements/${E}/findings/imports`))).status, 403); assert.equal((await team.call('GET', url(`/engagements/${E}/findings/imports`))).status, 200);
});
test('preview writes nothing and explains every row: new, invalid (no item, unknown item, not applicable) and counts by severity', async () => {
  const before = (await rows('SELECT COUNT(*) n FROM findings'))[0].n; let r = (await imp(team, { content: NESSUS })).body; assert.equal(r.committed, false); assert.equal(r.invalid, 3); assert.match(r.rows[0].message, /No checklist item/);
  r = (await imp(team, { content: NESSUS, defaultItemRef: 'NOPE-9' })).body; assert.match(r.rows[0].message, /Unknown checklist item "NOPE-9"/);
  const it = (await team.call('GET', url(`/engagements/${E}/checklist`))).body.items; const na = it.find((i: any) => i.ref === 'X-3'); await team.call('PATCH', url(`/checklist/${na.id}`), { readiness: 'not_applicable', naJustification: 'Out of scope for this test' });
  r = (await imp(team, { content: NESSUS, defaultItemRef: 'X-3' })).body; assert.match(r.rows[0].message, /X-3 is not applicable/); assert.equal(r.willCreate, 0);
  r = (await imp(team, { content: NESSUS, defaultItemRef: 'x-1' })).body; assert.deepEqual([r.total, r.willCreate, r.duplicates, r.invalid], [3, 3, 0, 0]); assert.deepEqual(r.bySeverity, { critical: 1, medium: 1, observation: 1 }); assert.deepEqual(r.rows.map((x: any) => [x.row, x.status, x.itemRef]), [[1, 'new', 'X-1'], [2, 'new', 'X-1'], [3, 'new', 'X-1']]);
  assert.equal((await rows('SELECT COUNT(*) n FROM findings'))[0].n, before); assert.equal((await rows('SELECT COUNT(*) n FROM finding_imports'))[0].n, 0);
});
test('commit: findings are created in file order with the next numbers, linked to the item, raised by the importer, with an event, an audit entry and an import record; invalid rows block unless skipped', async () => {
  const mixed = NESSUS + '12348,,,Weird,10.0.0.9,tcp,80,Odd finding,x,x,x\n12349,,,High,10.0.0.9,tcp,80,Item column,x,x,x\n'.replace('Item column', 'Mapped by column');
  let r = await imp(auditor, { content: mixed, defaultItemRef: 'X-1', commit: true }); assert.equal(r.status, 409); assert.equal(r.body.code, 'invalid_rows'); assert.equal((await rows('SELECT COUNT(*) n FROM findings'))[0].n, 0, 'nothing written on refusal');
  r = await imp(auditor, { content: mixed, defaultItemRef: 'X-1', commit: true, skipInvalid: true }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.deepEqual([r.body.committed, r.body.willCreate, r.body.invalid], [true, 4, 1]);
  const f = await rows("SELECT f.finding_no n, f.title, f.severity, f.status, f.raised_by rb, f.import_id iid, i.ref, f.recommendation FROM findings f JOIN checklist_items i ON i.id=f.item_id ORDER BY f.finding_no"); assert.deepEqual(f.map((x: any) => [x.n, x.title, x.severity, x.status, x.ref]), [[1, 'TLS 1.0 enabled', 'critical', 'open', 'X-1'], [2, 'SSH weak ciphers', 'medium', 'open', 'X-1'], [3, 'Banner disclosure', 'observation', 'open', 'X-1'], [4, 'Mapped by column', 'high', 'open', 'X-1']]);
  assert.ok(f.every((x: any) => x.rb === w.ids.aAuditor && x.iid === r.body.importId)); const ev = await rows("SELECT note FROM finding_events WHERE kind='raised' ORDER BY created_at, id"); assert.equal(ev.length, 4); assert.ok(ev.some((e: any) => e.note === 'Imported from scan.csv (row 1)'));
  const au = await rows("SELECT detail FROM audit_events WHERE action='finding.imported'"); assert.equal(au.length, 1); const dt = typeof au[0].detail === 'string' ? JSON.parse(au[0].detail) : au[0].detail; assert.equal(dt.created, 4); assert.equal(dt.invalid, 1); assert.match(dt.sha256, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(dt).includes('10.0.0.5'), 'audit holds counts, not the scan');
  const list = (await team.call('GET', url(`/engagements/${E}/findings/imports`))).body.imports; assert.equal(list.length, 1); assert.deepEqual([list[0].created, list[0].invalid, list[0].importedBy], [4, 1, list[0].importedBy]); assert.ok(list[0].importedBy);
  const seen = (await auditor.call('GET', url(`/engagements/${E}/findings`))).body; assert.equal((seen.findings ?? seen).length, 4); for (const x of (seen.findings ?? seen)) assert.equal(x.blocking, ['critical', 'high', 'medium'].includes(x.severity), 'imported medium-and-above findings block like any other');
});
test('re-importing the same file creates nothing (duplicates), also within one file; the same finding on another item or host is new; new numbers continue from the last', async () => {
  let r = await imp(team, { content: NESSUS, defaultItemRef: 'X-1' }); assert.deepEqual([r.body.willCreate, r.body.duplicates], [0, 3]); assert.equal(r.body.rows[0].status, 'duplicate'); r = await imp(team, { content: NESSUS, defaultItemRef: 'X-1', commit: true }); assert.equal(r.status, 409); assert.equal(r.body.code, 'nothing_to_import');
  r = await imp(team, { content: NESSUS, defaultItemRef: 'X-2', commit: true }); assert.equal(r.status, 201); assert.equal(r.body.willCreate, 3); assert.equal((await rows('SELECT MAX(finding_no) n FROM findings WHERE engagement_id=?', [E]))[0].n, 7);
  const twice = 'Title,Severity,Host\nDup,low,h1\nDup,low,h1\nDup,low,h2\n'; r = await imp(team, { content: twice, defaultItemRef: 'X-1', commit: true }); assert.deepEqual([r.body.willCreate, r.body.duplicates], [2, 1]);
  r = await imp(team, { content: twice, defaultItemRef: 'X-1', commit: true }, E2); assert.equal(r.status, 201, 'a different engagement has its own findings'); assert.equal((await rows('SELECT COUNT(*) n FROM finding_imports'))[0].n, 4);
  await assert.rejects(env.pool.query("INSERT INTO findings(tenant_id,id,engagement_id,item_id,finding_no,title,description,severity,raised_by,import_key) SELECT tenant_id,UUID(),engagement_id,item_id,99,'x','x','low',raised_by,import_key FROM findings WHERE import_key IS NOT NULL LIMIT 1"), /duplicate/i);
});
test('imported findings behave like any other: the owner can be assigned, status moves, identity and import records cannot be altered', async () => {
  const f = (await rows("SELECT id, import_id iid FROM findings WHERE title='TLS 1.0 enabled' AND engagement_id=?", [E]))[0]; assert.equal((await team.call('PATCH', url(`/findings/${f.id}`), { ownerUserId: w.ids.aVendor, dueDate: '2030-01-01' })).status, 200);
  await assert.rejects(env.pool.query("UPDATE findings SET import_id=NULL WHERE id=?", [f.id]), /immutable/); await assert.rejects(env.pool.query("UPDATE findings SET import_key='x' WHERE id=?", [f.id]), /immutable/);
  await assert.rejects(env.pool.query('UPDATE finding_imports SET total_rows=1'), /append-only/); await assert.rejects(env.pool.query('DELETE FROM finding_imports'), /append-only/);
  await assert.rejects(env.pool.query("INSERT INTO finding_imports(tenant_id,id,engagement_id,source_name,format,sha256,total_rows,created_count,duplicate_count,invalid_count,imported_by) VALUES (?,UUID(),?,'x','csv',REPEAT('a',64),1,2,0,0,?)", [w.A, E, w.ids.team]), /check|constraint/i);
});
test('JSON import and the per-user rate limit', async () => {
  const json = JSON.stringify({ findings: [{ title: 'Open redirect', severity: 'low', item: 'X-2', asset: 'app.example.com' }] }); let r = await imp(team, { format: 'json', filename: 'r.json', content: json, commit: true }, E2); assert.equal(r.status, 201); assert.equal((await rows("SELECT COUNT(*) n FROM findings WHERE title='Open redirect'"))[0].n, 1);
  assert.equal((await imp(team, { content: 'x' })).status, 400); assert.equal((await imp(team, { format: 'xml', content: 'x' })).status, 400); let last = 200; for (let i = 0; i < 70 && last !== 429; i++) last = (await imp(team, { content: NESSUS, defaultItemRef: 'X-1' })).status; assert.equal(last, 429);
});
