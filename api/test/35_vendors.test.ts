import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world } from './helpers';
import { tierOf, nextReview, addMonths, scoreOf, ratingOf, gapsOf, cleanAnswers, unanswered, statusCheck, submitCheck, decideCheck, startCheck, attention, summarize, reviewOverdue, contractEnding, contractExpired, QUESTIONS, domainScores, type Who, type AnswerMap, CRITICALITY, DATA_ACCESS } from '../src/modules/vendors/rules';
const W = { admin: { via: 'member', role: 'client_admin', manage: false } as Who, auditor: { via: 'member', role: 'tp_auditor', manage: false } as Who, staff: { via: 'member', role: 'client_staff', manage: false } as Who, vendor: { via: 'member', role: 'third_party_vendor', manage: false } as Who, mgr: { via: 'staff', role: 'isecurify_staff', manage: true } as Who, viewer: { via: 'staff', role: 'isecurify_staff', manage: false } as Who };
const T = '2026-10-27'; const all = (a: 'yes' | 'partial' | 'no' | 'na', note = 'n'): AnswerMap => Object.fromEntries(QUESTIONS.map(q => [q.id, { answer: a, note }]));
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let team: any, aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[]; const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const body = (a: 'yes' | 'partial' | 'no' | 'na', note = 'n') => ({ answers: all(a, note) });
const mk = async (c: any, o: any = {}) => c.call('POST', url('/vendors'), { name: 'Acme Hosting', service: 'Hosts our production database', category: 'cloud', criticality: 'critical', dataAccess: 'personal', ...o });
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true });
  team = await env.login('team@x.test'); aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
}); after(() => env.close());

