import { q, type Conn } from '../../db';
export type AuditFilter = { tenantId?: string; entity?: string; entityId?: string; actorId?: string; action?: string; from?: Date; to?: Date; beforeId?: number; limit?: number; engagementId?: string };
/** tenantId = the tenant to read. Platform-wide reads omit it (admin-level routes only). */
export async function queryAudit(c: Conn, f: AuditFilter) {
  const w: string[] = []; const p: any[] = [];
  if (f.tenantId) { w.push('a.tenant_id=?'); p.push(f.tenantId); }
  if (f.entity) { w.push('a.entity=?'); p.push(f.entity); }
  if (f.entityId) { w.push('a.entity_id=?'); p.push(f.entityId); }
  if (f.engagementId) { w.push("((a.entity='engagement' AND a.entity_id=?) OR JSON_UNQUOTE(JSON_EXTRACT(a.detail,'$.engagementId'))=?)"); p.push(f.engagementId, f.engagementId); }
  if (f.actorId) { w.push('a.actor_id=?'); p.push(f.actorId); }
  if (f.action) { w.push('a.action=?'); p.push(f.action); }
  if (f.from) { w.push('a.created_at>=?'); p.push(f.from); }
  if (f.to) { w.push('a.created_at<=?'); p.push(f.to); }
  if (f.beforeId) { w.push('a.id<?'); p.push(f.beforeId); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await q(c, `SELECT a.id,a.tenant_id,a.actor_id,u.name actor_name,a.action,a.entity,a.entity_id,a.detail,a.ip,a.created_at FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`, [...p, limit + 1]);
  const more = rows.length > limit; const items = rows.slice(0, limit);
  return { items, nextBeforeId: more ? items[items.length - 1].id : null };
}
export const distinctActions = async (c: Conn, tenantId?: string) => (await q(c, `SELECT DISTINCT action FROM audit_events ${tenantId ? 'WHERE tenant_id=?' : ''} ORDER BY action`, tenantId ? [tenantId] : [])).map(r => r.action as string);
export const countUserAuditEvents = async (c: Conn, userId: string) => (await q(c, 'SELECT COUNT(*) n FROM audit_events WHERE actor_id=?', [userId]))[0].n as number;
export const recentUserAuditActions = (c: Conn, userId: string, n = 200) => q(c, 'SELECT action,entity,created_at FROM audit_events WHERE actor_id=? ORDER BY id DESC LIMIT ?', [userId, n]);
export const hasRecentBackupEvent = async (c: Conn, actorId: string, targetId: string, minutes = 60) =>
  !!(await q(c, "SELECT 1 x FROM audit_events WHERE actor_id=? AND action='user.backup_generated' AND entity_id=? AND created_at>DATE_SUB(NOW(3), INTERVAL ? MINUTE) LIMIT 1", [actorId, targetId, minutes]))[0];
