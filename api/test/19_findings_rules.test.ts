import { test } from 'node:test'; import assert from 'node:assert/strict';
import { STATUSES, SEVERITIES, TERMINAL, TRANSITIONS, isBlocking, isOverdue, canAssess, canAssign, canRemediate, transitionCheck, allowedTransitions, editCheck, summarize, type Who, type FStatus } from '../src/modules/findings/rules';
const W = { auditor: { via: 'member', role: 'tp_auditor', manage: false } as Who, admin: { via: 'member', role: 'client_admin', manage: false } as Who, staffMember: { via: 'member', role: 'client_staff', manage: false } as Who, vendor: { via: 'member', role: 'third_party_vendor', manage: false } as Who,
  mgr: { via: 'staff', role: 'isecurify_team', manage: true } as Who, viewer: { via: 'staff', role: 'isecurify_team', manage: false } as Who };

test('blocking: only unresolved findings of medium severity or above; accepted risk, low and observation never block', () => {
  for (const s of STATUSES) for (const v of SEVERITIES) assert.equal(isBlocking(s, v), ['open', 'in_remediation', 'ready_for_retest'].includes(s) && ['critical', 'high', 'medium'].includes(v), `${s}/${v}`);
});
test('overdue: unresolved and past its due date only', () => {
  assert.equal(isOverdue('open', '2026-01-01', '2026-01-02'), true); assert.equal(isOverdue('open', '2026-01-02', '2026-01-02'), false); assert.equal(isOverdue('open', null, '2026-01-02'), false); assert.equal(isOverdue('closed', '2026-01-01', '2026-01-02'), false); assert.equal(isOverdue('risk_accepted', '2026-01-01', '2026-01-02'), false);
});
test('who may assess, assign, remediate', () => {
  assert.deepEqual([W.auditor, W.admin, W.staffMember, W.vendor, W.mgr, W.viewer].map(canAssess), [true, false, false, false, true, false]);
  assert.deepEqual([W.auditor, W.admin, W.staffMember, W.vendor, W.mgr, W.viewer].map(canAssign), [false, true, false, false, true, false]);
  assert.equal(canRemediate(W.vendor, true), true); assert.equal(canRemediate(W.vendor, false), false); assert.equal(canRemediate(W.admin, false), true); assert.equal(canRemediate(W.auditor, false), false);
});
test('terminal statuses: only closed and risk-accepted can be reopened; cancelled is final; nothing skips remediation to closed', () => {
  assert.deepEqual(TRANSITIONS.cancelled, []); for (const s of ['closed', 'risk_accepted'] as FStatus[]) assert.deepEqual(TRANSITIONS[s].map(t => t.to), ['open']);
  for (const s of ['open', 'in_remediation'] as FStatus[]) assert.equal(TRANSITIONS[s].some(t => t.to === 'closed'), false, `${s} -> closed must go through retest`);
  assert.equal(transitionCheck('open', 'closed', W.auditor, false, 'x').ok, false);
});
test('transition matrix: every (from, to, role, owner) combination is decided by the table and nothing else', () => {
  let allowed = 0;
  for (const from of STATUSES) for (const to of STATUSES) for (const [name, w] of Object.entries(W)) for (const isOwner of [false, true]) {
    const r = transitionCheck(from, to, w, isOwner, 'a note'); const rule = TRANSITIONS[from].find(t => t.to === to);
    if (from === to) { assert.equal(r.ok, false); continue; } if (!rule) { assert.equal(r.ok, false); assert.equal((r as any).status, 409); continue; }
    const expected = rule.who(w, isOwner) && !(rule.noSelf && isOwner); assert.equal(r.ok, expected, `${from}->${to} ${name} owner=${isOwner}`); if (expected) allowed++;
  }
  assert.ok(allowed > 20);
});
test('key flows: owner starts and finishes remediation, auditor retests; owner can never close or accept the risk of their own finding', () => {
  assert.equal(transitionCheck('open', 'in_remediation', W.vendor, true, null).ok, true); assert.equal(transitionCheck('open', 'in_remediation', W.vendor, false, null).ok, false);
  assert.equal(transitionCheck('in_remediation', 'ready_for_retest', W.vendor, true, 'patched').ok, true); assert.equal((transitionCheck('in_remediation', 'ready_for_retest', W.vendor, true, '  ') as any).code, 'note_required');
  assert.equal(transitionCheck('ready_for_retest', 'closed', W.auditor, false, 'verified').ok, true); assert.equal(transitionCheck('ready_for_retest', 'closed', W.vendor, true, 'x').ok, false); assert.equal(transitionCheck('ready_for_retest', 'closed', W.admin, false, 'x').ok, false, 'client admins never close');
  assert.equal((transitionCheck('ready_for_retest', 'closed', W.mgr, true, 'x') as any).code, 'self_review'); assert.equal((transitionCheck('open', 'risk_accepted', W.mgr, true, 'x') as any).code, 'self_review');
  assert.equal((transitionCheck('ready_for_retest', 'in_remediation', W.auditor, false, '') as any).code, 'note_required'); assert.equal((transitionCheck('closed', 'open', W.auditor, false, null) as any).code, 'note_required');
});
test('allowedTransitions drives the buttons and agrees with transitionCheck', () => {
  for (const from of STATUSES) for (const w of Object.values(W)) for (const isOwner of [false, true]) { const a = allowedTransitions(from, w, isOwner).map(x => x.to); for (const to of STATUSES) assert.equal(a.includes(to), transitionCheck(from, to, w, isOwner, 'n').ok, `${from}->${to}`); }
});
test('edits: substance by assessors, owner/due date by assigners (assessors may set the due date), plan by owner; closed findings are frozen', () => {
  assert.equal(editCheck(['title', 'severity'], 'open', W.auditor, false).ok, true); assert.equal(editCheck(['title'], 'open', W.admin, false).ok, false); assert.equal(editCheck(['ownerUserId'], 'open', W.admin, false).ok, true); assert.equal(editCheck(['ownerUserId'], 'open', W.auditor, false).ok, false);
  assert.equal(editCheck(['dueDate'], 'open', W.auditor, false).ok, true); assert.equal(editCheck(['remediationPlan'], 'in_remediation', W.vendor, true).ok, true); assert.equal(editCheck(['remediationPlan'], 'in_remediation', W.vendor, false).ok, false);
  for (const s of TERMINAL) assert.equal((editCheck(['title'], s, W.mgr, false) as any).code, 'finding_closed');
});
test('summary counts agree with the per-row rules', () => {
  const s = summarize([{ status: 'open', severity: 'critical', dueDate: '2020-01-01', count: 2 }, { status: 'closed', severity: 'high', dueDate: '2020-01-01' }, { status: 'in_remediation', severity: 'low', dueDate: null, count: 3 }, { status: 'risk_accepted', severity: 'medium', dueDate: null }], '2026-01-01');
  assert.deepEqual([s.total, s.unresolved, s.blocking, s.overdue], [7, 5, 2, 2]); assert.equal(s.byStatus.open, 2); assert.equal(s.bySeverity.low, 3);
});

