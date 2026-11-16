// Finding rules: PURE functions (no I/O, no clock) so every rule can be tested exhaustively and the routes stay thin.
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'observation'] as const; export type Severity = typeof SEVERITIES[number];
export const STATUSES = ['open', 'in_remediation', 'ready_for_retest', 'closed', 'risk_accepted', 'cancelled'] as const; export type FStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<FStatus, string> = { open: 'Open', in_remediation: 'In remediation', ready_for_retest: 'Ready for retest', closed: 'Closed', risk_accepted: 'Risk accepted', cancelled: 'Cancelled' };
export const TERMINAL: readonly FStatus[] = ['closed', 'risk_accepted', 'cancelled'];
/** Findings that stop a control from being "effective": still unresolved AND at least medium severity. Accepted risk is an explicit decision, so it does not block; low and observation never do. */
export const BLOCKING_SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium'];
export const UNRESOLVED: readonly FStatus[] = ['open', 'in_remediation', 'ready_for_retest'];
export const isUnresolved = (s: FStatus) => UNRESOLVED.includes(s);
export const isBlocking = (s: FStatus, sev: Severity) => isUnresolved(s) && BLOCKING_SEVERITIES.includes(sev);
export const isOverdue = (s: FStatus, dueDate: string | null, today: string) => isUnresolved(s) && !!dueDate && dueDate < today;
/** Suggested remediation window in days, used only to pre-fill the due date in the UI. */
export const DEFAULT_DAYS: Record<Severity, number> = { critical: 7, high: 30, medium: 60, low: 90, observation: 180 };

// ---------------------------------------------------------------- who may do what (inputs come from tenancy `resolveAccess`)
export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
const isAuditor = (w: Who) => w.via === 'member' && w.role === 'tp_auditor';
const isClientAdmin = (w: Who) => w.via === 'member' && w.role === 'client_admin';
/** Raise, edit the substance of, retest, close, accept risk on, cancel: the TP auditor (engagement membership is enforced by the caller's scope) and iSecurify staff with manage rights. */
export const canAssess = (w: Who) => isAuditor(w) || (w.via === 'staff' && w.manage);
/** Owner, due date: the people who run the client side. */
export const canAssign = (w: Who) => isClientAdmin(w) || (w.via === 'staff' && w.manage);
/** Remediation plan and "ready for retest": the finding's owner, client admins and managing staff. */
export const canRemediate = (w: Who, isOwner: boolean) => isOwner || canAssign(w);
/** Attach remediation evidence to a finding: the people who assess it and the people who fix it. */
export const canLinkEvidence = (w: Who, isOwner: boolean) => canAssess(w) || canRemediate(w, isOwner);
export const canComment = (_w: Who) => true;   // anyone who can SEE the finding; visibility is enforced by the caller

