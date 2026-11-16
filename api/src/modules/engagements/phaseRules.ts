// What to check before an engagement moves to the next phase. Pure: no database, no framework.
// "block" cannot be overridden (the move makes no sense). "warn" can be moved past, but only by acknowledging it with a note, which is audited.
export type Check = { code: string; level: 'block' | 'warn'; message: string };
export type PhaseFacts = { items: number; unassigned: number; applicable: number; effective: number; awaitingReview: number; overdue: number; unresolvedSerious: number; discoveryOpen: number; milestonesOpen: number; questionnaireOpen?: number; questionnaireToReview?: number; tasksOverdue?: number };
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
export function phaseChecks(from: number, f: PhaseFacts): Check[] {
  const out: Check[] = []; const warn = (code: string, message: string) => out.push({ code, level: 'warn', message });
  if (from === 1 && f.items === 0) out.push({ code: 'no_items', level: 'block', message: 'The checklist is empty. Add a framework before leaving Preparation' });
  if (from <= 2 && f.unassigned > 0) warn('unassigned', `${n(f.unassigned, 'checklist item has', 'checklist items have')} no accountable person`);
  if (from === 1 && f.discoveryOpen > 0) warn('discovery_open', `${n(f.discoveryOpen, 'discovery question is', 'discovery questions are')} not answered`);
  if (from === 1 && (f.questionnaireOpen ?? 0) > 0) warn('questionnaire_open', `${n(f.questionnaireOpen!, 'required questionnaire question is', 'required questionnaire questions are')} not answered`);
  if (from === 2 && (f.questionnaireToReview ?? 0) > 0) warn('questionnaire_review', `${n(f.questionnaireToReview!, 'questionnaire answer is', 'questionnaire answers are')} waiting for review or sent back`);
  if ((f.tasksOverdue ?? 0) > 0) warn('tasks_overdue', `${n(f.tasksOverdue!, 'task is', 'tasks are')} overdue`);
  if (from === 2 && f.overdue > 0) warn('overdue', `${n(f.overdue, 'item is', 'items are')} already overdue`);
  if ((from === 2 || from === 4) && f.effective < f.applicable) warn('not_effective', `${f.effective} of ${f.applicable} applicable controls are effective so far`);
  if (from === 3 && f.awaitingReview > 0) warn('awaiting_review', `${n(f.awaitingReview, 'item is', 'items are')} waiting for the auditor's review`);
  if (from === 4 && f.unresolvedSerious > 0) warn('unresolved_findings', `${n(f.unresolvedSerious, 'critical, high or medium finding is', 'critical, high or medium findings are')} still open`);
  if (f.milestonesOpen > 0) warn('milestones_open', `${n(f.milestonesOpen, 'milestone in this phase is', 'milestones in this phase are')} not complete`);
  return out;
}
export const summarizeChecks = (checks: Check[]) => ({ blocked: checks.filter(c => c.level === 'block'), warnings: checks.filter(c => c.level === 'warn') });
