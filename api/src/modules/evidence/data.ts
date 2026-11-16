// TENANT-SCOPED DATA LAYER for evidence (requests, versions, reviews, scans, storage usage). Only this file may run SQL on those tables
// (test/05_data_layer.test.ts enforces it). Every function takes tenantId and puts it in every WHERE/JOIN.
// Lock order used by every writer (prevents deadlocks): item -> engagement -> request -> usage.
import { q, type Conn } from '../../db';
import { deriveItemEvidence, type ReqStatus } from './rules'; import { setItemEvidenceStatus } from '../engagements/data';

const D = (col: string, as: string) => `DATE_FORMAT(${col},'%Y-%m-%d') ${as}`;
export type Usage = { usedBytes: number; versionCount: number; quotaBytes: number | null };

// ---------------- storage usage and quota ----------------
export const readUsage = async (c: Conn, tenantId: string): Promise<Usage> => (await q(c, 'SELECT used_bytes usedBytes, version_count versionCount, quota_bytes quotaBytes FROM evidence_usage WHERE tenant_id=?', [tenantId]))[0] ?? { usedBytes: 0, versionCount: 0, quotaBytes: null };
/** Creates the row if needed and locks it: the quota check and the counter update happen under this lock, so parallel uploads can never overshoot the quota. */
export async function lockUsage(c: Conn, tenantId: string): Promise<Usage> {
  await c.query('INSERT INTO evidence_usage(tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id=tenant_id', [tenantId]);
  return (await q(c, 'SELECT used_bytes usedBytes, version_count versionCount, quota_bytes quotaBytes FROM evidence_usage WHERE tenant_id=? FOR UPDATE', [tenantId]))[0];
}
export const addUsage = async (c: Conn, tenantId: string, bytes: number) => { await c.query('UPDATE evidence_usage SET used_bytes=used_bytes+?, version_count=version_count+1 WHERE tenant_id=?', [bytes, tenantId]); };
export const setQuota = async (c: Conn, tenantId: string, bytes: number | null) => { await c.query('INSERT INTO evidence_usage(tenant_id,quota_bytes) VALUES (?,?) ON DUPLICATE KEY UPDATE quota_bytes=VALUES(quota_bytes)', [tenantId, bytes]); };
/** What the counters SHOULD say, computed from the immutable version rows (used by the consistency test and by an operator check). */
export const recountUsage = async (c: Conn, tenantId: string) => (await q(c, 'SELECT COALESCE(SUM(size_bytes),0) usedBytes, COUNT(*) versionCount FROM evidence_versions WHERE tenant_id=?', [tenantId]))[0] as { usedBytes: number; versionCount: number };

// ---------------- requests ----------------
const SCAN = `CASE WHEN EXISTS(SELECT 1 FROM evidence_scans s WHERE s.tenant_id=v.tenant_id AND s.version_id=v.id AND s.status='infected') THEN 'infected'
  ELSE (SELECT s2.status FROM evidence_scans s2 WHERE s2.tenant_id=v.tenant_id AND s2.version_id=v.id ORDER BY s2.scanned_at DESC, s2.id DESC LIMIT 1) END`;
const REQ_COLS = `r.id, r.engagement_id engagementId, r.item_id itemId, r.title, r.instructions, r.template_id templateId, t.name templateName, t.file_name templateFileName, t.sha256 templateSha256, ${D('r.due_date', 'dueDate')}, r.valid_months validMonths, r.status,
  r.latest_version_no latestVersionNo, ${D('r.valid_until', 'validUntil')}, r.cancel_reason cancelReason, r.requested_by requestedBy, ru.name requestedByName, r.created_at createdAt, r.updated_at updatedAt,
  i.ref itemRef, i.title itemTitle, i.readiness_status itemReadiness, i.accountable_user_id accountableUserId`;
const REQ_FROM = `FROM evidence_requests r JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id LEFT JOIN evidence_templates t ON t.id=r.template_id LEFT JOIN users ru ON ru.id=r.requested_by`;
const LATEST_COLS = `v.id latestId, v.kind latestKind, v.file_name latestFileName, v.size_bytes latestSize, v.sha256 latestSha256, v.link_provider latestProvider, v.uploaded_at latestAt, uu.name latestBy, v.uploaded_by latestById, (${SCAN}) latestScan`;
const LATEST_JOIN = `LEFT JOIN evidence_versions v ON v.tenant_id=r.tenant_id AND v.request_id=r.id AND v.version_no=r.latest_version_no LEFT JOIN users uu ON uu.id=v.uploaded_by`;

