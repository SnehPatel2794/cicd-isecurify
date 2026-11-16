import { lateText, ageText, bucketLabel, trackingQuery, transitionLabel, notePrompt, dueFrom, suggestedDue, refOf, summaryChips, eventText, STATUS_LABEL, STATUS_TONE, SEVERITY_LABEL, SEVERITY_TONE, SEVERITIES } from './findingsUi';
test('every status and severity has a label and a tone', () => { for (const s of Object.keys(STATUS_LABEL)) expect(STATUS_TONE[s]).toBeDefined(); for (const s of SEVERITIES) { expect(SEVERITY_LABEL[s]).toBeDefined(); expect(SEVERITY_TONE[s]).toBeDefined(); } });
test('button wording tells retest-failed apart from start-remediation, and reopen from the rest', () => {
  expect(transitionLabel('open', 'in_remediation')).toBe('Start remediation'); expect(transitionLabel('ready_for_retest', 'in_remediation')).toMatch(/Retest failed/); expect(transitionLabel('closed', 'open')).toBe('Reopen'); expect(transitionLabel('ready_for_retest', 'closed')).toMatch(/Close/);
  for (const to of Object.keys(STATUS_LABEL)) expect(notePrompt(to).length).toBeGreaterThan(3);
});
test('due dates: calendar arithmetic across month and year ends and leap days', () => {
  expect(dueFrom('2026-12-25', 10)).toBe('2027-01-04'); expect(dueFrom('2028-02-28', 1)).toBe('2028-02-29'); expect(dueFrom('2027-02-28', 1)).toBe('2027-03-01'); expect(suggestedDue('critical', '2026-01-01')).toBe('2026-01-08'); expect(suggestedDue('high', '2026-01-01')).toBe('2026-01-31'); expect(suggestedDue('unknown', '2026-01-01')).toBe('2026-01-31');
});
test('references are zero-padded', () => { expect(refOf(1)).toBe('F-001'); expect(refOf(42)).toBe('F-042'); expect(refOf(1234)).toBe('F-1234'); });
test('summary chips and timeline sentences', () => {
  const c = summaryChips({ unresolved: 5, blocking: 2, overdue: 0, bySeverity: {}, byStatus: { ready_for_retest: 1 } }); expect(c.map(x => x[1])).toEqual([5, 2, 0, 1, 0]); expect(c[1][2]).toBe('red'); expect(c[2][2]).toBeUndefined();
  expect(eventText({ kind: 'status', fromStatus: 'open', toStatus: 'in_remediation', note: null })).toBe('changed status: Open → In remediation'); expect(eventText({ kind: 'raised', fromStatus: null, toStatus: 'open', note: null })).toMatch(/raised/); expect(eventText({ kind: 'comment', fromStatus: null, toStatus: null, note: 'x' })).toBe('commented');
});

test('tracking helpers: late text, age text, bucket labels and the query string only carry switched-on filters', () => {
  expect(lateText({ overdue: false, daysOverdue: 0 })).toBe(''); expect(lateText({ overdue: true, daysOverdue: 1 })).toBe('1 day late'); expect(lateText({ overdue: true, daysOverdue: 9 })).toBe('9 days late');
  expect(ageText(0)).toBe('today'); expect(ageText(1)).toBe('1 day'); expect(ageText(45)).toBe('45 days'); expect(ageText(90)).toBe('3 months'); expect(bucketLabel('90+')).toBe('Over 90 days late'); expect(bucketLabel('8-30')).toBe('8-30 days late');
  expect(trackingQuery({})).toBe(''); expect(trackingQuery({ mine: true, status: 'open', overdue: false })).toBe('?mine=true&status=open'); expect(trackingQuery({ unresolved: true, severity: 'high', awaitingRetest: true })).toBe('?awaitingRetest=true&unresolved=true&severity=high');
});

test('evidence events read as attachments, not comments', () => { expect(eventText({ kind: 'evidence', fromStatus: null, toStatus: null, note: 'x' })).toBe('attached remediation evidence'); });
