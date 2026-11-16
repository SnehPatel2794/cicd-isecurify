// THE control-evaluation service. Pure and deterministic: no I/O, no clock (callers pass `today`), so dashboards, lists and (later) reports
// always agree. Nothing else in the code base may compute a readiness or compliance status.
//
// Inputs come from two independent sources on purpose:
//   * readiness  - what the client/iSecurify CLAIM about the control (set by people)
//   * evidence   - what the independent auditor has VALIDATED (set only by the review workflow, Phase 5)
// An uploaded file never makes a control effective, and "effective" is not an external certification.
export const READINESS = ['not_started', 'in_progress', 'partially_implemented', 'implemented', 'not_applicable'] as const;
export const EVIDENCE = ['not_requested', 'requested', 'in_progress', 'submitted', 'accepted', 'rejected'] as const;
export const STATES = ['not_assessed', 'not_applicable', 'not_implemented', 'partially_implemented', 'implemented_pending_validation', 'awaiting_review', 'blocked_missing_evidence', 'ineffective', 'effective'] as const;
export type Readiness = typeof READINESS[number]; export type EvidenceStatus = typeof EVIDENCE[number]; export type EvalState = typeof STATES[number];
export type EvalInput = { readiness: Readiness; evidence: EvidenceStatus; evidenceExpired?: boolean; allControlsNotApplicable?: boolean; blockingFindings?: boolean };

export const STATE_LABEL: Record<EvalState, string> = { not_assessed: 'Not assessed', not_applicable: 'Not applicable', not_implemented: 'Not implemented', partially_implemented: 'Partially implemented',
  implemented_pending_validation: 'Implemented, pending validation', awaiting_review: 'Awaiting review', blocked_missing_evidence: 'Blocked: missing or stale evidence', ineffective: 'Ineffective', effective: 'Effective for the defined scope and period' };

/** Precedence (first match wins):
 *  1. Not applicable - the item was declared N/A (justification enforced by the database) OR every control it satisfies is N/A in the SOA.
 *  2. The claim decides the ceiling: not_started -> not_assessed; in_progress -> not_implemented; partially_implemented -> partially_implemented.
 *  3. Only "implemented" claims are validated against evidence:
 *       accepted (and not expired) -> effective | accepted but expired -> blocked | submitted -> awaiting_review | rejected -> ineffective
 *       in_progress (client still collecting) -> implemented_pending_validation | requested / not_requested -> blocked_missing_evidence
 *     accepted evidence is overridden by an unresolved finding of at least medium severity (Phase 6): the control is 'ineffective' until the finding is closed or its risk accepted
 *  Accepted evidence on an item NOT claimed implemented does not raise its state: the claim must come first. */
export function evaluateItem(i: EvalInput): EvalState {
  if (i.readiness === 'not_applicable' || i.allControlsNotApplicable) return 'not_applicable';
  switch (i.readiness) {
    case 'not_started': return 'not_assessed';
    case 'in_progress': return 'not_implemented';
    case 'partially_implemented': return 'partially_implemented';
    case 'implemented':
      switch (i.evidence) {
        case 'accepted': return i.evidenceExpired ? 'blocked_missing_evidence' : i.blockingFindings ? 'ineffective' : 'effective';
        case 'submitted': return 'awaiting_review';
        case 'rejected': return 'ineffective';
        case 'in_progress': return 'implemented_pending_validation';
        default: return 'blocked_missing_evidence';
      }
  }
  return 'not_assessed';
}
export type Summary = { total: number; applicable: number; byState: Record<EvalState, number>; effective: number; awaitingReview: number; overdue: number; readinessPercent: number | null };
export const emptySummary = (): Summary => ({ total: 0, applicable: 0, byState: Object.fromEntries(STATES.map(s => [s, 0])) as Record<EvalState, number>, effective: 0, awaitingReview: 0, overdue: 0, readinessPercent: null });
/** An item is overdue when it has a due date before `today` (YYYY-MM-DD) and is neither effective nor not-applicable. */
export const isOverdue = (state: EvalState, dueDate: string | null, today: string) => !!dueDate && dueDate < today && state !== 'effective' && state !== 'not_applicable';
/** Rows may be grouped: `count` defaults to 1. readinessPercent = effective / applicable, one decimal, null when nothing is applicable. */
export function summarize(rows: (EvalInput & { dueDate?: string | null; count?: number })[], today: string): Summary {
  const s = emptySummary();
  for (const r of rows) {
    const n = r.count ?? 1; const st = evaluateItem(r); s.total += n; s.byState[st] += n; if (isOverdue(st, r.dueDate ?? null, today)) s.overdue += n;
  }
  s.effective = s.byState.effective; s.awaitingReview = s.byState.awaiting_review; s.applicable = s.total - s.byState.not_applicable;
  s.readinessPercent = s.applicable ? Math.round((s.effective / s.applicable) * 1000) / 10 : null; return s;
}
export const mergeSummaries = (list: Summary[]): Summary => { const s = emptySummary(); for (const x of list) { s.total += x.total; s.overdue += x.overdue; for (const k of STATES) s.byState[k] += x.byState[k]; }
  s.effective = s.byState.effective; s.awaitingReview = s.byState.awaiting_review; s.applicable = s.total - s.byState.not_applicable; s.readinessPercent = s.applicable ? Math.round((s.effective / s.applicable) * 1000) / 10 : null; return s; };

/** One checklist row (as returned by listItems / itemFacts) -> its evaluated state. The single place the row shape is interpreted, shared by the checklist screen and the reports. */
export function evalRow(r: any, today: string) {
  const allNA = r.linkCount > 0 && Number(r.naLinks) === Number(r.linkCount);
  const state = evaluateItem({ readiness: r.readiness, evidence: r.evidence, allControlsNotApplicable: allNA, evidenceExpired: !!r.evidenceExpired, blockingFindings: !!r.blockingFindings });
  return { state, stateLabel: STATE_LABEL[state], overdue: isOverdue(state, r.dueDate, today) };
}
