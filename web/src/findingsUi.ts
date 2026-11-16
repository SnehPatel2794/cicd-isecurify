// Pure helpers for the findings screens (no React, no network): labels, tones, wording of buttons, default due dates.
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'observation'] as const;
export const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', observation: 'Observation' };
export const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'brand' | 'slate'> = { critical: 'red', high: 'red', medium: 'amber', low: 'brand', observation: 'slate' };
export const STATUS_LABEL: Record<string, string> = { open: 'Open', in_remediation: 'In remediation', ready_for_retest: 'Ready for retest', closed: 'Closed', risk_accepted: 'Risk accepted', cancelled: 'Cancelled' };
export const STATUS_TONE: Record<string, 'red' | 'amber' | 'brand' | 'green' | 'slate'> = { open: 'red', in_remediation: 'amber', ready_for_retest: 'brand', closed: 'green', risk_accepted: 'slate', cancelled: 'slate' };
export const DEFAULT_DAYS: Record<string, number> = { critical: 7, high: 30, medium: 60, low: 90, observation: 180 };
/** Text on the button that performs a transition. `from` disambiguates "reopen" and "retest failed". */
export function transitionLabel(from: string, to: string): string {
  if (to === 'in_remediation') return from === 'ready_for_retest' ? 'Retest failed: back to remediation' : 'Start remediation';
  if (to === 'ready_for_retest') return 'Mark ready for retest';
  if (to === 'closed') return 'Close (retest passed)';
  if (to === 'risk_accepted') return 'Accept risk';
  if (to === 'cancelled') return 'Cancel (raised in error)';
  if (to === 'open') return 'Reopen';
  return STATUS_LABEL[to] ?? to;
}
/** What the note box should ask for, per target status. */
export const notePrompt = (to: string) => to === 'ready_for_retest' ? 'What was fixed?' : to === 'closed' ? 'How did you verify the fix?' : to === 'risk_accepted' ? 'Who accepted the risk, and why?' : to === 'cancelled' ? 'Why was this raised in error?' : to === 'open' ? 'Why is it being reopened?' : to === 'in_remediation' ? 'What did the retest find?' : 'Note';
/** YYYY-MM-DD, `days` after `today` (UTC calendar arithmetic, no time zones involved). */
export function dueFrom(today: string, days: number): string { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export const suggestedDue = (severity: string, today: string) => dueFrom(today, DEFAULT_DAYS[severity] ?? 30);
export const refOf = (n: number) => `F-${String(n).padStart(3, '0')}`;
/** Summary chips for the tab header: [label, count, tone]. */
export function summaryChips(s: { unresolved: number; blocking: number; overdue: number; bySeverity: Record<string, number>; byStatus: Record<string, number> }): [string, number, 'red' | 'amber' | undefined][] {
  return [['Unresolved', s.unresolved, undefined], ['Blocking controls', s.blocking, s.blocking ? 'red' : undefined], ['Overdue', s.overdue, s.overdue ? 'red' : undefined], ['Ready for retest', s.byStatus.ready_for_retest ?? 0, undefined], ['Closed', s.byStatus.closed ?? 0, undefined]];
}
/** Timeline sentence for one event. */
export function eventText(e: { kind: string; fromStatus: string | null; toStatus: string | null; note: string | null }): string {
  if (e.kind === 'raised') return 'raised the finding';
  if (e.kind === 'status') return `changed status: ${STATUS_LABEL[e.fromStatus ?? ''] ?? e.fromStatus} → ${STATUS_LABEL[e.toStatus ?? ''] ?? e.toStatus}`;
  if (e.kind === 'assigned') return 'updated owner or due date';
  if (e.kind === 'edited') return 'edited the finding';
  if (e.kind === 'evidence') return 'attached remediation evidence';
  return 'commented';
}

// ---------------------------------------------------------------- 6C: remediation tracking
/** "3 days late", "due today"-style text for the tracking table. */
export const lateText = (f: { overdue: boolean; daysOverdue: number }) => !f.overdue ? '' : f.daysOverdue === 1 ? '1 day late' : `${f.daysOverdue} days late`;
export const ageText = (days: number) => days <= 0 ? 'today' : days === 1 ? '1 day' : days < 60 ? `${days} days` : `${Math.round(days / 30)} months`;
export const BUCKETS = ['1-7', '8-30', '31-90', '90+'] as const;
export const bucketLabel = (b: string) => b === '90+' ? 'Over 90 days late' : `${b} days late`;
/** Turns the server's filter state into a query string (only the filters that are switched on). */
export function trackingQuery(f: { mine?: boolean; overdue?: boolean; awaitingRetest?: boolean; unresolved?: boolean; status?: string; severity?: string }): string {
  const p = new URLSearchParams(); if (f.mine) p.set('mine', 'true'); if (f.overdue) p.set('overdue', 'true'); if (f.awaitingRetest) p.set('awaitingRetest', 'true'); if (f.unresolved) p.set('unresolved', 'true'); if (f.status) p.set('status', f.status); if (f.severity) p.set('severity', f.severity); const s = p.toString(); return s ? '?' + s : '';
}
