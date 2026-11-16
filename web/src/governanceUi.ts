// Pure helpers for the policy and incident screens (Phase 9C).
export const POLICY_CATEGORY: Record<string, string> = { security: 'Security', privacy: 'Privacy', hr: 'People / HR', operations: 'Operations', compliance: 'Compliance', other: 'Other' };
export const AUDIENCE: Record<string, string> = { staff: 'Client admins and staff', everyone: 'Everyone, including vendors' };
export const VERSION_TONE: Record<string, 'slate' | 'amber' | 'green' | 'brand'> = { draft: 'slate', in_review: 'amber', published: 'green', superseded: 'slate' };
export const VERSION_ACTION: Record<string, string> = { in_review: 'Submit for approval', published: 'Approve and publish', draft: 'Send back' };
/** "2 of 5 acknowledged"; "Nobody required" when the audience is empty. */
export const ackText = (done: number, required: number) => required === 0 ? 'Nobody required' : `${done} of ${required} acknowledged`;
export const ackPercent = (done: number, required: number) => required ? Math.round(done / required * 100) : 0;
/** The one-line state of a policy in the list. */
export function policyState(p: { archived: boolean; liveVersionNo: number | null; openStatus: string | null; reviewOverdue: boolean }) {
  if (p.archived) return 'Archived'; if (p.liveVersionNo === null) return p.openStatus === 'in_review' ? 'In review (never published)' : 'Draft (never published)'; if (p.reviewOverdue) return `Version ${p.liveVersionNo} · review overdue`; return `Version ${p.liveVersionNo} · published`;
}
export const INCIDENT_CATEGORY: Record<string, string> = { security_breach: 'Security breach', data_loss: 'Data loss or leak', malware: 'Malware', phishing: 'Phishing', availability: 'Outage or availability', physical: 'Physical', privacy: 'Privacy', other: 'Other' };
export const SEVERITY_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { low: 'green', medium: 'amber', high: 'red', critical: 'red' };
export const INCIDENT_TONE: Record<string, 'slate' | 'amber' | 'green' | 'brand' | 'red'> = { reported: 'red', investigating: 'amber', contained: 'brand', resolved: 'green', closed: 'slate' };
export const INCIDENT_ACTION: Record<string, string> = { investigating: 'Start investigation', contained: 'Mark contained', resolved: 'Mark resolved', closed: 'Close incident' };
export type INeed = { note: boolean; noteRequired: boolean; rootCause: boolean; lessons: boolean; actions: boolean; notified: boolean };
/** What the status dialog must collect, mirroring the server rules so people are not sent through avoidable errors. */
export function incidentNeeds(from: string, to: string, inc: { notifiable: boolean; authorityNotifiedAt: string | null; rootCause: string | null; lessons: string | null; correctiveActions: string | null }): INeed {
  const n: INeed = { note: false, noteRequired: false, rootCause: false, lessons: false, actions: false, notified: false };
  if (to === 'investigating' && from !== 'reported') { n.note = n.noteRequired = true; }
  if (to === 'contained') n.note = true;
  if (to === 'resolved') { n.note = true; n.rootCause = true; }
  if (to === 'closed' && from === 'reported') { n.note = n.noteRequired = true; }
  if (to === 'closed' && from !== 'reported') { n.note = true; n.lessons = true; n.actions = true; n.notified = inc.notifiable && !inc.authorityNotifiedAt; }
  return n;
}
/** datetime-local value (local time) to an ISO string, and back. */
export const toIso = (local: string) => local ? new Date(local).toISOString() : null;
export const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
/** Whole hours between two ISO times, for "open for 5 h". */
export const hoursOpen = (from: string, to: string | null, now = Date.now()) => Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 3600000));
