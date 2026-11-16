// Outbox dispatcher. Events are written by the API inside the business transaction; here each one is turned into an email job (or, for scanner results, a notification first).
// Each event is claimed with FOR UPDATE SKIP LOCKED and handled in ONE transaction together with its "processed" mark, so it is acted on exactly once even with several workers.
// Failures are retried with back-off; after MAX_TRIES the event is parked as dead (visible on the Email delivery screen, retry from there).
import type { Pool } from './queue';
export const MAX_TRIES = 5; export const HOURLY_CAP = 20;
export const retryDelaySeconds = (attempt: number) => Math.min(3600, 2 ** attempt * 15);
type Conn = Awaited<ReturnType<Pool['getConnection']>>;
type Ev = { id: number; tenant_id: string | null; type: string; payload: any; attempts: number };

/** Queues the email for one notification unless the person chose no email, the notification was already read, the account is not active, or the hourly cap is reached (the digest still covers it). */
export async function queueNotificationEmail(c: Conn, notificationId: number, emailDefault: boolean): Promise<'queued' | 'skipped'> {
  const [r]: any = await c.query("SELECT n.id, n.kind, n.label, n.read_at, n.user_id, u.email, u.name, u.status, o.name org, p.email_on FROM notifications n JOIN users u ON u.id=n.user_id JOIN organizations o ON o.id=n.tenant_id LEFT JOIN notification_prefs p ON p.user_id=n.user_id AND p.kind=n.kind WHERE n.id=?", [notificationId]);
  const n = r[0]; if (!n || n.read_at || n.status !== 'active') return 'skipped';
  const want = n.email_on === null || n.email_on === undefined ? emailDefault : !!n.email_on; if (!want) return 'skipped';
  const [cnt]: any = await c.query("SELECT COUNT(*) k FROM email_log WHERE to_email=? AND template='email.notification' AND created_at > DATE_SUB(NOW(3), INTERVAL 1 HOUR)", [String(n.email).slice(0, 190)]); if (Number(cnt[0].k) >= HOURLY_CAP) return 'skipped';
  await c.query("INSERT INTO jobs(type,payload,idempotency_key,max_attempts) VALUES ('email.notification',?,?,5) ON DUPLICATE KEY UPDATE id=id", [JSON.stringify({ to: n.email, name: n.name, kind: n.kind, label: n.label, org: n.org }), `notif:${n.id}`]); return 'queued';
}
/** A scanner finding becomes a notification for the person who uploaded the file and the person who asked for it (both must still have access), then an email. */
async function malwareFound(c: Conn, ev: Ev) {
  const { tenantId, versionId } = ev.payload ?? {}; if (!tenantId || !versionId) return;
  const [v]: any = await c.query("SELECT v.request_id, v.file_name, v.uploaded_by, r.requested_by, r.title, r.engagement_id FROM evidence_versions v JOIN evidence_requests r ON r.tenant_id=v.tenant_id AND r.id=v.request_id WHERE v.tenant_id=? AND v.id=?", [tenantId, versionId]); if (!v[0]) return;
  const label = `Malware found in "${String(v[0].file_name ?? 'a file')}" (${String(v[0].title)})`.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').slice(0, 200);
  for (const uid of new Set<string>([v[0].uploaded_by, v[0].requested_by])) {
    const [ok]: any = await c.query("SELECT 1 x FROM users u WHERE u.id=? AND u.status='active' AND (EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=? AND m.user_id=u.id) OR EXISTS (SELECT 1 FROM staff_assignments s WHERE s.tenant_id=? AND s.user_id=u.id AND (s.expires_at IS NULL OR s.expires_at>NOW(3))))", [uid, tenantId, tenantId]); if (!ok.length) continue;
    const [off]: any = await c.query("SELECT 1 x FROM notification_prefs WHERE user_id=? AND kind='evidence.malware' AND in_app=0", [uid]); if (off.length) continue;
    const [dup]: any = await c.query("SELECT 1 x FROM notifications WHERE user_id=? AND kind='evidence.malware' AND entity_id=? AND read_at IS NULL LIMIT 1", [uid, v[0].request_id]); if (dup.length) continue;
    const [ins]: any = await c.query("INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,NULL)", [tenantId, uid, 'evidence.malware', 'evidence_request', v[0].request_id, v[0].engagement_id, label]);
    await queueNotificationEmail(c, Number(ins.insertId), true);
  }
}
async function handle(c: Conn, ev: Ev) {
  if (ev.type === 'notification.created') { const id = Number(ev.payload?.notificationId); if (id) await queueNotificationEmail(c, id, !!ev.payload?.emailDefault); return; }
  if (ev.type === 'evidence.malware_found') { await malwareFound(c, ev); return; }
  // unknown types are marked processed so a future event type never blocks the queue
}
/** Processes up to `limit` due events. Returns counts for the log. */
export async function dispatchOutbox(pool: Pool, limit = 50): Promise<{ done: number; retried: number; dead: number }> {
  const out = { done: 0, retried: 0, dead: 0 };
  for (let i = 0; i < limit; i++) {
    const c = await pool.getConnection(); let ev: Ev | undefined;
    try {
      await c.beginTransaction();
      const [rows]: any = await c.query("SELECT id, tenant_id, type, payload, attempts FROM outbox_events WHERE processed_at IS NULL AND dead_at IS NULL AND next_try_at<=NOW(3) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows.length) { await c.commit(); return out; }
      ev = { ...rows[0], payload: typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload };
      await handle(c, ev); await c.query('UPDATE outbox_events SET processed_at=NOW(3), last_error=NULL WHERE id=?', [ev.id]); await c.commit(); out.done++;
    } catch (e: any) {
      try { await c.rollback(); } catch { /* connection gone */ }
      if (!ev) throw e;
      const tries = ev.attempts + 1; const msg = String(e?.message ?? e).slice(0, 480);
      if (tries >= MAX_TRIES) { await pool.query('UPDATE outbox_events SET attempts=?, last_error=?, dead_at=NOW(3) WHERE id=?', [tries, msg, ev.id]); out.dead++; }
      else { await pool.query('UPDATE outbox_events SET attempts=?, last_error=?, next_try_at=DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id=?', [tries, msg, retryDelaySeconds(tries), ev.id]); out.retried++; }
    } finally { c.release(); }
  }
  return out;
}
