import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, newFramework, frameworkFixtures } from './helpers';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, aAdmin: any, bAdmin: any;
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const mk = (c: any, t: string, name: string, rels: string[], extra: any = {}) => c.call('POST', `/t/${t}/engagements`, { name, primaryReleaseId: rels[0], additionalReleaseIds: rels.slice(1), ...extra });
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); fx = await frameworkFixtures(w.root); team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin');
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true });
}); after(() => env.close());

test('single-framework engagement: items, SOA, 5 phases, default milestones, links and primary framework', async () => {
  const r = await mk(aAdmin, w.A, 'Single X', [fx.X.releaseId]); assert.equal(r.status, 201); assert.equal(r.body.applied[0].created, 3); assert.equal(r.body.applied[0].merged, 0); assert.equal(r.body.milestones, 14);
  const e = (await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}`)).body; assert.equal(e.currentPhase, 1); assert.deepEqual(e.phases.map((p: any) => `${p.name}:${p.status}`), ['Preparation:in_progress', 'Scheduling:not_started', 'Audit Meeting:not_started', 'Follow-up:not_started', 'Closure:not_started']);
  assert.deepEqual(e.frameworks.map((f: any) => [f.name, f.isPrimary]), [['Fixture X', true]]); assert.equal(e.summary.total, 3);
  const cl = (await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}/checklist`)).body.items; assert.equal(cl.length, 3); assert.ok(cl.every((i: any) => i.state === 'not_assessed' && i.satisfies.length === 1 && i.readiness === 'not_started' && i.evidence === 'not_requested'));
  assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}/soa`)).body.summary.total, 3);
  assert.equal(e.members.length, 0);   // a client admin created it: no iSecurify lead assigned automatically
});
test('creator who is iSecurify staff becomes the lead automatically', async () => {
  const r = await mk(team, w.A, 'Staff-created', [fx.X.releaseId]); assert.equal(r.status, 201); const e = (await team.call('GET', `/t/${w.A}/engagements/${r.body.id}`)).body; assert.deepEqual(e.members.map((m: any) => [m.userId, m.role]), [[w.ids.team, 'lead']]);
});
test('overlap preview predicts exactly what creation does', async () => {
  const p = (await aAdmin.call('GET', `/t/${w.A}/engagements/overlap-preview?releaseIds=${fx.X.releaseId},${fx.Y.releaseId}`)).body;
  assert.deepEqual([p.totalControls, p.distinctItems, p.duplicatesAvoided], [6, 4, 2]); assert.deepEqual(p.shared.map((s: any) => s.title), ['Backup and recovery', 'Multi-factor authentication']); assert.deepEqual(p.shared[0].frameworks, { 'Fixture X': ['X-2'], 'Fixture Y': ['Y-2'] });
  const r = await mk(aAdmin, w.A, 'Multi X+Y', [fx.X.releaseId, fx.Y.releaseId]); assert.equal(r.status, 201);
  assert.deepEqual(r.body.applied.map((a: any) => [a.frameworkName, a.created, a.merged]), [['Fixture X', 3, 0], ['Fixture Y', 1, 2]]); assert.deepEqual(r.body.summary, { frameworksApplied: 2, totalCreated: 4, totalMerged: 2, sharedEvidenceItems: 2 });
  const items = (await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}/checklist`)).body.items; assert.equal(items.length, p.distinctItems);
  const mfaItem = items.find((i: any) => i.commonControlTitle === 'Multi-factor authentication'); assert.deepEqual(mfaItem.satisfies.map((s: any) => `${s.frameworkName}:${s.ref}`), ['Fixture X:X-1', 'Fixture Y:Y-1']); assert.equal(items.filter((i: any) => i.satisfies.length > 1).length, 2);
  assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}/soa`)).body.summary.total, 6);                                    // SOA still lists every control of every framework
  const list = (await aAdmin.call('GET', `/t/${w.A}/engagements`)).body.find((e: any) => e.name === 'Multi X+Y'); assert.deepEqual(list.frameworks.map((f: any) => f.name), ['Fixture X', 'Fixture Y']); assert.equal(list.frameworks[0].isPrimary, true);
  (w as any).multi = r.body.id;
});
test('two controls of one framework that share a common control collapse into one item', async () => {
  const Z = await newFramework(w.root, 'Fixture Z', [{ ref: 'Z-1', domain: 'd', title: 'Policy A' }, { ref: 'Z-2', domain: 'd', title: 'Policy B' }, { ref: 'Z-3', domain: 'd', title: 'Other' }]);
  for (const c of (await w.root.call('GET', `/releases/${Z.releaseId}/controls`)).body.filter((c: any) => c.ref !== 'Z-3')) await w.root.call('PUT', `/controls/${c.id}/mapping`, { commonControlId: fx.cc.policy }); await w.root.call('POST', `/releases/${Z.releaseId}/publish`);
  const r = await mk(aAdmin, w.A, 'Z only', [Z.releaseId]); assert.deepEqual([r.body.applied[0].created, r.body.applied[0].merged], [2, 1]);
});
test('validation: unpublished, archived, duplicated, unknown releases; same-framework twice; duplicate name', async () => {
  const draft = await newFramework(w.root, 'Draft only', [{ ref: 'D-1', domain: 'd', title: 't' }]); assert.equal((await mk(aAdmin, w.A, 'bad1', [draft.releaseId])).status, 400);
  const arch = await newFramework(w.root, 'To archive', [{ ref: 'A-1', domain: 'd', title: 't' }], true); await w.root.call('PATCH', `/frameworks/${arch.id}`, { archived: true }); assert.equal((await mk(aAdmin, w.A, 'bad2', [arch.releaseId])).status, 400);
  assert.equal((await mk(aAdmin, w.A, 'bad3', [fx.X.releaseId, fx.X.releaseId])).status, 400); assert.equal((await mk(aAdmin, w.A, 'bad4', ['00000000-0000-4000-8000-000000000000'])).status, 400);
  const v2 = (await w.root.call('POST', `/releases/${fx.X.releaseId}/new-draft`)).body.id; await w.root.call('POST', `/releases/${v2}/publish`); assert.equal((await mk(aAdmin, w.A, 'bad5', [fx.X.releaseId, v2])).status, 400);   // two releases of one framework
  assert.equal((await mk(aAdmin, w.A, 'Single X', [fx.X.releaseId])).status, 409); assert.equal((await aAdmin.call('POST', `/t/${w.A}/engagements`, { name: '', primaryReleaseId: fx.X.releaseId })).status, 400);
  assert.equal((await aAdmin.call('POST', `/t/${w.A}/engagements`, { name: 'dates', primaryReleaseId: fx.X.releaseId, startDate: '2026-13-45' })).status, 400);
  assert.equal((await aAdmin.call('POST', `/t/${w.A}/engagements`, { name: 'dates2', primaryReleaseId: fx.X.releaseId, startDate: '2026-05-01', endDate: '2026-04-01' })).status, 400);
  assert.equal((await mk(aAdmin, w.A, 'tenantId ignored', [fx.Y.releaseId], { tenantId: w.B })).status, 201); assert.equal((await rows('SELECT COUNT(*) n FROM engagements WHERE tenant_id=?', [w.B]))[0].n, 0);
});
test('who may create: client_admin and managing staff only; others 403; platform admin without assignment 404; other tenants 404', async () => {
  for (const who of ['aStaff', 'aVendor', 'aAuditor']) assert.equal((await mk(await w.as(who), w.A, 'x-' + who, [fx.X.releaseId])).status, 403, who);
  assert.equal((await mk(await env.login('admin@x.test'), w.A, 'x-admin', [fx.X.releaseId])).status, 404); assert.equal((await mk(aAdmin, w.B, 'x-cross', [fx.X.releaseId])).status, 404);
  assert.equal((await (await w.as('aStaff')).call('GET', `/t/${w.A}/available-frameworks`)).status, 403);
  const av = (await aAdmin.call('GET', `/t/${w.A}/available-frameworks`)).body; assert.ok(av.some((f: any) => f.name === 'Fixture X' && f.version === 2) && !av.some((f: any) => f.name === 'To archive' || f.name === 'Draft only'));
});
test('HISTORY: later framework releases and mapping edits never rewrite an existing engagement', async () => {
  const e = (w as any).multi; const snap = async () => JSON.stringify([await rows('SELECT id,ref,title,common_control_id FROM checklist_items WHERE tenant_id=? AND engagement_id=? ORDER BY id', [w.A, e]), await rows('SELECT item_id,control_id FROM checklist_item_controls WHERE tenant_id=? AND engagement_id=? ORDER BY item_id,control_id', [w.A, e]), await rows('SELECT release_id,framework_id FROM engagement_frameworks WHERE tenant_id=? AND engagement_id=? ORDER BY framework_id', [w.A, e])]);
  const before = await snap(); const v2 = (await w.root.call('GET', `/frameworks/${fx.X.id}`)).body.releases.find((r: any) => r.version === 2).id; assert.ok(v2);
  const d = (await w.root.call('POST', `/releases/${v2}/new-draft`)).body.id; const ctl = (await w.root.call('GET', `/releases/${d}/controls`)).body.find((c: any) => c.ref === 'X-1'); await w.root.call('PATCH', `/releases/${d}/controls/${ctl.id}`, { title: 'MFA for everyone (v3)' }); await w.root.call('POST', `/releases/${d}/publish`);
  await w.root.call('DELETE', `/controls/${fx.ctl['X-1']}/mapping`); await w.root.call('PUT', `/controls/${fx.ctl['Y-1']}/mapping`, { commonControlId: fx.cc.policy });
  assert.equal(await snap(), before); assert.equal((await rows('SELECT r.version FROM engagement_frameworks ef JOIN framework_releases r ON r.id=ef.release_id WHERE ef.engagement_id=? ORDER BY r.version', [e])).map(r => r.version).join(), '1,1');
  await w.root.call('PUT', `/controls/${fx.ctl['X-1']}/mapping`, { commonControlId: fx.cc.mfa }); await w.root.call('PUT', `/controls/${fx.ctl['Y-1']}/mapping`, { commonControlId: fx.cc.mfa });
});
test('audit path: required when a selected framework template has path-specific milestones; filters milestones; ignored otherwise', async () => {
  const W = await newFramework(w.root, 'Path FW', [{ ref: 'P-1', domain: 'd', title: 't' }], true);
  assert.equal((await w.root.call('PUT', `/process-templates/${W.id}`, { name: 'Path template', milestones: [{ phase: 1, title: 'Kick-off' }, { phase: 2, title: 'Type I fieldwork', pathFilter: ['TYPE1_ONLY', 'TYPE1_THEN_TYPE2'] }, { phase: 3, title: 'Type II observation', pathFilter: ['TYPE2_ONLY', 'TYPE1_THEN_TYPE2'] }, { phase: 4, title: 'Report' }] })).status, 200);
  assert.equal((await mk(aAdmin, w.A, 'Path none', [W.releaseId])).status, 400);
  const t2 = await mk(aAdmin, w.A, 'Path T2', [W.releaseId], { soc2Path: 'TYPE2_ONLY' }); assert.equal(t2.body.milestones, 3); const t1 = await mk(aAdmin, w.A, 'Path T1T2', [W.releaseId], { soc2Path: 'TYPE1_THEN_TYPE2' }); assert.equal(t1.body.milestones, 4);
  const ms = (await aAdmin.call('GET', `/t/${w.A}/engagements/${t2.body.id}/milestones`)).body; assert.deepEqual(ms.map((m: any) => m.title), ['Kick-off', 'Type II observation', 'Report']); assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${t2.body.id}`)).body.soc2Path, 'TYPE2_ONLY');
  const ign = await mk(aAdmin, w.A, 'Path ignored', [fx.Y.releaseId], { soc2Path: 'TYPE1_ONLY' }); assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${ign.body.id}`)).body.soc2Path, null);
  assert.equal((await team.call('PUT', `/process-templates/${W.id}`, { name: 'x', milestones: [{ phase: 1, title: 't' }] })).status, 403);
});
test('add a framework to an existing engagement: merges via common controls; duplicates refused', async () => {
  const r = await mk(aAdmin, w.A, 'Grow', [fx.X.releaseId]); const add = await aAdmin.call('POST', `/t/${w.A}/engagements/${r.body.id}/frameworks`, { releaseId: fx.Y.releaseId }); assert.equal(add.status, 201); assert.deepEqual([add.body.created, add.body.merged], [1, 2]);
  assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${r.body.id}/checklist`)).body.items.length, 4); assert.equal((await aAdmin.call('POST', `/t/${w.A}/engagements/${r.body.id}/frameworks`, { releaseId: fx.Y.releaseId })).status, 409);
  assert.equal((await (await w.as('aStaff')).call('POST', `/t/${w.A}/engagements/${r.body.id}/frameworks`, { releaseId: fx.Y.releaseId })).status, 403);
});
test('DATABASE: composite foreign keys, CHECK rules and unique markers hold even for raw SQL', async () => {
  const e = (w as any).multi; const [item] = await rows('SELECT id FROM checklist_items WHERE tenant_id=? AND engagement_id=? ORDER BY id LIMIT 1', [w.A, e]); const [ctl] = await rows('SELECT id FROM framework_controls WHERE id NOT IN (SELECT control_id FROM checklist_item_controls) ORDER BY id LIMIT 1'); const P = env.pool;   // a control that is NOT yet linked, so only the foreign keys can reject the inserts below
  await assert.rejects(P.query('INSERT INTO checklist_item_controls(tenant_id,engagement_id,item_id,control_id) VALUES (?,?,?,?)', [w.B, e, item.id, ctl.id]), /foreign key/i);
  await assert.rejects(P.query("INSERT INTO checklist_items(tenant_id,id,engagement_id,ref,domain,title) VALUES (?,UUID(),?,'R','d','t')", [w.B, e]), /foreign key/i);
  await assert.rejects(P.query('INSERT INTO soa_entries(tenant_id,engagement_id,control_id) VALUES (?,?,?)', [w.B, e, ctl.id]), /foreign key/i);
  await assert.rejects(P.query("INSERT INTO phase_logs(tenant_id,id,engagement_id,phase,name) VALUES (?,UUID(),?,1,'x')", [w.B, e]), /foreign key/i);
  const other = (await rows('SELECT id FROM engagements WHERE tenant_id=? AND name=?', [w.A, 'Single X']))[0].id;
  await assert.rejects(P.query('INSERT INTO checklist_item_controls(tenant_id,engagement_id,item_id,control_id) VALUES (?,?,?,?)', [w.A, other, item.id, ctl.id]), /foreign key/i);       // link must carry the item's own engagement
  await assert.rejects(P.query('UPDATE soa_entries SET applicable=0, justification=NULL WHERE tenant_id=? AND engagement_id=? LIMIT 1', [w.A, e]), /check constraint|data rule/i);
  await assert.rejects(P.query("UPDATE soa_entries SET applicable=0, justification='   ' WHERE tenant_id=? AND engagement_id=? LIMIT 1", [w.A, e]), /check constraint/i);
  await assert.rejects(P.query("UPDATE checklist_items SET readiness_status='not_applicable' WHERE tenant_id=? AND id=?", [w.A, item.id]), /check constraint/i);
  await assert.rejects(P.query('UPDATE engagements SET current_phase=9 WHERE tenant_id=? AND id=?', [w.A, e]), /check constraint/i);
  const [rel] = await rows("SELECT r.id,r.framework_id FROM framework_releases r WHERE r.status='published' ORDER BY r.id LIMIT 1"); const [other2] = await rows('SELECT id FROM frameworks WHERE id<>? AND id NOT IN (SELECT framework_id FROM engagement_frameworks WHERE engagement_id=?) ORDER BY id LIMIT 1', [rel.framework_id, e]);   // a framework NOT attached to this engagement, so only the composite FK can reject
  await assert.rejects(P.query('INSERT INTO engagement_frameworks(tenant_id,engagement_id,framework_id,release_id,added_by) VALUES (?,?,?,?,?)', [w.A, e, other2.id, rel.id, w.ids.root]), /foreign key/i);     // release must belong to the stated framework
  await assert.rejects(P.query("UPDATE engagement_frameworks SET is_primary=1 WHERE tenant_id=? AND engagement_id=?", [w.A, e]), /Duplicate/i);                                                // only one primary
  await P.query("INSERT INTO engagement_members(tenant_id,engagement_id,user_id,member_role,added_by) VALUES (?,?,?,'lead',?)", [w.A, e, w.ids.team, w.ids.root]);
  await assert.rejects(P.query("INSERT INTO engagement_members(tenant_id,engagement_id,user_id,member_role,added_by) VALUES (?,?,?,'lead',?)", [w.A, e, w.ids.root, w.ids.root]), /Duplicate/i);                // only one lead
  await P.query('DELETE FROM engagement_members WHERE engagement_id=?', [e]);
  await assert.rejects(P.query('DELETE FROM engagements WHERE tenant_id=? AND id=?', [w.A, e]), /foreign key/i);                                                                             // history cannot be deleted
});
test('role-scoped visibility: client admin all; staff/vendor only engagements and items assigned to them; auditor only as member; other tenants never', async () => {
  const e = (w as any).multi; const items = (await aAdmin.call('GET', `/t/${w.A}/engagements/${e}/checklist`)).body.items; const [i1, i2] = items;
  const staff = await w.as('aStaff'), vendor = await w.as('aVendor'), auditor = await w.as('aAuditor');
  for (const c of [staff, vendor, auditor]) { assert.equal((await c.call('GET', `/t/${w.A}/engagements`)).body.length, 0); assert.equal((await c.call('GET', `/t/${w.A}/engagements/${e}`)).status, 404); assert.equal((await c.call('GET', `/t/${w.A}/engagements/${e}/checklist`)).status, 404); }
  assert.equal((await aAdmin.call('PATCH', `/t/${w.A}/checklist/${i1.id}`, { accountableUserId: w.ids.aStaff })).status, 200); assert.equal((await aAdmin.call('PATCH', `/t/${w.A}/checklist/${i2.id}`, { accountableUserId: w.ids.aVendor })).status, 200);
  const sl = (await staff.call('GET', `/t/${w.A}/engagements/${e}/checklist`)).body.items; assert.deepEqual(sl.map((i: any) => i.id), [i1.id]); assert.deepEqual((await vendor.call('GET', `/t/${w.A}/engagements/${e}/checklist`)).body.items.map((i: any) => i.id), [i2.id]);
  const se = (await staff.call('GET', `/t/${w.A}/engagements`)).body; assert.equal(se.length, 1); assert.equal(se[0].summary.total, 1); assert.equal((await staff.call('GET', `/t/${w.A}/engagements/${e}`)).body.members.length, 0);
  assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements/${e}`)).body.summary.total, 4);
  for (const u of ['soa', 'members', 'milestones', 'discovery', 'activity']) assert.equal((await staff.call('GET', `/t/${w.A}/engagements/${e}/${u}`)).status, 403, u);
  assert.equal((await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true })).status, 201);
  assert.equal((await team.call('PUT', `/t/${w.A}/engagements/${e}/members/${w.ids.aAuditor}`, { role: 'auditor' })).status, 200); assert.equal((await auditor.call('GET', `/t/${w.A}/engagements/${e}/checklist`)).body.items.length, 4); assert.equal((await auditor.call('GET', `/t/${w.A}/engagements`)).body.length, 1);
  assert.equal((await auditor.call('GET', `/t/${w.A}/engagements/${(await rows('SELECT id FROM engagements WHERE tenant_id=? AND name=?', [w.A, 'Single X']))[0].id}`)).status, 404);   // member of one engagement only
  assert.equal((await team.call('GET', `/t/${w.A}/engagements`)).body.length >= 5, true);
  assert.equal((await bAdmin.call('GET', `/t/${w.B}/engagements/${e}`)).status, 404); assert.equal((await bAdmin.call('GET', `/t/${w.A}/engagements`)).status, 404); assert.equal((await bAdmin.call('GET', `/t/${w.B}/engagements/${e}/checklist`)).status, 404);
  assert.equal((await bAdmin.call('PATCH', `/t/${w.B}/checklist/${i1.id}`, { readiness: 'implemented' })).status, 404);
});
test('evaluation integration: states follow the exhaustive rules; checklist, list and dashboard agree', async () => {
  const e = (w as any).multi; const items = () => aAdmin.call('GET', `/t/${w.A}/engagements/${e}/checklist`).then((r: any) => r.body.items as any[]); const [i1, i2, i3] = await items();
  await aAdmin.call('PATCH', `/t/${w.A}/checklist/${i1.id}`, { readiness: 'implemented' }); await aAdmin.call('PATCH', `/t/${w.A}/checklist/${i2.id}`, { readiness: 'implemented' }); await aAdmin.call('PATCH', `/t/${w.A}/checklist/${i3.id}`, { readiness: 'partially_implemented' });
  let s = await items(); assert.equal(s.find(i => i.id === i1.id).state, 'blocked_missing_evidence'); assert.equal(s.find(i => i.id === i3.id).state, 'partially_implemented');
  await env.pool.query("UPDATE checklist_items SET evidence_status='accepted' WHERE tenant_id=? AND id=?", [w.A, i1.id]); await env.pool.query("UPDATE checklist_items SET evidence_status='submitted' WHERE tenant_id=? AND id=?", [w.A, i2.id]);   // simulates the Phase 5 review workflow
  s = await items(); assert.equal(s.find(i => i.id === i1.id).state, 'effective'); assert.equal(s.find(i => i.id === i2.id).state, 'awaiting_review');
  await env.pool.query("UPDATE checklist_items SET evidence_status='accepted' WHERE tenant_id=? AND id=?", [w.A, i3.id]); s = await items(); assert.equal(s.find(i => i.id === i3.id).state, 'partially_implemented');   // accepted file alone never raises a claim
  const detail = (await aAdmin.call('GET', `/t/${w.A}/engagements/${e}`)).body.summary; const dash = (await aAdmin.call('GET', `/t/${w.A}/dashboard`)).body; const row = dash.perEngagement.find((p: any) => p.id === e);
  const byState = (arr: any[]) => arr.reduce((m: any, i: any) => (m[i.state] = (m[i.state] ?? 0) + 1, m), {}); const fromItems = byState(await items());
  for (const k of Object.keys(detail.byState)) assert.equal(detail.byState[k], fromItems[k] ?? 0, k); assert.deepEqual(row.summary, detail); assert.equal(detail.effective, 1); assert.equal(detail.readinessPercent, 25);
  assert.equal(dash.summary.total >= detail.total, true); assert.equal((await aAdmin.call('GET', `/t/${w.A}/engagements`)).body.find((x: any) => x.id === e).summary.effective, 1);
});