import { canLinkEvidence, daysBetween, ageing, overdueBucket } from '../src/modules/findings/rules';
test('who may attach remediation evidence: assessors, owners, client admins and managers; not other clients or view-only staff', () => {
  assert.deepEqual([W.auditor, W.admin, W.staffMember, W.vendor, W.mgr, W.viewer].map(w => canLinkEvidence(w, false)), [true, true, false, false, true, false]); assert.equal(canLinkEvidence(W.vendor, true), true); assert.equal(canLinkEvidence(W.staffMember, true), true);
});
test('ageing and overdue buckets use calendar days', () => {
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2); assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); assert.equal(daysBetween('2026-03-01', '2026-02-27'), -2);
  assert.deepEqual(ageing('2026-01-01T10:00:00.000Z', 'open', '2026-01-10', '2026-01-20'), { ageDays: 19, daysOverdue: 10 }); assert.deepEqual(ageing('2026-01-01T10:00:00.000Z', 'closed', '2026-01-10', '2026-01-20'), { ageDays: 19, daysOverdue: 0 }); assert.equal(ageing('2026-01-01T00:00:00.000Z', 'open', null, '2026-01-20').daysOverdue, 0); assert.equal(ageing('2026-02-01T00:00:00.000Z', 'open', null, '2026-01-20').ageDays, 0);
  assert.deepEqual([0, 1, 7, 8, 30, 31, 90, 91].map(overdueBucket), [null, '1-7', '1-7', '8-30', '8-30', '31-90', '31-90', '90+']);
});
