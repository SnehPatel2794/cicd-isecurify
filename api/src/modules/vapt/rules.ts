// Pure rules for VAPT rounds (Phase 11D): the status flow, and the comparison between rounds. No database, no clock.
export const STATUSES = ['planned', 'in_progress', 'report_issued', 'retesting', 'closed', 'cancelled'] as const; export type RStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<RStatus, string> = { planned: 'Planned', in_progress: 'Testing in progress', report_issued: 'Report issued', retesting: 'Retest in progress', closed: 'Closed', cancelled: 'Cancelled' };
export const MAX_ROUNDS = 8;
const NEXT: Record<RStatus, RStatus[]> = { planned: ['in_progress', 'cancelled'], in_progress: ['report_issued', 'cancelled'], report_issued: ['retesting', 'closed'], retesting: ['closed'], closed: [], cancelled: [] };
export const nextStatuses = (s: RStatus) => NEXT[s];
export const isLive = (s: RStatus) => s !== 'closed' && s !== 'cancelled';
export type Round = { status: RStatus; reportTitle: string | null; reportIssuedOn?: string | null };
/** Why a status change is refused, or null when it is allowed. `unresolvedSerious` counts open critical/high findings tagged to this round. */
export function transitionCheck(r: Round, to: RStatus, unresolvedSerious: number): string | null {
  if (!NEXT[r.status].includes(to)) return `A round that is "${STATUS_LABEL[r.status]}" cannot move to "${STATUS_LABEL[to]}"`;
  if (to === 'report_issued' && !r.reportTitle) return 'Record the report title before marking the report as issued';
  if (to === 'closed' && unresolvedSerious > 0) return `${unresolvedSerious} critical or high finding${unresolvedSerious === 1 ? ' is' : 's are'} still open in this round. Close or risk-accept them first`;
  return null;
}
export type Stage = 'upcoming' | 'due' | 'overdue';
export const UPCOMING_DAYS = 7; export const OVERDUE_AFTER_DAYS = 3;
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
/** Reminder stage for a planned round that has not started: a week before, on the day, and once it is 3 days late. */
export function reminderStage(plannedOn: string, today: string): Stage | null { const n = days(today, plannedOn); if (n > UPCOMING_DAYS) return null; if (n > 0) return 'upcoming'; return -n >= OVERDUE_AFTER_DAYS ? 'overdue' : 'due'; }

export type CmpFinding = { roundId: string | null; severity: string; status: string; createdOn: string; closedOn: string | null };
export type CmpRound = { id: string; roundNo: number; title: string; status: RStatus; startOn: string };
const OPEN = ['open', 'in_remediation', 'ready_for_retest'];
const SERIOUS = ['critical', 'high'];
/** Per round: what it found (new), what was already open when it began (carried in), and what was closed while it ran until the next round began.
 *  Dates decide, so the numbers do not change when a later finding is closed after the round has ended. */
export function compare(rounds: CmpRound[], findings: CmpFinding[]) {
  const sorted = [...rounds].filter(r => r.status !== 'cancelled').sort((a, b) => a.roundNo - b.roundNo);
  return sorted.map((r, i) => {
    const nextStart = sorted[i + 1]?.startOn ?? '9999-12-31'; const mine = findings.filter(f => f.roundId === r.id); const earlier = findings.filter(f => f.roundId && sorted.slice(0, i).some(x => x.id === f.roundId));
    const carriedIn = earlier.filter(f => f.createdOn < r.startOn && (!f.closedOn || f.closedOn >= r.startOn)); const sev: Record<string, number> = {}; for (const f of mine) sev[f.severity] = (sev[f.severity] ?? 0) + 1;
    const closedInWindow = [...mine, ...carriedIn].filter(f => f.closedOn && f.closedOn >= r.startOn && f.closedOn < nextStart).length;
    return { roundId: r.id, roundNo: r.roundNo, title: r.title, status: r.status, found: mine.length, foundBySeverity: sev, foundSerious: mine.filter(f => SERIOUS.includes(f.severity)).length, carriedIn: carriedIn.length, closedAfter: closedInWindow, stillOpen: mine.filter(f => OPEN.includes(f.status)).length };
  });
}
export type Trend = 'improving' | 'worsening' | 'steady' | 'not_enough_data';
/** Compares the serious findings of the last two rounds that actually found something to report on (status past in_progress). */
export function trend(rows: ReturnType<typeof compare>): Trend { const done = rows.filter(r => ['report_issued', 'retesting', 'closed'].includes(r.status)); if (done.length < 2) return 'not_enough_data'; const a = done[done.length - 2].foundSerious, b = done[done.length - 1].foundSerious; return b < a ? 'improving' : b > a ? 'worsening' : 'steady'; }
