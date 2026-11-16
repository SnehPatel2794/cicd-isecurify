// The readiness SERVICE shared by the API and the worker: facts about checklist items in, evaluated summaries out. No framework, no pool type: the caller passes a `query` function,
// so there is exactly one implementation of "how ready is this engagement" (the evaluation rules in ./evaluation plus the queries below).
import { summarize, mergeSummaries, type Summary } from './evaluation';
export type Query = (sql: string, params?: any[]) => Promise<any[]>;
export type ItemFact = { engagementId: string; readiness: any; evidence: any; allControlsNotApplicable: boolean; evidenceExpired: boolean; blockingFindings: boolean; dueDate: string | null; count: number };
/** Grouped facts for the evaluation service: one row per distinct (engagement, readiness, evidence, all-controls-N/A, overdue?, evidence-expired?, blocking?) with a count. */
export async function itemFacts(query: Query, tenantId: string, o: { today: string; engagementIds?: string[]; assignedUserId?: string }): Promise<ItemFact[]> {
  const w = ['i.tenant_id=?']; const p: any[] = [o.today, tenantId, tenantId];
  if (o.engagementIds) { if (!o.engagementIds.length) return []; w.push('i.engagement_id IN (?)'); p.push(o.engagementIds); } if (o.assignedUserId) { w.push('i.accountable_user_id=?'); p.push(o.assignedUserId); }
  const rows = await query(`SELECT i.engagement_id engagementId, i.readiness_status readiness, i.evidence_status evidence, (COALESCE(x.n,0)>0 AND x.n=x.na) allNA, (i.due_date IS NOT NULL AND i.due_date < ?) overdue,
    EXISTS(SELECT 1 FROM evidence_requests er WHERE er.tenant_id=i.tenant_id AND er.item_id=i.id AND er.status='accepted' AND er.valid_until IS NOT NULL AND er.valid_until < ?) expired,
    EXISTS(SELECT 1 FROM findings fx WHERE fx.tenant_id=i.tenant_id AND fx.item_id=i.id AND fx.status IN ('open','in_remediation','ready_for_retest') AND fx.severity IN ('critical','high','medium')) blocking, COUNT(*) count
    FROM checklist_items i LEFT JOIN (SELECT l.tenant_id,l.item_id, COUNT(*) n, SUM(COALESCE(s.applicable,1)=0) na FROM checklist_item_controls l LEFT JOIN soa_entries s ON s.tenant_id=l.tenant_id AND s.engagement_id=l.engagement_id AND s.control_id=l.control_id
      WHERE l.tenant_id=? GROUP BY l.tenant_id,l.item_id) x ON x.tenant_id=i.tenant_id AND x.item_id=i.id WHERE ${w.join(' AND ')} GROUP BY i.engagement_id,i.readiness_status,i.evidence_status,allNA,overdue,expired,blocking`, [o.today, o.today, tenantId, ...p.slice(2)]);
  return rows.map(r => ({ engagementId: r.engagementId as string, readiness: r.readiness, evidence: r.evidence, allControlsNotApplicable: !!r.allNA, evidenceExpired: !!r.expired, blockingFindings: !!r.blocking, dueDate: r.overdue ? '1970-01-01' : null, count: Number(r.count) }));
}
export type FindingCounts = { unresolved: number; critical: number; overdue: number };
/** Unresolved findings, unresolved critical findings and overdue unresolved findings, per engagement (same definitions as the findings analytics). */
export async function findingCounts(query: Query, tenantId: string, engagementIds: string[], today: string): Promise<Map<string, FindingCounts>> {
  const out = new Map<string, FindingCounts>(); if (!engagementIds.length) return out;
  const rows = await query(`SELECT engagement_id e, COUNT(*) unresolved, SUM(severity='critical') critical, SUM(due_date IS NOT NULL AND due_date < ?) overdue FROM findings WHERE tenant_id=? AND engagement_id IN (?) AND status IN ('open','in_remediation','ready_for_retest') GROUP BY engagement_id`, [today, tenantId, engagementIds]);
  for (const r of rows) out.set(r.e, { unresolved: Number(r.unresolved), critical: Number(r.critical ?? 0), overdue: Number(r.overdue ?? 0) }); return out;
}
export type EngagementSummary = { engagementId: string; summary: Summary; findings: FindingCounts };
/** THE computation: one readiness summary and the finding counts for each engagement, as of `today`. */
export async function computeSummaries(query: Query, tenantId: string, engagementIds: string[], today: string): Promise<EngagementSummary[]> {
  if (!engagementIds.length) return [];
  const [facts, fc] = await Promise.all([itemFacts(query, tenantId, { today, engagementIds }), findingCounts(query, tenantId, engagementIds, today)]);
  const by = new Map<string, ItemFact[]>(); for (const f of facts) (by.get(f.engagementId) ?? by.set(f.engagementId, []).get(f.engagementId)!).push(f);
  return engagementIds.map(id => ({ engagementId: id, summary: summarize(by.get(id) ?? [], today), findings: fc.get(id) ?? { unresolved: 0, critical: 0, overdue: 0 } }));
}
export const mergeAll = (list: EngagementSummary[]) => ({ summary: mergeSummaries(list.map(x => x.summary)), findings: list.reduce((a, x) => ({ unresolved: a.unresolved + x.findings.unresolved, critical: a.critical + x.findings.critical, overdue: a.overdue + x.findings.overdue }), { unresolved: 0, critical: 0, overdue: 0 }) });
/** A summary is stale when it was computed more than 15 minutes ago (the worker refreshes every ~10 minutes and within seconds of a change). */
export const STALE_MINUTES = 15; export const REFRESH_MINUTES = 10;
export const isStale = (computedAt: Date | string | number, now: number) => now - new Date(computedAt).getTime() > STALE_MINUTES * 60_000;

