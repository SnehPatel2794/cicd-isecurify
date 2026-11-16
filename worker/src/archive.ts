// Evidence archival. Nothing is deleted: an engagement closed for longer than its organization's retention period is MARKED archived (a read-only record, kept in full).
// A legal hold on the organization or the engagement stops it; an engagement an administrator has restored is never archived again automatically.
import type { Handler, Pool } from './queue';
export const BATCH = 200;
export async function archiveDue(pool: Pool, limit = BATCH): Promise<number> {
  const [rows]: any = await pool.query(`SELECT e.tenant_id tenantId, e.id, e.closed_at closedAt, o.retention_months retention, (SELECT COUNT(*) FROM evidence_requests r WHERE r.tenant_id=e.tenant_id AND r.engagement_id=e.id) n
    FROM engagements e JOIN organizations o ON o.id=e.tenant_id
    WHERE e.status='closed' AND e.closed_at IS NOT NULL AND e.closed_at < DATE_SUB(NOW(3), INTERVAL o.retention_months MONTH) AND e.legal_hold=0 AND o.legal_hold=0
      AND NOT EXISTS (SELECT 1 FROM evidence_archive a WHERE a.tenant_id=e.tenant_id AND a.engagement_id=e.id)
      AND EXISTS (SELECT 1 FROM evidence_requests r WHERE r.tenant_id=e.tenant_id AND r.engagement_id=e.id) ORDER BY e.closed_at LIMIT ?`, [limit]);
  let done = 0;
  for (const r of rows) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [ins]: any = await c.query('INSERT IGNORE INTO evidence_archive(tenant_id,engagement_id,retention_months,closed_at,request_count) VALUES (?,?,?,?,?)', [r.tenantId, r.id, r.retention, r.closedAt, r.n]);
      if (ins.affectedRows) { await c.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity,entity_id,detail) VALUES (?,NULL,'evidence.archived','engagement',?,?)", [r.tenantId, r.id, JSON.stringify({ engagementId: r.id, retentionMonths: r.retention, requests: Number(r.n), by: 'retention schedule' })]); done++; }
      await c.commit();
    } catch (e) { try { await c.rollback(); } catch { /* gone */ } throw e; } finally { c.release(); }
  }
  return done;
}
export const makeArchiveHandler = (log: { info: (o: any, m?: string) => void }): Handler => async (_j, { pool }) => { const n = await archiveDue(pool); if (n) log.info({ archived: n }, 'evidence archival'); };
