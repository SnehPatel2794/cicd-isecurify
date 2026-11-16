// TENANT-SCOPED DATA LAYER for engagements, checklists, SOA, phases, milestones and discovery (all tenant-owned tables).
// Every function takes tenantId explicitly and puts it in every WHERE/JOIN. Only this file (plus tenancy/data.ts, audit/data.ts) may touch these tables.
import { itemFacts as sharedItemFacts } from '../../../../shared/readiness'; import { q, type Conn } from '../../db'; import { overdueCount as tasksOverdueCount } from '../tasks/data'; import { snapshot as snapshotQuestionnaire, progressRows as questionnaireRows } from '../questionnaires/data'; import { progress as qProgress } from '../questionnaires/rules'; import { uuid } from '../../platform/crypto';

export const PHASE_NAMES = ['Preparation', 'Scheduling', 'Audit Meeting', 'Follow-up', 'Closure'] as const;
export type Scope = { kind: 'all' } | { kind: 'auditor'; userId: string } | { kind: 'assigned'; userId: string };
const D = (col: string, as: string) => `DATE_FORMAT(${col},'%Y-%m-%d') ${as}`;
const ENG = `e.tenant_id, e.id, e.renewed_from renewedFrom, (SELECT r.name FROM engagements r WHERE r.tenant_id=e.tenant_id AND r.id=e.renewed_from) renewedFromName, e.name, e.client_ref clientRef, e.status, e.current_phase currentPhase, ${D('e.start_date', 'startDate')}, ${D('e.end_date', 'endDate')}, e.soc2_path soc2Path, e.document_number documentNumber,
  e.document_owner documentOwner, e.classification, e.review_cycle reviewCycle, e.document_version documentVersion, e.client_address clientAddress, e.created_at createdAt, e.closed_at closedAt,
  EXISTS(SELECT 1 FROM evidence_archive a WHERE a.tenant_id=e.tenant_id AND a.engagement_id=e.id AND a.restored_at IS NULL) archived, e.legal_hold legalHold`;
const scopeJoin = (s: Scope) => s.kind === 'auditor' ? { sql: 'AND EXISTS (SELECT 1 FROM engagement_members m WHERE m.tenant_id=e.tenant_id AND m.engagement_id=e.id AND m.user_id=?)', p: [s.userId] }
  : s.kind === 'assigned' ? { sql: 'AND EXISTS (SELECT 1 FROM checklist_items i WHERE i.tenant_id=e.tenant_id AND i.engagement_id=e.id AND i.accountable_user_id=?)', p: [s.userId] } : { sql: '', p: [] as string[] };

