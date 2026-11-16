// TENANT-SCOPED DATA LAYER for findings. Only this file may run SQL on findings and finding_events (test/05_data_layer.test.ts enforces it).
// Every function takes tenantId and puts it in every WHERE/JOIN. Lock order used by every writer: item -> engagement -> finding.
import { q, type Conn } from '../../db';
import type { FStatus, Severity } from './rules'; import { TERMINAL } from './rules';
const D = (col: string, as: string) => `DATE_FORMAT(${col},'%Y-%m-%d') ${as}`;

const COLS = `f.id, f.engagement_id engagementId, f.item_id itemId, i.ref itemRef, i.title itemTitle, i.accountable_user_id accountableUserId, f.finding_no findingNo, f.title, f.description, f.recommendation, f.severity, f.status,
  f.owner_user_id ownerUserId, ou.name ownerName, ${D('f.due_date', 'dueDate')}, f.remediation_plan remediationPlan, f.raised_by raisedBy, ru.name raisedByName, f.created_at createdAt, f.updated_at updatedAt, f.closed_at closedAt, f.round_id roundId`;
const FROM = `FROM findings f JOIN checklist_items i ON i.tenant_id=f.tenant_id AND i.id=f.item_id LEFT JOIN users ou ON ou.id=f.owner_user_id LEFT JOIN users ru ON ru.id=f.raised_by`;
/** Client staff and vendors only reach findings they own or on items assigned to them. */
const ASSIGNED = `(f.owner_user_id=? OR i.accountable_user_id=?)`;

