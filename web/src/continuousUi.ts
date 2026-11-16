// Pure helpers for the continuous-controls screens (Phase 11A).
export const FREQUENCY_OPTIONS: [string, string][] = [['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannual', 'Every 6 months'], ['annual', 'Yearly']];
export const TEST_STATE: Record<string, { label: string; tone: 'red' | 'amber' | 'green' | 'slate' }> = { failing: { label: 'Last test failed', tone: 'red' }, overdue: { label: 'Overdue', tone: 'red' }, due_soon: { label: 'Due soon', tone: 'amber' }, ok: { label: 'On track', tone: 'green' }, paused: { label: 'Paused', tone: 'slate' } };
export const SCHEDULE_STATE: Record<string, { label: string; tone: 'red' | 'amber' | 'green' | 'slate' }> = { due: { label: 'Ready to request', tone: 'amber' }, upcoming: { label: 'Coming up', tone: 'slate' }, ok: { label: 'Scheduled', tone: 'green' }, paused: { label: 'Paused', tone: 'slate' } };
export const everyLabel = (m: number) => m === 1 ? 'every month' : m === 12 ? 'every year' : m % 12 === 0 ? `every ${m / 12} years` : `every ${m} months`;
export const TREND_LABEL: Record<string, string> = { up: '▲ improving', down: '▼ declining', flat: '● steady', unknown: 'not enough history yet' };
export type SeriesPoint = { date: string; percent: number };
/** Points for a small line chart: x spreads over the date range, y is the percentage (0 at the bottom). */
export function chartPoints(series: SeriesPoint[], w: number, h: number, pad = 4): { x: number; y: number }[] {
  if (!series.length) return []; const t = (d: string) => Date.parse(d + 'T00:00:00Z'); const lo = t(series[0].date), hi = t(series[series.length - 1].date);
  return series.map(p => ({ x: pad + (hi === lo ? (w - 2 * pad) / 2 : ((t(p.date) - lo) / (hi - lo)) * (w - 2 * pad)), y: pad + (1 - Math.min(100, Math.max(0, p.percent)) / 100) * (h - 2 * pad) }));
}
export const pathOf = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
