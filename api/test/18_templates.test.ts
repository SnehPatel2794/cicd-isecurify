import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mpf, PDF, sha } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let root: any, team: any, aAdmin: any, loner: any; let E: string, item: string;
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const up = (c: any, name: string, buf: Buffer, fields: Record<string, string> = { name: 'Template' }) => { const m = mpf(name, buf, fields); return c.call('POST', '/templates', m.payload, m.headers); };
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, evidence: { scannerEnabled: false, maxFileBytes: 1024 * 1024 } } as any); w = await world(env); fx = await frameworkFixtures(w.root); root = w.root;
  await env.mkUser('loner@x.test', 'none'); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); loner = await env.login('loner@x.test');
  E = (await aAdmin.call('POST', `/t/${w.A}/engagements`, { name: 'T', primaryReleaseId: fx.X.releaseId })).body.id; item = ((await aAdmin.call('GET', `/t/${w.A}/engagements/${E}/checklist`)).body.items[0]).id;
}); after(() => env.close());

test('who may upload, edit, retire: platform users upload/edit, only admin-level retire, clients and outsiders never', async () => {
  assert.equal((await up(aAdmin, 'a.pdf', PDF())).status, 403); assert.equal((await up(loner, 'a.pdf', PDF())).status, 403);
  const f = PDF('t1'); const r = await up(team, 'ISMS policy template.pdf', f, { name: 'ISMS policy', category: 'Policies', versionLabel: 'v1', description: 'Blank policy', frameworkId: fx.X.id }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.sha256, sha(f));
  const id = r.body.id; assert.equal((await team.call('PATCH', `/templates/${id}`, { description: 'Updated' })).status, 200); assert.equal((await aAdmin.call('PATCH', `/templates/${id}`, { description: 'x' })).status, 403);
  assert.equal((await team.call('POST', `/templates/${id}/retire`)).status, 403, 'isecurify_team is not admin-level'); assert.equal((await rows("SELECT description d FROM evidence_templates WHERE id=?", [id]))[0].d, 'Updated');
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action IN ('template.uploaded','template.updated')"))[0].n, 2);
});
test('readers: organization members and platform users can list and download; an account without any organization cannot; bytes and headers are exact', async () => {
  const l = await aAdmin.call('GET', '/templates'); assert.equal(l.status, 200); assert.equal(l.body.length, 1); const t = l.body[0]; assert.equal(t.category, 'Policies'); assert.equal(t.frameworkName != null, true); assert.equal(t.storageKey, undefined);
  assert.equal((await loner.call('GET', '/templates')).status, 403); assert.equal((await loner.call('GET', `/templates/${t.id}/download`)).status, 403);
  const d = await aAdmin.call('GET', `/templates/${t.id}/download`); assert.equal(d.status, 200); assert.equal(sha(Buffer.from(d.body)), t.sha256); assert.equal(d.headers['content-type'], 'application/octet-stream'); assert.equal(d.headers['x-content-type-options'], 'nosniff'); assert.equal(d.headers['x-evidence-sha256'], t.sha256); assert.match(String(d.headers['content-disposition']), /^attachment/);
  assert.equal((await aAdmin.call('GET', '/templates/00000000-0000-4000-8000-000000000000/download')).status, 404);
});
test('upload policy: type allow-list, disguised content, executables, empty and oversize files are refused; nothing is stored or recorded', async () => {
  const before = (await rows('SELECT COUNT(*) n FROM evidence_templates'))[0].n;
  assert.equal((await up(team, 'a.exe', Buffer.from('MZ\x90\x00'))).status, 415); assert.equal((await up(team, 'a.pdf', Buffer.from('not a pdf at all'))).status, 415); assert.equal((await up(team, 'a.txt', Buffer.from('#!/bin/sh\necho'))).status, 415);
  assert.equal((await up(team, 'a.pdf', Buffer.alloc(0))).status >= 400, true); assert.equal((await up(team, 'big.pdf', Buffer.concat([PDF(), Buffer.alloc(1024 * 1024 + 10)]))).status, 413);
  assert.equal((await up(team, 'a.pdf', PDF(), { name: '   ' })).status, 400); assert.equal((await up(team, 'a.pdf', PDF(), { name: 'x', frameworkId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  assert.equal((await rows('SELECT COUNT(*) n FROM evidence_templates'))[0].n, before);
});
test('replace: the old version is retired and the new one listed; retired templates are hidden from clients, visible to staff, and still downloadable', async () => {
  const old = (await aAdmin.call('GET', '/templates')).body[0]; const n = await up(team, 'v2.pdf', PDF('v2'), { name: 'ISMS policy', category: 'Policies', versionLabel: 'v2', replacesId: old.id }); assert.equal(n.status, 201);
  const l = (await aAdmin.call('GET', '/templates')).body; assert.deepEqual(l.map((x: any) => x.id), [n.body.id]); assert.equal(l[0].replacesId, old.id);
  assert.equal((await aAdmin.call('GET', '/templates?includeRetired=true')).body.length, 1, 'clients cannot list retired'); const sl = (await team.call('GET', '/templates?includeRetired=true')).body; assert.equal(sl.length, 2); assert.equal(sl.find((x: any) => x.id === old.id).active, 0);
  assert.equal((await aAdmin.call('GET', `/templates/${old.id}/download`)).status, 200, 'requests that use a retired template can still fetch it');
  assert.equal((await up(team, 'v3.pdf', PDF('v3'), { name: 'x', replacesId: old.id })).status, 400, 'cannot replace a retired template');
  assert.equal((await root.call('POST', `/templates/${old.id}/retire`)).status, 409, 'retiring twice'); assert.equal((await root.call('POST', `/templates/${n.body.id}/retire`)).status, 200);
  assert.equal((await aAdmin.call('GET', '/templates')).body.length, 0);
});
test('requests can point to an active template only; the request shows the template file so the web can download and verify it', async () => {
  const t = await up(team, 'form.pdf', PDF('form'), { name: 'Access form', category: 'Forms' }); const tid = t.body.id;
  assert.equal((await aAdmin.call('POST', `/t/${w.A}/checklist/${item}/evidence-requests`, { title: 'Bad', templateId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  const r = await aAdmin.call('POST', `/t/${w.A}/checklist/${item}/evidence-requests`, { title: 'Fill the form', templateId: tid }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = await aAdmin.call('GET', `/t/${w.A}/evidence-requests/${r.body.id}`); assert.equal(g.body.templateName, 'Access form'); assert.equal(g.body.templateFileName, 'form.pdf'); assert.equal(g.body.templateSha256, sha(PDF('form')));
  await root.call('POST', `/templates/${tid}/retire`); assert.equal((await aAdmin.call('POST', `/t/${w.A}/checklist/${item}/evidence-requests`, { title: 'Late', templateId: tid })).status, 400, 'retired templates are not offered for new requests');
  assert.equal((await aAdmin.call('GET', `/templates/${tid}/download`)).status, 200);
});
test('template rows and files are immutable at the database: no delete, no file-fact changes (raw SQL)', async () => {
  const id = (await rows('SELECT id FROM evidence_templates LIMIT 1'))[0].id;
  await assert.rejects(() => env.pool.query('DELETE FROM evidence_templates WHERE id=?', [id]), /never deleted/); await assert.rejects(() => env.pool.query("UPDATE evidence_templates SET sha256=? WHERE id=?", ['f'.repeat(64), id]), /immutable/);
  await assert.rejects(() => env.pool.query("UPDATE evidence_templates SET file_name='x.pdf' WHERE id=?", [id]), /immutable/);
});
