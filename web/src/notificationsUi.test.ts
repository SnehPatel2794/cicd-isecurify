import { targetOf, headline, ago, countText } from './notificationsUi';
const base = { tenantId: 't1', entityId: 'e 1', engagementId: 'g1' };
test('each kind of notification opens the right screen', () => {
  expect(targetOf({ ...base, entityType: 'finding' })).toBe('/org/t1/findings?open=e%201'); expect(targetOf({ ...base, entityType: 'evidence_request' })).toBe('/org/t1/engagements/g1?tab=Evidence'); expect(targetOf({ ...base, entityType: 'checklist_item' })).toBe('/org/t1/engagements/g1?tab=Checklist');
  expect(targetOf({ ...base, entityType: 'checklist_item', engagementId: null })).toBe('/org/t1/engagements');
});
test('headlines name the person, and fall back for unknown kinds', () => {
  expect(headline({ kind: 'finding.assigned', actorName: 'Priya' })).toBe('Priya assigned you a finding'); expect(headline({ kind: 'finding.comment', actorName: null })).toBe('Someone commented on a finding'); expect(headline({ kind: 'new.thing', kindLabel: 'Something new' })).toBe('Something new');
});
test('relative time and the count badge', () => {
  const now = Date.parse('2026-10-24T12:00:00Z'); expect(ago('2026-10-24T11:59:40Z', now)).toBe('just now'); expect(ago('2026-10-24T11:15:00Z', now)).toBe('45 min ago'); expect(ago('2026-10-24T07:00:00Z', now)).toBe('5 h ago'); expect(ago('2026-10-23T10:00:00Z', now)).toBe('1 day ago'); expect(ago('2026-10-11T10:00:00Z', now)).toBe('13 days ago'); expect(ago('2026-10-10T10:00:00Z', now)).toBe('2026-10-10'); expect(ago('2026-09-01T10:00:00Z', now)).toBe('2026-09-01');
  expect(countText(0)).toBe('0'); expect(countText(99)).toBe('99'); expect(countText(100)).toBe('99+');
});
