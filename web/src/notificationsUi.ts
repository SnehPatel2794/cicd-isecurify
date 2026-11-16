// Pure helpers for notifications: where a notification leads, and how to say when it happened.
export type Note = { id: number; tenantId: string; tenantName?: string; kind: string; entityType: 'finding' | 'evidence_request' | 'checklist_item' | 'certificate' | 'risk' | 'policy' | 'vendor' | 'incident'; entityId: string; engagementId: string | null; label: string; createdAt: string; read: boolean; actorName?: string | null; kindLabel?: string };
/** The screen that shows the thing. Opening it goes through the normal authorised routes, so a person who lost access simply sees "not found". */
export function targetOf(n: Pick<Note, 'tenantId' | 'entityType' | 'entityId' | 'engagementId'>): string {
  const org = `/org/${n.tenantId}`;
  if (n.entityType === 'finding') return `${org}/findings?open=${encodeURIComponent(n.entityId)}`;
  if (n.entityType === 'risk') return `${org}/risks`;
  if (n.entityType === 'policy') return `${org}/policies`;
  if (n.entityType === 'incident') return `${org}/incidents`;
  if (n.entityType === 'vendor') return `${org}/vendors`;
  if (n.entityType === 'certificate') return `${org}/certificates`;
  if (!n.engagementId) return `${org}/engagements`;
  return `${org}/engagements/${n.engagementId}?tab=${n.entityType === 'evidence_request' ? 'Evidence' : 'Checklist'}`;
}
const HEADLINE: Record<string, string> = {
  'item.assigned': 'assigned you a checklist item', 'evidence.requested': 'requested evidence from you', 'evidence.submitted': 'submitted evidence you requested', 'evidence.accepted': 'accepted your evidence', 'evidence.rejected': 'rejected your evidence',
  'finding.assigned': 'assigned you a finding', 'finding.ready_for_retest': 'marked a finding ready for retest', 'finding.closed': 'closed a finding you own', 'finding.reopened': 'sent a finding back to remediation', 'finding.comment': 'commented on a finding', 'certificate.issued': 'issued a certificate', 'policy.published': 'published a policy for you to acknowledge', 'policy.review': 'submitted a policy version for your approval', 'incident.assigned': 'assigned you an incident', 'incident.reported': 'reported a high-severity incident', 'risk.assigned': 'assigned you a risk', 'risk.decision': 'updated the status of a risk you own', 'certificate.revoked': 'revoked a certificate',
};
/** "Priya assigned you a finding". Falls back to the stored description when the kind is unknown (an older or newer server). */
const REMINDER: Record<string, string> = { 'reminder.due_soon': 'Due soon', 'reminder.overdue': 'Overdue' };
export const headline = (n: Pick<Note, 'kind' | 'actorName' | 'kindLabel'>) => REMINDER[n.kind] ? REMINDER[n.kind] : HEADLINE[n.kind] ? `${n.actorName ?? 'Someone'} ${HEADLINE[n.kind]}` : (n.kindLabel ?? n.kind);
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)); if (s < 60) return 'just now'; const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`; const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24); if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`; return new Date(iso).toISOString().slice(0, 10);
}
export const countText = (n: number) => n > 99 ? '99+' : String(n);
