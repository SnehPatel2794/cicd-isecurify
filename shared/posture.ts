// Compliance posture per framework, and the health of recurring control tests (Phase 11A). Shared by the API (live values) and the worker (daily snapshots),
// so there is one definition of "how compliant is this engagement against this framework".
// An item counts toward a framework when at least one of its linked controls belongs to that framework's release in this engagement; one item can count toward several frameworks.
// Custom items (no linked control) belong to no framework and are therefore not part of a per-framework score (they remain in the engagement's overall readiness).
import { summarize, type Summary } from './evaluation'; import type { Query } from './readiness';
export type FrameworkSummary = { engagementId: string; frameworkId: string; summary: Summary };
export async function frameworkSummaries(query: Query, tenantId: string, engagementIds: string[], today: string): Promise<FrameworkSummary[]> {
  if (!engagementIds.length) return [];
  const rows = await query(`SELECT i.engagement_id engagementId, f.framework_id frameworkId, i.readiness_status readiness, i.evidence_status evidence, (COALESCE(x.n,0)>0 AND x.n=x.na) allNA, (i.due_date IS NOT NULL AND i.due_date < ?) overdue,
    EXISTS(SELECT 1 FROM evidence_requests er WHERE er.tenant_id=i.tenant_id AND er.item_id=i.id AND er.status='accepted' AND er.valid_until IS NOT NULL AND er.valid_until < ?) expired,
    EXISTS(SELECT 1 FROM findings fx WHERE fx.tenant_id=i.tenant_id AND fx.item_id=i.id AND fx.status IN ('open','in_remediation','ready_for_retest') AND fx.severity IN ('critical','high','medium')) blocking, COUNT(*) count
    FROM checklist_items i
    JOIN (SELECT DISTINCT l.tenant_id, l.item_id, ef.framework_id FROM checklist_item_controls l JOIN framework_controls c ON c.id=l.control_id
          JOIN engagement_frameworks ef ON ef.tenant_id=l.tenant_id AND ef.engagement_id=l.engagement_id AND ef.release_id=c.release_id WHERE l.tenant_id=? AND l.engagement_id IN (?)) f ON f.tenant_id=i.tenant_id AND f.item_id=i.id
    LEFT JOIN (SELECT l.tenant_id,l.item_id, COUNT(*) n, SUM(COALESCE(s.applicable,1)=0) na FROM checklist_item_controls l LEFT JOIN soa_entries s ON s.tenant_id=l.tenant_id AND s.engagement_id=l.engagement_id AND s.control_id=l.control_id
      WHERE l.tenant_id=? GROUP BY l.tenant_id,l.item_id) x ON x.tenant_id=i.tenant_id AND x.item_id=i.id
    WHERE i.tenant_id=? AND i.engagement_id IN (?) GROUP BY i.engagement_id, f.framework_id, i.readiness_status, i.evidence_status, allNA, overdue, expired, blocking`,
    [today, today, tenantId, engagementIds, tenantId, tenantId, engagementIds]);
  const by = new Map<string, any[]>(); for (const r of rows) { const k = `${r.engagementId}|${r.frameworkId}`; (by.get(k) ?? by.set(k, []).get(k)!).push({ readiness: r.readiness, evidence: r.evidence, allControlsNotApplicable: !!r.allNA, evidenceExpired: !!r.expired, blockingFindings: !!r.blocking, dueDate: r.overdue ? '1970-01-01' : null, count: Number(r.count) }); }
  return [...by.entries()].map(([k, v]) => { const [engagementId, frameworkId] = k.split('|'); return { engagementId, frameworkId, summary: summarize(v, today) }; });
}
export type TestHealth = { total: number; overdue: number; failing: number; dueSoon: number };
export const emptyHealth = (): TestHealth => ({ total: 0, overdue: 0, failing: 0, dueSoon: 0 });
export const DUE_SOON_DAYS = 7;
/** Active recurring tests per engagement: how many exist, how many are overdue, how many last failed, how many fall due within a week. */
export async function testHealth(query: Query, tenantId: string, engagementIds: string[], today: string, assignedUserId?: string): Promise<Map<string, TestHealth>> {
  const out = new Map<string, TestHealth>(); if (!engagementIds.length) return out;
  const rows = await query(`SELECT t.engagement_id e, COUNT(*) total, SUM(t.next_due_on < ?) overdue, SUM(t.last_result='fail') failing, SUM(t.next_due_on >= ? AND t.next_due_on <= DATE_ADD(?, INTERVAL ${DUE_SOON_DAYS} DAY)) dueSoon
    FROM control_tests t JOIN checklist_items i ON i.tenant_id=t.tenant_id AND i.id=t.item_id WHERE t.tenant_id=? AND t.engagement_id IN (?) AND t.status='active' ${assignedUserId ? 'AND COALESCE(t.owner_user_id, i.accountable_user_id)=?' : ''} GROUP BY t.engagement_id`,
    [today, today, today, tenantId, engagementIds, ...(assignedUserId ? [assignedUserId] : [])]);
  for (const r of rows) out.set(r.e, { total: Number(r.total), overdue: Number(r.overdue ?? 0), failing: Number(r.failing ?? 0), dueSoon: Number(r.dueSoon ?? 0) }); return out;
}