export type ItemRow = { id: string; ref: string; title: string; engagementId: string; ownerUserId: string | null; ownerName: string | null; dueDate: string | null; readiness: any; evidence: any; allControlsNotApplicable: boolean; evidenceExpired: boolean; blockingFindings: boolean };
/** Which items could possibly be in an evaluation state, as a cheap SQL condition on the claim and the evidence (a superset; the exact state is still computed by evaluateItem). '' means "cannot narrow in SQL". */
export const coarseSql = (state?: string): string => ({
  not_assessed: "i.readiness_status='not_started'", not_implemented: "i.readiness_status='in_progress'", partially_implemented: "i.readiness_status='partially_implemented'",
  implemented_pending_validation: "i.readiness_status='implemented' AND i.evidence_status='in_progress'", awaiting_review: "i.readiness_status='implemented' AND i.evidence_status='submitted'", ineffective: "i.readiness_status='implemented' AND i.evidence_status IN ('accepted','rejected')",
  blocked_missing_evidence: "i.readiness_status='implemented' AND i.evidence_status IN ('accepted','requested','not_requested')", effective: "i.readiness_status='implemented' AND i.evidence_status='accepted'",
} as Record<string, string>)[state ?? ''] ?? '';
/** One row per checklist item with the facts the evaluator needs (the ungrouped sibling of itemFacts), for the engagements given. `overdue` narrows to items past their due date in SQL. */
export async function itemRows(query: Query, tenantId: string, o: { today: string; engagementIds: string[]; assignedUserId?: string; ownerUserId?: string; overdue?: boolean; state?: string; like?: string }): Promise<ItemRow[]> {
  if (!o.engagementIds.length) return [];
  const w = ['i.tenant_id=?', 'i.engagement_id IN (?)']; const wp: any[] = [tenantId, o.engagementIds];
  const who = o.assignedUserId ?? o.ownerUserId; if (who) { w.push('i.accountable_user_id=?'); wp.push(who); }
  if (o.overdue) { w.push('i.due_date IS NOT NULL AND i.due_date < ?'); wp.push(o.today); }
  const c = coarseSql(o.state); if (c) w.push(`(${c})`);
  if (o.like) { w.push("(i.ref LIKE ? ESCAPE '!' OR i.title LIKE ? ESCAPE '!')"); wp.push(o.like, o.like); }
  const rows = await query(`SELECT i.id, i.ref, i.title, i.engagement_id engagementId, i.accountable_user_id ownerUserId, u.name ownerName, DATE_FORMAT(i.due_date,'%Y-%m-%d') dueDate, i.readiness_status readiness, i.evidence_status evidence,
    (COALESCE(x.n,0)>0 AND x.n=x.na) allNA,
    EXISTS(SELECT 1 FROM evidence_requests er WHERE er.tenant_id=i.tenant_id AND er.item_id=i.id AND er.status='accepted' AND er.valid_until IS NOT NULL AND er.valid_until < ?) expired,
    EXISTS(SELECT 1 FROM findings fx WHERE fx.tenant_id=i.tenant_id AND fx.item_id=i.id AND fx.status IN ('open','in_remediation','ready_for_retest') AND fx.severity IN ('critical','high','medium')) blocking
    FROM checklist_items i LEFT JOIN users u ON u.id=i.accountable_user_id LEFT JOIN (SELECT l.tenant_id,l.item_id, COUNT(*) n, SUM(COALESCE(s.applicable,1)=0) na FROM checklist_item_controls l LEFT JOIN soa_entries s ON s.tenant_id=l.tenant_id AND s.engagement_id=l.engagement_id AND s.control_id=l.control_id
      WHERE l.tenant_id=? GROUP BY l.tenant_id,l.item_id) x ON x.tenant_id=i.tenant_id AND x.item_id=i.id WHERE ${w.join(' AND ')}`, [o.today, tenantId, ...wp]);
  return rows.map(r => ({ id: r.id, ref: r.ref, title: r.title, engagementId: r.engagementId, ownerUserId: r.ownerUserId, ownerName: r.ownerName, dueDate: r.dueDate, readiness: r.readiness, evidence: r.evidence, allControlsNotApplicable: !!r.allNA, evidenceExpired: !!r.expired, blockingFindings: !!r.blocking }));
}
