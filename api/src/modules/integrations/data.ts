// TENANT-SCOPED DATA LAYER for integrations: API keys, webhook endpoints and their deliveries, and the read feed of the audit log. Every function takes tenantId explicitly.
import { q, type Conn } from '../../db';
const j = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const KEY = `k.id, k.name, k.prefix, k.scopes, k.created_by createdBy, u.name createdByName, k.expires_at expiresAt, k.revoked_at revokedAt, k.last_used_at lastUsedAt, k.last_used_ip lastUsedIp, k.created_at createdAt`;
export const listKeys = async (c: Conn, tenantId: string) => (await q(c, `SELECT ${KEY} FROM api_keys k JOIN users u ON u.id=k.created_by WHERE k.tenant_id=? ORDER BY k.created_at DESC LIMIT 200`, [tenantId])).map(r => ({ ...r, scopes: j(r.scopes) }));
export const getKey = async (c: Conn, tenantId: string, id: string) => { const r = (await q(c, `SELECT ${KEY} FROM api_keys k JOIN users u ON u.id=k.created_by WHERE k.tenant_id=? AND k.id=?`, [tenantId, id]))[0]; return r ? { ...r, scopes: j(r.scopes) } : null; };
export const countLiveKeys = async (c: Conn, tenantId: string) => Number((await q(c, 'SELECT COUNT(*) n FROM api_keys WHERE tenant_id=? AND revoked_at IS NULL', [tenantId]))[0].n);
export const insertKey = (c: Conn, tenantId: string, k: { id: string; name: string; prefix: string; hash: string; scopes: string[]; createdBy: string; expiresAt: Date | null }) =>
  c.query('INSERT INTO api_keys(tenant_id,id,name,prefix,key_hash,scopes,created_by,expires_at) VALUES (?,?,?,?,?,?,?,?)', [tenantId, k.id, k.name, k.prefix, k.hash, JSON.stringify(k.scopes), k.createdBy, k.expiresAt]);
export const revokeKey = (c: Conn, tenantId: string, id: string, by: string) => c.query('UPDATE api_keys SET revoked_at=NOW(3), revoked_by=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL', [by, tenantId, id]);
/** The one lookup that is NOT scoped by a tenant given by the caller: a presented key finds its own tenant. Returns the stored hash for a constant-time comparison. */
export const keyByPrefix = async (c: Conn, prefix: string) => { const r = (await q(c, `SELECT k.tenant_id tenantId, k.id, k.name, k.key_hash hash, k.scopes, k.created_by createdBy, k.expires_at expiresAt, k.revoked_at revokedAt, u.status userStatus FROM api_keys k JOIN users u ON u.id=k.created_by WHERE k.prefix=?`, [prefix]))[0]; return r ? { ...r, scopes: j(r.scopes) as string[] } : null; };
export const touchKey = (c: Conn, tenantId: string, id: string, ip: string) => c.query('UPDATE api_keys SET last_used_at=NOW(3), last_used_ip=? WHERE tenant_id=? AND id=? AND (last_used_at IS NULL OR last_used_at < DATE_SUB(NOW(3), INTERVAL 1 MINUTE))', [ip.slice(0, 45), tenantId, id]);
export const orgActive = async (c: Conn, tenantId: string) => (await q(c, "SELECT 1 x FROM organizations WHERE id=? AND status='active'", [tenantId]))[0] ?? null;

const EP = `e.id, e.name, e.url, e.events, e.active, e.disabled_reason disabledReason, e.consecutive_failures consecutiveFailures, e.last_success_at lastSuccessAt, e.created_by createdBy, e.created_at createdAt`;
export const listEndpoints = async (c: Conn, tenantId: string) => (await q(c, `SELECT ${EP} FROM webhook_endpoints e WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 100`, [tenantId])).map(r => ({ ...r, events: j(r.events), active: !!r.active }));
export const getEndpoint = async (c: Conn, tenantId: string, id: string, withSecret = false) => { const r = (await q(c, `SELECT ${EP}${withSecret ? ', e.secret_enc secretEnc' : ''} FROM webhook_endpoints e WHERE e.tenant_id=? AND e.id=?`, [tenantId, id]))[0]; return r ? { ...r, events: j(r.events), active: !!r.active } : null; };
export const countEndpoints = async (c: Conn, tenantId: string) => Number((await q(c, 'SELECT COUNT(*) n FROM webhook_endpoints WHERE tenant_id=?', [tenantId]))[0].n);
export const insertEndpoint = (c: Conn, tenantId: string, e: { id: string; name: string; url: string; secretEnc: string; events: string[]; createdBy: string }) =>
  c.query('INSERT INTO webhook_endpoints(tenant_id,id,name,url,secret_enc,events,created_by) VALUES (?,?,?,?,?,?,?)', [tenantId, e.id, e.name, e.url, e.secretEnc, JSON.stringify(e.events), e.createdBy]);
