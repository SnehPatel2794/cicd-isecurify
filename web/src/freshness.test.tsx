import { render, screen } from '@testing-library/react'; import { Freshness, freshnessText } from './freshness';
test('wording: live, minutes, hours', () => {
  expect(freshnessText(undefined)).toBe(''); expect(freshnessText({ source: 'live', computedAt: null, ageMinutes: null, stale: false })).toBe('Calculated just now');
  const s = (m: number) => freshnessText({ source: 'summary', computedAt: 'x', ageMinutes: m, stale: false }); expect(s(0)).toBe('Updated less than a minute ago'); expect(s(1)).toBe('Updated 1 minute ago'); expect(s(9)).toBe('Updated 9 minutes ago'); expect(s(65)).toBe('Updated 1 hour ago'); expect(s(300)).toBe('Updated 5 hours ago');
});
test('a stale summary shows the out-of-date badge; a fresh one does not; nothing renders without data', () => {
  const { rerender } = render(<Freshness value={{ source: 'summary', computedAt: 'x', ageMinutes: 20, stale: true, staleAfterMinutes: 15 }} />); expect(screen.getByText('Updated 20 minutes ago')).toBeInTheDocument(); expect(screen.getByText('May be out of date')).toBeInTheDocument();
  rerender(<Freshness value={{ source: 'summary', computedAt: 'x', ageMinutes: 2, stale: false }} />); expect(screen.queryByText('May be out of date')).toBeNull();
  rerender(<Freshness value={undefined} />); expect(screen.queryByLabelText('Data freshness')).toBeNull();
});
