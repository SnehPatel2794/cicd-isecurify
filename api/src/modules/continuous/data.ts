// TENANT-SCOPED DATA LAYER for continuous controls (control tests and their runs, evidence schedules, posture snapshots). Every function takes tenantId and puts it in every WHERE/JOIN.
import { q, type Conn } from '../../db';
const D = (col: string, as: string) => `DATE_FORMAT(${col},'%Y-%m-%d') ${as}`;
const TEST = `t.id, t.engagement_id engagementId, e.name engagementName, e.status engagementStatus, t.item_id itemId, i.ref itemRef, i.title itemTitle, t.title, t.procedure_text AS \`procedure\`, t.frequency, t.owner_user_id ownerUserId,
  COALESCE(t.owner_user_id, i.accountable_user_id) responsibleUserId, ru.name responsibleName, i.accountable_user_id accountableUserId, ${D('t.next_due_on', 'nextDueOn')}, t.status, t.last_result lastResult, ${D('t.last_run_on', 'lastRunOn')}, t.created_by createdBy, t.created_at createdAt`;
const TEST_FROM = `FROM control_tests t JOIN checklist_items i ON i.tenant_id=t.tenant_id AND i.id=t.item_id JOIN engagements e ON e.tenant_id=t.tenant_id AND e.id=t.engagement_id LEFT JOIN users ru ON ru.id=COALESCE(t.owner_user_id, i.accountable_user_id)`;
export async function listTests(c: Conn, tenantId: string, f: { engagementIds: string[]; itemId?: string; assignedUserId?: string }) {
  if (!f.engagementIds.length) return [] as any[]; const w = ['t.tenant_id=?', 't.engagement_id IN (?)']; const p: any[] = [tenantId, f.engagementIds];
  if (f.itemId) { w.push('t.item_id=?'); p.push(f.itemId); } if (f.assignedUserId) { w.push('COALESCE(t.owner_user_id, i.accountable_user_id)=?'); p.push(f.assignedUserId); }
  return q(c, `SELECT ${TEST} ${TEST_FROM} WHERE ${w.join(' AND ')} ORDER BY t.next_due_on, t.title LIMIT 2000`, p);
}
export const getTest = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${TEST} ${TEST_FROM} WHERE t.tenant_id=? AND t.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
export const countTestsOnItem = async (c: Conn, tenantId: string, itemId: string) => Number((await q(c, 'SELECT COUNT(*) n FROM control_tests WHERE tenant_id=? AND item_id=?', [tenantId, itemId]))[0].n);
export async function insertTest(c: Conn, tenantId: string, t: { id: string; engagementId: string; itemId: string; title: string; procedure?: string | null; frequency: string; ownerUserId?: string | null; nextDueOn: string; createdBy: string }) {
  await c.query('INSERT INTO control_tests(tenant_id,id,engagement_id,item_id,title,procedure_text,frequency,owner_user_id,next_due_on,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)', [tenantId, t.id, t.engagementId, t.itemId, t.title, t.procedure ?? null, t.frequency, t.ownerUserId ?? null, t.nextDueOn, t.createdBy]);
}
const TEST_COLS: Record<string, string> = { title: 'title', procedure: 'procedure_text', frequency: 'frequency', ownerUserId: 'owner_user_id', nextDueOn: 'next_due_on', status: 'status' };
export async function updateTest(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in TEST_COLS); if (!keys.length) return; await c.query(`UPDATE control_tests SET ${keys.map(k => `${TEST_COLS[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k]), tenantId, id]);
}
export async function insertRun(c: Conn, tenantId: string, r: { id: string; testId: string; engagementId: string; itemId: string; performedOn: string; result: 'pass' | 'fail'; note: string; performedBy: string }) {
  await c.query('INSERT INTO control_test_runs(tenant_id,id,test_id,engagement_id,item_id,performed_on,result,note,performed_by) VALUES (?,?,?,?,?,?,?,?,?)', [tenantId, r.id, r.testId, r.engagementId, r.itemId, r.performedOn, r.result, r.note, r.performedBy]);
}
export const recordResult = (c: Conn, tenantId: string, id: string, result: string, performedOn: string, nextDueOn: string) =>
  c.query('UPDATE control_tests SET last_result=?, last_run_on=?, next_due_on=? WHERE tenant_id=? AND id=?', [result, performedOn, nextDueOn, tenantId, id]);
export const listRuns = (c: Conn, tenantId: string, testId: string) => q(c, `SELECT r.id, ${D('r.performed_on', 'performedOn')}, r.result, r.note, r.performed_by performedBy, u.name performedByName, r.created_at createdAt FROM control_test_runs r JOIN users u ON u.id=r.performed_by WHERE r.tenant_id=? AND r.test_id=? ORDER BY r.performed_on DESC, r.created_at DESC LIMIT 200`, [tenantId, testId]);
/** The result a test would show after the newest remaining run: the run with the latest performed_on (ties: the latest recorded). */
export const latestRun = async (c: Conn, tenantId: string, testId: string) => (await q(c, `SELECT ${D('performed_on', 'performedOn')}, result FROM control_test_runs WHERE tenant_id=? AND test_id=? ORDER BY performed_on DESC, created_at DESC LIMIT 1`, [tenantId, testId]))[0] ?? null;
export const clientAdminIds = async (c: Conn, tenantId: string) => (await q(c, "SELECT m.user_id id FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='active' WHERE m.tenant_id=? AND m.role='client_admin'", [tenantId])).map(r => r.id as string);

