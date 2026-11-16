// SQL for the search / My Work screens that no other module already offers. Every query is tenant-scoped and restricted to the engagement ids the caller may see.
import { q, type Conn } from '../../db'; import { likeOf } from './rules';
export async function searchItems(c: Conn, tenantId: string, term: string, engIds: string[], o: { assignedUserId?: string; limit: number }) {
  if (!engIds.length) return []; const w = ['i.tenant_id=?', 'i.engagement_id IN (?)', "(i.ref LIKE ? ESCAPE '!' OR i.title LIKE ? ESCAPE '!' OR i.domain LIKE ? ESCAPE '!' OR i.description LIKE ? ESCAPE '!')"]; const l = likeOf(term); const p: any[] = [tenantId, engIds, l, l, l, l];
  if (o.assignedUserId) { w.push('i.accountable_user_id=?'); p.push(o.assignedUserId); }
  return q(c, `SELECT i.id, i.engagement_id engagementId, i.ref, i.title, i.description, i.domain, i.readiness_status status, i.accountable_user_id ownerUserId, u.name ownerName FROM checklist_items i LEFT JOIN users u ON u.id=i.accountable_user_id WHERE ${w.join(' AND ')} ORDER BY i.engagement_id, i.sort_order LIMIT ?`, [...p, o.limit + 1]);
}
/** Evidence submitted and waiting for a reviewer, in the given engagements (the caller has already limited these to what the reviewer may see). */
export async function submittedEvidence(c: Conn, tenantId: string, engIds: string[], limit: number) {
  if (!engIds.length) return []; return q(c, `SELECT r.id, r.engagement_id engagementId, r.item_id itemId, r.title, i.ref itemRef, DATE_FORMAT(r.due_date,'%Y-%m-%d') dueDate, r.updated_at since FROM evidence_requests r JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id
    WHERE r.tenant_id=? AND r.status='submitted' AND r.engagement_id IN (?) ORDER BY r.updated_at LIMIT ?`, [tenantId, engIds, limit + 1]);
}
