// TENANT-SCOPED DATA LAYER for VAPT rounds. The only file that runs SQL on vapt_rounds and vapt_notice_log.
import { q, type Conn } from '../../db';
const D = (c: string, a: string) => `DATE_FORMAT(${c},'%Y-%m-%d') ${a}`;
const COLS = `r.id, r.engagement_id engagementId, r.round_no roundNo, r.title, r.scope, r.tester, ${D('r.planned_on', 'plannedOn')}, ${D('r.started_on', 'startedOn')}, ${D('r.report_issued_on', 'reportIssuedOn')}, r.report_title reportTitle, r.report_ref reportRef,
  ${D('r.retest_planned_on', 'retestPlannedOn')}, ${D('r.retested_on', 'retestedOn')}, r.status, r.closed_at closedAt, r.created_by createdBy, r.created_at createdAt,
  (SELECT COUNT(*) FROM findings f WHERE f.tenant_id=r.tenant_id AND f.round_id=r.id) findings,
  (SELECT COUNT(*) FROM findings f WHERE f.tenant_id=r.tenant_id AND f.round_id=r.id AND f.status IN ('open','in_remediation','ready_for_retest')) openFindings`;
export const list = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT ${COLS} FROM vapt_rounds r WHERE r.tenant_id=? AND r.engagement_id=? ORDER BY r.round_no`, [tenantId, engagementId]);
export const get = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${COLS} FROM vapt_rounds r WHERE r.tenant_id=? AND r.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
export const inEngagement = async (c: Conn, tenantId: string, engagementId: string, id: string) => (await q(c, 'SELECT id, status FROM vapt_rounds WHERE tenant_id=? AND engagement_id=? AND id=?', [tenantId, engagementId, id]))[0] ?? null;
export const nextNo = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, 'SELECT COALESCE(MAX(round_no),0)+1 n FROM vapt_rounds WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].n);
export const liveCount = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, "SELECT COUNT(*) n FROM vapt_rounds WHERE tenant_id=? AND engagement_id=? AND status <> 'cancelled'", [tenantId, engagementId]))[0].n);
export const insert = (c: Conn, tenantId: string, r: { id: string; engagementId: string; no: number; title: string; scope: string | null; tester: string | null; plannedOn: string; createdBy: string }) =>
  c.query('INSERT INTO vapt_rounds(tenant_id,id,engagement_id,round_no,title,scope,tester,planned_on,created_by) VALUES (?,?,?,?,?,?,?,?,?)', [tenantId, r.id, r.engagementId, r.no, r.title, r.scope, r.tester, r.plannedOn, r.createdBy]);
const FIELDS: Record<string, string> = { title: 'title', scope: 'scope', tester: 'tester', plannedOn: 'planned_on', startedOn: 'started_on', reportIssuedOn: 'report_issued_on', reportTitle: 'report_title', reportRef: 'report_ref', retestPlannedOn: 'retest_planned_on', retestedOn: 'retested_on' };
export async function update(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in FIELDS); if (!keys.length) return; await c.query(`UPDATE vapt_rounds SET ${keys.map(k => `${FIELDS[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k] ?? null), tenantId, id]);
}
export const setStatus = (c: Conn, tenantId: string, id: string, to: string) => c.query(`UPDATE vapt_rounds SET status=?, closed_at=${to === 'closed' ? 'NOW(3)' : 'NULL'} WHERE tenant_id=? AND id=?`, [to, tenantId, id]);