export type ListFilter = { assignedUserId?: string; status?: FStatus; severity?: Severity; itemId?: string; ownerUserId?: string; unresolved?: boolean };
export function listFindings(c: Conn, tenantId: string, engagementId: string, f: ListFilter = {}) {
  const w = ['f.tenant_id=?', 'f.engagement_id=?']; const p: any[] = [tenantId, engagementId];
  if (f.assignedUserId) { w.push(ASSIGNED); p.push(f.assignedUserId, f.assignedUserId); } if (f.status) { w.push('f.status=?'); p.push(f.status); } if (f.severity) { w.push('f.severity=?'); p.push(f.severity); }
  if (f.itemId) { w.push('f.item_id=?'); p.push(f.itemId); } if (f.ownerUserId) { w.push('f.owner_user_id=?'); p.push(f.ownerUserId); } if (f.unresolved) w.push("f.status IN ('open','in_remediation','ready_for_retest')");
  return q(c, `SELECT ${COLS} ${FROM} WHERE ${w.join(' AND ')} ORDER BY FIELD(f.severity,'critical','high','medium','low','observation'), f.finding_no LIMIT 2001`, p);
}
export const listItemFindings = (c: Conn, tenantId: string, itemId: string) => q(c, `SELECT ${COLS} ${FROM} WHERE f.tenant_id=? AND f.item_id=? ORDER BY f.finding_no`, [tenantId, itemId]);
export const getFinding = async (c: Conn, tenantId: string, id: string) => (await q(c, `SELECT ${COLS} ${FROM} WHERE f.tenant_id=? AND f.id=?`, [tenantId, id]))[0] ?? null;
export const lockFinding = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT status FROM findings WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, id]))[0] ?? null;
/** Next finding number within the engagement. Call only while holding the engagement row lock, so two writers cannot pick the same number. */
export const nextNo = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, 'SELECT COALESCE(MAX(finding_no),0)+1 n FROM findings WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].n);
export const insertFinding = (c: Conn, tenantId: string, r: { id: string; engagementId: string; itemId: string; no: number; title: string; description: string; recommendation?: string | null; severity: Severity; ownerUserId?: string | null; dueDate?: string | null; raisedBy: string; roundId?: string | null }) =>
  c.query('INSERT INTO findings(tenant_id,id,engagement_id,item_id,finding_no,title,description,recommendation,severity,owner_user_id,due_date,raised_by,round_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [tenantId, r.id, r.engagementId, r.itemId, r.no, r.title, r.description, r.recommendation ?? null, r.severity, r.ownerUserId ?? null, r.dueDate ?? null, r.raisedBy, r.roundId ?? null]);
export const addEvent = (c: Conn, tenantId: string, e: { id: string; findingId: string; kind: 'raised' | 'status' | 'edited' | 'assigned' | 'comment' | 'evidence'; from?: string | null; to?: string | null; note?: string | null; actorId: string }) =>
  c.query('INSERT INTO finding_events(tenant_id,id,finding_id,kind,from_status,to_status,note,actor_id) VALUES (?,?,?,?,?,?,?,?)', [tenantId, e.id, e.findingId, e.kind, e.from ?? null, e.to ?? null, e.note ?? null, e.actorId]);
export const listEvents = (c: Conn, tenantId: string, findingId: string) => q(c, `SELECT e.id, e.kind, e.from_status fromStatus, e.to_status toStatus, e.note, e.actor_id actorId, u.name actorName, e.created_at createdAt FROM finding_events e JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=? AND e.finding_id=? ORDER BY e.created_at, e.id`, [tenantId, findingId]);
const FIELD_COLS: Record<string, string> = { title: 'title', description: 'description', recommendation: 'recommendation', severity: 'severity', ownerUserId: 'owner_user_id', dueDate: 'due_date', remediationPlan: 'remediation_plan' };
export async function updateFields(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in FIELD_COLS); if (!keys.length) return;
  await c.query(`UPDATE findings SET ${keys.map(k => `${FIELD_COLS[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k] ?? null), tenantId, id]);
}
/** Moves the finding to a new status. Terminal statuses stamp closed_at; leaving one clears it (the database CHECK keeps the two in step). */
export const setStatus = (c: Conn, tenantId: string, id: string, to: FStatus) => c.query(`UPDATE findings SET status=?, closed_at=${TERMINAL.includes(to) ? 'NOW(3)' : 'NULL'} WHERE tenant_id=? AND id=?`, [to, tenantId, id]);
/** Is this user an active client-side member (any role except auditor) of the organization? Used to validate remediation owners. */
export const isOwnerCandidate = async (c: Conn, tenantId: string, userId: string) => !!(await q(c, "SELECT 1 x FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role IN ('client_admin','client_staff','third_party_vendor') AND u.status='active'", [tenantId, userId]))[0];
export const itemFindingCounts = (c: Conn, tenantId: string, engagementId: string) => q(c, "SELECT item_id itemId, COUNT(*) total, SUM(status IN ('open','in_remediation','ready_for_retest')) unresolved, SUM(status IN ('open','in_remediation','ready_for_retest') AND severity IN ('critical','high','medium')) blocking FROM findings WHERE tenant_id=? AND engagement_id=? GROUP BY item_id", [tenantId, engagementId]);
export async function summaryRows(c: Conn, tenantId: string, engagementId: string, today: string, assignedUserId?: string) {
  const rows = await q(c, `SELECT f.status, f.severity, (f.due_date IS NOT NULL AND f.due_date < ?) late, COUNT(*) n ${FROM} WHERE f.tenant_id=? AND f.engagement_id=? ${assignedUserId ? 'AND ' + ASSIGNED : ''} GROUP BY f.status, f.severity, late`, [today, tenantId, engagementId, ...(assignedUserId ? [assignedUserId, assignedUserId] : [])]);
  return rows.map(r => ({ status: r.status as FStatus, severity: r.severity as Severity, dueDate: r.late ? '1970-01-01' : null, count: Number(r.n) }));
}
/** Blocking findings for the engagement-closure check. */
export const unresolvedCount = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, "SELECT COUNT(*) n FROM findings WHERE tenant_id=? AND engagement_id=? AND status IN ('open','in_remediation','ready_for_retest') AND severity IN ('critical','high','medium')", [tenantId, engagementId]))[0].n);
/** Unresolved findings a user owns (account-deletion blocker; tenantId=null means anywhere). */
export const openFindingsFor = (c: Conn, userId: string, tenantId: string | null) => q(c, `SELECT f.id, f.finding_no n, f.title, e.name engagementName FROM findings f JOIN engagements e ON e.tenant_id=f.tenant_id AND e.id=f.engagement_id WHERE f.owner_user_id=? ${tenantId ? 'AND f.tenant_id=?' : ''} AND f.status IN ('open','in_remediation','ready_for_retest')`, tenantId ? [userId, tenantId] : [userId]);
export const findingsRaisedBy = (c: Conn, userId: string) => q(c, 'SELECT f.finding_no n, f.title, f.severity, f.status, f.created_at createdAt, e.name engagementName FROM findings f JOIN engagements e ON e.tenant_id=f.tenant_id AND e.id=f.engagement_id WHERE f.raised_by=? ORDER BY f.created_at', [userId]);

