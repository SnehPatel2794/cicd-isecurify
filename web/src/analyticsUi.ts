// Pure helpers for the analytics screens (no chart library: bars are plain elements with a text value next to them).
export const barPct = (n: number, max: number) => max > 0 ? Math.max(n > 0 ? 3 : 0, Math.round((n / max) * 100)) : 0;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1] ?? m} ${m.slice(2, 4)}`;
export const pctText = (p: number | null) => p === null ? '—' : `${p}%`;
export const changeText = (n: number) => n > 0 ? `Backlog grew by ${n} this month` : n < 0 ? `Backlog shrank by ${-n} this month` : 'Backlog unchanged this month';
export const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'observation'] as const;
export const SEV_BAR: Record<string, string> = { critical: 'bg-red-600', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-sky-500', observation: 'bg-slate-400' };
export const MONTH_CHOICES = [3, 6, 12] as const;
