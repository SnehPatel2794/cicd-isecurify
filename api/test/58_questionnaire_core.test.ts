// Questionnaires, Phase 13A: core (locked) vs optional / industry questions; staff add, edit, remove and restore per engagement; multi-choice answers.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mp } from './helpers'; import { parseQuestionnaire, checkAnswer, parseIndustries } from '../src/modules/questionnaires/rules';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, vendor: any;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
const CSV = Buffer.from(`Ref #,Section,Question,Answer type,Choices,Required,Help text,Core (all clients),Industries
C-1,Scope,Is the company a legal entity?,yes/no,,yes,,yes,
C-2,Scope,Employees in scope?,number,,yes,,core,All
O-1,Hosting,Where is production hosted?,choice,Own DC|Cloud|Hybrid,yes,,no,
M-1,Hosting,Which clouds are used?,choose all,AWS|Azure|GCP,no,,,
B-1,Regulatory,Is the entity regulated by the RBI?,yes/no,,yes,,no,BFSI
H-1,Regulatory,Do you process patient records?,yes/no,,yes,,no,Healthcare | BFSI
`);
let FW = '', E = '', QS: Record<string, any> = {};
const state = async (c: any = team) => { const b = (await c.call('GET', url(`/engagements/${E}/questionnaire`))).body; QS = {}; for (const f of b.frameworks) for (const q of f.questions) QS[q.ref] = q; return b; };
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root); FW = fx.X.id;
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); admin = await w.as('aAdmin'); vendor = await w.as('aVendor'); });
after(() => env.close());