// ---------------------------------------------------------------- 6C: organization-wide tracking and remediation evidence
export type OrgScope = { kind: 'all' } | { kind: 'auditor'; userId: string } | { kind: 'assigned'; userId: string };
const scopeSql = (sc: OrgScope) => sc.kind === 'auditor' ? { sql: ' AND EXISTS (SELECT 1 FROM engagement_members m WHERE m.tenant_id=f.tenant_id AND m.engagement_id=f.engagement_id AND m.user_id=?)', p: [sc.userId] }
  : sc.kind === 'assigned' ? { sql: ` AND ${ASSIGNED}`, p: [sc.userId, sc.userId] } : { sql: '', p: [] as string[] };
const ORG_FROM = `${FROM} JOIN engagements e ON e.tenant_id=f.tenant_id AND e.id=f.engagement_id`;
export type OrgFilter = { engagementId?: string; mineUserId?: string; status?: FStatus; severity?: Severity; unresolved?: boolean; overdueToday?: string; awaitingRetest?: boolean };
export function listOrgFindings(c: Conn, tenantId: string, sc: OrgScope, f: OrgFilter = {}) {
  const j = scopeSql(sc); const w = ['f.tenant_id=?']; const p: any[] = [tenantId];
  if (f.engagementId) { w.push('f.engagement_id=?'); p.push(f.engagementId); } if (f.mineUserId) { w.push('f.owner_user_id=?'); p.push(f.mineUserId); } if (f.status) { w.push('f.status=?'); p.push(f.status); } if (f.severity) { w.push('f.severity=?'); p.push(f.severity); }
  if (f.unresolved) w.push("f.status IN ('open','in_remediation','ready_for_retest')"); if (f.awaitingRetest) w.push("f.status='ready_for_retest'"); if (f.overdueToday) { w.push("f.status IN ('open','in_remediation','ready_for_retest') AND f.due_date IS NOT NULL AND f.due_date < ?"); p.push(f.overdueToday); }
  return q(c, `SELECT ${COLS}, e.name engagementName, e.status engagementStatus ${ORG_FROM} WHERE ${w.join(' AND ')}${j.sql} ORDER BY (f.due_date IS NULL), f.due_date, FIELD(f.severity,'critical','high','medium','low','observation'), f.engagement_id, f.finding_no LIMIT 2001`, [...p, ...j.p]);
}
export async function orgSummaryRows(c: Conn, tenantId: string, sc: OrgScope, today: string) {
  const j = scopeSql(sc); const rows = await q(c, `SELECT f.status, f.severity, (f.due_date IS NOT NULL AND f.due_date < ?) late, COUNT(*) n ${FROM} WHERE f.tenant_id=?${j.sql} GROUP BY f.status, f.severity, late`, [today, tenantId, ...j.p]);
  return rows.map(r => ({ status: r.status as FStatus, severity: r.severity as Severity, dueDate: r.late ? '1970-01-01' : null, count: Number(r.n) }));
}
export const linkEvidence = (c: Conn, tenantId: string, findingId: string, requestId: string, itemId: string, userId: string) => c.query('INSERT INTO finding_evidence(tenant_id,finding_id,request_id,item_id,linked_by) VALUES (?,?,?,?,?)', [tenantId, findingId, requestId, itemId, userId]);
export const listFindingEvidence = (c: Conn, tenantId: string, findingId: string) => q(c, `SELECT r.id requestId, r.title, r.status, ${D('r.valid_until', 'validUntil')}, r.latest_version_no versionCount, u.name linkedByName, l.linked_at linkedAt FROM finding_evidence l JOIN evidence_requests r ON r.tenant_id=l.tenant_id AND r.id=l.request_id JOIN users u ON u.id=l.linked_by WHERE l.tenant_id=? AND l.finding_id=? ORDER BY l.linked_at`, [tenantId, findingId]);
export const listLinkable = (c: Conn, tenantId: string, findingId: string, itemId: string) => q(c, `SELECT r.id requestId, r.title, r.status, r.latest_version_no versionCount FROM evidence_requests r WHERE r.tenant_id=? AND r.item_id=? AND r.status<>'cancelled' AND NOT EXISTS (SELECT 1 FROM finding_evidence l WHERE l.tenant_id=r.tenant_id AND l.finding_id=? AND l.request_id=r.id) ORDER BY r.created_at`, [tenantId, itemId, findingId]);
export const requestStatus = async (c: Conn, tenantId: string, requestId: string) => (await q(c, 'SELECT item_id itemId, status, title FROM evidence_requests WHERE tenant_id=? AND id=?', [tenantId, requestId]))[0] ?? null;