// ----- evidence schedules -----
const SCH = `s.id, s.engagement_id engagementId, e.name engagementName, e.status engagementStatus, s.item_id itemId, i.ref itemRef, i.title itemTitle, i.accountable_user_id accountableUserId, au.name accountableName, i.readiness_status itemReadiness, s.title, s.instructions, s.template_id templateId, s.valid_months validMonths,
  s.every_months everyMonths, s.due_days dueDays, ${D('s.next_run_on', 'nextRunOn')}, s.status, ${D('s.last_opened_on', 'lastOpenedOn')}, s.last_request_id lastRequestId, s.created_by createdBy, s.created_at createdAt`;
const SCH_FROM = `FROM evidence_schedules s JOIN checklist_items i ON i.tenant_id=s.tenant_id AND i.id=s.item_id JOIN engagements e ON e.tenant_id=s.tenant_id AND e.id=s.engagement_id LEFT JOIN users au ON au.id=i.accountable_user_id`;
export async function listSchedules(c: Conn, tenantId: string, f: { engagementIds: string[]; itemId?: string; assignedUserId?: string }) {
  if (!f.engagementIds.length) return [] as any[]; const w = ['s.tenant_id=?', 's.engagement_id IN (?)']; const p: any[] = [tenantId, f.engagementIds];
  if (f.itemId) { w.push('s.item_id=?'); p.push(f.itemId); } if (f.assignedUserId) { w.push('i.accountable_user_id=?'); p.push(f.assignedUserId); }
  return q(c, `SELECT ${SCH} ${SCH_FROM} WHERE ${w.join(' AND ')} ORDER BY s.next_run_on, s.title LIMIT 2000`, p);
}
export const getSchedule = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${SCH} ${SCH_FROM} WHERE s.tenant_id=? AND s.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
export async function insertSchedule(c: Conn, tenantId: string, s: { id: string; engagementId: string; itemId: string; title: string; instructions?: string | null; templateId?: string | null; validMonths?: number | null; everyMonths: number; dueDays: number; nextRunOn: string; createdBy: string }) {
  await c.query('INSERT INTO evidence_schedules(tenant_id,id,engagement_id,item_id,title,instructions,template_id,valid_months,every_months,due_days,next_run_on,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [tenantId, s.id, s.engagementId, s.itemId, s.title, s.instructions ?? null, s.templateId ?? null, s.validMonths ?? null, s.everyMonths, s.dueDays, s.nextRunOn, s.createdBy]);
}
const SCH_COLS: Record<string, string> = { title: 'title', instructions: 'instructions', templateId: 'template_id', validMonths: 'valid_months', everyMonths: 'every_months', dueDays: 'due_days', nextRunOn: 'next_run_on', status: 'status' };
export async function updateSchedule(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in SCH_COLS); if (!keys.length) return; await c.query(`UPDATE evidence_schedules SET ${keys.map(k => `${SCH_COLS[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k]), tenantId, id]);
}
export const deleteSchedule = (c: Conn, tenantId: string, id: string) => c.query('DELETE FROM evidence_schedules WHERE tenant_id=? AND id=?', [tenantId, id]);
export const markOpened = (c: Conn, tenantId: string, id: string, requestId: string, openedOn: string, nextRunOn: string) =>
  c.query('UPDATE evidence_schedules SET last_opened_on=?, last_request_id=?, next_run_on=? WHERE tenant_id=? AND id=?', [openedOn, requestId, nextRunOn, tenantId, id]);
export const activeTemplate = async (c: Conn, id: string) => (await q(c, 'SELECT 1 x FROM evidence_templates WHERE id=? AND active=1', [id]))[0] ?? null;

// ----- posture -----
export const snapshots = (c: Conn, tenantId: string, engagementIds: string[], since: string) => engagementIds.length ? q(c, `SELECT engagement_id engagementId, framework_id frameworkId, ${D('snap_date', 'date')}, applicable, effective, awaiting_review awaitingReview, overdue, percent, tests_total testsTotal, tests_overdue testsOverdue, tests_failing testsFailing
  FROM posture_snapshots WHERE tenant_id=? AND engagement_id IN (?) AND snap_date >= ? ORDER BY snap_date`, [tenantId, engagementIds, since]) : Promise.resolve([] as any[]);
export const frameworksOf = (c: Conn, tenantId: string, engagementIds: string[]) => engagementIds.length ? q(c, `SELECT ef.engagement_id engagementId, f.id frameworkId, f.name, f.color, r.version, ef.is_primary isPrimary FROM engagement_frameworks ef JOIN frameworks f ON f.id=ef.framework_id JOIN framework_releases r ON r.id=ef.release_id
  WHERE ef.tenant_id=? AND ef.engagement_id IN (?) ORDER BY ef.is_primary DESC, f.name`, [tenantId, engagementIds]) : Promise.resolve([] as any[]);