// ---------------------------------------------------------------- state machine
type Rule = { to: FStatus; note: boolean; who: (w: Who, isOwner: boolean) => boolean; noSelf?: boolean };
export const TRANSITIONS: Record<FStatus, Rule[]> = {
  open: [{ to: 'in_remediation', note: false, who: canRemediate }, { to: 'risk_accepted', note: true, who: canAssess, noSelf: true }, { to: 'cancelled', note: true, who: canAssess }],
  in_remediation: [{ to: 'ready_for_retest', note: true, who: canRemediate }, { to: 'risk_accepted', note: true, who: canAssess, noSelf: true }, { to: 'cancelled', note: true, who: canAssess }],
  ready_for_retest: [{ to: 'closed', note: true, who: canAssess, noSelf: true }, { to: 'in_remediation', note: true, who: canAssess }, { to: 'risk_accepted', note: true, who: canAssess, noSelf: true }, { to: 'cancelled', note: true, who: canAssess }],
  closed: [{ to: 'open', note: true, who: canAssess }],
  risk_accepted: [{ to: 'open', note: true, who: canAssess }],
  cancelled: [],
};
export type Check = { ok: true } | { ok: false; status: 400 | 403 | 409; code: string; message: string };
/** `isOwner`: the actor is the finding's remediation owner. Nobody may close or accept the risk of a finding they own (no marking your own homework). */
export function transitionCheck(from: FStatus, to: FStatus, w: Who, isOwner: boolean, note: string | null | undefined): Check {
  if (from === to) return { ok: false, status: 409, code: 'no_change', message: `The finding is already ${STATUS_LABEL[to].toLowerCase()}` };
  const r = TRANSITIONS[from].find(t => t.to === to); if (!r) return { ok: false, status: 409, code: 'bad_transition', message: `A finding that is ${STATUS_LABEL[from].toLowerCase()} cannot become ${STATUS_LABEL[to].toLowerCase()}` };
  if (!r.who(w, isOwner)) return { ok: false, status: 403, code: 'forbidden', message: 'You cannot make this change' };
  if (r.noSelf && isOwner) return { ok: false, status: 403, code: 'self_review', message: 'You cannot close or accept the risk of a finding you own' };
  if (r.note && !(note ?? '').trim()) return { ok: false, status: 400, code: 'note_required', message: 'A note is required for this change' };
  return { ok: true };
}
/** Transitions the caller could perform right now (drives the buttons; the server re-checks). */
export const allowedTransitions = (from: FStatus, w: Who, isOwner: boolean): { to: FStatus; note: boolean }[] =>
  TRANSITIONS[from].filter(r => r.who(w, isOwner) && !(r.noSelf && isOwner)).map(r => ({ to: r.to, note: r.note }));

/** Which edits a caller may make to a non-terminal finding. Terminal findings are frozen: reopen first. */
export type EditField = 'title' | 'description' | 'recommendation' | 'severity' | 'ownerUserId' | 'dueDate' | 'remediationPlan';
export function editCheck(fields: EditField[], status: FStatus, w: Who, isOwner: boolean): Check {
  if (TERMINAL.includes(status)) return { ok: false, status: 409, code: 'finding_closed', message: 'This finding is closed. Reopen it to change it.' };
  for (const f of fields) {
    const ok = f === 'ownerUserId' || f === 'dueDate' ? canAssign(w) || (f === 'dueDate' && canAssess(w)) : f === 'remediationPlan' ? canRemediate(w, isOwner) : canAssess(w);
    if (!ok) return { ok: false, status: 403, code: 'forbidden', message: `You cannot change ${f}` };
  }
  return { ok: true };
}
/** Pure summary over grouped rows so lists and dashboards agree. */
export type Row = { status: FStatus; severity: Severity; dueDate: string | null; count?: number };
export function summarize(rows: Row[], today: string) {
  const out = { total: 0, unresolved: 0, blocking: 0, overdue: 0, byStatus: Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<FStatus, number>, bySeverity: Object.fromEntries(SEVERITIES.map(s => [s, 0])) as Record<Severity, number> };
  for (const r of rows) { const n = r.count ?? 1; out.total += n; out.byStatus[r.status] += n; out.bySeverity[r.severity] += n; if (isUnresolved(r.status)) out.unresolved += n; if (isBlocking(r.status, r.severity)) out.blocking += n; if (isOverdue(r.status, r.dueDate, today)) out.overdue += n; }
  return out;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), negative when `to` is earlier. Calendar arithmetic only. */
export function daysBetween(from: string, to: string): number { return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000); }
/** Ageing for remediation tracking: how long it has been open and, if unresolved and late, how many days late. */
export function ageing(createdAt: string, status: FStatus, dueDate: string | null, today: string) { return { ageDays: Math.max(0, daysBetween(createdAt.slice(0, 10), today)), daysOverdue: isOverdue(status, dueDate, today) ? daysBetween(dueDate!, today) : 0 }; }
/** Buckets for the overdue chart: 1-7, 8-30, 31-90, 90+ days late. */
export const overdueBucket = (days: number) => days <= 0 ? null : days <= 7 ? '1-7' : days <= 30 ? '8-30' : days <= 90 ? '31-90' : '90+';
