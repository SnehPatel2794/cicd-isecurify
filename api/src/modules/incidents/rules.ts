// Incident rules: PURE functions (no I/O, no clock) so every rule is testable and the routes stay thin.
//   reported -> investigating -> contained -> resolved (root cause) -> closed (lessons, corrective actions, authority notified if required; not by the owner)
export const CATEGORIES = ['security_breach', 'data_loss', 'malware', 'phishing', 'availability', 'physical', 'privacy', 'other'] as const; export type Category = typeof CATEGORIES[number];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const; export type Severity = typeof SEVERITIES[number];
export const STATUSES = ['reported', 'investigating', 'contained', 'resolved', 'closed'] as const; export type IStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<IStatus, string> = { reported: 'Reported', investigating: 'Investigating', contained: 'Contained', resolved: 'Resolved', closed: 'Closed' };
export const CATEGORY_LABEL: Record<Category, string> = { security_breach: 'Security breach', data_loss: 'Data loss or leak', malware: 'Malware', phishing: 'Phishing', availability: 'Outage or availability', physical: 'Physical', privacy: 'Privacy', other: 'Other' };
export const TRANSITIONS: Record<IStatus, IStatus[]> = { reported: ['investigating', 'closed'], investigating: ['contained'], contained: ['resolved', 'investigating'], resolved: ['closed', 'investigating'], closed: ['investigating'] };
export const isOpen = (s: IStatus) => s !== 'closed';

export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
const auditor = (w: Who) => w.via === 'member' && w.role === 'tp_auditor'; const clientAdmin = (w: Who) => w.via === 'member' && w.role === 'client_admin'; const staffMgr = (w: Who) => w.via === 'staff' && w.manage;
/** Triage: set severity, owner and whether authorities must be told; close incidents. */
export const canTriage = (w: Who) => clientAdmin(w) || staffMgr(w);
/** Everyone who belongs to the organization (and managing staff) can report an incident; auditors can too. */
export const canReport = (w: Who) => w.via === 'member' || staffMgr(w);
/** Who sees every incident. Others see only incidents they reported or own. */
export const canSeeAll = (w: Who) => canTriage(w) || auditor(w);
/** Work the incident: the owner and the people who triage. */
export const canWork = (w: Who, isOwner: boolean) => isOwner || canTriage(w);

export type Check = { ok: true } | { ok: false; status: 400 | 403 | 409; code: string; message: string };
const no = (status: 400 | 403 | 409, code: string, message: string): Check => ({ ok: false, status, code, message });
export type IncidentFacts = { status: IStatus; ownerUserId: string | null; notifiable: boolean; authorityNotifiedAt: string | null; rootCause: string | null; correctiveActions: string | null; lessons: string | null };
export type Input = { note?: string | null; rootCause?: string | null; correctiveActions?: string | null; lessons?: string | null; authorityNotifiedAt?: string | null };
const has = (s: string | null | undefined) => !!(s ?? '').trim();