export async function insertRequests(c: Conn, tenantId: string, engagementId: string, rows: { id: string; itemId: string; title: string; instructions?: string | null; templateId?: string | null; dueDate?: string | null; validMonths?: number | null; requestedBy: string }[]) {
  for (let i = 0; i < rows.length; i += 500) await c.query('INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,instructions,template_id,due_date,valid_months,requested_by) VALUES ?',
    [rows.slice(i, i + 500).map(r => [tenantId, r.id, engagementId, r.itemId, r.title, r.instructions ?? null, r.templateId ?? null, r.dueDate ?? null, r.validMonths ?? null, r.requestedBy])]);
}
export const getRequest = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${REQ_COLS} ${REQ_FROM} WHERE r.tenant_id=? AND r.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
/** Plain (non-locking) read of just the ids needed to take locks in the right order. */
export const requestRefs = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT id, engagement_id engagementId, item_id itemId FROM evidence_requests WHERE tenant_id=? AND id=?', [tenantId, id]))[0] ?? null;
export const lockRequest = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT id, status, latest_version_no latestVersionNo, valid_months validMonths FROM evidence_requests WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, id]))[0] ?? null;
export async function listRequests(c: Conn, tenantId: string, engagementId: string, f: { assignedUserId?: string; itemId?: string; status?: string } = {}) {
  const w = ['r.tenant_id=?', 'r.engagement_id=?']; const p: any[] = [tenantId, engagementId];
  if (f.assignedUserId) { w.push('i.accountable_user_id=?'); p.push(f.assignedUserId); } if (f.itemId) { w.push('r.item_id=?'); p.push(f.itemId); } if (f.status) { w.push('r.status=?'); p.push(f.status); }
  return q(c, `SELECT ${REQ_COLS}, ${LATEST_COLS} ${REQ_FROM} ${LATEST_JOIN} WHERE ${w.join(' AND ')} ORDER BY i.sort_order, r.created_at, r.id LIMIT 2001`, p);
}
export const listItemRequests = (c: Conn, tenantId: string, itemId: string) => q(c, `SELECT ${REQ_COLS}, ${LATEST_COLS} ${REQ_FROM} ${LATEST_JOIN} WHERE r.tenant_id=? AND r.item_id=? ORDER BY r.created_at, r.id`, [tenantId, itemId]);
export const countActiveRequests = async (c: Conn, tenantId: string, itemId: string) => (await q(c, "SELECT COUNT(*) n FROM evidence_requests WHERE tenant_id=? AND item_id=? AND status<>'cancelled'", [tenantId, itemId]))[0].n as number;
export const itemsWithActiveRequests = async (c: Conn, tenantId: string, engagementId: string) => new Set<string>((await q(c, "SELECT DISTINCT item_id id FROM evidence_requests WHERE tenant_id=? AND engagement_id=? AND status<>'cancelled'", [tenantId, engagementId])).map(r => r.id));
export const expiredItemIds = async (c: Conn, tenantId: string, engagementId: string, today: string) => new Set<string>((await q(c, "SELECT DISTINCT item_id id FROM evidence_requests WHERE tenant_id=? AND engagement_id=? AND status='accepted' AND valid_until IS NOT NULL AND valid_until < ?", [tenantId, engagementId, today])).map(r => r.id));

const REQ_WRITABLE: Record<string, string> = { title: 'title', instructions: 'instructions', dueDate: 'due_date', validMonths: 'valid_months', templateId: 'template_id' };
export async function updateRequestFields(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in REQ_WRITABLE); if (!keys.length) return;
  await c.query(`UPDATE evidence_requests SET ${keys.map(k => `${REQ_WRITABLE[k]}=?`).join(',')} WHERE tenant_id=? AND id=?`, [...keys.map(k => patch[k] ?? null), tenantId, id]);
}
/** A new version resets the decision: the request is awaiting review again and any earlier validity period no longer applies. */
export const markSubmitted = async (c: Conn, tenantId: string, id: string, versionNo: number) => { await c.query("UPDATE evidence_requests SET status='submitted', latest_version_no=?, valid_until=NULL WHERE tenant_id=? AND id=?", [versionNo, tenantId, id]); };
export const markReviewed = async (c: Conn, tenantId: string, id: string, decision: 'accepted' | 'rejected', validUntil: string | null) => { await c.query('UPDATE evidence_requests SET status=?, valid_until=? WHERE tenant_id=? AND id=?', [decision, decision === 'accepted' ? validUntil : null, tenantId, id]); };
export const markCancelled = async (c: Conn, tenantId: string, id: string, reason: string) => { await c.query("UPDATE evidence_requests SET status='cancelled', cancel_reason=?, valid_until=NULL WHERE tenant_id=? AND id=?", [reason, tenantId, id]); };

