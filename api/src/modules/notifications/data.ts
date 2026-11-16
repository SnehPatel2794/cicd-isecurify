// TENANT-SCOPED DATA LAYER for notifications and their preferences. The only file that runs SQL on those tables.
import { q, type Conn } from '../../db';
export type NewNote = { tenantId: string; userId: string; kind: string; entityType: 'finding' | 'evidence_request' | 'checklist_item' | 'certificate' | 'risk' | 'policy' | 'incident' | 'vendor' | 'engagement'; entityId: string; engagementId: string | null; label: string; actorId: string | null };

/** Users (of those given) who switched this kind off. */
export async function usersWhoDisabled(c: Conn, userIds: string[], kind: string): Promise<Set<string>> {
  if (!userIds.length) return new Set(); const rows = await q(c, `SELECT user_id u FROM notification_prefs WHERE kind=? AND in_app=0 AND user_id IN (${userIds.map(() => '?').join(',')})`, [kind, ...userIds]); return new Set(rows.map((r: any) => r.u));
}
/** Inserts unless the same person already has an UNREAD notification of the same kind about the same thing (a burst of comments is one line, not twenty). Returns the new id, or 0 when nothing was added. */
export async function insertUnlessUnread(c: Conn, n: NewNote): Promise<number> {
  if ((await q(c, 'SELECT 1 x FROM notifications WHERE user_id=? AND kind=? AND entity_id=? AND read_at IS NULL LIMIT 1', [n.userId, n.kind, n.entityId]))[0]) return 0;
  const [r]: any = await c.query('INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,?)', [n.tenantId, n.userId, n.kind, n.entityType, n.entityId, n.engagementId, n.label, n.actorId]); return Number(r.insertId);
}
const scope = (tenantIds: string[], col = 'tenant_id') => tenantIds.length ? `${col} IN (${tenantIds.map(() => '?').join(',')})` : '1=0';
/** `tenantIds` is the set of organizations the user can enter RIGHT NOW; notifications from anywhere else stay hidden. */
export const listFor = (c: Conn, userId: string, tenantIds: string[], o: { unread?: boolean; tenantId?: string; beforeId?: number; limit: number }) => q(c,
  `SELECT n.id, n.tenant_id tenantId, o.name tenantName, n.kind, n.entity_type entityType, n.entity_id entityId, n.engagement_id engagementId, n.label, n.created_at createdAt, n.read_at readAt, a.name actorName
   FROM notifications n JOIN organizations o ON o.id=n.tenant_id LEFT JOIN users a ON a.id=n.actor_id
   WHERE n.user_id=? AND ${scope(tenantIds, 'n.tenant_id')} ${o.unread ? 'AND n.read_at IS NULL' : ''} ${o.tenantId ? 'AND n.tenant_id=?' : ''} ${o.beforeId ? 'AND n.id<?' : ''} ORDER BY n.id DESC LIMIT ?`,
  [userId, ...tenantIds, ...(o.tenantId ? [o.tenantId] : []), ...(o.beforeId ? [o.beforeId] : []), o.limit]);
export const unreadCount = async (c: Conn, userId: string, tenantIds: string[]) => Number((await q(c, `SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL AND ${scope(tenantIds)}`, [userId, ...tenantIds]))[0].n);
export const unreadByTenant = (c: Conn, userId: string, tenantIds: string[]) => q(c, `SELECT tenant_id tenantId, COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL AND ${scope(tenantIds)} GROUP BY tenant_id`, [userId, ...tenantIds]);
export async function markRead(c: Conn, userId: string, tenantIds: string[], ids: number[] | 'all'): Promise<number> {
  if (ids !== 'all' && !ids.length) return 0;
  const [r]: any = await c.query(`UPDATE notifications SET read_at=NOW(3) WHERE user_id=? AND read_at IS NULL AND ${scope(tenantIds)} ${ids === 'all' ? '' : `AND id IN (${ids.map(() => '?').join(',')})`}`, [userId, ...tenantIds, ...(ids === 'all' ? [] : ids)]); return r.affectedRows as number;
}
export const getPrefs = (c: Conn, userId: string) => q(c, 'SELECT kind, in_app inApp, email_on emailOn FROM notification_prefs WHERE user_id=?', [userId]);
export const setPref = async (c: Conn, userId: string, kind: string, p: { inApp?: boolean; email?: boolean }) => {
  await c.query('INSERT INTO notification_prefs(user_id,kind,in_app,email_on) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE in_app=COALESCE(?,in_app), email_on=COALESCE(?,email_on)', [userId, kind, p.inApp === undefined ? 1 : p.inApp ? 1 : 0, p.email === undefined ? null : p.email ? 1 : 0, p.inApp === undefined ? null : p.inApp ? 1 : 0, p.email === undefined ? null : p.email ? 1 : 0]);
};
export const getDigest = async (c: Conn, userId: string) => { const r = (await q(c, 'SELECT frequency, last_sent_at lastSentAt FROM user_digest WHERE user_id=?', [userId]))[0]; return { frequency: (r?.frequency ?? 'daily') as 'off' | 'daily' | 'weekly', lastSentAt: r?.lastSentAt ?? null }; };
export const setDigest = async (c: Conn, userId: string, frequency: 'off' | 'daily' | 'weekly') => { await c.query('INSERT INTO user_digest(user_id,frequency) VALUES (?,?) ON DUPLICATE KEY UPDATE frequency=VALUES(frequency)', [userId, frequency]); };
/** Account deletion: notifications and preferences are personal data. */
export const purgeUser = async (c: Conn, userId: string) => { await c.query('DELETE FROM notifications WHERE user_id=?', [userId]); await c.query('DELETE FROM notification_prefs WHERE user_id=?', [userId]); await c.query('DELETE FROM user_digest WHERE user_id=?', [userId]); await c.query('DELETE FROM reminder_log WHERE user_id=?', [userId]); };