/** Checks a status change. The facts that hold afterwards are the supplied ones, else the stored ones. */
export function transitionCheck(i: IncidentFacts, to: IStatus, w: Who, isOwner: boolean, inp: Input): Check {
  if (i.status === to) return no(409, 'no_change', 'The incident is already in that status');
  if (!TRANSITIONS[i.status].includes(to)) return no(409, 'bad_transition', `An incident cannot go from ${STATUS_LABEL[i.status].toLowerCase()} to ${STATUS_LABEL[to].toLowerCase()}`);
  const note = has(inp.note); const pick = (a: string | null | undefined, b: string | null) => a === undefined ? b : a;
  switch (to) {
    case 'investigating': if (!canWork(w, isOwner)) return no(403, 'forbidden', 'Only the incident owner, client admins and managing staff can start or reopen an investigation');
      if (i.status === 'reported' && !i.ownerUserId) return no(400, 'owner_required', 'Assign an owner before investigating');
      if (i.status !== 'reported' && !note) return no(400, 'note_required', 'Say why the incident is reopened'); return { ok: true };
    case 'contained': return canWork(w, isOwner) ? { ok: true } : no(403, 'forbidden', 'Only the incident owner, client admins and managing staff can record containment');
    case 'resolved': if (!canWork(w, isOwner)) return no(403, 'forbidden', 'Only the incident owner, client admins and managing staff can resolve an incident'); return has(pick(inp.rootCause, i.rootCause)) ? { ok: true } : no(400, 'root_cause_required', 'Record the root cause before resolving');
    case 'closed': {
      if (!canTriage(w)) return no(403, 'forbidden', 'Only client admins and managing staff can close an incident');
      if (i.status === 'reported') return note ? { ok: true } : no(400, 'note_required', 'Say why this report is dismissed (for example a false alarm)');
      if (isOwner) return no(403, 'self_review', 'You cannot close an incident you own: someone else must');
      if (!has(pick(inp.lessons, i.lessons))) return no(400, 'lessons_required', 'Record the lessons learned before closing'); if (!has(pick(inp.correctiveActions, i.correctiveActions))) return no(400, 'actions_required', 'Record the corrective actions before closing');
      if (i.notifiable && !pick(inp.authorityNotifiedAt, i.authorityNotifiedAt)) return no(400, 'notification_required', 'This incident must be reported to the authorities. Record when they were notified'); return { ok: true }; }
    default: return no(409, 'bad_transition', 'Not allowed');
  }
}
export const allowedTargets = (from: IStatus, w: Who, isOwner: boolean) => TRANSITIONS[from].filter(to => { const r = transitionCheck({ status: from, ownerUserId: 'x', notifiable: false, authorityNotifiedAt: null, rootCause: 'x', correctiveActions: 'x', lessons: 'x' }, to, w, isOwner, { note: 'x' }); return r.ok; });
export type EditField = 'title' | 'description' | 'category' | 'severity' | 'ownerUserId' | 'notifiable' | 'authorityNotifiedAt' | 'occurredAt' | 'detectedAt' | 'rootCause' | 'correctiveActions' | 'lessons';
/** Which fields a person may change. A closed incident is frozen until reopened. The reporter may reword their own report until it is picked up. */
export function editCheck(status: IStatus, fields: EditField[], w: Who, isOwner: boolean, isReporter: boolean): Check {
  if (status === 'closed') return no(409, 'closed', 'A closed incident cannot be edited. Reopen it first');
  for (const f of fields) {
    if (f === 'rootCause' || f === 'correctiveActions' || f === 'lessons') { if (!canWork(w, isOwner)) return no(403, 'forbidden', 'Only the incident owner, client admins and managing staff can record the findings of the investigation'); }
    else if (f === 'title' || f === 'description') { if (!(canTriage(w) || (isReporter && status === 'reported'))) return no(403, 'forbidden', 'Only client admins and managing staff can reword an incident (the reporter can until it is picked up)'); }
    else if (!canTriage(w)) return no(403, 'forbidden', 'Only client admins and managing staff can triage an incident');
  }
  return { ok: true };
}
/** Hours between two ISO timestamps, rounded to one decimal; null if either is missing. */
export const hoursBetween = (from: string | null, to: string | null) => from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 360000) / 10 : null;
export function summarize(rows: { status: IStatus; severity: Severity; notifiable: boolean; authorityNotifiedAt: string | null; detectedAt?: string | null; resolvedAt?: string | null }[]) {
  const out = { total: 0, open: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } as Record<Severity, number>, byStatus: { reported: 0, investigating: 0, contained: 0, resolved: 0, closed: 0 } as Record<IStatus, number>, notificationsPending: 0, meanHoursToResolve: null as number | null };
  let sum = 0, n = 0; for (const r of rows) { out.total++; out.byStatus[r.status]++; if (isOpen(r.status)) { out.open++; out.bySeverity[r.severity]++; if (r.notifiable && !r.authorityNotifiedAt) out.notificationsPending++; } const h = hoursBetween(r.detectedAt ?? null, r.resolvedAt ?? null); if (h !== null && h >= 0) { sum += h; n++; } }
  if (n) out.meanHoursToResolve = Math.round(sum / n * 10) / 10; return out;
}
