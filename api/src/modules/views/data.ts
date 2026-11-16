// TENANT-SCOPED DATA LAYER for saved_views. Only this file runs SQL on it. Every query is limited to the calling user.
import { q, type Conn } from '../../db';
export const listViews = (c: Conn, tenantId: string, userId: string, page: string) => q(c, 'SELECT id, name, filters, created_at createdAt FROM saved_views WHERE tenant_id=? AND user_id=? AND page=? ORDER BY name', [tenantId, userId, page]);
export const countViews = async (c: Conn, tenantId: string, userId: string, page: string) => Number((await q(c, 'SELECT COUNT(*) n FROM saved_views WHERE tenant_id=? AND user_id=? AND page=?', [tenantId, userId, page]))[0].n);
export const insertView = (c: Conn, tenantId: string, v: { id: string; userId: string; page: string; name: string; filters: string }) => c.query('INSERT INTO saved_views(tenant_id,id,user_id,page,name,filters) VALUES (?,?,?,?,?,?)', [tenantId, v.id, v.userId, v.page, v.name, v.filters]);
export const deleteView = async (c: Conn, tenantId: string, userId: string, id: string) => { const [r]: any = await c.query('DELETE FROM saved_views WHERE tenant_id=? AND user_id=? AND id=?', [tenantId, userId, id]); return (r.affectedRows ?? 0) > 0; };
