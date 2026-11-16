// Phase 11B, the worker's part of webhooks.
//   fanOut:      reads new rows of the audit log (a cursor remembers where it stopped) and queues one delivery per matching, active endpoint of the same organization.
//   deliverDue:  sends due deliveries, signed, with a short timeout, no redirects and no private addresses; retries with back-off; parks after MAX_ATTEMPTS; switches an endpoint off after DISABLE_AFTER failures in a row.
// Written against the worker's own limited database account: it may read the audit log and endpoints, queue and update deliveries, and update endpoint health; nothing else.
import dns from 'node:dns/promises'; import crypto from 'node:crypto'; import type { Pool } from './queue';
import { matches, payloadOf, sign, backoffSeconds, MAX_ATTEMPTS, DISABLE_AFTER, isPrivateAddress, checkUrl } from '../../shared/webhooks';
export type Env = { key?: Buffer; allowHttp: boolean; timeoutMs: number; fetch: typeof fetch; resolve: (host: string) => Promise<string[]>; log: { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void } };
export const defaultEnv = (log: Env['log']): Env => ({ key: process.env.WEBHOOK_ENC_KEY ? Buffer.from(process.env.WEBHOOK_ENC_KEY, 'base64') : undefined, allowHttp: process.env.WEBHOOK_ALLOW_HTTP === 'true' && process.env.NODE_ENV !== 'production', timeoutMs: 10_000, fetch, log,
  resolve: async (h) => (await dns.lookup(h, { all: true })).map(a => a.address) });