test('1. the sheet: core and industry columns, choose-all type, and every error is explained', async () => {
  const p = await parseQuestionnaire('q.csv', CSV); assert.ok(p.rows.every(r => !r.errors.length), JSON.stringify(p.rows.map(r => r.errors)));
  const by = Object.fromEntries(p.rows.map(r => [r.data.ref, r.data])); assert.equal(by['C-1'].core, true); assert.equal(by['C-2'].core, true); assert.equal(by['O-1'].core, false); assert.equal(by['M-1'].core, false, 'blank = not core');
  assert.equal(by['C-2'].industries, null, '"All" = every industry'); assert.equal(by['B-1'].industries, '|BFSI|'); assert.equal(by['H-1'].industries, '|Healthcare|BFSI|'); assert.equal(by['M-1'].answerType, 'multi_choice');
  const bad = await parseQuestionnaire('q.csv', Buffer.from('Ref,Question,Answer type,Core,Industries,Choices\nA,Q?,text,perhaps,\nB,Q?,text,,Aerospace\nC,Q?,choose all,,,One\n'));
  assert.match(bad.rows[0].errors.join(), /core must be yes or no/); assert.match(bad.rows[1].errors.join(), /industry "Aerospace"/); assert.match(bad.rows[2].errors.join(), /at least two choices/);
  assert.deepEqual(parseIndustries('retail/e-commerce'), { value: '|Retail / E-commerce|' }); assert.deepEqual(checkAnswer({ answerType: 'multi_choice', choices: ['AWS', 'Azure'] }, 'azure | AWS | azure'), { value: 'Azure|AWS' }); assert.ok('error' in checkAnswer({ answerType: 'multi_choice', choices: ['AWS'] }, 'AWS|Oracle'));
});
test('2. upload and publish; an engagement without an industry gets core + untagged questions only', async () => {
  const m = mp('q.csv', CSV); const ok = await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, m.payload, m.headers); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal((await w.root.call('POST', `/questionnaire-versions/${ok.body.id}/publish`)).status, 200);
  E = (await admin.call('POST', url('/engagements'), { name: 'FY27', primaryReleaseId: fx.X.releaseId })).body.id; const s = await state(); assert.deepEqual(Object.keys(QS).sort(), ['C-1', 'C-2', 'M-1', 'O-1']); assert.equal(s.industry, null);
  assert.equal(QS['C-1'].core, true); assert.equal(QS['O-1'].core, false); assert.deepEqual(QS['H-1'], undefined);
  assert.equal((await rows('SELECT COUNT(*) n FROM questionnaire_questions WHERE core=1'))[0].n, 2);
});
test('3. choosing the industry adds its questions, never removes any, and only staff may do it', async () => {
  assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire-industry`), { industry: 'BFSI' })).status, 403); assert.equal((await team.call('PUT', url(`/engagements/${E}/questionnaire-industry`), { industry: 'Aerospace' })).status, 400);
  const a = await team.call('PUT', url(`/engagements/${E}/questionnaire-industry`), { industry: 'BFSI' }); assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.added, 2); await state(); assert.ok(QS['B-1'] && QS['H-1'], 'H-1 is tagged for BFSI as well');
  assert.equal((await team.call('PUT', url(`/engagements/${E}/questionnaire-industry`), { industry: 'BFSI' })).body.added, 0, 'idempotent');
  assert.equal((await team.call('PUT', url(`/engagements/${E}/questionnaire-industry`), { industry: null })).status, 200); await state(); assert.ok(QS['B-1'], 'clearing the industry keeps what was added');
  const s = await state(admin); assert.equal(s.can.edit, false); assert.equal((await admin.call('GET', url(`/engagements/${E}/questionnaire/library`))).status, 403);
  assert.equal((await rows('SELECT industry FROM engagements WHERE id=?', [E]))[0].industry, null);
});
test('4. core questions can be neither changed nor removed: API and database', async () => {
  await state(); const id = QS['C-1'].id;
  assert.equal((await team.call('DELETE', url(`/engagements/${E}/questionnaire/${id}`), { reason: 'not relevant' })).status, 403); assert.equal((await team.call('PATCH', url(`/engagements/${E}/questionnaire/${id}/definition`), { section: 'S', question: 'Changed wording?', required: false })).status, 403);
  await assert.rejects(env.pool.query('UPDATE engagement_questions SET question=? WHERE id=?', ['sneaky', id]), /core questions cannot be changed/); await assert.rejects(env.pool.query('UPDATE engagement_questions SET required=0 WHERE id=?', [id]), /core questions/);
  await assert.rejects(env.pool.query('UPDATE engagement_questions SET removed_at=NOW() WHERE id=?', [id]), /core questions|ck_eq_core|CONSTRAINT/i); await assert.rejects(env.pool.query('DELETE FROM engagement_questions WHERE id=?', [id]), /never deleted/);
  assert.equal((await rows('SELECT question FROM engagement_questions WHERE id=?', [id]))[0].question, 'Is the company a legal entity?');
  assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/${id}/restore`))).status, 409);
});
test('5. other questions: staff edit (audited), remove with a reason, restore; removed ones leave the progress and cannot be answered', async () => {
  await state(); const o = QS['O-1']; const before = (await state()).progress;
  assert.equal((await vendor.call('PATCH', url(`/engagements/${E}/questionnaire/${o.id}/definition`), { section: 'Hosting', question: 'x?', required: true })).status, 403); assert.equal((await admin.call('DELETE', url(`/engagements/${E}/questionnaire/${o.id}`), { reason: 'not needed here' })).status, 403);
  const e = await team.call('PATCH', url(`/engagements/${E}/questionnaire/${o.id}/definition`), { section: 'Hosting', question: 'Where is production hosted today?', required: false, helpText: 'Pick the main one' }); assert.equal(e.status, 200, JSON.stringify(e.body)); await state(); assert.equal(QS['O-1'].question, 'Where is production hosted today?'); assert.equal(QS['O-1'].edited, true); assert.equal(QS['O-1'].required, false);
  assert.equal((await team.call('PATCH', url(`/engagements/${E}/questionnaire/${o.id}/definition`), { section: 'Hosting', question: 'ok?', required: false })).status, 400, 'question text must be 5+ characters');
  assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire/${o.id}`), { answer: 'cloud' })).status, 200);
  assert.equal((await team.call('PATCH', url(`/engagements/${E}/questionnaire/${o.id}/definition`), { section: 'Hosting', question: 'Where is production hosted today?', required: false, choices: ['A', 'B'] })).status, 409, 'choices are fixed once answered');
  assert.equal((await team.call('DELETE', url(`/engagements/${E}/questionnaire/${QS['B-1'].id}`), {})).status, 400, 'a reason is needed');
  assert.equal((await team.call('DELETE', url(`/engagements/${E}/questionnaire/${QS['B-1'].id}`), { reason: 'Not a bank' })).status, 200); const s = await state(); assert.equal(QS['B-1'].removed, true); assert.equal(s.progress.total, before.total - 1);
  assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire/${QS['B-1'].id}`), { answer: 'yes' })).status, 409); assert.equal((await team.call('DELETE', url(`/engagements/${E}/questionnaire/${QS['B-1'].id}`), { reason: 'again please' })).status, 409);
  assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/${QS['B-1'].id}/restore`))).status, 200); assert.equal((await state()).progress.total, before.total);
  const csv = (await team.call('GET', url(`/engagements/${E}/questionnaire.csv`))).body as string; assert.match(csv, /core, required/);
  const acts = (await rows("SELECT action FROM audit_events WHERE action LIKE 'questionnaire.%'")).map(r => r.action); for (const a of ['questionnaire.industry_set', 'questionnaire.question_edited', 'questionnaire.question_removed', 'questionnaire.question_restored']) assert.ok(acts.includes(a), a);
});
test('6. add from the library and add a custom question for this client', async () => {
  await state(); await team.call('DELETE', url(`/engagements/${E}/questionnaire/${QS['M-1'].id}`), { reason: 'client uses no cloud' });
  const lib = (await team.call('GET', url(`/engagements/${E}/questionnaire/library`))).body; assert.deepEqual(lib, [], 'removed questions are restored, not re-added'); assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/${QS['M-1'].id}/restore`))).status, 200);
  const del = await rows('SELECT id FROM engagement_questions WHERE ref=? AND engagement_id=?', ['H-1', E]); assert.equal(del.length, 1);
  const c1 = await team.call('POST', url(`/engagements/${E}/questionnaire/custom`), { frameworkId: FW, section: 'Client specific', question: 'Which customer contract requires this certificate?', answerType: 'text', required: true }); assert.equal(c1.status, 200, JSON.stringify(c1.body)); assert.equal(c1.body.ref, 'CUS-1');
  assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/custom`), { frameworkId: FW, section: 'X', question: 'Pick one please', answerType: 'choice', required: true })).status, 400); assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/custom`), { frameworkId: fx.Y.id, section: 'X', question: 'Not in engagement?', answerType: 'text', required: true })).status, 400);
  assert.equal((await team.call('POST', url(`/engagements/${E}/questionnaire/custom`), { frameworkId: FW, section: 'Client specific', question: 'Which clouds besides these?', answerType: 'multi_choice', choices: ['AWS', 'Azure'], required: false })).body.ref, 'CUS-2');
  assert.equal((await admin.call('POST', url(`/engagements/${E}/questionnaire/custom`), { frameworkId: FW, section: 'X', question: 'Client adds one?', answerType: 'text', required: true })).status, 403);
  await state(); assert.equal(QS['CUS-1'].origin, 'custom'); assert.equal(QS['CUS-1'].core, false);
  assert.equal((await team.call('DELETE', url(`/engagements/${E}/questionnaire/${QS['CUS-1'].id}`), { reason: 'asked by client' })).status, 200);
});
test('7. choose-all answers are checked against the list and stored in a fixed form', async () => {
  await state(); const id = QS['M-1'].id; assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire/${id}`), { answer: 'Oracle' })).status, 400);
  assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire/${id}`), { answer: 'gcp|AWS' })).status, 200); await state(); assert.equal(QS['M-1'].answer, 'GCP|AWS');
});
test('8. a later questionnaire version never changes an engagement that has its copy; the database rejects a core question marked removed at insert', async () => {
  const m = mp('q.csv', Buffer.from('Ref,Question,Answer type,Core\nZ-1,A newer question?,text,yes\n')); const up = await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, m.payload, m.headers); await w.root.call('POST', `/questionnaire-versions/${up.body.id}/publish`);
  await state(); assert.equal(QS['Z-1'], undefined); assert.ok(QS['C-1']);
  await assert.rejects(env.pool.query("INSERT INTO engagement_questions(tenant_id,id,engagement_id,framework_id,ref,section,question,answer_type,required,core,origin,sort_order) VALUES (?,UUID(),?,?,'K-1','S','Q?','text',1,1,'custom',99)", [w.A, E, FW]), /ck_eq_core|CONSTRAINT|constraint/i);
});
test('9. the downloadable templates upload cleanly (header "Choices (separate with |)" is understood) and the two shipped questionnaires have no errors', async () => {
  for (const ext of ['xlsx', 'csv']) { const t = await w.root.call('GET', `/questionnaire-template.${ext}`); assert.equal(t.status, 200); const p = await parseQuestionnaire(`t.${ext}`, Buffer.from(t.raw)); assert.equal(p.rows.length, 6); assert.deepEqual(p.rows.flatMap(r => r.errors), [], ext); assert.deepEqual(p.rows[2].data.choices, ['Own data centre', 'Public cloud', 'Hybrid']); assert.equal(p.rows[0].data.core, true); assert.equal(p.rows[4].data.industries, '|BFSI|Healthcare|'); assert.equal(p.rows[5].data.answerType, 'multi_choice'); }
  const fs = await import('node:fs'); const dir = new URL('../../docs/questionnaires/', import.meta.url);
  for (const [f, min] of [['DPDP_Engagement_Questionnaire.xlsx', 60], ['ISO27001_2022_Engagement_Questionnaire.xlsx', 50]] as const) { const p = await parseQuestionnaire(f, fs.readFileSync(new URL(f, dir))); assert.ok(p.rows.length >= min); assert.deepEqual(p.rows.flatMap(r => r.errors), [], f); assert.ok(p.rows.some(r => r.data.core) && p.rows.some(r => r.data.industries) && p.rows.some(r => r.data.answerType === 'multi_choice')); const refs = p.rows.map(r => r.data.ref); assert.equal(new Set(refs).size, refs.length); }
});