/** Derives the item-level evidence status from the item's requests (pure rule in rules.ts) and stores it. Call inside every transaction that changes a request. */
export async function recomputeItemEvidence(c: Conn, tenantId: string, itemId: string) {
  const rows = await q(c, 'SELECT status FROM evidence_requests WHERE tenant_id=? AND item_id=?', [tenantId, itemId]);
  const s = deriveItemEvidence(rows.map(r => r.status as ReqStatus)); await setItemEvidenceStatus(c, tenantId, itemId, s); return s;
}

// ---------------- versions, reviews, scans ----------------
export async function insertVersion(c: Conn, tenantId: string, v: { id: string; requestId: string; versionNo: number; kind: 'file' | 'link'; fileName?: string | null; mediaType?: string | null; sizeBytes?: number | null; sha256?: string | null; storageKey?: string | null; linkUrl?: string | null; linkProvider?: string | null; note?: string | null; uploadedBy: string }) {
  await c.query('INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,media_type,size_bytes,sha256,storage_key,link_url,link_provider,note,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [tenantId, v.id, v.requestId, v.versionNo, v.kind, v.fileName ?? null, v.mediaType ?? null, v.sizeBytes ?? null, v.sha256 ?? null, v.storageKey ?? null, v.linkUrl ?? null, v.linkProvider ?? null, v.note ?? null, v.uploadedBy]);
}
const VER_COLS = `v.id, v.request_id requestId, v.version_no versionNo, v.kind, v.file_name fileName, v.media_type mediaType, v.size_bytes sizeBytes, v.sha256, v.link_url linkUrl, v.link_provider linkProvider, v.note, v.uploaded_by uploadedBy, u.name uploadedByName, v.uploaded_at uploadedAt, (${SCAN}) scanStatus`;
export const listVersions = (c: Conn, tenantId: string, requestId: string) => q(c, `SELECT ${VER_COLS} FROM evidence_versions v JOIN users u ON u.id=v.uploaded_by WHERE v.tenant_id=? AND v.request_id=? ORDER BY v.version_no`, [tenantId, requestId]);
export const listVersionsFor = async (c: Conn, tenantId: string, requestIds: string[]) => { if (!requestIds.length) return [] as any[]; return q(c, `SELECT ${VER_COLS} FROM evidence_versions v JOIN users u ON u.id=v.uploaded_by WHERE v.tenant_id=? AND v.request_id IN (?) ORDER BY v.request_id, v.version_no`, [tenantId, requestIds]); };
/** One version plus what the permission checks need (its request, item, accountable person). */
export const getVersion = async (c: Conn, tenantId: string, id: string) => (await q(c, `SELECT ${VER_COLS}, v.storage_key storageKey, r.engagement_id engagementId, r.item_id itemId, r.status requestStatus, r.latest_version_no latestVersionNo, i.accountable_user_id accountableUserId, i.ref itemRef
  FROM evidence_versions v JOIN users u ON u.id=v.uploaded_by JOIN evidence_requests r ON r.tenant_id=v.tenant_id AND r.id=v.request_id JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id WHERE v.tenant_id=? AND v.id=?`, [tenantId, id]))[0] ?? null;
/** 'infected' if ANY scan of the version found something, otherwise the newest result, or null when it was never scanned. */
export const versionScanStatus = async (c: Conn, tenantId: string, versionId: string): Promise<string | null> => (await q(c, `SELECT (${SCAN}) s FROM evidence_versions v WHERE v.tenant_id=? AND v.id=?`, [tenantId, versionId]))[0]?.s ?? null;
export const getVersionInRequest = async (c: Conn, tenantId: string, requestId: string, versionId: string) => (await q(c, 'SELECT v.id, v.version_no versionNo, v.kind, v.uploaded_by uploadedBy FROM evidence_versions v WHERE v.tenant_id=? AND v.request_id=? AND v.id=?', [tenantId, requestId, versionId]))[0] ?? null;
export async function insertReview(c: Conn, tenantId: string, r: { id: string; requestId: string; versionId: string; decision: 'accepted' | 'rejected'; note: string; validUntil: string | null; reviewedBy: string }) {
  await c.query('INSERT INTO evidence_reviews(tenant_id,id,request_id,version_id,decision,note,valid_until,reviewed_by) VALUES (?,?,?,?,?,?,?,?)', [tenantId, r.id, r.requestId, r.versionId, r.decision, r.note, r.validUntil, r.reviewedBy]);
}
export const listReviews = (c: Conn, tenantId: string, requestId: string) => q(c, `SELECT rv.id, rv.version_id versionId, v.version_no versionNo, rv.decision, rv.note, ${D('rv.valid_until', 'validUntil')}, rv.reviewed_by reviewedBy, u.name reviewedByName, rv.reviewed_at reviewedAt
  FROM evidence_reviews rv JOIN evidence_versions v ON v.tenant_id=rv.tenant_id AND v.id=rv.version_id JOIN users u ON u.id=rv.reviewed_by WHERE rv.tenant_id=? AND rv.request_id=? ORDER BY rv.reviewed_at, rv.id`, [tenantId, requestId]);
export const listReviewsFor = async (c: Conn, tenantId: string, requestIds: string[]) => { if (!requestIds.length) return [] as any[]; return q(c, `SELECT rv.request_id requestId, rv.id, rv.version_id versionId, v.version_no versionNo, rv.decision, rv.note, ${D('rv.valid_until', 'validUntil')}, rv.reviewed_by reviewedBy, u.name reviewedByName, rv.reviewed_at reviewedAt
  FROM evidence_reviews rv JOIN evidence_versions v ON v.tenant_id=rv.tenant_id AND v.id=rv.version_id JOIN users u ON u.id=rv.reviewed_by WHERE rv.tenant_id=? AND rv.request_id IN (?) ORDER BY rv.reviewed_at, rv.id`, [tenantId, requestIds]); };
export const listScans = (c: Conn, tenantId: string, versionId: string) => q(c, 'SELECT id, status, signature, engine, detail, scanned_at scannedAt FROM evidence_scans WHERE tenant_id=? AND version_id=? ORDER BY scanned_at DESC, id DESC LIMIT 20', [tenantId, versionId]);

// ---------------- summaries ----------------
/** Counts for the engagement Evidence tab. `assignedUserId` narrows to one person's items (client staff / vendors). */
export async function evidenceSummary(c: Conn, tenantId: string, engagementId: string, today: string, assignedUserId?: string) {
  const rows = await q(c, `SELECT r.status, (r.status='accepted' AND r.valid_until IS NOT NULL AND r.valid_until < ?) expired, (r.status IN ('requested','rejected') AND r.due_date IS NOT NULL AND r.due_date < ?) overdue, COUNT(*) n
    FROM evidence_requests r JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id WHERE r.tenant_id=? AND r.engagement_id=? ${assignedUserId ? 'AND i.accountable_user_id=?' : ''} GROUP BY r.status, expired, overdue`,
    [today, today, tenantId, engagementId, ...(assignedUserId ? [assignedUserId] : [])]);
  const out = { total: 0, requested: 0, submitted: 0, accepted: 0, rejected: 0, cancelled: 0, expired: 0, overdue: 0 } as Record<string, number>;
  for (const r of rows) { const n = Number(r.n); out.total += n; out[r.status] += n; if (r.expired) out.expired += n; if (r.overdue) out.overdue += n; } return out;
}

// ---------------- hooks for the account-backup manifest ----------------
export const versionsUploadedBy = (c: Conn, userId: string) => q(c, `SELECT e.name engagementName, i.ref, v.version_no versionNo, v.kind, COALESCE(v.file_name, v.link_url) what, v.sha256, v.uploaded_at uploadedAt
  FROM evidence_versions v JOIN evidence_requests r ON r.tenant_id=v.tenant_id AND r.id=v.request_id JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id JOIN engagements e ON e.tenant_id=r.tenant_id AND e.id=r.engagement_id
  WHERE v.uploaded_by=? ORDER BY v.uploaded_at DESC LIMIT 500`, [userId]);
/** Administrative: per-organization usage with the platform default applied by the caller. */
export const listUsageByOrg = (c: Conn) => q(c, 'SELECT tenant_id tenantId, used_bytes usedBytes, version_count versionCount, quota_bytes quotaBytes FROM evidence_usage');
