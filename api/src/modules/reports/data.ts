// TENANT-SCOPED DATA LAYER for the export log (report_exports). The only file that runs SQL on it.
import { q, type Conn } from '../../db';
export type ExportRow = { id: string; tenantId: string; engagementId: string; format: 'pdf' | 'xlsx'; sha256: string; sizeBytes: number; counts: any; engagementStatus: 'active' | 'closed'; generatedBy: string; createdAt: string };
export const insertExport = async (c: Conn, r: { id: string; tenantId: string; engagementId: string; format: 'pdf' | 'xlsx'; sha256: string; sizeBytes: number; counts: unknown; engagementStatus: string; generatedBy: string }) => {
  await c.query('INSERT INTO report_exports(id,tenant_id,engagement_id,format,sha256,size_bytes,counts,engagement_status,generated_by) VALUES (?,?,?,?,?,?,?,?,?)', [r.id, r.tenantId, r.engagementId, r.format, r.sha256, r.sizeBytes, JSON.stringify(r.counts), r.engagementStatus, r.generatedBy]);
};
const COLS = `x.id, x.engagement_id engagementId, e.name engagementName, x.format, x.sha256, x.size_bytes sizeBytes, x.counts, x.engagement_status engagementStatus, x.generated_by generatedById, u.name generatedBy, x.created_at createdAt`;
const FROM = `FROM report_exports x JOIN engagements e ON e.tenant_id=x.tenant_id AND e.id=x.engagement_id JOIN users u ON u.id=x.generated_by`;
export const listExports = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT ${COLS} ${FROM} WHERE x.tenant_id=? AND x.engagement_id=? ORDER BY x.created_at DESC, x.id LIMIT 200`, [tenantId, engagementId]);
/** Every export in this organization whose bytes hash to `sha256` (normally one). Scope to engagements the caller can see happens in the route. */
export const findByHash = (c: Conn, tenantId: string, sha256: string) => q(c, `SELECT ${COLS} ${FROM} WHERE x.tenant_id=? AND x.sha256=? ORDER BY x.created_at DESC LIMIT 20`, [tenantId, sha256]);
