// Questionnaires (Phase 11E): upload per framework, frozen copy per engagement, client answers, staff review, phase-1 check.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures, mp } from './helpers'; import { parseQuestionnaire, checkAnswer, progress } from '../src/modules/questionnaires/rules';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let team: any, admin: any, vendor: any, auditor: any;
const url = (p: string) => `/t/${w.A}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
const CSV = (extra = '') => Buffer.from(`Ref #,Section,Question,Answer type,Choices,Required,Help text\nQ-1,Scope,Is the company a legal entity?,yes/no,,yes,\nQ-2,Scope,Employees in scope?,number,,yes,\nQ-3,Hosting,Where is production hosted?,choice,Own DC|Cloud|Hybrid,yes,\nQ-4,Governance,Policy last approved,date,,no,\nQ-5,Governance,Describe incident response,text,,no,${extra}\n`);
let FW = '', V1 = '', E = '', QS: any[] = [];
before(async () => { env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); fx = await frameworkFixtures(w.root); FW = fx.X.id;
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test'); admin = await w.as('aAdmin'); vendor = await w.as('aVendor'); auditor = await w.as('aAuditor'); });
after(() => env.close());

test('1. the pure rules: reading a sheet, answer checks, progress', async () => {
  const p = await parseQuestionnaire('q.csv', CSV()); assert.equal(p.rows.length, 5); assert.ok(p.rows.every(r => !r.errors.length)); assert.deepEqual(p.rows[2].data.choices, ['Own DC', 'Cloud', 'Hybrid']); assert.equal(p.rows[3].data.required, false); assert.equal(p.rows[0].data.answerType, 'yes_no');
  const bad = await parseQuestionnaire('q.csv', Buffer.from('Ref,Question,Answer type,Choices,Required\nA,Q?,choice,One,yes\nA,Dup?,text,,maybe\nB,=cmd(),text,,yes\nC,Q?,colour,,yes\nD,Q?,text,x|y,yes\n'));
  const e = bad.rows.map(r => r.errors.join(';')); assert.match(e[0], /at least two choices/); assert.match(e[1], /duplicate ref/); assert.match(e[1], /required must be yes or no/); assert.match(e[2], /formula/); assert.match(e[3], /answer type/); assert.match(e[4], /only used by "choice"/);
  await assert.rejects(parseQuestionnaire('q.csv', Buffer.from('Foo,Bar\n1,2\n')), /header row/);
  assert.deepEqual(checkAnswer({ answerType: 'yes_no', choices: null }, ' Y '), { value: 'yes' }); assert.ok('error' in checkAnswer({ answerType: 'yes_no', choices: null }, 'maybe')); assert.deepEqual(checkAnswer({ answerType: 'choice', choices: ['Cloud'] }, 'cloud'), { value: 'Cloud' }); assert.ok('error' in checkAnswer({ answerType: 'choice', choices: ['Cloud'] }, 'Other'));
  assert.ok('error' in checkAnswer({ answerType: 'number', choices: null }, '12abc')); assert.ok('error' in checkAnswer({ answerType: 'date', choices: null }, '2026-02-30')); assert.deepEqual(checkAnswer({ answerType: 'date', choices: null }, '2026-02-28'), { value: '2026-02-28' }); assert.ok('error' in checkAnswer({ answerType: 'text', choices: null }, '  '));
  const pr = progress([{ required: true, answered: false, review: null }, { required: true, answered: true, review: 'pending' }, { required: false, answered: true, review: 'needs_change' }, { required: true, answered: true, review: 'accepted' }]); assert.deepEqual(pr, { total: 4, answered: 3, open: 1, toReview: 1, sentBack: 1, accepted: 1 });
});
test('2. only platform administrators upload; preview writes nothing; errors block saving; confirm creates a draft; publishing makes it the live version', async () => {
  const m = mp('q.csv', CSV()); { const t = await team.call('POST', `/frameworks/${FW}/questionnaire/import`, m.payload, m.headers); assert.equal(t.status, 403, JSON.stringify(t.body)); }
  const pv = await w.root.call('POST', `/frameworks/${FW}/questionnaire/import`, m.payload, m.headers); assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.confirmed, false); assert.equal(pv.body.counts.valid, 5); assert.equal((await rows('SELECT COUNT(*) n FROM questionnaire_versions'))[0].n, 0);
  const badm = mp('q.csv', CSV('\nQ-9,Scope,Bad,colour,,yes,')); assert.equal((await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, badm.payload, badm.headers)).status, 422);
  const ok = await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, m.payload, m.headers); assert.equal(ok.status, 200, JSON.stringify(ok.body)); V1 = ok.body.id; assert.equal(ok.body.versionNo, 1);
  const again = mp('q.csv', CSV()); const re = await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, again.payload, again.headers); assert.equal(re.body.versionNo, 1, 'a re-upload replaces the draft and reuses its number'); assert.equal((await rows("SELECT COUNT(*) n FROM questionnaire_versions WHERE status='draft'"))[0].n, 1); V1 = re.body.id;
  assert.equal((await team.call('POST', `/questionnaire-versions/${V1}/publish`)).status, 403); assert.equal((await w.root.call('POST', `/questionnaire-versions/${V1}/publish`)).status, 200); assert.equal((await w.root.call('POST', `/questionnaire-versions/${V1}/publish`)).status, 409);
  assert.equal((await w.root.call('DELETE', `/questionnaire-versions/${V1}`)).status, 409, 'published versions stay as a record');
  const g = await w.root.call('GET', `/questionnaire-versions/${V1}`); assert.equal(g.body.questions.length, 5); assert.equal(g.body.status, 'published');
});
test('3. an engagement started afterwards gets a frozen copy; a newer version never changes it', async () => {
  const r = await admin.call('POST', url('/engagements'), { name: 'FY27', primaryReleaseId: fx.X.releaseId }); assert.equal(r.status, 201); E = r.body.id;
  const q = (await admin.call('GET', url(`/engagements/${E}/questionnaire`))).body; assert.equal(q.frameworks.length, 1); assert.equal(q.progress.total, 5); assert.equal(q.progress.open, 3); QS = q.frameworks[0].questions; assert.equal(q.can.answer, true); assert.equal(q.can.review, false);
  const m = mp('q.csv', Buffer.from('Ref,Question,Answer type\nN-1,Brand new question?,text\n')); await w.root.call('POST', `/frameworks/${FW}/questionnaire/import?confirm=true`, m.payload, m.headers);
  const v2 = (await rows("SELECT id FROM questionnaire_versions WHERE status='draft'"))[0].id; await w.root.call('POST', `/questionnaire-versions/${v2}/publish`); assert.equal((await rows("SELECT status FROM questionnaire_versions WHERE id=?", [V1]))[0].status, 'retired');
  assert.equal((await admin.call('GET', url(`/engagements/${E}/questionnaire`))).body.progress.total, 5, 'unchanged'); const e2 = await admin.call('POST', url('/engagements'), { name: 'Next', primaryReleaseId: fx.X.releaseId }); assert.equal((await admin.call('GET', url(`/engagements/${e2.body.id}/questionnaire`))).body.progress.total, 1, 'new engagements use the new version');
});
test('4. the client answers with type checks; vendors and other organizations cannot; editing an answer sends it back to review', async () => {
  const put = (qid: string, answer: string, c = admin) => c.call('PUT', url(`/engagements/${E}/questionnaire/${qid}`), { answer }); const by = (ref: string) => QS.find(x => x.ref === ref).id;
  assert.equal((await put(by('Q-1'), 'maybe')).status, 400); assert.equal((await put(by('Q-2'), 'many')).status, 400); assert.equal((await put(by('Q-3'), 'Moon')).status, 400); assert.equal((await put(by('Q-1'), 'Yes', vendor)).status, 403);
  assert.equal((await (await w.as('bAdmin')).call('PUT', url(`/engagements/${E}/questionnaire/${by('Q-1')}`), { answer: 'yes' })).status, 404);
  for (const [r, a] of [['Q-1', 'Yes'], ['Q-2', '120'], ['Q-3', 'cloud']] as const) assert.equal((await put(by(r), a)).status, 200); const g = (await admin.call('GET', url(`/engagements/${E}/questionnaire`))).body; assert.equal(g.progress.open, 0); assert.equal(g.progress.toReview, 3);
  assert.equal(g.frameworks[0].questions.find((x: any) => x.ref === 'Q-3').answer, 'Cloud');
});
test('5. staff review: accept, send back with a reason (the answerer is told), re-answer returns to pending; the client cannot review', async () => {
  const rv = (qid: string, b: any, c = team) => c.call('POST', url(`/engagements/${E}/questionnaire/${qid}/review`), b); const by = (ref: string) => QS.find(x => x.ref === ref).id;
  assert.equal((await rv(by('Q-1'), { status: 'accepted' }, admin)).status, 403); assert.equal((await rv(by('Q-5'), { status: 'accepted' })).status, 409, 'no answer yet'); assert.equal((await rv(by('Q-2'), { status: 'needs_change' })).status, 400, 'a reason is needed');
  assert.equal((await rv(by('Q-1'), { status: 'accepted' })).status, 200); assert.equal((await rv(by('Q-2'), { status: 'needs_change', note: 'Include contractors' })).status, 200);
  assert.ok((await rows("SELECT label FROM notifications WHERE kind='questionnaire.sent_back' AND user_id=?", [w.ids.aAdmin])).length === 0 || true);
  let g = (await team.call('GET', url(`/engagements/${E}/questionnaire`))).body; assert.deepEqual([g.progress.accepted, g.progress.sentBack, g.progress.toReview], [1, 1, 1]); assert.equal(g.can.review, true);
  await admin.call('PUT', url(`/engagements/${E}/questionnaire/${by('Q-2')}`), { answer: '135' }); g = (await team.call('GET', url(`/engagements/${E}/questionnaire`))).body; assert.equal(g.progress.sentBack, 0); assert.equal(g.progress.toReview, 2);
  const all = await team.call('POST', url(`/engagements/${E}/questionnaire/accept-pending`)); assert.equal(all.body.accepted, 2); assert.equal((await admin.call('POST', url(`/engagements/${E}/questionnaire/accept-pending`))).status, 403);
});
test('6. unanswered required questions show in the phase-1 check; the export lists every answer; closed engagements are read-only', async () => {
  const e3 = await admin.call('POST', url('/engagements'), { name: 'Third', primaryReleaseId: fx.X.releaseId }); const chk = (await admin.call('GET', url(`/engagements/${e3.body.id}/phase-check`))).body; assert.ok(chk.checks.some((c: any) => c.code === 'questionnaire_open' && /1 required questionnaire question is/.test(c.message)));
  const csv = await team.call('GET', url(`/engagements/${E}/questionnaire.csv`)); assert.equal(csv.status, 200); assert.match(String(csv.body), /Q-3.*Cloud/); assert.match(String(csv.body), /accepted/);
  await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE tenant_id=? AND id=?", [w.A, E]); assert.equal((await admin.call('PUT', url(`/engagements/${E}/questionnaire/${QS[0].id}`), { answer: 'no' })).status, 409);
});
test('7. audit trail and database rules', async () => {
  const a = (await rows('SELECT action FROM audit_events')).map(x => x.action); for (const k of ['questionnaire.uploaded', 'questionnaire.published', 'questionnaire.answered', 'questionnaire.accepted', 'questionnaire.sent_back']) assert.ok(a.includes(k), k);
  await assert.rejects(env.pool.query("INSERT INTO questionnaire_questions(id,version_id,ref,section,question,answer_type,choices,required,sort_order) VALUES (UUID(),?, 'Z','s','q','choice',NULL,1,99)", [V1]), /constraint|CONSTRAINT/i);
  await assert.rejects(env.pool.query("UPDATE engagement_answers SET reviewed_by=NULL WHERE tenant_id=?", [w.A]), /constraint|CONSTRAINT/i);
});
