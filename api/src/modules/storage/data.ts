// DATA LAYER for storage administration: usage per organization, legal holds, archive state, quarantine. Evidence itself is never deleted.
import { q, type Conn } from '../../db';
export const orgStorageRows = (c: Conn) => q(c, `SELECT o.id, o.name, o.status, o.retention_months retentionMonths, o.legal_hold legalHold, o.legal_hold_reason legalHoldReason, o.legal_hold_at legalHoldAt,
  COALESCE(u.used_bytes,0) usedBytes, COALESCE(u.version_count,0) versionCount, u.quota_bytes quotaBytes,
  (SELECT COUNT(*) FROM evidence_archive a WHERE a.tenant_id=o.id AND a.restored_at IS NULL) archivedEngagements,
  (SELECT COUNT(DISTINCT s.version_id) FROM evidence_scans s WHERE s.tenant_id=o.id AND s.status='infected') infectedFiles,
  (SELECT COUNT(*) FROM engagements e WHERE e.tenant_id=o.id AND e.legal_hold=1) heldEngagements
  FROM organizations o LEFT JOIN evidence_usage u ON u.tenant_id=o.id ORDER BY o.name`);
export const setOrgHold = async (c: Conn, orgId: string, hold: boolean, reason: string | null) => { await c.query('UPDATE organizations SET legal_hold=?, legal_hold_reason=?, legal_hold_at=IF(?, NOW(3), NULL) WHERE id=?', [hold ? 1 : 0, hold ? reason : null, hold ? 1 : 0, orgId]); };
export const getEngagementHold = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT id, name, status, legal_hold legalHold FROM engagements WHERE tenant_id=? AND id=?', [tenantId, id]))[0] ?? null;
export const setEngagementHold = async (c: Conn, tenantId: string, id: string, hold: boolean, reason: string | null) => { await c.query('UPDATE engagements SET legal_hold=?, legal_hold_reason=?, legal_hold_at=IF(?, NOW(3), NULL) WHERE tenant_id=? AND id=?', [hold ? 1 : 0, hold ? reason : null, hold ? 1 : 0, tenantId, id]); };
export const heldEngagements = (c: Conn) => q(c, `SELECT e.tenant_id tenantId, o.name orgName, e.id, e.name, e.legal_hold_reason reason, e.legal_hold_at since FROM engagements e JOIN organizations o ON o.id=e.tenant_id WHERE e.legal_hold=1 ORDER BY o.name, e.name`);
export const archivedList = (c: Conn) => q(c, `SELECT a.tenant_id tenantId, o.name orgName, a.engagement_id engagementId, e.name, a.archived_at archivedAt, a.request_count requestCount, a.retention_months retentionMonths
  FROM evidence_archive a JOIN engagements e ON e.tenant_id=a.tenant_id AND e.id=a.engagement_id JOIN organizations o ON o.id=a.tenant_id WHERE a.restored_at IS NULL ORDER BY a.archived_at DESC LIMIT 200`);
/** Brings an archived engagement back. Returns false when it was not archived. */
export async function restoreArchive(c: Conn, tenantId: string, engagementId: string, userId: string): Promise<boolean> {
  const [r]: any = await c.query('UPDATE evidence_archive SET restored_at=NOW(3), restored_by=? WHERE tenant_id=? AND engagement_id=? AND restored_at IS NULL', [userId, tenantId, engagementId]); return r.affectedRows > 0;
}
/** Files the malware scan flagged, with who uploaded them. The file itself stays on disk but can never be downloaded or accepted. */
export const quarantine = (c: Conn, tenantId: string | null) => q(c, `SELECT v.tenant_id tenantId, o.name orgName, v.id versionId, v.version_no versionNo, v.file_name fileName, v.size_bytes sizeBytes, v.uploaded_at uploadedAt, u.name uploadedBy, r.id requestId, r.title requestTitle, r.engagement_id engagementId,
  (SELECT s.signature FROM evidence_scans s WHERE s.tenant_id=v.tenant_id AND s.version_id=v.id AND s.status='infected' ORDER BY s.scanned_at DESC, s.id DESC LIMIT 1) signature,
  (SELECT MAX(s.scanned_at) FROM evidence_scans s WHERE s.tenant_id=v.tenant_id AND s.version_id=v.id AND s.status='infected') detectedAt
  FROM evidence_versions v JOIN evidence_requests r ON r.tenant_id=v.tenant_id AND r.id=v.request_id JOIN organizations o ON o.id=v.tenant_id JOIN users u ON u.id=v.uploaded_by
  WHERE v.kind='file' AND EXISTS(SELECT 1 FROM evidence_scans s WHERE s.tenant_id=v.tenant_id AND s.version_id=v.id AND s.status='infected') ${tenantId ? 'AND v.tenant_id=?' : ''} ORDER BY detectedAt DESC LIMIT 500`, tenantId ? [tenantId] : []);

/** Organizations with a storage limit that have used 90% or more of it. */
export const orgsNearQuota = async (c: Conn) => (await q(c, 'SELECT o.name, u.used_bytes used, u.quota_bytes quota FROM evidence_usage u JOIN organizations o ON o.id=u.tenant_id WHERE u.quota_bytes IS NOT NULL AND u.quota_bytes>0 AND u.used_bytes >= u.quota_bytes*0.9 ORDER BY o.name LIMIT 20')).map((r: any) => ({ name: String(r.name), percent: Math.min(100, Math.round((Number(r.used) / Number(r.quota)) * 100)) }));
