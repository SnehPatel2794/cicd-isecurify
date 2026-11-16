// Pure helpers for analytics. No I/O, no clock ("today" is passed in). The readiness numbers themselves always come from the evaluation service.
export const MAX_MONTHS = 12; export const DEFAULT_MONTHS = 6;
/** The last `n` calendar months ending with the month of `today`, oldest first, as YYYY-MM. */
export function monthsBack(today: string, n: number): string[] {
  let y = +today.slice(0, 4), m = +today.slice(5, 7); const out: string[] = []; for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y--; } } return out;
}
/** First day of the oldest month, to bound the SQL. */
export const sinceOf = (months: string[]) => `${months[0]}-01`;
/** One row per month, zero where the database had nothing, so charts never skip a month. */
export function fillSeries<K extends string>(months: string[], keys: readonly K[], rows: ({ month: string } & Partial<Record<K, number>>)[]) {
  return months.map(month => { const r = rows.filter(x => x.month === month); return { month, ...Object.fromEntries(keys.map(k => [k, r.reduce((a, x) => a + Number(x[k] ?? 0), 0)])) } as { month: string } & Record<K, number>; });
}
export const AGE_BUCKETS = ['0-30', '31-90', '91-180', '180+'] as const;
export const ageBucket = (days: number) => days <= 30 ? '0-30' : days <= 90 ? '31-90' : days <= 180 ? '91-180' : '180+';
export const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
export const parseMonths = (raw: unknown) => { const n = Number(raw ?? DEFAULT_MONTHS); return Number.isInteger(n) && n >= 1 && n <= MAX_MONTHS ? n : null; };
/** Attention flags for one organization: what a manager should look at first. Order is the order shown. */
export type OrgFacts = { overdueFindings: number; criticalUnresolved: number; certificatesExpiringSoon: number; certificatesExpired: number; overdueItems: number; criticalRisks?: number; riskReviewsOverdue?: number; criticalIncidents?: number; incidentNotificationsPending?: number; policyReviewsOverdue?: number; overdueTasks?: number };
export function attention(f: OrgFacts): string[] {
  const out: string[] = []; if (f.overdueTasks) out.push(`${f.overdueTasks} task${f.overdueTasks === 1 ? '' : 's'} overdue`); if (f.criticalUnresolved) out.push(`${f.criticalUnresolved} critical finding${f.criticalUnresolved === 1 ? '' : 's'} unresolved`); if (f.overdueFindings) out.push(`${f.overdueFindings} finding${f.overdueFindings === 1 ? '' : 's'} overdue`);
  if (f.overdueItems) out.push(`${f.overdueItems} checklist item${f.overdueItems === 1 ? '' : 's'} overdue`); if (f.criticalRisks) out.push(`${f.criticalRisks} critical risk${f.criticalRisks === 1 ? '' : 's'} open`); if (f.riskReviewsOverdue) out.push(`${f.riskReviewsOverdue} risk acceptance review${f.riskReviewsOverdue === 1 ? '' : 's'} overdue`); if (f.criticalIncidents) out.push(`${f.criticalIncidents} critical incident${f.criticalIncidents === 1 ? '' : 's'} open`); if (f.incidentNotificationsPending) out.push(`${f.incidentNotificationsPending} incident${f.incidentNotificationsPending === 1 ? '' : 's'} awaiting authority notification`); if (f.policyReviewsOverdue) out.push(`${f.policyReviewsOverdue} polic${f.policyReviewsOverdue === 1 ? 'y' : 'ies'} overdue for review`); if (f.certificatesExpired) out.push(`${f.certificatesExpired} certificate${f.certificatesExpired === 1 ? '' : 's'} expired`); if (f.certificatesExpiringSoon) out.push(`${f.certificatesExpiringSoon} certificate${f.certificatesExpiringSoon === 1 ? '' : 's'} expiring soon`); return out;
}
/** Net change between the last two months of a raised/closed series: positive means the backlog grew. */
export const backlogChange = (series: { raised: number; closed: number }[]) => series.length ? series[series.length - 1].raised - series[series.length - 1].closed : 0;