// ---------------- engagements ----------------
export const getEngagement = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${ENG} FROM engagements e WHERE e.tenant_id=? AND e.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
export const getVisibleEngagement = async (c: Conn, tenantId: string, id: string, scope: Scope) => { const j = scopeJoin(scope); return (await q(c, `SELECT ${ENG} FROM engagements e WHERE e.tenant_id=? AND e.id=? ${j.sql}`, [tenantId, id, ...j.p]))[0] ?? null; };
export const listEngagements = (c: Conn, tenantId: string, scope: Scope) => { const j = scopeJoin(scope); return q(c, `SELECT ${ENG} FROM engagements e WHERE e.tenant_id=? ${j.sql} ORDER BY e.created_at DESC, e.name`, [tenantId, ...j.p]); };
export async function insertEngagement(c: Conn, tenantId: string, e: { id: string; name: string; clientRef?: string | null; startDate?: string | null; endDate?: string | null; soc2Path?: string | null; createdBy: string; renewedFrom?: string | null; doc?: Record<string, string | null | undefined> }) {
  await c.query(`INSERT INTO engagements(tenant_id,id,name,client_ref,start_date,end_date,soc2_path,document_number,document_owner,classification,review_cycle,document_version,client_address,created_by,renewed_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tenantId, e.id, e.name, e.clientRef ?? null, e.startDate ?? null, e.endDate ?? null, e.soc2Path ?? null, e.doc?.documentNumber ?? null, e.doc?.documentOwner ?? null, e.doc?.classification ?? null, e.doc?.reviewCycle ?? null, e.doc?.documentVersion ?? null, e.doc?.clientAddress ?? null, e.createdBy, e.renewedFrom ?? null]);
}
const ENG_COLS: Record<string, string> = { name: 'name', clientRef: 'client_ref', startDate: 'start_date', endDate: 'end_date', documentNumber: 'document_number', documentOwner: 'document_owner', classification: 'classification', reviewCycle: 'review_cycle', documentVersion: 'document_version', clientAddress: 'client_address' };
export async function updateEngagement(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in ENG_COLS); if (!keys.length) return;
  await c.query(`UPDATE engagements SET ${keys.map(k => `${ENG_COLS[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k] ?? null), tenantId, id]);
}
export const setPhaseNumber = async (c: Conn, tenantId: string, id: string, phase: number) => { await c.query('UPDATE engagements SET current_phase=? WHERE tenant_id=? AND id=?', [phase, tenantId, id]); };
export const closeEngagement = async (c: Conn, tenantId: string, id: string) => { await c.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE tenant_id=? AND id=?", [tenantId, id]); };

// ---------------- frameworks attached to an engagement ----------------
export const engagementFrameworks = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT f.id frameworkId, f.name, f.color, r.id releaseId, r.version, ef.is_primary isPrimary FROM engagement_frameworks ef
  JOIN frameworks f ON f.id=ef.framework_id JOIN framework_releases r ON r.id=ef.release_id WHERE ef.tenant_id=? AND ef.engagement_id=? ORDER BY ef.is_primary DESC, ef.added_at, f.name`, [tenantId, engagementId]);
export async function engagementFrameworksFor(c: Conn, tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const rows = await q(c, `SELECT ef.engagement_id engagementId, f.id frameworkId, f.name, f.color, r.version, ef.is_primary isPrimary FROM engagement_frameworks ef JOIN frameworks f ON f.id=ef.framework_id JOIN framework_releases r ON r.id=ef.release_id
    WHERE ef.tenant_id=? AND ef.engagement_id IN (?) ORDER BY ef.is_primary DESC, ef.added_at, f.name`, [tenantId, ids]);
  const m = new Map<string, any[]>(); for (const r of rows) { (m.get(r.engagementId) ?? m.set(r.engagementId, []).get(r.engagementId)!).push(r); } return m;
}
export const addEngagementFramework = async (c: Conn, tenantId: string, engagementId: string, fw: { frameworkId: string; releaseId: string; isPrimary: boolean; addedBy: string }) => {
  await c.query('INSERT INTO engagement_frameworks(tenant_id,engagement_id,framework_id,release_id,is_primary,added_by) VALUES (?,?,?,?,?,?)', [tenantId, engagementId, fw.frameworkId, fw.releaseId, fw.isPrimary ? 1 : 0, fw.addedBy]); await snapshotQuestionnaire(c, tenantId, engagementId, fw.frameworkId); };

// ---------------- apply a release: create items, merge via common controls, create SOA entries ----------------
/** For each control: if its common control is already represented by an item in this engagement, MERGE (add a link, no duplicate item); otherwise create the item.
 *  Controls without a common control always create their own item. SOA entries default to "applicable". Runs inside the caller's transaction. */
export async function applyRelease(c: Conn, tenantId: string, engagementId: string, releaseId: string, actorId: string) {
  const controls = await q(c, `SELECT c.id,c.ref,c.domain,c.title,c.description,c.owner_department,c.secondary_guidance_note,c.remarks,m.common_control_id FROM framework_controls c
    LEFT JOIN control_mappings m ON m.control_id=c.id WHERE c.release_id=? ORDER BY c.sort_order,c.ref`, [releaseId]);
  const byCommon = new Map<string, string>((await q(c, 'SELECT id,common_control_id FROM checklist_items WHERE tenant_id=? AND engagement_id=? AND common_control_id IS NOT NULL', [tenantId, engagementId])).map(r => [r.common_control_id, r.id]));
  let order = (await q(c, 'SELECT COALESCE(MAX(sort_order),0) m FROM checklist_items WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].m as number;
  const items: any[][] = [], links: any[][] = [], soa: any[][] = []; let created = 0, merged = 0;
  for (const ctl of controls) {
    soa.push([tenantId, engagementId, ctl.id, 1, null, actorId]);
    let itemId = ctl.common_control_id ? byCommon.get(ctl.common_control_id) : undefined;
    if (itemId) merged++;
    else { itemId = uuid(); created++; order++; items.push([tenantId, itemId, engagementId, 'framework', ctl.common_control_id, ctl.ref, ctl.domain, ctl.title, ctl.description, ctl.owner_department, ctl.secondary_guidance_note, ctl.remarks, order]); if (ctl.common_control_id) byCommon.set(ctl.common_control_id, itemId); }
    links.push([tenantId, engagementId, itemId, ctl.id]);
  }
  const batch = async (sql: string, rows: any[][]) => { for (let i = 0; i < rows.length; i += 500) await c.query(sql, [rows.slice(i, i + 500)]); };
  await batch('INSERT INTO checklist_items(tenant_id,id,engagement_id,origin,common_control_id,ref,domain,title,description,owner_department,secondary_guidance_note,remarks,sort_order) VALUES ?', items);
  await batch('INSERT INTO checklist_item_controls(tenant_id,engagement_id,item_id,control_id) VALUES ?', links);
  await batch('INSERT INTO soa_entries(tenant_id,engagement_id,control_id,applicable,justification,updated_by) VALUES ?', soa);
  return { created, merged, total: controls.length };
}

// ---------------- checklist ----------------
const LINKAGG = `SELECT l.item_id, COUNT(*) n, SUM(COALESCE(s.applicable,1)=0) na FROM checklist_item_controls l LEFT JOIN soa_entries s ON s.tenant_id=l.tenant_id AND s.engagement_id=l.engagement_id AND s.control_id=l.control_id
  WHERE l.tenant_id=? AND l.engagement_id=? GROUP BY l.item_id`;
const ITEM_COLS = `i.id,i.engagement_id engagementId,i.ref,i.domain,i.title,i.description,i.owner_department ownerDepartment,i.secondary_guidance_note secondaryGuidanceNote,i.remarks,i.readiness_status readiness,i.na_justification naJustification,
  i.evidence_status evidence,i.accountable_user_id accountableUserId,u.name accountableName,${D('i.due_date', 'dueDate')},i.origin,i.common_control_id commonControlId,cc.title commonControlTitle,COALESCE(x.n,0) linkCount,COALESCE(x.na,0) naLinks,
  EXISTS(SELECT 1 FROM evidence_requests er WHERE er.tenant_id=i.tenant_id AND er.item_id=i.id AND er.status='accepted' AND er.valid_until IS NOT NULL AND er.valid_until < ?) evidenceExpired,
  EXISTS(SELECT 1 FROM findings fx WHERE fx.tenant_id=i.tenant_id AND fx.item_id=i.id AND fx.status IN ('open','in_remediation','ready_for_retest') AND fx.severity IN ('critical','high','medium')) blockingFindings`;
export const listItems = (c: Conn, tenantId: string, engagementId: string, scope: Scope, today: string) => q(c, `SELECT ${ITEM_COLS} FROM checklist_items i LEFT JOIN users u ON u.id=i.accountable_user_id LEFT JOIN common_controls cc ON cc.id=i.common_control_id
  LEFT JOIN (${LINKAGG}) x ON x.item_id=i.id WHERE i.tenant_id=? AND i.engagement_id=? ${scope.kind === 'assigned' ? 'AND i.accountable_user_id=?' : ''} ORDER BY i.sort_order,i.ref`,
  [today, tenantId, engagementId, tenantId, engagementId, ...(scope.kind === 'assigned' ? [scope.userId] : [])]);
export const getItem = async (c: Conn, tenantId: string, itemId: string, lock = false) => (await q(c, `SELECT i.id,i.engagement_id engagementId,i.ref,i.title,i.readiness_status readiness,i.na_justification naJustification,i.evidence_status evidence,i.accountable_user_id accountableUserId,${D('i.due_date', 'dueDate')}
  FROM checklist_items i WHERE i.tenant_id=? AND i.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, itemId]))[0] ?? null;
export const satisfiesFor = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT l.item_id itemId, fc.id controlId, fc.ref, f.id frameworkId, f.name frameworkName, f.color, r.version FROM checklist_item_controls l
  JOIN framework_controls fc ON fc.id=l.control_id JOIN framework_releases r ON r.id=fc.release_id JOIN frameworks f ON f.id=r.framework_id WHERE l.tenant_id=? AND l.engagement_id=? ORDER BY f.name, fc.ref`, [tenantId, engagementId]);
export async function insertCustomItem(c: Conn, tenantId: string, engagementId: string, i: { ref: string; domain: string; title: string; description?: string | null; ownerDepartment?: string | null; accountableUserId?: string | null; dueDate?: string | null }) {
  const id = uuid(); const order = ((await q(c, 'SELECT COALESCE(MAX(sort_order),0)+1 n FROM checklist_items WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].n as number);
  await c.query("INSERT INTO checklist_items(tenant_id,id,engagement_id,origin,ref,domain,title,description,owner_department,accountable_user_id,due_date,sort_order) VALUES (?,?,?,'custom',?,?,?,?,?,?,?,?)",
    [tenantId, id, engagementId, i.ref, i.domain, i.title, i.description ?? null, i.ownerDepartment ?? null, i.accountableUserId ?? null, i.dueDate ?? null, order]); return id;
}
const ITEM_COLS_W: Record<string, string> = { accountableUserId: 'accountable_user_id', dueDate: 'due_date', readiness: 'readiness_status', naJustification: 'na_justification', ownerDepartment: 'owner_department', remarks: 'remarks' };
export async function updateItem(c: Conn, tenantId: string, itemId: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in ITEM_COLS_W); if (!keys.length) return;
  await c.query(`UPDATE checklist_items SET ${keys.map(k => `${ITEM_COLS_W[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k] ?? null), tenantId, itemId]);
}
/** The ONLY writers of checklist_items.evidence_status. Phase 5's evidence module derives the value (modules/evidence/rules.ts) and calls these inside its transaction. */
export const setItemEvidenceStatus = async (c: Conn, tenantId: string, itemId: string, status: string) => { await c.query('UPDATE checklist_items SET evidence_status=? WHERE tenant_id=? AND id=?', [status, tenantId, itemId]); };
export const bulkSetEvidenceStatus = async (c: Conn, tenantId: string, engagementId: string, itemIds: string[], status: string) => { for (let i = 0; i < itemIds.length; i += 500) await c.query('UPDATE checklist_items SET evidence_status=? WHERE tenant_id=? AND engagement_id=? AND id IN (?)', [status, tenantId, engagementId, itemIds.slice(i, i + 500)]); };
/** Lock the given items (sorted, so two bulk operations can never deadlock) and return them. Lock order everywhere: item -> engagement -> request. */
export const lockItems = (c: Conn, tenantId: string, engagementId: string, ids: string[]) => ids.length ? q(c, `SELECT i.id,i.ref,i.title,i.readiness_status readiness,i.accountable_user_id accountableUserId FROM checklist_items i WHERE i.tenant_id=? AND i.engagement_id=? AND i.id IN (?) ORDER BY i.id FOR UPDATE`, [tenantId, engagementId, ids]) : Promise.resolve([] as any[]);
export const listEngagementItemsBrief = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT i.id,i.ref,i.title,i.readiness_status readiness,i.accountable_user_id accountableUserId, (COALESCE(x.n,0)>0 AND x.n=x.na) allNA FROM checklist_items i
  LEFT JOIN (SELECT l.item_id, COUNT(*) n, SUM(COALESCE(s.applicable,1)=0) na FROM checklist_item_controls l LEFT JOIN soa_entries s ON s.tenant_id=l.tenant_id AND s.engagement_id=l.engagement_id AND s.control_id=l.control_id WHERE l.tenant_id=? AND l.engagement_id=? GROUP BY l.item_id) x ON x.item_id=i.id
  WHERE i.tenant_id=? AND i.engagement_id=? ORDER BY i.sort_order, i.ref`, [tenantId, engagementId, tenantId, engagementId]);

/** Grouped facts for the evaluation service (the query itself lives in shared/readiness.ts, used by the worker too). */
export const itemFacts = (c: Conn, tenantId: string, o: { today: string; engagementIds?: string[]; assignedUserId?: string }) => sharedItemFacts((sql, p) => q(c, sql, p), tenantId, o);

// ---------------- SOA ----------------
export const listSoa = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT s.control_id controlId, fc.ref, fc.domain, fc.title, f.id frameworkId, f.name frameworkName, f.color, r.version, s.applicable, s.justification, s.updated_at updatedAt
  FROM soa_entries s JOIN framework_controls fc ON fc.id=s.control_id JOIN framework_releases r ON r.id=fc.release_id JOIN frameworks f ON f.id=r.framework_id WHERE s.tenant_id=? AND s.engagement_id=? ORDER BY f.name, fc.domain, fc.sort_order, fc.ref`, [tenantId, engagementId]);
export const getSoa = async (c: Conn, tenantId: string, engagementId: string, controlId: string) => (await q(c, 'SELECT applicable,justification FROM soa_entries WHERE tenant_id=? AND engagement_id=? AND control_id=? FOR UPDATE', [tenantId, engagementId, controlId]))[0] ?? null;
export const updateSoa = async (c: Conn, tenantId: string, engagementId: string, controlId: string, applicable: boolean, justification: string | null, by: string) => {
  await c.query('UPDATE soa_entries SET applicable=?, justification=?, updated_by=? WHERE tenant_id=? AND engagement_id=? AND control_id=?', [applicable ? 1 : 0, applicable ? null : justification, by, tenantId, engagementId, controlId]); };

// ---------------- phases ----------------
export async function insertPhaseLogs(c: Conn, tenantId: string, engagementId: string, today: string) {
  const rows = PHASE_NAMES.map((n, i) => [tenantId, uuid(), engagementId, i + 1, n, i === 0 ? today : null, i === 0 ? 'in_progress' : 'not_started']);
  await c.query('INSERT INTO phase_logs(tenant_id,id,engagement_id,phase,name,start_date,status) VALUES ?', [rows]);
}
export const listPhases = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT phase,name,owner_user_id ownerUserId,(SELECT name FROM users WHERE id=p.owner_user_id) ownerName,${D('start_date', 'startDate')},${D('end_date', 'endDate')},status,completed_at completedAt FROM phase_logs p WHERE tenant_id=? AND engagement_id=? ORDER BY phase`, [tenantId, engagementId]);
export const getPhase = async (c: Conn, tenantId: string, engagementId: string, phase: number) => (await q(c, `SELECT phase,owner_user_id ownerUserId,${D('start_date', 'startDate')},${D('end_date', 'endDate')},status FROM phase_logs WHERE tenant_id=? AND engagement_id=? AND phase=? FOR UPDATE`, [tenantId, engagementId, phase]))[0] ?? null;
export const updatePhase = async (c: Conn, tenantId: string, engagementId: string, phase: number, p: { startDate?: string | null; endDate?: string | null; ownerUserId?: string | null }) => {
  const sets: string[] = [], v: any[] = []; if (p.startDate !== undefined) { sets.push('start_date=?'); v.push(p.startDate); } if (p.endDate !== undefined) { sets.push('end_date=?'); v.push(p.endDate); } if (p.ownerUserId !== undefined) { sets.push('owner_user_id=?'); v.push(p.ownerUserId); }
  if (sets.length) await c.query(`UPDATE phase_logs SET ${sets.join(',')} WHERE tenant_id=? AND engagement_id=? AND phase=?`, [...v, tenantId, engagementId, phase]); };
export const completePhase = async (c: Conn, tenantId: string, engagementId: string, phase: number, today: string) => { await c.query("UPDATE phase_logs SET status='complete', completed_at=NOW(3), end_date=COALESCE(end_date,?) WHERE tenant_id=? AND engagement_id=? AND phase=?", [today, tenantId, engagementId, phase]); };
export const startPhase = async (c: Conn, tenantId: string, engagementId: string, phase: number, today: string) => { await c.query("UPDATE phase_logs SET status='in_progress', start_date=COALESCE(start_date,?) WHERE tenant_id=? AND engagement_id=? AND phase=?", [today, tenantId, engagementId, phase]); };

// ---------------- engagement members ----------------
export const listEngagementMembers = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT u.id userId,u.name,u.email,m.member_role role FROM engagement_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.engagement_id=? AND u.status<>'deleted' ORDER BY FIELD(m.member_role,'lead','team','auditor'),u.name`, [tenantId, engagementId]);
export const getEngagementMember = async (c: Conn, tenantId: string, engagementId: string, userId: string) => (await q(c, 'SELECT member_role role FROM engagement_members WHERE tenant_id=? AND engagement_id=? AND user_id=?', [tenantId, engagementId, userId]))[0] ?? null;
export async function setEngagementMember(c: Conn, tenantId: string, engagementId: string, userId: string, role: 'lead' | 'team' | 'auditor', by: string) {
  if (role === 'lead') await c.query("UPDATE engagement_members SET member_role='team' WHERE tenant_id=? AND engagement_id=? AND member_role='lead' AND user_id<>?", [tenantId, engagementId, userId]);   // lead transfer
  await c.query('INSERT INTO engagement_members(tenant_id,engagement_id,user_id,member_role,added_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE member_role=VALUES(member_role)', [tenantId, engagementId, userId, role, by]);
}
export const removeEngagementMember = async (c: Conn, tenantId: string, engagementId: string, userId: string) => ((await c.query('DELETE FROM engagement_members WHERE tenant_id=? AND engagement_id=? AND user_id=?', [tenantId, engagementId, userId]))[0] as any).affectedRows as number;
export const leadOf = async (c: Conn, tenantId: string, engagementIds: string[]) => { if (!engagementIds.length) return new Map<string, string>(); const rows = await q(c, "SELECT m.engagement_id id, u.name FROM engagement_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.member_role='lead' AND m.engagement_id IN (?)", [tenantId, engagementIds]); return new Map<string, string>(rows.map(r => [r.id, r.name])); };
export const assignableUsers = (c: Conn, tenantId: string) => q(c, "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.status='active' AND m.role IN ('client_admin','client_staff','third_party_vendor') ORDER BY u.name", [tenantId]);

// ---------------- milestones ----------------
export async function insertMilestones(c: Conn, tenantId: string, engagementId: string, rows: { phase: number; title: string; source: string | null }[]) {
  if (!rows.length) return; const counters = new Map<number, number>();
  await c.query('INSERT INTO engagement_milestones(tenant_id,id,engagement_id,phase,sort_order,title,source) VALUES ?', [rows.map(r => { const n = (counters.get(r.phase) ?? 0) + 1; counters.set(r.phase, n); return [tenantId, uuid(), engagementId, r.phase, n, r.title, r.source]; })]);
}
export const listMilestones = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT id,phase,sort_order sortOrder,title,source,status,${D('due_date', 'dueDate')},completed_at completedAt FROM engagement_milestones WHERE tenant_id=? AND engagement_id=? ORDER BY phase,sort_order`, [tenantId, engagementId]);
export const getMilestone = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT id,engagement_id engagementId,status FROM engagement_milestones WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, id]))[0] ?? null;
export const updateMilestone = async (c: Conn, tenantId: string, id: string, p: { status?: string; dueDate?: string | null }) => {
  const sets: string[] = [], v: any[] = []; if (p.status) { sets.push('status=?', "completed_at=IF(?='complete', NOW(3), NULL)"); v.push(p.status, p.status); } if (p.dueDate !== undefined) { sets.push('due_date=?'); v.push(p.dueDate); }
  if (sets.length) await c.query(`UPDATE engagement_milestones SET ${sets.join(',')} WHERE tenant_id=? AND id=?`, [...v, tenantId, id]); };

// ---------------- discovery ----------------
export const listDiscovery = (c: Conn, tenantId: string, engagementId: string, frameworkIds: string[]) => q(c, `SELECT dq.id questionId, dq.domain, dq.question, dq.framework_id frameworkId, dr.response, dr.notes, dr.responded_at respondedAt, (SELECT name FROM users WHERE id=dr.responded_by) respondedBy
  FROM discovery_questions dq LEFT JOIN discovery_responses dr ON dr.tenant_id=? AND dr.engagement_id=? AND dr.question_id=dq.id
  WHERE dq.active=1 AND (dq.framework_id IS NULL ${frameworkIds.length ? 'OR dq.framework_id IN (?)' : ''}) OR dr.id IS NOT NULL AND dr.tenant_id=? AND dr.engagement_id=? ORDER BY dq.framework_id IS NOT NULL, dq.sort_order, dq.domain`, [tenantId, engagementId, ...(frameworkIds.length ? [frameworkIds] : []), tenantId, engagementId]);
export const questionApplies = async (c: Conn, tenantId: string, engagementId: string, questionId: string) => !!(await q(c, `SELECT 1 x FROM discovery_questions dq WHERE dq.id=? AND dq.active=1 AND (dq.framework_id IS NULL OR dq.framework_id IN (SELECT framework_id FROM engagement_frameworks WHERE tenant_id=? AND engagement_id=?))`, [questionId, tenantId, engagementId]))[0];
export const upsertResponse = async (c: Conn, tenantId: string, engagementId: string, questionId: string, response: string | null, notes: string | null, by: string) => {
  await c.query('INSERT INTO discovery_responses(tenant_id,id,engagement_id,question_id,response,notes,responded_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE response=VALUES(response), notes=VALUES(notes), responded_by=VALUES(responded_by), responded_at=NOW(3)', [tenantId, uuid(), engagementId, questionId, response, notes, by]); };

// ---------------- hooks for user deletion / removal ----------------
/** Open work: assigned to the person, not accepted, not N/A, in an engagement that is still active. tenantId=null means "in any organization". */
export const openItemsFor = (c: Conn, userId: string, tenantId: string | null) => q(c, `SELECT i.id, i.ref, i.title, e.name engagementName FROM checklist_items i JOIN engagements e ON e.tenant_id=i.tenant_id AND e.id=i.engagement_id
  WHERE i.accountable_user_id=? AND i.evidence_status<>'accepted' AND i.readiness_status<>'not_applicable' AND e.status='active' ${tenantId ? 'AND i.tenant_id=?' : ''} ORDER BY e.name, i.sort_order LIMIT 100`, tenantId ? [userId, tenantId] : [userId]);
export const assignedItemsFor = (c: Conn, userId: string) => q(c, `SELECT e.name engagementName, i.ref, i.title, i.evidence_status evidence FROM checklist_items i JOIN engagements e ON e.tenant_id=i.tenant_id AND e.id=i.engagement_id WHERE i.accountable_user_id=? ORDER BY e.name, i.sort_order LIMIT 500`, [userId]);

export const countSharedItems = async (c: Conn, tenantId: string, engagementId: string) => (await q(c, 'SELECT COUNT(*) n FROM (SELECT item_id FROM checklist_item_controls WHERE tenant_id=? AND engagement_id=? GROUP BY item_id HAVING COUNT(*)>1) t', [tenantId, engagementId]))[0].n as number;

/** Counts the phase checks need that the summary service does not already give. */
export async function phaseCounts(c: Conn, tenantId: string, engagementId: string, phase: number) {
  const r = (await q(c, "SELECT COUNT(*) items, COALESCE(SUM(readiness_status<>'not_applicable' AND accountable_user_id IS NULL),0) unassigned FROM checklist_items WHERE tenant_id=? AND engagement_id=?", [tenantId, engagementId]))[0];
  const m = (await q(c, "SELECT COUNT(*) n FROM engagement_milestones WHERE tenant_id=? AND engagement_id=? AND phase=? AND status<>'complete'", [tenantId, engagementId, phase]))[0];
  const fw = (await engagementFrameworks(c, tenantId, engagementId)).map((f: any) => f.frameworkId as string); const disc = await listDiscovery(c, tenantId, engagementId, fw);
  return { tasksOverdue: await tasksOverdueCount(c, tenantId, engagementId, new Date().toISOString().slice(0, 10)), items: Number(r.items), unassigned: Number(r.unassigned), milestonesOpen: Number(m.n), discoveryOpen: disc.filter((x: any) => !String(x.response ?? '').trim()).length, ...(p => ({ questionnaireOpen: p.open, questionnaireToReview: p.toReview + p.sentBack }))(qProgress(await questionnaireRows(c, tenantId, engagementId))) };
}

// ---------------- renewal (Phase 11C) ----------------
export const itemIdsByRef = async (c: Conn, tenantId: string, engagementId: string) => new Map<string, { id: string; na: boolean }>((await q(c, 'SELECT ref,id,readiness_status rs FROM checklist_items WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId])).map(r => [r.ref as string, { id: r.id as string, na: r.rs === 'not_applicable' }]));
export const renewalOf = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT id,name,status FROM engagements WHERE tenant_id=? AND renewed_from=? ORDER BY created_at DESC LIMIT 1', [tenantId, id]))[0] ?? null;
export const latestPublished = (c: Conn, frameworkIds: string[]) => frameworkIds.length ? q(c, `SELECT r.framework_id frameworkId, r.id releaseId, r.version, f.name FROM framework_releases r JOIN frameworks f ON f.id=r.framework_id AND f.archived=0 WHERE r.framework_id IN (?) AND r.status='published' AND r.version=(SELECT MAX(version) FROM framework_releases x WHERE x.framework_id=r.framework_id AND x.status='published')`, [frameworkIds]) : Promise.resolve([] as any[]);
const joined = 'JOIN checklist_items o ON o.tenant_id=n.tenant_id AND o.engagement_id=? AND o.ref=n.ref';
/** Copies the decisions people made on the old engagement onto the matching items (same reference) of the new one. Evidence is never copied: it has to be fresh. */
export async function carryDecisions(c: Conn, tenantId: string, fromId: string, toId: string, o: { assignees: boolean; notApplicable: boolean }) {
  const aff = async (sql: string, p: any[]) => Number(((await c.query(sql, p)) as any)[0].affectedRows ?? 0); let assignees = 0, notApplicable = 0, soa = 0;
  if (o.assignees) assignees = await aff(`UPDATE checklist_items n ${joined} JOIN users u ON u.id=o.accountable_user_id AND u.status='active' JOIN memberships m ON m.tenant_id=n.tenant_id AND m.user_id=u.id AND m.role IN ('client_admin','client_staff','third_party_vendor') SET n.accountable_user_id=o.accountable_user_id WHERE n.tenant_id=? AND n.engagement_id=? AND o.accountable_user_id IS NOT NULL`, [fromId, tenantId, toId]);
  if (o.notApplicable) {
    soa = await aff(`UPDATE soa_entries n JOIN framework_controls nc ON nc.id=n.control_id JOIN framework_releases nr ON nr.id=nc.release_id JOIN framework_controls oc ON oc.ref=nc.ref JOIN framework_releases orl ON orl.id=oc.release_id AND orl.framework_id=nr.framework_id
      JOIN soa_entries o ON o.tenant_id=n.tenant_id AND o.engagement_id=? AND o.control_id=oc.id SET n.applicable=0, n.justification=o.justification WHERE n.tenant_id=? AND n.engagement_id=? AND o.applicable=0 AND o.justification IS NOT NULL`, [fromId, tenantId, toId]);
    notApplicable = await aff(`UPDATE checklist_items n ${joined} SET n.readiness_status='not_applicable', n.na_justification=o.na_justification WHERE n.tenant_id=? AND n.engagement_id=? AND o.readiness_status='not_applicable' AND o.na_justification IS NOT NULL`, [fromId, tenantId, toId]);
  }
  return { assignees, notApplicable, soa };
}
