// Auditor sign-off rules. Pure: no database, no framework.
export const OPINIONS = ['unqualified', 'qualified', 'adverse'] as const; export type Opinion = typeof OPINIONS[number];
export const OPINION_LABEL: Record<Opinion, string> = { unqualified: 'Unqualified (no exceptions)', qualified: 'Qualified (with exceptions)', adverse: 'Adverse (controls not effective)' };
export type Active = { id: string; kind: 'auditor' | 'waiver'; opinion: Opinion | null; applicable: number; effective: number; unresolved: number } | null;
export type Facts = { status: 'active' | 'closed'; phase: number; applicable: number; effective: number; unresolvedSerious: number; hasAuditor: boolean; active: Active };
type Verdict = { ok: true } | { ok: false; code: string; message: string };
const no = (code: string, message: string): Verdict => ({ ok: false, code, message });
const common = (f: Facts): Verdict | null => f.status === 'closed' ? no('engagement_closed', 'This engagement is closed') : f.phase !== 5 ? no('not_final_phase', 'Sign-off is recorded in the Closure phase (phase 5)') : f.active ? no('already_signed_off', 'A sign-off is already recorded. Withdraw it first to record a new one') : null;
/** May the auditor record this opinion now? An unqualified opinion is only possible when every applicable control is effective and no serious finding is open. */
export function checkOpinion(f: Facts, opinion: Opinion): Verdict {
  const c = common(f); if (c) return c;
  if (opinion === 'unqualified' && (f.effective < f.applicable || f.unresolvedSerious > 0)) return no('not_unqualified', `An unqualified opinion needs every applicable control effective and no serious finding open (now ${f.effective} of ${f.applicable} effective, ${f.unresolvedSerious} serious findings open). Record a qualified opinion, or wait`);
  return { ok: true };
}
/** A waiver is for engagements with no external auditor. */
export function checkWaiver(f: Facts): Verdict { const c = common(f); if (c) return c; return f.hasAuditor ? no('auditor_assigned', 'An auditor is assigned to this engagement, so the auditor must sign off') : { ok: true }; }
/** Why the engagement cannot close yet, or null. */
export function closeReason(f: Facts): string | null {
  const a = f.active;
  if (f.hasAuditor) { if (!a || a.kind !== 'auditor') return 'The third-party auditor has not signed off'; }
  else if (!a) return 'No auditor is assigned: record a sign-off waiver with the reason';
  if (a && a.kind === 'auditor' && a.opinion === 'unqualified' && (f.effective < f.applicable || f.unresolvedSerious > 0)) return 'Readiness changed after the unqualified sign-off: the auditor must withdraw it and sign again';
  return null;
}
/** May a certificate be issued under this sign-off? An adverse opinion never certifies. */
export function certificateCheck(a: Active): Verdict { if (!a) return no('no_signoff', 'This engagement has no auditor sign-off'); if (a.opinion === 'adverse') return no('adverse_opinion', 'The auditor gave an adverse opinion, so a certificate cannot be issued'); return { ok: true }; }
