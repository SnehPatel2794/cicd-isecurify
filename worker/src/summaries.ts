// Keeps engagement_summary fresh. Three reasons to recompute an engagement:
//   1. it is in summary_dirty (a trigger saw a change) - handled within a couple of seconds,
//   2. it has no summary yet, or the summary was computed on an earlier day (overdue / expired depend on the date),
//   3. it is active and its summary is older than REFRESH_MINUTES (catch-up, in case anything was missed).
// The dirty mark is removed only if it has not moved since we started computing (compare-and-delete on marked_at), so a change that lands mid-computation is picked up on the next pass.
import { computeSummaries, REFRESH_MINUTES } from '../../shared/readiness'; import type { Pool } from './queue';
export const BATCH = 200; export const DEBOUNCE_MS = 1500;
type Cand = { tenantId: string; id: string; marked: string | null };
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);
export async function refreshDue(pool: Pool, o: { limit?: number; today?: string } = {}): Promise<number> {
  const limit = o.limit ?? BATCH, today = o.today ?? utcToday();
  const [rows]: any = await pool.query(`SELECT e.tenant_id tenantId, e.id, DATE_FORMAT(d.marked_at,'%Y-%m-%d %H:%i:%s.%f') marked FROM engagements e
      LEFT JOIN engagement_summary s ON s.tenant_id=e.tenant_id AND s.engagement_id=e.id LEFT JOIN summary_dirty d ON d.tenant_id=e.tenant_id AND d.engagement_id=e.id
      WHERE (d.marked_at IS NOT NULL AND d.marked_at < DATE_SUB(NOW(3), INTERVAL ? * 1000 MICROSECOND)) OR s.engagement_id IS NULL OR s.computed_for <> ? OR (e.status='active' AND s.computed_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE))
      ORDER BY (d.marked_at IS NULL), d.marked_at LIMIT ?`, [DEBOUNCE_MS, today, REFRESH_MINUTES, limit]);
  const by = new Map<string, Cand[]>(); for (const r of rows as Cand[]) (by.get(r.tenantId) ?? by.set(r.tenantId, []).get(r.tenantId)!).push(r);
  let done = 0;
  for (const [tenantId, list] of by) {
    const query = async (sql: string, p?: any[]) => (await pool.query(sql, p))[0] as any[];
    const results = await computeSummaries(query, tenantId, list.map(x => x.id), today);
    const marks = new Map(list.map(x => [x.id, x.marked]));
    for (const r of results) {
      await pool.query(`INSERT INTO engagement_summary(tenant_id,engagement_id,summary,findings_unresolved,findings_critical,findings_overdue,computed_for,computed_at) VALUES (?,?,?,?,?,?,?,NOW(3))
        ON DUPLICATE KEY UPDATE summary=VALUES(summary), findings_unresolved=VALUES(findings_unresolved), findings_critical=VALUES(findings_critical), findings_overdue=VALUES(findings_overdue), computed_for=VALUES(computed_for), computed_at=VALUES(computed_at)`,
        [tenantId, r.engagementId, JSON.stringify(r.summary), r.findings.unresolved, r.findings.critical, r.findings.overdue, today]);
      const m = marks.get(r.engagementId); if (m) await pool.query('DELETE FROM summary_dirty WHERE tenant_id=? AND engagement_id=? AND marked_at=?', [tenantId, r.engagementId, m]);
      done++;
    }
  }
  return done;
}
