import type { Conn } from '../db';
export async function audit(c: Conn, e: { tenantId?: string | null; actorId?: string | null; action: string; entity?: string; entityId?: string; detail?: unknown; ip?: string }) {
  await c.query('INSERT INTO audit_events(tenant_id,actor_id,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)',
    [e.tenantId ?? null, e.actorId ?? null, e.action, e.entity ?? null, e.entityId ?? null, e.detail ? JSON.stringify(e.detail) : null, e.ip ?? null]);
}
