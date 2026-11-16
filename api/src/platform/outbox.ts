// The transactional outbox. Call inside the same transaction as the change it announces: the event exists exactly when the change committed.
// The worker reads events and sends the emails. A problem here must never undo the business action, so it never throws.
import { q, type Conn } from '../db';
export async function emit(c: Conn, e: { tenantId?: string | null; type: string; payload?: unknown; dedupeKey?: string }): Promise<boolean> {
  try {
    await c.query('INSERT INTO outbox_events(tenant_id,type,payload,dedupe_key) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id', [e.tenantId ?? null, e.type.slice(0, 80), e.payload === undefined ? null : JSON.stringify(e.payload), e.dedupeKey?.slice(0, 120) ?? null]); return true;
  } catch (err: any) { console.error(JSON.stringify({ level: 'error', msg: 'outbox emit failed', type: e.type, err: err?.message })); return false; }
}
/** Counts and the parked events, for the Email delivery screen. */
export async function outboxStats(c: Conn) {
  const ob = (await q(c, 'SELECT SUM(processed_at IS NULL AND dead_at IS NULL) pending, SUM(dead_at IS NOT NULL) dead, SUM(processed_at IS NOT NULL) done FROM outbox_events'))[0];
  return { pending: Number(ob?.pending ?? 0), dead: Number(ob?.dead ?? 0), done: Number(ob?.done ?? 0), deadEvents: await q(c, 'SELECT id, type, attempts, last_error lastError, dead_at deadAt FROM outbox_events WHERE dead_at IS NOT NULL ORDER BY id DESC LIMIT 20') };
}
/** Puts parked events back in the queue. Events already processed are never touched. */
export async function retryDead(c: Conn): Promise<number> {
  const [r]: any = await c.query('UPDATE outbox_events SET dead_at=NULL, attempts=0, last_error=NULL, next_try_at=NOW(3) WHERE dead_at IS NOT NULL AND processed_at IS NULL'); return r.affectedRows as number;
}
