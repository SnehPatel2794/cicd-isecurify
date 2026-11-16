// The kinds of in-app notification and who may switch them off. Pure: no database, no framework.
export const KINDS = {
  'item.assigned':          { group: 'Checklist',  label: 'A checklist item is assigned to me' },
  'evidence.requested':     { group: 'Evidence',   label: 'Evidence is requested on an item I am accountable for' },
  'evidence.submitted':     { group: 'Evidence',   label: 'Evidence is submitted for a request I made' },
  'evidence.accepted':      { group: 'Evidence',   label: 'Evidence I submitted is accepted' },
  'evidence.rejected':      { group: 'Evidence',   label: 'Evidence I submitted is rejected' },
  'finding.assigned':       { group: 'Findings',   label: 'A finding is assigned to me' },
  'finding.ready_for_retest': { group: 'Findings', label: 'A finding I raised is ready for retest' },
  'finding.closed':         { group: 'Findings',   label: 'A finding I own is closed or accepted as a risk' },
  'finding.reopened':       { group: 'Findings',   label: 'A finding I own is reopened or sent back' },
  'reminder.due_soon':      { group: 'Reminders',  label: 'Something of mine is due within 3 days' },
  'reminder.overdue':       { group: 'Reminders',  label: 'Something of mine is overdue (repeats weekly)' },
  'engagement.signed_off':  { group: 'Engagements', label: 'The auditor signs off an engagement' },
  'questionnaire.sent_back': { group: 'Engagements', label: 'Staff send a questionnaire answer back for changes' },
  'task.assigned':          { group: 'Tasks', label: 'A task is assigned to me, or someone comments on a task of mine' },
  'task.due':               { group: 'Tasks', label: 'A task of mine is due soon or overdue' },
  'vapt.round_due':         { group: 'Engagements', label: 'A VAPT round is coming up, due or late' },
  'certificate.issued':     { group: 'Certificates', label: 'A certificate is issued to my organization' },
  'certificate.revoked':    { group: 'Certificates', label: 'A certificate of my organization is revoked' },
  'risk.assigned':          { group: 'Risks',      label: 'A risk is assigned to me' },
  'risk.decision':          { group: 'Risks',      label: 'A risk I own is accepted, closed or reopened' },
  'policy.published':       { group: 'Policies',   label: 'A policy needs my acknowledgement' },
  'policy.review':          { group: 'Policies',   label: 'A policy version is waiting for my approval' },
  'incident.assigned':      { group: 'Incidents',  label: 'An incident is assigned to me' },
  'incident.reported':      { group: 'Incidents',  label: 'A high or critical incident is reported' },
  'vendor.assessment_requested': { group: 'Vendors', label: 'A security assessment is requested from my vendor' },
  'vendor.assessment_submitted': { group: 'Vendors', label: 'An assessment of a vendor I own is submitted' },
  'vendor.assessment_decided': { group: 'Vendors', label: 'An assessment I submitted is approved, rejected or sent back' },
  'evidence.malware':       { group: 'Evidence',   label: 'A file I uploaded or requested is found to contain malware' },
  'engagement.phase_advanced': { group: 'Engagements', label: 'An engagement I am on moves to the next phase' },
  'control_test.due':       { group: 'Continuous controls', label: 'A recurring control test of mine is due or overdue' },
  'control_test.failed':    { group: 'Continuous controls', label: 'A recurring control test fails' },
  'evidence.refresh_due':   { group: 'Continuous controls', label: 'Evidence on a refresh schedule is due to be requested again' },
  'finding.comment':        { group: 'Findings',   label: 'Someone comments on a finding I own or raised' },
} as const;
/** Kinds that are also emailed unless the person switches email off. The rest stay in the app (and in the digest) unless the person switches email on. */
export const EMAIL_DEFAULT: ReadonlySet<string> = new Set(['evidence.requested', 'evidence.rejected', 'evidence.malware', 'finding.assigned', 'finding.ready_for_retest', 'risk.assigned', 'policy.published', 'policy.review', 'incident.assigned', 'incident.reported', 'vendor.assessment_requested', 'vendor.assessment_decided', 'certificate.issued', 'certificate.revoked', 'item.assigned']);
export const emailDefault = (k: string) => EMAIL_DEFAULT.has(k);
export type Kind = keyof typeof KINDS;
export const KIND_LIST = Object.keys(KINDS) as Kind[];
export const isKind = (k: string): k is Kind => Object.prototype.hasOwnProperty.call(KINDS, k);
/** Short label text is stored with each notification; this caps it and removes control characters. */
export const cleanLabel = (s: unknown, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || '(untitled)';
/** Which recipients should actually receive a notification: never the person who did it, never twice, never someone who switched the kind off. */
export function pickRecipients(candidates: (string | null | undefined)[], actorId: string | null, off: ReadonlySet<string>): string[] {
  const out: string[] = []; for (const u of candidates) if (u && u !== actorId && !off.has(u) && !out.includes(u)) out.push(u); return out;
}