const EP_COLS: Record<string, string> = { name: 'name', url: 'url', events: 'events', active: 'active', secretEnc: 'secret_enc' };
export async function updateEndpoint(c: Conn, tenantId: string, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch).filter(k => k in EP_COLS); if (!keys.length) return; const sets = keys.map(k => `${EP_COLS[k]}=?`); const vals = keys.map(k => k === 'events' ? JSON.stringify(patch[k]) : k === 'active' ? (patch[k] ? 1 : 0) : patch[k]);
  if (keys.includes('active') && patch.active) sets.push('disabled_reason=NULL', 'consecutive_failures=0'); await c.query(`UPDATE webhook_endpoints SET ${sets.join(',')} WHERE tenant_id=? AND id=?`, [...vals, tenantId, id]);
}
export const deleteEndpoint = async (c: Conn, tenantId: string, id: string) => { await c.query('DELETE FROM webhook_deliveries WHERE tenant_id=? AND endpoint_id=?', [tenantId, id]); await c.query('DELETE FROM webhook_endpoints WHERE tenant_id=? AND id=?', [tenantId, id]); };
export const listDeliveries = (c: Conn, tenantId: string, endpointId: string, status?: string) => q(c, `SELECT id, event_type eventType, status, attempts, last_status lastStatus, last_error lastError, next_attempt_at nextAttemptAt, delivered_at deliveredAt, created_at createdAt FROM webhook_deliveries WHERE tenant_id=? AND endpoint_id=? ${status ? 'AND status=?' : ''} ORDER BY id DESC LIMIT 100`, status ? [tenantId, endpointId, status] : [tenantId, endpointId]);
export const queueDelivery = (c: Conn, tenantId: string, endpointId: string, eventType: string, payload: unknown, auditId: number | null) =>
  c.query('INSERT IGNORE INTO webhook_deliveries(tenant_id,endpoint_id,audit_id,event_type,payload) VALUES (?,?,?,?,?)', [tenantId, endpointId, auditId, eventType.slice(0, 80), JSON.stringify(payload)]);
export const retryDelivery = async (c: Conn, tenantId: string, endpointId: string, id: number) => ((await c.query("UPDATE webhook_deliveries SET status='pending', attempts=0, next_attempt_at=NOW(3), last_error=NULL WHERE tenant_id=? AND endpoint_id=? AND id=? AND status='dead'", [tenantId, endpointId, id])) as any)[0].affectedRows as number;

/** The activity log as a feed for a SIEM: oldest first from a cursor, only what is sendable (the same rule as webhooks). */
export async function auditFeed(c: Conn, tenantId: string, o: { afterId: number; limit: number; from?: Date }) {
  const w = ['a.tenant_id=?', 'a.id>?']; const p: any[] = [tenantId, o.afterId]; if (o.from) { w.push('a.created_at>=?'); p.push(o.from); }
  return q(c, `SELECT a.id, a.actor_id actorId, a.action, a.entity, a.entity_id entityId, a.detail, a.created_at createdAt FROM audit_events a WHERE ${w.join(' AND ')} ORDER BY a.id LIMIT ?`, [...p, o.limit]);
}
export const findingByExternalRef = async (c: Conn, tenantId: string, ref: string) => (await q(c, 'SELECT id, finding_no findingNo FROM findings WHERE tenant_id=? AND external_ref=?', [tenantId, ref]))[0] ?? null;
export const setExternalRef = (c: Conn, tenantId: string, id: string, ref: string) => c.query('UPDATE findings SET external_ref=? WHERE tenant_id=? AND id=?', [ref, tenantId, id]);
