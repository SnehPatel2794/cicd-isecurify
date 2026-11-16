// Data access for the summary tables (engagement_summary, summary_dirty). The API only reads them; the worker writes (see worker/src/summaries.ts).
import { q, type Conn } from '../../db';
export type Stored = { engagementId: string; summary: any; findings: { unresolved: number; critical: number; overdue: number }; computedFor: string; computedAt: Date };
export async function readStored(c: Conn, tenantId: string, ids: string[]): Promise<Stored[]> {
  if (!ids.length) return [];
  const rows = await q(c, `SELECT engagement_id engagementId, summary, findings_unresolved u, findings_critical k, findings_overdue o, DATE_FORMAT(computed_for,'%Y-%m-%d') computedFor, computed_at computedAt FROM engagement_summary WHERE tenant_id=? AND engagement_id IN (?)`, [tenantId, ids]);
  return rows.map(r => ({ engagementId: r.engagementId, summary: typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary, findings: { unresolved: Number(r.u), critical: Number(r.k), overdue: Number(r.o) }, computedFor: r.computedFor, computedAt: new Date(r.computedAt) }));
}
export async function readDirty(c: Conn, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await q(c, 'SELECT engagement_id id FROM summary_dirty WHERE tenant_id=? AND engagement_id IN (?)', [tenantId, ids])).map(r => r.id as string));
}