// ---------------------------------------------------------------- imports (Phase 8C)
export const existingImportKeys = async (c: Conn, tenantId: string, engagementId: string, keys: string[]) => { if (!keys.length) return new Set<string>(); return new Set<string>((await q(c, `SELECT import_key k FROM findings WHERE tenant_id=? AND engagement_id=? AND import_key IN (${keys.map(() => '?').join(',')})`, [tenantId, engagementId, ...keys])).map((r: any) => r.k)); };
export const insertImport = (c: Conn, tenantId: string, r: { id: string; engagementId: string; sourceName: string; format: 'csv' | 'json'; sha256: string; total: number; created: number; duplicates: number; invalid: number; importedBy: string }) =>
  c.query('INSERT INTO finding_imports(tenant_id,id,engagement_id,source_name,format,sha256,total_rows,created_count,duplicate_count,invalid_count,imported_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [tenantId, r.id, r.engagementId, r.sourceName, r.format, r.sha256, r.total, r.created, r.duplicates, r.invalid, r.importedBy]);
export const insertImported = (c: Conn, tenantId: string, r: { id: string; engagementId: string; itemId: string; no: number; title: string; description: string; recommendation: string | null; severity: Severity; raisedBy: string; importId: string; importKey: string; roundId?: string | null }) =>
  c.query('INSERT INTO findings(tenant_id,id,engagement_id,item_id,finding_no,title,description,recommendation,severity,raised_by,import_id,import_key,round_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [tenantId, r.id, r.engagementId, r.itemId, r.no, r.title, r.description, r.recommendation, r.severity, r.raisedBy, r.importId, r.importKey, r.roundId ?? null]);
export const listImports = (c: Conn, tenantId: string, engagementId: string) => q(c, 'SELECT i.id, i.source_name sourceName, i.format, i.sha256, i.total_rows total, i.created_count created, i.duplicate_count duplicates, i.invalid_count invalid, u.name importedBy, i.created_at createdAt FROM finding_imports i JOIN users u ON u.id=i.imported_by WHERE i.tenant_id=? AND i.engagement_id=? ORDER BY i.created_at DESC, i.id LIMIT 50', [tenantId, engagementId]);

// ---- carried over by a renewal (Phase 11C) ----
export const unresolvedForCarry = (c: Conn, tenantId: string, engagementId: string) => q(c, "SELECT f.id, f.finding_no n, f.title, f.description, f.recommendation, f.severity, f.owner_user_id ownerUserId, i.ref itemRef FROM findings f JOIN checklist_items i ON i.tenant_id=f.tenant_id AND i.id=f.item_id WHERE f.tenant_id=? AND f.engagement_id=? AND f.status IN ('open','in_remediation','ready_for_retest') ORDER BY f.finding_no", [tenantId, engagementId]);
export const setCarriedFrom = async (c: Conn, tenantId: string, id: string, from: string) => { await c.query('UPDATE findings SET carried_from=? WHERE tenant_id=? AND id=?', [from, tenantId, id]); };

// ---- VAPT rounds (Phase 11D) ----
/** Tags findings of one engagement with a round (or clears the tag with null). Returns how many rows changed. */
export async function setRound(c: Conn, tenantId: string, engagementId: string, ids: string[], roundId: string | null) {
  if (!ids.length) return 0; const [r] = await c.query('UPDATE findings SET round_id=? WHERE tenant_id=? AND engagement_id=? AND id IN (?)', [roundId, tenantId, engagementId, ids]) as any; return Number(r.affectedRows);
}
export const forCompare = (c: Conn, tenantId: string, engagementId: string) => q(c, "SELECT round_id roundId, severity, status, DATE_FORMAT(created_at,'%Y-%m-%d') createdOn, DATE_FORMAT(closed_at,'%Y-%m-%d') closedOn FROM findings WHERE tenant_id=? AND engagement_id=? AND round_id IS NOT NULL", [tenantId, engagementId]);
export const roundSerious = async (c: Conn, tenantId: string, roundId: string) => Number((await q(c, "SELECT COUNT(*) n FROM findings WHERE tenant_id=? AND round_id=? AND severity IN ('critical','high') AND status IN ('open','in_remediation','ready_for_retest')", [tenantId, roundId]))[0].n);
export const roundFindings = (c: Conn, tenantId: string, roundId: string) => q(c, `SELECT ${COLS} ${FROM} WHERE f.tenant_id=? AND f.round_id=? ORDER BY FIELD(f.severity,'critical','high','medium','low','observation'), f.finding_no`, [tenantId, roundId]);
export const countFor = async (c: Conn, tenantId: string, engagementId: string, ids: string[]) => ids.length ? Number((await q(c, 'SELECT COUNT(*) n FROM findings WHERE tenant_id=? AND engagement_id=? AND id IN (?)', [tenantId, engagementId, ids]))[0].n) : 0;
