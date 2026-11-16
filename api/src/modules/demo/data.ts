// Wiping a demo organization (Phase 13C). Runs on the dedicated purge account (see grants.ts / docs/DEMO_DATA.md), inside one transaction.
// The append-only triggers allow a delete only for a demo organization whose purge_started_at is set, so a mistake here cannot touch a real client.
import { q, type Conn } from '../../db';
export const orgOf = async (c: Conn, id: string) => (await q(c, 'SELECT id, name, is_demo isDemo, purge_started_at purgeStartedAt FROM organizations WHERE id=?', [id]))[0] ?? null;
export const passwordHashOf = async (c: Conn, userId: string) => (await q(c, "SELECT password_hash h FROM users WHERE id=? AND status='active'", [userId]))[0]?.h as string | null | undefined;
export const lockForWipe = async (c: Conn, id: string) => (await q(c, 'SELECT id, name, is_demo isDemo FROM organizations WHERE id=? FOR UPDATE', [id]))[0] ?? null;
export const markWiping = async (c: Conn, id: string) => { await c.query('UPDATE organizations SET purge_started_at=NOW(3) WHERE id=? AND is_demo=1', [id]); };
export const tenantTables = async (c: Conn) => (await q(c, "SELECT DISTINCT table_name t FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name='tenant_id' AND table_name<>'organizations'", [])).map(r => (r.t ?? r.T ?? r.TABLE_NAME) as string);
export const storageKeys = async (c: Conn, tenantId: string) => (await q(c, 'SELECT storage_key k FROM evidence_versions WHERE tenant_id=? AND storage_key IS NOT NULL', [tenantId])).map(r => r.k as string);
/** People who belong to this organization and nowhere else, are not platform users and are not iSecurify staff assignments. */
export const peopleOnlyHere = async (c: Conn, tenantId: string) => (await q(c, `SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.tenant_id=? WHERE u.platform_role='none'
  AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id=u.id AND o.tenant_id<>?) AND NOT EXISTS (SELECT 1 FROM staff_assignments s WHERE s.user_id=u.id)`, [tenantId, tenantId])).map(r => r.id as string);
export const setForeignKeyChecks = async (c: Conn, on: boolean) => { await c.query(`SET FOREIGN_KEY_CHECKS=${on ? 1 : 0}`); };
/** Rows that point at an organization's rows without carrying a tenant_id of their own. */
export async function deleteDependents(c: Conn, tenantId: string) {
  await c.query('DELETE n FROM task_notice_log n JOIN tasks t ON t.id=n.task_id WHERE t.tenant_id=?', [tenantId]);
  await c.query('DELETE n FROM vapt_notice_log n JOIN vapt_rounds r ON r.id=n.round_id WHERE r.tenant_id=?', [tenantId]);
}
/** Deletes every row of the organization from one table in small batches; returns how many went. */
export async function deleteFrom(c: Conn, table: string, tenantId: string) {
  if (!/^[a-z0-9_]+$/.test(table)) throw new Error('bad table name'); let total = 0;
  for (;;) { const r = (await c.query(`DELETE FROM \`${table}\` WHERE tenant_id=? LIMIT 5000`, [tenantId])) as any; const n = Number(r[0].affectedRows); total += n; if (n < 5000) return total; }
}
export const remaining = async (c: Conn, table: string, tenantId: string) => Number((await q(c, `SELECT COUNT(*) n FROM \`${table}\` WHERE tenant_id=?`, [tenantId]))[0].n);
export async function deletePerson(c: Conn, userId: string) {
  for (const t of ['sessions', 'mfa_secrets', 'recovery_codes', 'password_resets', 'notification_prefs', 'user_digest', 'reminder_log', 'continuous_notice_log']) await c.query(`DELETE FROM ${t} WHERE user_id=?`, [userId]);
  await c.query('DELETE FROM users WHERE id=?', [userId]);
}
export const deleteOrg = async (c: Conn, id: string) => { await c.query('DELETE FROM organizations WHERE id=?', [id]); };
export const writeAudit = async (c: Conn, actorId: string, detail: unknown, ip?: string) => { await c.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity,entity_id,detail,ip) VALUES (NULL,?,?,?,?,?,?)", [actorId, 'org.wiped', 'organization', (detail as any).id, JSON.stringify(detail), ip ?? null]); };
