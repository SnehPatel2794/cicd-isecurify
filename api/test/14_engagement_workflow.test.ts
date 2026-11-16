import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, newFramework } from './helpers'; import { deletionBlockers, manifestProviders } from '../src/modules/users/hooks';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>;
let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any; let E: string, items: any[];
const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const url = (p: string) => `/t/${w.A}${p}`; const mk = async (name: string, rels: string[], c: any = aAdmin) => (await c.call('POST', url('/engagements'), { name, primaryReleaseId: rels[0], additionalReleaseIds: rels.slice(1) })).body.id as string;
const list = async (e = E, c: any = aAdmin) => (await c.call('GET', url(`/engagements/${e}/checklist`))).body.items as any[];
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false }); w = await world(env); fx = await frameworkFixtures(w.root);
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true }); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.root, canManage: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = await mk('Workflow', [fx.X.releaseId, fx.Y.releaseId]); items = await list();
}); after(() => env.close());

test('assignment: only active client/vendor members of THIS organization; valid dates; audited', async () => {
  const i = items[0].id; const p = (b: any) => aAdmin.call('PATCH', url(`/checklist/${i}`), b);
  for (const [who, why] of [[w.ids.bStaff, 'other tenant'], [w.ids.aAuditor, 'auditor role'], [w.ids.team, 'iSecurify staff'], ['00000000-0000-4000-8000-000000000000', 'unknown']] as const) assert.equal((await p({ accountableUserId: who })).status, 400, why);
  await env.pool.query("UPDATE users SET status='disabled' WHERE id=?", [w.ids.aStaff]); assert.equal((await p({ accountableUserId: w.ids.aStaff })).status, 400); await env.pool.query("UPDATE users SET status='active' WHERE id=?", [w.ids.aStaff]);
  assert.equal((await p({ accountableUserId: w.ids.aVendor, dueDate: '2030-01-31' })).status, 200); assert.equal((await p({ dueDate: '31/01/2030' })).status, 400);
  const it = (await list()).find(x => x.id === i); assert.equal(it.accountableUserId, w.ids.aVendor); assert.equal(it.dueDate, '2030-01-31'); assert.equal((await p({ accountableUserId: null })).status, 200);
  assert.equal((await p({ accountableUserId: w.ids.aVendor })).status, 200);
});
test('the accountable person may update ONLY the readiness of their own item', async () => {
  const mine = items[0].id, other = items[1].id; assert.equal((await vendor.call('PATCH', url(`/checklist/${mine}`), { readiness: 'in_progress' })).status, 200);
  for (const b of [{ dueDate: '2031-01-01' }, { accountableUserId: w.ids.aStaff }, { readiness: 'not_applicable', naJustification: 'nope' }, { remarks: 'x' }]) assert.equal((await vendor.call('PATCH', url(`/checklist/${mine}`), b)).status, 403, JSON.stringify(b));
  assert.equal((await vendor.call('PATCH', url(`/checklist/${other}`), { readiness: 'implemented' })).status, 403); assert.equal((await staff.call('PATCH', url(`/checklist/${mine}`), { readiness: 'implemented' })).status, 404);
  assert.equal((await auditor.call('PATCH', url(`/checklist/${mine}`), { readiness: 'implemented' })).status, 404); assert.equal((await vendor.call('PATCH', url(`/checklist/${mine}`), { readiness: 'bogus' })).status, 400);
  assert.equal((await list(E, vendor)).find(i => i.id === mine).readiness, 'in_progress');
});
test('not applicable needs a justification (API and database); leaving N/A clears it', async () => {
  const i = items[2].id; const p = (b: any) => aAdmin.call('PATCH', url(`/checklist/${i}`), b);
  assert.equal((await p({ readiness: 'not_applicable' })).status, 400); assert.equal((await p({ readiness: 'not_applicable', naJustification: '   ' })).status, 400);
  assert.equal((await p({ readiness: 'not_applicable', naJustification: 'We do not process payment data' })).status, 200); let it = (await list()).find(x => x.id === i); assert.equal(it.state, 'not_applicable'); assert.equal(it.naJustification, 'We do not process payment data');
  assert.equal((await p({ readiness: 'in_progress' })).status, 200); it = (await list()).find(x => x.id === i); assert.equal(it.naJustification, null); assert.equal(it.state, 'not_implemented');
});
test('custom checklist items: managers only, validated assignee, shown as custom', async () => {
  const body = { ref: 'CUST-1', domain: 'Client specific', title: 'Provide the signed DPA', accountableUserId: w.ids.aVendor, dueDate: '2030-06-30' };
  assert.equal((await staff.call('POST', url(`/engagements/${E}/checklist`), body)).status, 403); assert.equal((await aAdmin.call('POST', url(`/engagements/${E}/checklist`), { ...body, accountableUserId: w.ids.bStaff })).status, 400);
  assert.equal((await aAdmin.call('POST', url(`/engagements/${E}/checklist`), body)).status, 201); const c = (await list()).find(i => i.ref === 'CUST-1'); assert.equal(c.origin, 'custom'); assert.equal(c.satisfies.length, 0); assert.equal(c.state, 'not_assessed');
});
test('SOA: justification mandatory; admins/managers edit, auditors read only; all-controls-N/A makes the item not applicable', async () => {
  const soa = (await aAdmin.call('GET', url(`/engagements/${E}/soa`))).body; assert.equal(soa.summary.total, 6); const x1 = fx.ctl['X-1'], y1 = fx.ctl['Y-1'];
  await team.call('PUT', url(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); assert.equal((await auditor.call('GET', url(`/engagements/${E}/soa`))).status, 200); assert.equal((await auditor.call('PATCH', url(`/engagements/${E}/soa/${x1}`), { applicable: false, justification: 'x' })).status, 403);
  assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${x1}`), { applicable: false })).status, 400); assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${x1}`), { applicable: false, justification: '  ' })).status, 400);
  assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${x1}`), { applicable: false, justification: 'No remote access in scope' })).status, 200);
  const mfa = () => list().then(l => l.find(i => i.commonControlTitle === 'Multi-factor authentication')); assert.notEqual((await mfa()).state, 'not_applicable');            // only one of the two linked controls is N/A
  assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${y1}`), { applicable: false, justification: 'Same reason' })).status, 200); assert.equal((await mfa()).state, 'not_applicable');
  assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${x1}`), { applicable: true })).status, 200); assert.notEqual((await mfa()).state, 'not_applicable'); assert.equal((await rows('SELECT justification FROM soa_entries WHERE control_id=? AND engagement_id=?', [x1, E]))[0].justification, null);
  await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${y1}`), { applicable: true }); assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/${fx.ctl['Y-3']}x`), { applicable: true })).status, 404);
  assert.equal((await aAdmin.call('PATCH', url(`/engagements/${E}/soa/00000000-0000-4000-8000-000000000000`), { applicable: false, justification: 'x' })).status, 404);
});
test('team: lead transfer, only assigned iSecurify staff as lead/team, only TP auditors as auditors, staff-manager only', async () => {
  const m = (u: string, role: string, c: any = team) => c.call('PUT', url(`/engagements/${E}/members/${u}`), { role });
  assert.equal((await m(w.ids.team, 'lead')).status, 200); assert.equal((await m(w.ids.root, 'lead')).status, 200); let t = (await aAdmin.call('GET', url(`/engagements/${E}/members`))).body; assert.deepEqual(t.filter((x: any) => x.role === 'lead').map((x: any) => x.userId), [w.ids.root]); assert.equal(t.find((x: any) => x.userId === w.ids.team).role, 'team');
  assert.equal((await m(w.ids.aVendor, 'team')).status, 400); assert.equal((await m(w.ids.admin, 'team')).status, 400); assert.equal((await m(w.ids.aVendor, 'auditor')).status, 400); assert.equal((await m(w.ids.bAdmin, 'auditor')).status, 400);
  assert.equal((await m(w.ids.team, 'team', aAdmin)).status, 403); assert.equal((await m(w.ids.team, 'team', staff)).status, 403); assert.equal((await aAdmin.call('DELETE', url(`/engagements/${E}/members/${w.ids.team}`))).status, 403);
  assert.equal((await team.call('DELETE', url(`/engagements/${E}/members/${w.ids.team}`))).status, 200); assert.equal((await team.call('DELETE', url(`/engagements/${E}/members/${w.ids.team}`))).status, 404);
  assert.equal((await team.call('GET', url(`/engagements/${E}/assignees`))).body.some((u: any) => u.role === 'tp_auditor' || u.id === w.ids.team), false); await m(w.ids.team, 'lead');
});
test('phases: owner must be a member, dates must be ordered, phase number validated; edits audited', async () => {
  const p = (n: number, b: any) => aAdmin.call('PATCH', url(`/engagements/${E}/phases/${n}`), b);
  assert.equal((await p(2, { ownerUserId: w.ids.aVendor })).status, 400); assert.equal((await p(2, { startDate: '2026-03-01', endDate: '2026-02-01' })).status, 400); assert.equal((await p(6, { startDate: '2026-03-01' })).status, 400); assert.equal((await p(2, { startDate: 'soon' })).status, 400);
  assert.equal((await p(2, { ownerUserId: w.ids.team, startDate: '2026-02-01', endDate: '2026-03-01' })).status, 200); const ph = (await aAdmin.call('GET', url(`/engagements/${E}`))).body.phases[1]; assert.deepEqual([ph.ownerName, ph.startDate, ph.endDate], ['team', '2026-02-01', '2026-03-01']);
  assert.equal((await staff.call('PATCH', url(`/engagements/${E}/phases/2`), { startDate: '2026-02-02' })).status, 403); assert.equal((await p(2, { startDate: '2026-04-01' })).status, 400);   // end (03-01) would precede new start
});
test('advance phase: staff managers only, one step at a time, never past the last phase; close only from the last phase', async () => {
  const adv = (c: any, body: any = { acknowledge: true, note: 'Reviewed and accepted for this test' }) => c.call('POST', url(`/engagements/${E}/advance-phase`), body); assert.equal((await adv(aAdmin)).status, 403); assert.equal((await adv(staff)).status, 403);
  const r = await adv(team); assert.equal(r.status, 200); assert.deepEqual([r.body.currentPhase, r.body.phaseName], [2, 'Scheduling']);
  const ph = (await aAdmin.call('GET', url(`/engagements/${E}`))).body.phases; assert.deepEqual(ph.map((x: any) => x.status), ['complete', 'in_progress', 'not_started', 'not_started', 'not_started']); assert.ok(ph[0].completedAt && ph[0].endDate && ph[1].startDate === '2026-02-01');
  assert.equal((await team.call('POST', url(`/engagements/${E}/close`))).status, 409); assert.equal((await adv(await env.login('root@x.test'))).status, 200);   // admin-level staff assignment may advance too
  await adv(team); await adv(team); assert.equal((await aAdmin.call('GET', url(`/engagements/${E}`))).body.currentPhase, 5); const last = await adv(team); assert.equal(last.status, 409); assert.equal(last.body.code, 'final_phase');
  assert.equal((await aAdmin.call('POST', url(`/engagements/${E}/close`))).status, 403);
});
test('milestones: list for managers/auditors, status completes with a timestamp, due dates, scoped', async () => {
  const ms = (await aAdmin.call('GET', url(`/engagements/${E}/milestones`))).body; assert.equal(ms.length, 14); assert.deepEqual([...new Set(ms.map((m: any) => m.phase))], [1, 2, 3, 4, 5]); assert.equal((await vendor.call('GET', url(`/engagements/${E}/milestones`))).status, 403);
  const id = ms[0].id; assert.equal((await aAdmin.call('PATCH', url(`/milestones/${id}`), { status: 'complete', dueDate: '2026-01-15' })).status, 200); let m = (await aAdmin.call('GET', url(`/engagements/${E}/milestones`))).body[0]; assert.equal(m.status, 'complete'); assert.ok(m.completedAt); assert.equal(m.dueDate, '2026-01-15');
  await aAdmin.call('PATCH', url(`/milestones/${id}`), { status: 'pending' }); m = (await aAdmin.call('GET', url(`/engagements/${E}/milestones`))).body[0]; assert.equal(m.completedAt, null);
  assert.equal((await aAdmin.call('PATCH', url(`/milestones/${id}`), { status: 'done' })).status, 400); assert.equal((await vendor.call('PATCH', url(`/milestones/${id}`), { status: 'complete' })).status, 403); assert.equal((await bAdmin.call('PATCH', `/t/${w.B}/milestones/${id}`, { status: 'complete' })).status, 404);
});
test('discovery questionnaire: generic + framework-specific questions, answers upsert, retired questions keep answers', async () => {
  const qs = async (e = E) => (await aAdmin.call('GET', url(`/engagements/${e}/discovery`))).body; assert.equal((await qs()).total, 5);
  const q1 = (await w.root.call('POST', '/discovery-questions', { frameworkId: fx.X.id, domain: 'Scope', question: 'Is card data processed?' })).body.id; assert.equal((await team.call('POST', '/discovery-questions', { domain: 'd', question: 'x' })).status, 403);
  assert.equal((await qs()).total, 6); const Yonly = await mk('Y only', [fx.Y.releaseId]); assert.equal((await qs(Yonly)).total, 5); assert.equal((await aAdmin.call('PUT', url(`/engagements/${Yonly}/discovery/${q1}`), { response: 'No' })).status, 404);
  assert.equal((await aAdmin.call('PUT', url(`/engagements/${E}/discovery/${q1}`), { response: 'Yes, via a gateway', notes: 'see diagram' })).status, 200); await aAdmin.call('PUT', url(`/engagements/${E}/discovery/${q1}`), { response: 'Yes, via a hosted gateway' });
  let a = await qs(); assert.equal(a.answered, 1); assert.equal(a.questions.find((x: any) => x.questionId === q1).response, 'Yes, via a hosted gateway'); assert.equal((await rows('SELECT COUNT(*) n FROM discovery_responses WHERE engagement_id=?', [E]))[0].n, 1);
  await w.root.call('PATCH', `/discovery-questions/${q1}`, { active: false }); a = await qs(); assert.equal(a.total, 6); assert.equal(a.questions.find((x: any) => x.questionId === q1).response, 'Yes, via a hosted gateway');       // answered question stays visible
  const generic = a.questions.find((x: any) => !x.frameworkId && !x.response).questionId; await w.root.call('PATCH', `/discovery-questions/${generic}`, { active: false }); assert.equal((await qs()).total, 5); assert.equal((await staff.call('GET', url(`/engagements/${E}/discovery`))).status, 403);
  assert.equal((await vendor.call('PUT', url(`/engagements/${E}/discovery/${q1}`), { response: 'x' })).status, 403);
});
test('activity feed: this engagement only, managers and auditors, paginated; other roles and tenants refused', async () => {
  const f = (await aAdmin.call('GET', url(`/engagements/${E}/activity?limit=200`))).body; const actions = f.items.map((x: any) => x.action); for (const a of ['engagement.created', 'checklist.item_updated', 'soa.updated', 'phase.advanced', 'engagement.member_set', 'discovery.answered', 'milestone.updated']) assert.ok(actions.includes(a), a);
  assert.ok(f.items.every((x: any) => x.entity === 'engagement' && x.entity_id === E && x.tenant_id === w.A));
  const seen: number[] = []; let b: number | null = null; do { const r: any = (await auditor.call('GET', url(`/engagements/${E}/activity?limit=4${b ? '&beforeId=' + b : ''}`))).body; seen.push(...r.items.map((x: any) => x.id)); b = r.nextBeforeId; } while (b); assert.deepEqual(seen, f.items.map((x: any) => x.id));
  assert.equal((await vendor.call('GET', url(`/engagements/${E}/activity`))).status, 403); assert.equal((await bAdmin.call('GET', `/t/${w.B}/engagements/${E}/activity`)).status, 404);
});
test('dashboard: numbers come from the evaluation service, scoped by role, overdue counted correctly, closed engagements excluded', async () => {
  const E2 = await mk('Dash 2', [fx.X.releaseId]); const l2 = await list(E2); const [a, b2, c] = l2; const p = (id: string, body: any) => aAdmin.call('PATCH', url(`/checklist/${id}`), body);
  await p(a.id, { dueDate: '2020-01-01' }); await p(b2.id, { dueDate: '2020-01-01', readiness: 'implemented' }); await p(c.id, { dueDate: '2099-01-01' }); await env.pool.query("UPDATE checklist_items SET evidence_status='accepted' WHERE tenant_id=? AND id=?", [w.A, b2.id]);
  let d = (await aAdmin.call('GET', url('/dashboard'))).body; const e2 = d.perEngagement.find((x: any) => x.id === E2).summary; assert.equal(e2.overdue, 1); assert.equal(e2.effective, 1); assert.equal(e2.total, 3); assert.equal(e2.readinessPercent, 33.3);
  const sum = Object.values(d.summary.byState).reduce((x: any, y: any) => x + y, 0); assert.equal(sum, d.summary.total); assert.equal(d.scope, 'all');
  await p(a.id, { accountableUserId: w.ids.aVendor }); const vd = (await vendor.call('GET', url('/dashboard'))).body; assert.equal(vd.scope, 'assigned'); assert.ok(vd.summary.total >= 1 && vd.summary.total < d.summary.total); assert.equal(vd.perEngagement.every((x: any) => x.summary.total >= 1), true);
  assert.equal((await staff.call('GET', url('/dashboard'))).body.perEngagement.length, 0); assert.equal((await bAdmin.call('GET', `/t/${w.B}/dashboard`)).body.engagements.total, 0);
  const before = d.engagements.active; assert.equal((await team.call('POST', url(`/engagements/${E}/close`))).body.code, 'close_blocked', 'closing needs the sign-off'); const wv = await (await w.as('aAuditor')).call('POST', url(`/engagements/${E}/signoff`), { opinion: 'qualified', note: 'Exceptions noted: see the findings register for this engagement' }); assert.equal(wv.status, 201, JSON.stringify(wv.body)); assert.equal((await team.call('POST', url(`/engagements/${E}/close`))).status, 200); d = (await aAdmin.call('GET', url('/dashboard'))).body; assert.equal(d.engagements.active, before - 1); assert.equal(d.engagements.closed, 1);
});
test('a closed engagement is read-only everywhere', async () => {
  const ci = items[0].id; const closed = (c: any, m: string, u: string, b?: any) => c.call(m, url(u), b).then((r: any) => [r.status, r.body.code]);
  for (const [c, m, u, b] of [[aAdmin, 'PATCH', `/checklist/${ci}`, { readiness: 'implemented' }], [aAdmin, 'POST', `/engagements/${E}/checklist`, { ref: 'Z', domain: 'd', title: 't' }], [aAdmin, 'PATCH', `/engagements/${E}/soa/${fx.ctl['X-1']}`, { applicable: true }], [aAdmin, 'POST', `/engagements/${E}/frameworks`, { releaseId: fx.Y.releaseId }],
    [team, 'PUT', `/engagements/${E}/members/${w.ids.team}`, { role: 'team' }], [aAdmin, 'PATCH', `/engagements/${E}/phases/1`, { startDate: '2026-01-01' }], [aAdmin, 'PATCH', `/engagements/${E}`, { name: 'Renamed' }], [team, 'POST', `/engagements/${E}/advance-phase`], [team, 'POST', `/engagements/${E}/close`]] as const)
    assert.deepEqual(await closed(c, m, u, b), [409, m === 'POST' && u.endsWith('advance-phase') ? 'engagement_closed' : 'engagement_closed'], `${m} ${u}`);
  assert.equal((await aAdmin.call('GET', url(`/engagements/${E}/checklist`))).status, 200); assert.equal((await aAdmin.call('GET', url('/engagements'))).body.find((e: any) => e.id === E).status, 'closed');
});
test('open work blocks removing or deleting a person; N/A, accepted and closed-engagement items do not', async () => {
  const E3 = await mk('Blockers', [fx.Y.releaseId]); const l = await list(E3); const [i1, i2, i3] = l; for (const i of l) await aAdmin.call('PATCH', url(`/checklist/${i.id}`), { accountableUserId: w.ids.aStaff });
  const del = () => aAdmin.call('DELETE', url(`/members/${w.ids.aStaff}`)); let r = await del(); assert.equal(r.status, 409); assert.equal(r.body.code, 'has_open_items');
  const s = (await w.root.call('GET', `/platform/users/${w.ids.aStaff}/deletion-summary`)).body; assert.equal(s.canDelete, false); assert.equal(s.blockers.length, 3); assert.match(s.blockers[0].label, /Blockers: Y-/);
  assert.equal((await w.root.call('POST', `/platform/users/${w.ids.aStaff}/delete`, { withoutBackup: true, confirmEmail: 'astaff@c.test' })).body.code, 'has_open_items');
  await aAdmin.call('PATCH', url(`/checklist/${i1.id}`), { readiness: 'not_applicable', naJustification: 'n/a' }); await env.pool.query("UPDATE checklist_items SET evidence_status='accepted' WHERE tenant_id=? AND id=?", [w.A, i2.id]); r = await del(); assert.equal(r.status, 409);   // i3 still open
  await aAdmin.call('PATCH', url(`/checklist/${i3.id}`), { accountableUserId: w.ids.aVendor }); assert.equal((await w.root.call('GET', `/platform/users/${w.ids.aStaff}/deletion-summary`)).body.blockers.filter((b: any) => /Blockers/.test(b.label)).length, 0);
  const res = await env.app.inject({ method: 'GET', url: `/platform/users/${w.ids.aVendor}/backup`, headers: { cookie: w.root.cookie } }); assert.equal(res.statusCode, 200); assert.equal(res.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const sec = await manifestProviders[0](env.pool, w.ids.aVendor); assert.equal(sec.title, 'Assigned checklist items'); assert.ok(sec.rows.length >= 1); assert.equal(deletionBlockers.length >= 1, true);
});
test('process templates and discovery questions: platform users read, admin-level write, defaults seeded', async () => {
  const t = (await team.call('GET', '/process-templates')).body; assert.equal(t.find((x: any) => x.frameworkId === null).milestones.length, 14); assert.equal((await aAdmin.call('GET', '/process-templates')).status, 403);
  assert.equal((await team.call('PUT', '/process-templates/default', { name: 'x', milestones: [{ phase: 1, title: 'y' }] })).status, 403); assert.equal((await w.root.call('PUT', '/process-templates/default', { name: 'Generic audit engagement', milestones: [{ phase: 1, title: 'Only one' }, { phase: 5, title: 'Done' }] })).status, 200);
  const E4 = await mk('After template change', [fx.Y.releaseId]); assert.equal((await aAdmin.call('GET', url(`/engagements/${E4}/milestones`))).body.length, 2); assert.equal((await aAdmin.call('GET', url(`/engagements/${E}/milestones`))).body.length, 14);   // old engagements keep their copy
  assert.equal((await w.root.call('PUT', '/process-templates/default', { name: 'x', milestones: [{ phase: 9, title: 'bad' }] })).status, 400); assert.equal((await w.root.call('PUT', `/process-templates/00000000-0000-4000-8000-000000000000`, { name: 'x', milestones: [{ phase: 1, title: 't' }] })).status, 404);
});
test('IDOR sweep: ids from tenant A are unreachable through tenant B in every Phase 4 route', async () => {
  const item = items[0].id, ms = (await aAdmin.call('GET', url(`/engagements/${E}/milestones`))).body[0].id; const q = (await aAdmin.call('GET', url(`/engagements/${E}/discovery`))).body.questions[0].questionId;
  const B = (p: string) => `/t/${w.B}${p}`; const calls: [string, string, any?][] = [['GET', B(`/engagements/${E}`)], ['GET', B(`/engagements/${E}/checklist`)], ['PATCH', B(`/checklist/${item}`), { readiness: 'implemented' }], ['PATCH', B(`/milestones/${ms}`), { status: 'complete' }], ['GET', B(`/engagements/${E}/soa`)],
    ['PATCH', B(`/engagements/${E}/soa/${fx.ctl['X-1']}`), { applicable: true }], ['GET', B(`/engagements/${E}/members`)], ['PUT', B(`/engagements/${E}/members/${w.ids.team}`), { role: 'team' }], ['POST', B(`/engagements/${E}/advance-phase`)], ['PATCH', B(`/engagements/${E}/phases/1`), { startDate: '2026-01-01' }],
    ['PUT', B(`/engagements/${E}/discovery/${q}`), { response: 'x' }], ['POST', B(`/engagements/${E}/checklist`), { ref: 'a', domain: 'b', title: 'c' }], ['POST', B(`/engagements/${E}/frameworks`), { releaseId: fx.Y.releaseId }], ['PATCH', B(`/engagements/${E}`), { name: 'hijack' }]];
  const staffOnly = (u: string, m: string) => (m === 'PUT' && u.includes('/members/')) || u.endsWith('/advance-phase');
  for (const [m, u, b] of calls) assert.equal((await bAdmin.call(m, u, b)).status, staffOnly(u, m) ? 403 : 404, `${m} ${u}`);        // role gate first (same answer for real and fake ids), otherwise 404
  await w.root.call('POST', `/platform/organizations/${w.B}/staff`, { userId: w.ids.team, canManage: true });                              // a REAL iSecurify manager of tenant B still cannot reach tenant A's records
  for (const [m, u, b] of calls) assert.equal((await team.call(m, u, b)).status, 404, `team ${m} ${u}`);
  await w.root.call('DELETE', `/platform/organizations/${w.B}/staff/${w.ids.team}`);
  assert.equal((await rows('SELECT name FROM engagements WHERE tenant_id=? AND id=?', [w.A, E]))[0].name, 'Workflow');
});
test('team candidates: only for staff managers; lists assigned staff and this organization\'s auditors', async () => {
  const c = (await team.call('GET', url('/team-candidates'))).body; assert.ok(c.staff.some((s: any) => s.id === w.ids.team) && c.staff.some((s: any) => s.id === w.ids.root)); assert.deepEqual(c.auditors.map((a: any) => a.id), [w.ids.aAuditor]);
  assert.equal((await aAdmin.call('GET', url('/team-candidates'))).status, 403); assert.equal((await bAdmin.call('GET', `/t/${w.A}/team-candidates`)).status, 404);
});