export function decryptSecret(blob: string, key: Buffer): string { const b = Buffer.from(blob, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
const json = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
export const FANOUT_BATCH = 500;
export async function fanOut(pool: Pool): Promise<{ scanned: number; queued: number }> {
  const [[cur]]: any = await pool.query('SELECT last_audit_id id FROM webhook_cursor WHERE id=1'); if (!cur) return { scanned: 0, queued: 0 };
  const [events]: any = await pool.query('SELECT id, tenant_id tenantId, actor_id actorId, action, entity, entity_id entityId, detail, created_at createdAt FROM audit_events WHERE id>? ORDER BY id LIMIT ?', [Number(cur.id), FANOUT_BATCH]);
  if (!events.length) return { scanned: 0, queued: 0 };
  const tenants = [...new Set(events.map((e: any) => e.tenantId).filter(Boolean))]; if (!tenants.length) { await pool.query('UPDATE webhook_cursor SET last_audit_id=GREATEST(last_audit_id, ?) WHERE id=1', [Number(events[events.length - 1].id)]); return { scanned: events.length, queued: 0 }; } const [eps]: any = await pool.query("SELECT tenant_id tenantId, id, events FROM webhook_endpoints WHERE active=1 AND tenant_id IN (?)", [tenants]); let queued = 0;
  for (const ev of events) for (const ep of eps) {
    if (ep.tenantId !== ev.tenantId || !matches(json(ep.events), ev.action)) continue;
    const payload = payloadOf({ auditId: Number(ev.id), tenantId: ev.tenantId, action: ev.action, actorId: ev.actorId, entity: ev.entity, entityId: ev.entityId, detail: json(ev.detail), createdAt: ev.createdAt });
    const [r]: any = await pool.query('INSERT IGNORE INTO webhook_deliveries(tenant_id,endpoint_id,audit_id,event_type,payload) VALUES (?,?,?,?,?)', [ev.tenantId, ep.id, Number(ev.id), ev.action.slice(0, 80), JSON.stringify(payload)]); queued += r.affectedRows;
  }
  await pool.query('UPDATE webhook_cursor SET last_audit_id=GREATEST(last_audit_id, ?) WHERE id=1', [Number(events[events.length - 1].id)]); return { scanned: events.length, queued };
}
/** Resolves the host now and refuses private answers (checked at delivery time, so a name that later points inward is still caught). */
async function safeTarget(env: Env, raw: string): Promise<string | null> {
  const c = checkUrl(raw, { allowHttp: env.allowHttp }); if (c.ok === false) return c.reason; if (env.allowHttp) return null;
  const host = c.url.hostname.replace(/^\[|\]$/g, ''); let addrs: string[]; try { addrs = await env.resolve(host); } catch { return 'The host name could not be resolved'; }
  if (!addrs.length || addrs.some(isPrivateAddress)) return 'The host name points to a private address'; return null;
}
type Due = { id: number; tenant_id: string; endpoint_id: string; event_type: string; payload: any; attempts: number; url: string; secret_enc: string };
export async function deliverDue(pool: Pool, env: Env, limit = 25): Promise<{ delivered: number; failed: number; dead: number }> {
  const out = { delivered: 0, failed: 0, dead: 0 }; if (!env.key) return out;
  for (let i = 0; i < limit; i++) {
    const c = await pool.getConnection(); let d: Due | undefined;
    try {
      await c.beginTransaction();
      const [rows]: any = await c.query("SELECT id, tenant_id, endpoint_id, event_type, payload, attempts FROM webhook_deliveries WHERE status='pending' AND next_attempt_at<=NOW(3) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows.length) { await c.commit(); return out; }
      const [ep]: any = await c.query('SELECT url, secret_enc, active FROM webhook_endpoints WHERE tenant_id=? AND id=?', [rows[0].tenant_id, rows[0].endpoint_id]);
      if (!ep.length || (!ep[0].active && rows[0].event_type !== 'webhook.test')) { await c.query("UPDATE webhook_deliveries SET next_attempt_at=DATE_ADD(NOW(3), INTERVAL 10 MINUTE) WHERE id=?", [rows[0].id]); await c.commit(); continue; }
      d = { ...rows[0], url: ep[0].url, secret_enc: ep[0].secret_enc } as Due; await c.query('UPDATE webhook_deliveries SET next_attempt_at=DATE_ADD(NOW(3), INTERVAL 120 SECOND) WHERE id=?', [d.id]); await c.commit();   // claimed: nobody else sends it while we are out calling
    } catch (e: any) { try { await c.rollback(); } catch { /* gone */ } throw e; } finally { c.release(); }
    const body = typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload); let status: number | null = null; let error: string | null = null;
    try {
      error = await safeTarget(env, d.url);
      if (!error) {
        const secret = decryptSecret(d.secret_enc, env.key); const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), env.timeoutMs);
        try { const r = await env.fetch(d.url, { method: 'POST', redirect: 'manual', signal: ac.signal, headers: { 'content-type': 'application/json', 'user-agent': 'iSecurify-GRC-Webhooks/1', 'x-isg-event': d.event_type, 'x-isg-delivery': String(d.id), 'x-isg-signature': sign(secret, body) }, body });
          status = r.status; try { await r.arrayBuffer(); } catch { /* ignore body */ } if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? 'The endpoint redirected (redirects are not followed)' : `The endpoint answered ${status}`; }
        finally { clearTimeout(timer); }
      }
    } catch (e: any) { error = e?.name === 'AbortError' ? 'The endpoint did not answer within 10 seconds' : String(e?.message ?? e).slice(0, 200); }
    if (!error) { await pool.query("UPDATE webhook_deliveries SET status='delivered', attempts=attempts+1, last_status=?, last_error=NULL, delivered_at=NOW(3) WHERE id=?", [status, d.id]); await pool.query('UPDATE webhook_endpoints SET consecutive_failures=0, last_success_at=NOW(3) WHERE tenant_id=? AND id=?', [d.tenant_id, d.endpoint_id]); out.delivered++; continue; }
    const tries = d.attempts + 1; const dead = tries >= MAX_ATTEMPTS;
    await pool.query('UPDATE webhook_deliveries SET status=?, attempts=?, last_status=?, last_error=?, next_attempt_at=DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id=?', [dead ? 'dead' : 'pending', tries, status, error.slice(0, 300), backoffSeconds(tries), d.id]); dead ? out.dead++ : out.failed++;
    if (d.event_type !== 'webhook.test') { await pool.query('UPDATE webhook_endpoints SET consecutive_failures=consecutive_failures+1 WHERE tenant_id=? AND id=?', [d.tenant_id, d.endpoint_id]);
      await pool.query("UPDATE webhook_endpoints SET active=0, disabled_reason='Switched off after repeated failures' WHERE tenant_id=? AND id=? AND consecutive_failures>=? AND active=1", [d.tenant_id, d.endpoint_id, DISABLE_AFTER]); }
  }
  return out;
}
export async function cleanup(pool: Pool) { await pool.query("DELETE FROM webhook_deliveries WHERE created_at < DATE_SUB(NOW(3), INTERVAL 30 DAY)"); }