test('pure rules: tier matrix, review months, month arithmetic, overdue and contract dates', () => {
  assert.equal(tierOf('low', 'none'), 'low'); assert.equal(tierOf('low', 'confidential'), 'low'); assert.equal(tierOf('medium', 'internal'), 'medium'); assert.equal(tierOf('high', 'confidential'), 'high'); assert.equal(tierOf('critical', 'personal'), 'critical'); assert.equal(tierOf('critical', 'none'), 'medium'); assert.equal(tierOf('critical', 'regulated'), 'critical');
  const seen = new Set<string>(); for (const c of CRITICALITY) for (const d of DATA_ACCESS) seen.add(tierOf(c, d)); assert.equal(seen.size, 4);
  assert.equal(nextReview('critical', '2026-10-27'), '2027-04-27'); assert.equal(nextReview('high', '2026-10-27'), '2027-10-27'); assert.equal(nextReview('medium', '2026-10-27'), '2028-10-27'); assert.equal(nextReview('low', '2026-10-27'), '2029-10-27');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); assert.equal(addMonths('2026-12-15', 2), '2027-02-15');
  assert.equal(reviewOverdue('active', '2026-10-26', T), true); assert.equal(reviewOverdue('active', T, T), false); assert.equal(reviewOverdue('offboarded', '2020-01-01', T), false); assert.equal(reviewOverdue('active', null, T), false);
  assert.equal(contractEnding('active', '2026-12-26', T), true); assert.equal(contractEnding('active', '2026-12-27', T), false); assert.equal(contractEnding('active', '2026-10-26', T), false); assert.equal(contractExpired('active', '2026-10-26', T), true); assert.equal(contractExpired('offboarded', '2020-01-01', T), false);
});
test('pure rules: scoring, ratings, gaps, answer cleaning', () => {
  assert.equal(QUESTIONS.length, 24); assert.equal(new Set(QUESTIONS.map(q => q.id)).size, 24);
  assert.equal(scoreOf(all('yes')), 100); assert.equal(scoreOf(all('no')), 0); assert.equal(scoreOf(all('partial')), 50); assert.equal(scoreOf(all('na')), 0); assert.equal(scoreOf({}), 0);
  const half = all('yes'); half.gov1 = { answer: 'no' }; const s = scoreOf(half); assert.ok(s < 100 && s > 90, String(s)); const na = all('yes'); na.gov1 = { answer: 'na', note: 'x' }; assert.equal(scoreOf(na), 100, 'not applicable questions drop out of the score');
  assert.deepEqual([0, 59, 60, 79, 80, 100].map(ratingOf), ['poor', 'poor', 'fair', 'fair', 'good', 'good']);
  const g = all('yes'); g.ops4 = { answer: 'no' }; g.gov1 = { answer: 'no' }; g.acc1 = { answer: 'partial' }; const gaps = gapsOf(g); assert.deepEqual(gaps.map(x => x.id), ['gov1', 'ops4', 'acc1']); assert.deepEqual(gaps.map(x => x.severity), ['high', 'medium', 'low']);
  assert.equal(domainScores(all('yes')).every(d => d.score === 100), true); assert.equal(unanswered({ gov1: { answer: 'yes' } }).length, 23);
  const c = cleanAnswers({ gov1: { answer: 'yes', note: '  ok\u0000  ' }, bogus: { answer: 'yes' }, gov2: { answer: 'maybe' }, gov3: 'yes', acc1: { answer: 'no', note: 'x'.repeat(2000) } }); assert.deepEqual(Object.keys(c).sort(), ['acc1', 'gov1']); assert.equal(c.gov1.note, 'ok'); assert.equal(c.acc1.note!.length, 1000); assert.deepEqual(cleanAnswers(null), {});
});
test('pure rules: status changes', () => {
  const v = (o: any = {}) => ({ status: 'onboarding', tier: 'critical', ownerUserId: 'u', contractEnd: null, latestApproved: null, ...o }); const sc = (x: any, to: any, wh = W.admin, note: string | null = null) => statusCheck(x, to, wh, note, T) as any;
  assert.equal(sc(v(), 'active').code, 'needs_assessment'); assert.equal(sc(v({ latestApproved: { decidedOn: T } }), 'active').ok, true); assert.equal(sc(v({ tier: 'medium' }), 'active').ok, true); assert.equal(sc(v({ tier: 'low', ownerUserId: null }), 'active').code, 'needs_owner'); assert.equal(sc(v({ tier: 'low', contractEnd: '2026-10-26' }), 'active').code, 'contract_ended');
  assert.equal(sc(v({ status: 'active' }), 'active').code, 'unchanged'); assert.equal(sc(v({ status: 'active' }), 'onboarding').code, 'bad_transition'); assert.equal(sc(v({ status: 'active' }), 'offboarded', W.admin, 'x').code, 'bad_transition'); assert.equal(sc(v({ status: 'active' }), 'offboarding').code, 'needs_note'); assert.equal(sc(v({ status: 'active' }), 'offboarding', W.admin, 'contract ended').ok, true);
  assert.equal(sc(v({ status: 'offboarding' }), 'offboarded', W.mgr, 'data deleted').ok, true); assert.equal(sc(v({ status: 'offboarded' }), 'active').code, 'bad_transition'); for (const wh of [W.auditor, W.staff, W.vendor, W.viewer]) assert.equal(sc(v({ tier: 'low' }), 'active', wh).code, 'forbidden');
});
test('pure rules: submitting, reviewing, starting, attention, summary', () => {
  const a = (o: any = {}) => ({ status: 'draft', submittedBy: null, answers: all('yes'), ...o }); const sub = (x: any, wh: Who, contact: boolean) => submitCheck(x, wh, contact) as any;
  assert.equal(sub(a(), W.vendor, true).ok, true); assert.equal(sub(a(), W.vendor, false).code, 'forbidden'); assert.equal(sub(a(), W.admin, false).ok, true); assert.equal(sub(a(), W.auditor, false).code, 'forbidden'); assert.equal(sub(a({ status: 'submitted' }), W.admin, false).code, 'not_draft'); assert.equal(sub(a({ answers: {} }), W.admin, false).code, 'incomplete'); assert.equal(sub(a({ answers: all('na', '') }), W.admin, false).code, 'na_needs_note');
  const dc = (x: any, act: any, id: string, wh: Who, note: string | null = null) => decideCheck(x, act, id, wh, note) as any; const s = a({ status: 'submitted', submittedBy: 'v' });
  assert.equal(dc(s, 'approve', 'r', W.auditor).ok, true); assert.equal(dc(s, 'approve', 'v', W.admin).code, 'self_review'); assert.equal(dc(s, 'approve', 'r', W.vendor).code, 'forbidden'); assert.equal(dc(s, 'approve', 'r', W.staff).code, 'forbidden'); assert.equal(dc(s, 'reject', 'r', W.admin).code, 'needs_note'); assert.equal(dc(s, 'return', 'r', W.admin, 'fix 3').ok, true); assert.equal(dc(a(), 'approve', 'r', W.admin).code, 'not_submitted');
  assert.equal((startCheck({ status: 'active' }, W.admin, false) as any).ok, true); assert.equal((startCheck({ status: 'active' }, W.admin, true) as any).code, 'already_open'); assert.equal((startCheck({ status: 'offboarded' }, W.admin, false) as any).code, 'offboarded'); assert.equal((startCheck({ status: 'active' }, W.auditor, false) as any).code, 'forbidden');
  const base = { status: 'active', tier: 'high', ownerUserId: 'u', reviewDate: null, contractEnd: null, openAssessment: null, latest: { status: 'approved', score: 90 } } as any; assert.deepEqual(attention(base, T), []); assert.ok(attention({ ...base, latest: null }, T)[0].includes('No assessment')); assert.ok(attention({ ...base, openAssessment: 'submitted' }, T)[0].includes('waiting for review')); assert.ok(attention({ ...base, reviewDate: '2026-01-01' }, T).join().includes('overdue')); assert.ok(attention({ ...base, latest: { status: 'approved', score: 40 } }, T).join().includes('poor')); assert.deepEqual(attention({ ...base, status: 'offboarded' }, T), []);
  const sm = summarize([{ status: 'active', tier: 'critical', reviewDate: '2026-01-01', contractEnd: null, latestScore: 40, hasApproved: true }, { status: 'onboarding', tier: 'low', reviewDate: null, contractEnd: null, latestScore: null, hasApproved: false }, { status: 'offboarded', tier: 'high', reviewDate: '2020-01-01', contractEnd: null, latestScore: 10, hasApproved: true }], T);
  assert.equal(sm.total, 3); assert.equal(sm.live, 2); assert.equal(sm.byTier.critical, 1); assert.equal(sm.overdue, 1); assert.equal(sm.unassessed, 1); assert.equal(sm.poor, 1); assert.equal(sm.byStatus.offboarded, 1);
});

