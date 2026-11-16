// TENANT-SCOPED DATA LAYER for analytics: read-only aggregates over findings and evidence requests. Every query carries tenant_id and the caller's engagement ids.
import { q, type Conn } from '../../db';
const IN = (n: number) => Array(n).fill('?').join(',');
const UNRESOLVED = "('open','in_remediation','ready_for_retest')";
export async function findingFacts(c: Conn, tenantId: string, engIds: string[], today: string, since: string) {
  if (!engIds.length) return { grid: [], ages: [], overdue: [], raised: [], closed: [], avgDaysToClose: null as number | null };
  const base = [tenantId, ...engIds]; const w = `tenant_id=? AND engagement_id IN (${IN(engIds.length)})`;
  const [grid, ages, overdue, raised, closed, avg] = await Promise.all([
    q(c, `SELECT status, severity, COUNT(*) n FROM findings WHERE ${w} GROUP BY status, severity`, base),
    q(c, `SELECT DATEDIFF(?, DATE(created_at)) d, COUNT(*) n FROM findings WHERE ${w} AND status IN ${UNRESOLVED} GROUP BY d`, [today, ...base]),
    q(c, `SELECT DATEDIFF(?, due_date) d, COUNT(*) n FROM findings WHERE ${w} AND status IN ${UNRESOLVED} AND due_date IS NOT NULL AND due_date < ? GROUP BY d`, [today, ...base, today]),
    q(c, `SELECT DATE_FORMAT(created_at,'%Y-%m') month, COUNT(*) n FROM findings WHERE ${w} AND created_at >= ? GROUP BY month`, [...base, since]),
    q(c, `SELECT DATE_FORMAT(closed_at,'%Y-%m') month, COUNT(*) n FROM findings WHERE ${w} AND status='closed' AND closed_at >= ? GROUP BY month`, [...base, since]),
    q(c, `SELECT AVG(DATEDIFF(closed_at, created_at)) a, COUNT(*) n FROM findings WHERE ${w} AND status='closed' AND closed_at >= ?`, [...base, since]),
  ]);
  return { grid: grid.map((r: any) => ({ status: r.status, severity: r.severity, n: Number(r.n) })), ages: ages.map((r: any) => ({ days: Number(r.d), n: Number(r.n) })), overdue: overdue.map((r: any) => ({ days: Number(r.d), n: Number(r.n) })),
    raised: raised.map((r: any) => ({ month: r.month, raised: Number(r.n) })), closed: closed.map((r: any) => ({ month: r.month, closed: Number(r.n) })), avgDaysToClose: Number(avg[0]?.n) ? Math.round(Number(avg[0].a) * 10) / 10 : null };
}
export async function evidenceFacts(c: Conn, tenantId: string, engIds: string[], today: string, since: string) {
  if (!engIds.length) return { byStatus: [], expiring30: 0, expiring60: 0, expired: 0, reviews: [] };
  const base = [tenantId, ...engIds]; const w = `tenant_id=? AND engagement_id IN (${IN(engIds.length)})`;
  const [byStatus, exp, reviews] = await Promise.all([
    q(c, `SELECT status, COUNT(*) n FROM evidence_requests WHERE ${w} GROUP BY status`, base),
    q(c, `SELECT SUM(valid_until >= ? AND valid_until <= DATE_ADD(?, INTERVAL 30 DAY)) e30, SUM(valid_until >= ? AND valid_until <= DATE_ADD(?, INTERVAL 60 DAY)) e60, SUM(valid_until < ?) ex FROM evidence_requests WHERE ${w} AND status='accepted' AND valid_until IS NOT NULL`, [today, today, today, today, today, ...base]),
    q(c, `SELECT DATE_FORMAT(v.reviewed_at,'%Y-%m') month, v.decision, COUNT(*) n FROM evidence_reviews v JOIN evidence_requests r ON r.tenant_id=v.tenant_id AND r.id=v.request_id WHERE r.tenant_id=? AND r.engagement_id IN (${IN(engIds.length)}) AND v.reviewed_at >= ? GROUP BY month, v.decision`, [...base, since]),
  ]);
  return { byStatus: byStatus.map((r: any) => ({ status: r.status, n: Number(r.n) })), expiring30: Number(exp[0]?.e30 ?? 0), expiring60: Number(exp[0]?.e60 ?? 0), expired: Number(exp[0]?.ex ?? 0), reviews: reviews.map((r: any) => ({ month: r.month, decision: r.decision, n: Number(r.n) })) };
}

/** Every organization, for administrators' overview. Names and counts only; opening one still needs access to it. */
export const allOrganizations = (c: Conn) => q(c, 'SELECT id, name, status, is_demo isDemo FROM organizations ORDER BY name', []);
