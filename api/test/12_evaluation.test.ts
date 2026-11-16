import { test } from 'node:test'; import assert from 'node:assert/strict';
import { evaluateItem, summarize, mergeSummaries, isOverdue, READINESS, EVIDENCE, STATES, type Readiness, type EvidenceStatus, type EvalState } from '../src/modules/engagements/evaluation';

// Exhaustive expectation table, written independently of the implementation's switch statement.
const expected = (r: Readiness, e: EvidenceStatus, expired: boolean, allNA: boolean): EvalState => {
  if (r === 'not_applicable' || allNA) return 'not_applicable';
  if (r === 'not_started') return 'not_assessed'; if (r === 'in_progress') return 'not_implemented'; if (r === 'partially_implemented') return 'partially_implemented';
  if (e === 'accepted') return expired ? 'blocked_missing_evidence' : 'effective'; if (e === 'submitted') return 'awaiting_review'; if (e === 'rejected') return 'ineffective';
  if (e === 'in_progress') return 'implemented_pending_validation'; return 'blocked_missing_evidence';
};
test('EXHAUSTIVE: every combination of readiness x evidence x expiry x SOA-N/A gives the specified state', () => {
  let n = 0; for (const r of READINESS) for (const e of EVIDENCE) for (const x of [false, true]) for (const na of [false, true]) { assert.equal(evaluateItem({ readiness: r, evidence: e, evidenceExpired: x, allControlsNotApplicable: na }), expected(r, e, x, na), `${r}/${e}/exp=${x}/na=${na}`); n++; }
  assert.equal(n, 5 * 6 * 2 * 2);
});
test('an uploaded or accepted file never makes a control effective unless it is claimed implemented', () => {
  for (const e of EVIDENCE) for (const r of ['not_started', 'in_progress', 'partially_implemented'] as const) assert.notEqual(evaluateItem({ readiness: r, evidence: e }), 'effective', `${r}/${e}`);
  assert.equal(evaluateItem({ readiness: 'implemented', evidence: 'submitted' }), 'awaiting_review'); assert.notEqual(evaluateItem({ readiness: 'implemented', evidence: 'submitted' }), 'effective');
});
test('only accepted, unexpired evidence on an implemented control is effective', () => {
  const eff = []; for (const r of READINESS) for (const e of EVIDENCE) for (const x of [false, true]) if (evaluateItem({ readiness: r, evidence: e, evidenceExpired: x }) === 'effective') eff.push(`${r}/${e}/${x}`);
  assert.deepEqual(eff, ['implemented/accepted/false']);
});
test('not applicable takes precedence over everything, including accepted evidence', () => {
  for (const e of EVIDENCE) assert.equal(evaluateItem({ readiness: 'not_applicable', evidence: e }), 'not_applicable'); assert.equal(evaluateItem({ readiness: 'implemented', evidence: 'accepted', allControlsNotApplicable: true }), 'not_applicable');
});
test('every state is reachable and the evaluator is deterministic', () => {
  const seen = new Set<string>(); for (const r of READINESS) for (const e of EVIDENCE) for (const x of [false, true]) for (const na of [false, true]) { const i = { readiness: r, evidence: e, evidenceExpired: x, allControlsNotApplicable: na }; const a = evaluateItem(i); assert.equal(evaluateItem(i), a); seen.add(a); }
  assert.deepEqual([...seen].sort(), [...STATES].sort());
});
test('overdue: past due date and not effective / not applicable', () => {
  assert.equal(isOverdue('not_assessed', '2026-01-01', '2026-02-01'), true); assert.equal(isOverdue('not_assessed', '2026-02-01', '2026-02-01'), false); assert.equal(isOverdue('not_assessed', null, '2026-02-01'), false);
  assert.equal(isOverdue('effective', '2020-01-01', '2026-02-01'), false); assert.equal(isOverdue('not_applicable', '2020-01-01', '2026-02-01'), false); assert.equal(isOverdue('awaiting_review', '2020-01-01', '2026-02-01'), true);
});
test('summary: counts, readiness % excludes N/A, grouped rows, empty and all-N/A cases', () => {
  const today = '2026-06-01'; const s = summarize([{ readiness: 'implemented', evidence: 'accepted' }, { readiness: 'implemented', evidence: 'accepted', dueDate: '2026-05-01' }, { readiness: 'implemented', evidence: 'submitted', dueDate: '2026-05-01', count: 2 },
    { readiness: 'not_started', evidence: 'not_requested', count: 4 }, { readiness: 'not_applicable', evidence: 'not_requested', justification: 'x' } as any], today);
  assert.equal(s.total, 9); assert.equal(s.applicable, 8); assert.equal(s.effective, 2); assert.equal(s.awaitingReview, 2); assert.equal(s.overdue, 2); assert.equal(s.readinessPercent, 25); assert.equal(Object.values(s.byState).reduce((a, b) => a + b, 0), 9);
  assert.equal(summarize([], today).readinessPercent, null); assert.equal(summarize([{ readiness: 'not_applicable', evidence: 'not_requested' }], today).readinessPercent, null);
  assert.equal(summarize([{ readiness: 'implemented', evidence: 'accepted', count: 1 }, { readiness: 'in_progress', evidence: 'not_requested', count: 2 }], today).readinessPercent, 33.3);
});
test('summaries can be merged and the merge equals summarizing everything at once', () => {
  const a = [{ readiness: 'implemented', evidence: 'accepted', dueDate: '2020-01-01' }, { readiness: 'in_progress', evidence: 'requested' }] as any[]; const b = [{ readiness: 'not_applicable', evidence: 'not_requested' }, { readiness: 'implemented', evidence: 'rejected', dueDate: '2020-01-01' }] as any[];
  assert.deepEqual(mergeSummaries([summarize(a, '2026-01-01'), summarize(b, '2026-01-01')]), summarize([...a, ...b], '2026-01-01'));
});

test('an unresolved finding of at least medium severity makes accepted evidence ineffective; it changes nothing else', () => {
  for (const r of READINESS) for (const e of EVIDENCE) for (const x of [false, true]) for (const na of [false, true]) {
    const base = evaluateItem({ readiness: r, evidence: e, evidenceExpired: x, allControlsNotApplicable: na }); const withF = evaluateItem({ readiness: r, evidence: e, evidenceExpired: x, allControlsNotApplicable: na, blockingFindings: true });
    if (base === 'effective') assert.equal(withF, 'ineffective', `${r}/${e}`); else assert.equal(withF, base, `${r}/${e}/${x}/${na}`);
  }
});