let V1: string;
test('adding vendors: managers only, numbered, validated, unique names, people checked', async () => {
  for (const c of [staff, vendor, auditor]) assert.equal((await mk(c)).status, 403); assert.equal((await bAdmin.call('POST', url('/vendors'), {})).status, 404); assert.equal((await env.client().call('POST', url('/vendors'), {})).status, 401);
  assert.equal((await mk(aAdmin, { name: ' ' })).status, 400); assert.equal((await mk(aAdmin, { category: 'x' })).status, 400); assert.equal((await mk(aAdmin, { contactEmail: 'nope' })).status, 400); assert.equal((await mk(aAdmin, { contractStart: '2027-01-01', contractEnd: '2026-01-01' })).status, 400);
  assert.equal((await mk(aAdmin, { ownerUserId: w.ids.aVendor })).status, 400, 'owner must be client side'); assert.equal((await mk(aAdmin, { contactUserId: w.ids.aStaff })).status, 400, 'contact must be a vendor user'); assert.equal((await mk(aAdmin, { ownerUserId: w.ids.bAdmin })).status, 400);
  const r = await mk(aAdmin, { ownerUserId: w.ids.aStaff, contactUserId: w.ids.aVendor, contactName: 'Pat', contactEmail: 'Pat@Acme.Test' }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.ref, 'V-001'); V1 = r.body.id;
  assert.equal((await mk(aAdmin)).status, 409); const r2 = await mk(team, { name: 'Other Ltd', criticality: 'low', dataAccess: 'none' }); assert.equal(r2.status, 201); assert.equal(r2.body.ref, 'V-002');
  const d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(d.status, 'onboarding'); assert.equal(d.tier, 'critical'); assert.equal(d.contactEmail, 'pat@acme.test'); assert.equal(d.events.length, 1); assert.ok(d.can.edit);
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='vendor.created'"))[0].n, 2);
});
test('visibility: managers and auditors see all; a vendor contact sees only their own vendor; others are refused; other organizations get 404', async () => {
  assert.equal((await aAdmin.call('GET', url('/vendors'))).body.vendors.length, 2); assert.equal((await auditor.call('GET', url('/vendors'))).body.vendors.length, 2); assert.equal((await team.call('GET', url('/vendors'))).body.vendors.length, 2);
  const mine = await vendor.call('GET', url('/vendors')); assert.equal(mine.status, 200); assert.deepEqual(mine.body.vendors.map((x: any) => x.id), [V1]); assert.equal(mine.body.can.create, false);
  assert.equal((await vendor.call('GET', url(`/vendors/${V1}`))).status, 200); assert.deepEqual((await vendor.call('GET', url(`/vendors/${V1}`))).body.events, [], 'internal history is not shown to the vendor');
  const other = (await aAdmin.call('GET', url('/vendors'))).body.vendors.find((x: any) => x.id !== V1).id; assert.equal((await vendor.call('GET', url(`/vendors/${other}`))).status, 404);
  assert.equal((await staff.call('GET', url('/vendors'))).status, 403); assert.equal((await staff.call('GET', url(`/vendors/${V1}`))).status, 404); assert.equal((await bAdmin.call('GET', url('/vendors'))).status, 404); assert.equal((await bAdmin.call('GET', url(`/vendors/${V1}`))).status, 404); assert.equal((await vendor.call('GET', url('/vendors?status=bogus'))).status, 400);
  assert.equal((await vendor.call('GET', url('/vendors/questionnaire'))).body.questions.length, 24); assert.equal((await staff.call('GET', url('/vendors/questionnaire'))).status, 404);
  assert.equal((await aAdmin.call('GET', url('/vendors?status=active'))).body.vendors.length, 0);
});
test('editing: managers only; contract and people validated; changes are events and audited', async () => {
  for (const c of [staff, vendor, auditor]) assert.equal((await c.call('PATCH', url(`/vendors/${V1}`), { service: 'x' })).status, 403); assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), {})).status, 400); assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { contractStart: '2027-01-01', contractEnd: '2026-01-01' })).status, 400);
  assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { name: 'Other Ltd' })).status, 409); assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { contactUserId: w.ids.aAdmin })).status, 400);
  assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { service: 'Hosts the production database and backups', contractEnd: day(400) })).status, 200); const d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(d.service, 'Hosts the production database and backups'); assert.equal(d.contractEnd, day(400)); assert.equal(d.events.at(-1).kind, 'edited');
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='vendor.updated'"))[0].n, 1); assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { service: 'Hosts the production database and backups' })).status, 200); assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='vendor.updated'"))[0].n, 1, 'no change, no event');
});
let A1: string;
test('assessment: request, answer, submit by the vendor contact; the owner and contact are notified', async () => {
  assert.equal((await staff.call('POST', url(`/vendors/${V1}/assessments`), {})).status, 404); for (const c of [vendor, auditor]) assert.equal((await c.call('POST', url(`/vendors/${V1}/assessments`), {})).status, 403); assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), { dueDate: day(-1) })).status, 400);
  const r = await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), { dueDate: day(14) }); assert.equal(r.status, 201); A1 = r.body.id; assert.equal(r.body.no, 1); assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), {})).status, 409, 'one open assessment at a time');
  assert.equal((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='vendor.assessment_requested' AND user_id=?", [w.ids.aVendor]))[0].n, 1);
  const A = (p = '') => url(`/vendors/${V1}/assessments/${A1}${p}`);
  assert.equal((await vendor.call('POST', A('/submit'))).status, 422, 'nothing answered yet'); assert.equal((await vendor.call('PUT', A('/answers'), { answers: { nope: { answer: 'yes' } } })).status, 400); assert.equal((await vendor.call('PUT', A('/answers'), { answers: { gov1: { answer: 'maybe' } } })).status, 400);
  assert.equal((await staff.call('PUT', A('/answers'), body('yes'))).status, 404); assert.equal((await auditor.call('PUT', A('/answers'), body('yes'))).status, 403);
  assert.equal((await vendor.call('PUT', A('/answers'), { answers: { gov1: { answer: 'yes' } } })).status, 200); const part = (await vendor.call('GET', url(`/vendors/${V1}`))).body.assessments[0]; assert.equal(Object.keys(part.answers).length, 1); assert.equal(part.score, null); assert.equal(part.can.submit, true);
  assert.equal((await vendor.call('POST', A('/submit'))).body.code ?? 'incomplete', 'incomplete'); const na = body('yes'); na.answers.phy1 = { answer: 'na', note: '' } as any; assert.equal((await vendor.call('PUT', A('/answers'), na)).status, 200); assert.equal((await vendor.call('POST', A('/submit'))).status, 422, 'n/a needs an explanation');
  const fill = body('yes'); fill.answers.ops2 = { answer: 'no', note: 'Planned for next quarter' } as any; fill.answers.phy1 = { answer: 'na', note: 'Fully cloud hosted' } as any; assert.equal((await vendor.call('PUT', A('/answers'), fill)).status, 200);
  const s = await vendor.call('POST', A('/submit')); assert.equal(s.status, 200, JSON.stringify(s.body)); assert.ok(s.body.score > 85 && s.body.score < 100); assert.equal(s.body.rating, 'good');
  assert.equal((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='vendor.assessment_submitted' AND user_id=?", [w.ids.aStaff]))[0].n, 1);
  assert.equal((await vendor.call('PUT', A('/answers'), body('no'))).status, 409, 'submitted answers are locked'); assert.equal((await vendor.call('POST', A('/submit'))).status, 409);
  const d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body.assessments[0]; assert.equal(d.status, 'submitted'); assert.equal(d.gaps[0].id, 'ops2'); assert.equal(d.gaps[0].severity, 'high'); assert.ok(d.domains.find((x: any) => x.domain === 'Operations').score < 100); assert.equal(d.can.decide, true);
});
test('review: four eyes, a reason to reject or send back, approval sets the next review date by tier and lets a critical vendor go live', async () => {
  const A = (p = '') => url(`/vendors/${V1}/assessments/${A1}${p}`); const dec = (c: any, action: string, note?: string) => c.call('POST', A('/decision'), { action, note });
  for (const c of [vendor, staff]) assert.ok([403, 404].includes((await dec(c, 'approve')).status)); assert.equal((await dec(aAdmin, 'bogus')).status, 400); assert.equal((await dec(aAdmin, 'reject')).status, 422); assert.equal((await dec(aAdmin, 'return', ' ')).status, 422);
  assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/transition`), { to: 'active' })).body.code, 'needs_assessment'); const back = await dec(aAdmin, 'return', 'Please evidence the penetration test'); assert.equal(back.status, 200);
  let d = (await vendor.call('GET', url(`/vendors/${V1}`))).body.assessments[0]; assert.equal(d.status, 'draft'); assert.equal(d.reviewNote, 'Please evidence the penetration test'); assert.equal(d.score, null); assert.equal(Object.keys(d.answers).length, 24, 'answers survive being sent back');
  assert.equal((await rows("SELECT COUNT(*) n FROM notifications WHERE kind='vendor.assessment_decided' AND user_id=?", [w.ids.aVendor]))[0].n, 1);
  // the manager completes it on the vendor's behalf; then the same manager cannot approve it
  assert.equal((await aAdmin.call('POST', A('/submit'))).status, 200); assert.equal((await dec(aAdmin, 'approve')).status, 403); assert.equal((await dec(aAdmin, 'approve')).body.code, 'self_review');
  const ok = await dec(auditor, 'approve', 'Evidence reviewed'); assert.equal(ok.status, 200); assert.equal(ok.body.reviewDate, addMonths(day(0), 6)); 
  d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(d.reviewDate, ok.body.reviewDate); assert.equal(d.assessments[0].status, 'approved'); assert.equal(d.latestScore, d.assessments[0].score); assert.equal(d.approvedCount, 1); assert.equal(d.assessments[0].reviewedBy, 'aauditor');
  assert.equal((await dec(auditor, 'approve')).status, 409, 'a decided assessment is final'); assert.equal((await vendor.call('PUT', A('/answers'), body('no'))).status, 409);
  assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/transition`), { to: 'active' })).status, 200); assert.equal((await aAdmin.call('GET', url(`/vendors/${V1}`))).body.status, 'active');
});
test('changing criticality after approval recalculates the review date; a rejected assessment can be followed by a new one', async () => {
  const before = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body.reviewDate; assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { criticality: 'medium', dataAccess: 'internal' })).status, 200); const after = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(after.tier, 'medium'); assert.ok(after.reviewDate > before, `${after.reviewDate} > ${before}`);
  const r = await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), {}); assert.equal(r.status, 201); assert.equal(r.body.no, 2); const A = (p: string) => url(`/vendors/${V1}/assessments/${r.body.id}${p}`); assert.equal((await vendor.call('PUT', A('/answers'), body('no'))).status, 200); assert.equal((await vendor.call('POST', A('/submit'))).status, 200);
  assert.equal((await auditor.call('POST', A('/decision'), { action: 'reject', note: 'Unacceptable' })).status, 200); const d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(d.assessments.length, 2); assert.equal(d.assessments[0].status, 'rejected'); assert.equal(d.latestScore, 0); assert.equal(d.latestRating, 'poor'); assert.equal(d.reviewDate, after.reviewDate, 'a rejection does not move the review date');
  assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), {})).status, 201);
});
test('status: offboarding needs a reason, offboarded vendors are frozen, history is kept', async () => {
  const t = (to: string, note?: string) => aAdmin.call('POST', url(`/vendors/${V1}/transition`), { to, note }); assert.equal((await t('offboarding')).status, 422); assert.equal((await t('offboarding', 'Contract ended')).status, 200);
  assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/assessments`), {})).status, 409, 'an assessment is still open'); assert.equal((await t('offboarded', 'Data deleted, confirmed in writing')).status, 200);
  const d = (await aAdmin.call('GET', url(`/vendors/${V1}`))).body; assert.equal(d.status, 'offboarded'); assert.ok(d.offboardedAt); assert.equal(d.can.edit, false); assert.equal((await aAdmin.call('PATCH', url(`/vendors/${V1}`), { service: 'x y z' })).status, 409); assert.equal((await t('active')).status, 409);
  assert.equal((await aAdmin.call('POST', url(`/vendors/${V1}/comments`), { note: 'x' })).status, 409); assert.deepEqual(d.events.filter((e: any) => e.kind === 'status').map((e: any) => e.toStatus), ['active', 'offboarding', 'offboarded']);
  assert.equal((await aAdmin.call('GET', url('/vendors?status=offboarded'))).body.vendors.length, 1);
});
test('comments and the low-tier shortcut: a low vendor can be activated without an assessment once it has an owner', async () => {
  const id = (await aAdmin.call('GET', url('/vendors'))).body.vendors.find((x: any) => x.name === 'Other Ltd').id; assert.equal((await aAdmin.call('POST', url(`/vendors/${id}/transition`), { to: 'active' })).body.code, 'needs_owner');
  assert.equal((await aAdmin.call('PATCH', url(`/vendors/${id}`), { ownerUserId: w.ids.aAdmin })).status, 200); assert.equal((await aAdmin.call('POST', url(`/vendors/${id}/transition`), { to: 'active' })).status, 200);
  assert.equal((await auditor.call('POST', url(`/vendors/${id}/comments`), { note: 'Looks fine' })).status, 201); assert.equal((await vendor.call('POST', url(`/vendors/${id}/comments`), { note: 'x' })).status, 403); assert.equal((await aAdmin.call('POST', url(`/vendors/${id}/comments`), { note: ' ' })).status, 400);
  const list = (await aAdmin.call('GET', url('/vendors'))).body; assert.equal(list.summary.total, 2); assert.equal(list.summary.live, 1); assert.ok(list.vendors.find((x: any) => x.id === id).attention.includes('No assessment has been requested yet'));
});
test('export: CSV and Excel for the people who see the register; formulas are neutralised', async () => {
  await aAdmin.call('PATCH', url(`/vendors/${(await aAdmin.call('GET', url('/vendors?status=active'))).body.vendors[0].id}`), { service: '=HYPERLINK("http://evil","x")' });
  const r = await aAdmin.call('GET', url('/vendors/export')); assert.equal(r.status, 200); assert.match(String(r.headers['content-type']), /csv/); const text = r.raw.toString('utf8'); assert.ok(text.includes('V-001') && text.includes('Acme Hosting')); assert.ok(!/(^|,|")=HYPERLINK/.test(text.replace(/\r?\n/g, '\n')), 'formula must be neutralised'); assert.match(text, /'=HYPERLINK/);
  assert.equal((await aAdmin.call('GET', url('/vendors/export?format=xlsx'))).status, 200); for (const c of [staff, vendor]) assert.equal((await c.call('GET', url('/vendors/export'))).status, 403); assert.equal((await bAdmin.call('GET', url('/vendors/export'))).status, 404); assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='export.vendors'"))[0].n, 2);
});
test('people: an owner or contact of a live vendor blocks account deletion; offboarded vendors do not', async () => {
  const id = (await aAdmin.call('GET', url('/vendors?status=active'))).body.vendors[0].id; assert.ok(id); const { openVendorsFor } = await import('../src/modules/vendors/data'); assert.equal((await openVendorsFor(env.pool as any, w.ids.aAdmin, null)).length, 1); assert.equal((await openVendorsFor(env.pool as any, w.ids.aVendor, null)).length, 0, 'V1 is offboarded');
});
test('database: vendors are never deleted, identity is permanent, decided assessments are frozen, events are append-only, one open assessment per vendor, four eyes', async () => {
  const rej = (sql: string, re: RegExp, p: any[] = []) => assert.rejects(env.pool.query(sql, p), re);
  await rej('DELETE FROM vendors', /never deleted/); await rej("UPDATE vendors SET vendor_no=99 WHERE id=?", /identity/, [V1]); await rej('DELETE FROM vendor_assessments', /never deleted/); await rej("UPDATE vendor_assessments SET score=1 WHERE status='rejected'", /permanent/); await rej("UPDATE vendor_assessments SET assessment_no=9", /permanent|identity/);
  await rej("UPDATE vendor_events SET note='x'", /append-only/); await rej('DELETE FROM vendor_events', /append-only/); await rej("UPDATE vendors SET status='offboarded', offboarded_at=NULL WHERE id=?", /chk_vendor_off|constraint/i, [V1]);
  const open = (await rows("SELECT vendor_id v, tenant_id t FROM vendor_assessments WHERE status IN ('draft','submitted') LIMIT 1"))[0]; assert.ok(open); await rej("INSERT INTO vendor_assessments(tenant_id,id,vendor_id,assessment_no,answers,requested_by) VALUES (?,UUID(),?,50,'{}',?)", /Duplicate|uq_va_open/i, [open.t, open.v, w.ids.aAdmin]);
  await rej("UPDATE vendor_assessments SET status='submitted', score=50, submitted_by=?, submitted_at=NOW(), reviewed_by=? WHERE status='draft'", /constraint|chk_/i, [w.ids.aAdmin, w.ids.aAdmin]);
});
