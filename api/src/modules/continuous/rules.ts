// Continuous controls: pure rules (no database, no framework). Dates are plain YYYY-MM-DD strings in UTC, the same "today" the rest of the product uses.
export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'] as const; export type Frequency = typeof FREQUENCIES[number];
export const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Yearly' };
const MONTHS: Record<Exclude<Frequency, 'weekly'>, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const iso = (d: Date) => d.toISOString().slice(0, 10); const parse = (s: string) => new Date(s + 'T00:00:00Z');
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Adds calendar months and clamps to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export const addMonthsClamped = (s: string, n: number) => { const d = parse(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
export const addPeriod = (s: string, f: Frequency) => f === 'weekly' ? addDays(s, 7) : addMonthsClamped(s, MONTHS[f]);
/** The next due date after a test was performed: one period after the day it was performed (a test done early or late keeps its own rhythm). */
export const nextDueAfter = (performedOn: string, f: Frequency) => addPeriod(performedOn, f);

export type TestState = 'failing' | 'overdue' | 'due_soon' | 'ok' | 'paused';
export const SOON = 7;
export function testState(t: { status: string; lastResult: string | null; nextDueOn: string }, today: string): TestState {
  if (t.status === 'paused') return 'paused'; if (t.lastResult === 'fail') return 'failing'; if (t.nextDueOn < today) return 'overdue'; if (t.nextDueOn <= addDays(today, SOON)) return 'due_soon'; return 'ok';
}
export const needsAttention = (s: TestState) => s === 'failing' || s === 'overdue';
export const TEST_STATE_LABEL: Record<TestState, string> = { failing: 'Last test failed', overdue: 'Overdue', due_soon: 'Due soon', ok: 'On track', paused: 'Paused' };

export type ScheduleState = 'due' | 'upcoming' | 'ok' | 'paused';
export const UPCOMING_DAYS = 14;
export function scheduleState(s: { status: string; nextRunOn: string }, today: string): ScheduleState {
  if (s.status === 'paused') return 'paused'; if (s.nextRunOn <= today) return 'due'; if (s.nextRunOn <= addDays(today, UPCOMING_DAYS)) return 'upcoming'; return 'ok';
}

/** Who may do what. `manage` is the evidence module's definition (client admins and iSecurify staff with manage rights). */
export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
export const canManage = (w: Who) => w.manage;
/** Recording a result: managers, or the person who owns the test (the accountable person for the item unless another owner was set). Auditors only read. */
export const canRecord = (w: Who, userId: string, ownerUserId: string | null, accountableUserId: string | null) => w.manage || (w.via === 'member' && (w.role === 'client_staff' || w.role === 'third_party_vendor') && (ownerUserId ?? accountableUserId) === userId);
export const MAX_BACKDATE_DAYS = 366;
export function runDateProblem(performedOn: string, today: string): string | null {
  if (performedOn > today) return 'A test cannot be recorded for a future date'; if (performedOn < addDays(today, -MAX_BACKDATE_DAYS)) return 'A test cannot be recorded more than a year in the past'; return null;
}

// ----- posture trend -----
export type Point = { date: string; percent: number };
/** Change in percentage points between the latest point and the latest point at least `days` earlier. Null when there is no earlier point to compare with. */
export function changeOver(points: Point[], days: number): number | null {
  if (points.length < 2) return null; const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date)); const last = sorted[sorted.length - 1]; const limit = addDays(last.date, -days);
  const base = [...sorted].reverse().find(p => p.date <= limit); if (!base) return null; return Math.round((last.percent - base.percent) * 10) / 10;
}
export const TREND = (change: number | null): 'up' | 'down' | 'flat' | 'unknown' => change === null ? 'unknown' : change > 0.4 ? 'up' : change < -0.4 ? 'down' : 'flat';
