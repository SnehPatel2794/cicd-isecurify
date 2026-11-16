// The daily reminder scan: finds evidence requests and findings that are due soon or overdue, notifies the responsible person once per stage,
// then queues at most one digest email per person. Written against the worker's own database account (it may add notifications and reminder rows only).
import type { Pool } from '../queue'; import { enqueue } from '../queue';
import { SOON_DAYS, stageFor, certStage, certLabel, type Stage, reminderLabel, digestDue, groupItems, type DigestItem } from './rules'; import type { MailEnv } from '../mail/handlers';
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };
type Cand = { entityType: 'finding' | 'evidence_request' | 'certificate'; id: string; tenantId: string; engagementId: string; userId: string; org: string; base: string; due: string };
const stageOf = (c: Cand, today: string): Stage | null => c.entityType === 'certificate' ? certStage(c.due, today) : stageFor(c.due, today);
const textOf = (c: Cand, s: Stage) => c.entityType === 'certificate' ? certLabel(c.base, c.due, s) : reminderLabel(c.base, c.due, s);
export const ACCESS = (u: string, t: string) => `(EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=${t} AND m.user_id=${u}) OR EXISTS (SELECT 1 FROM staff_assignments s WHERE s.tenant_id=${t} AND s.user_id=${u} AND (s.expires_at IS NULL OR s.expires_at>NOW(3))))`;
const LIVE = `o.status='active' AND e.status='active' AND u.status='active'`;

/** Everything that is due within SOON_DAYS or already late, for people who can still enter the organization. */
export async function candidates(pool: Pool, today: string): Promise<Cand[]> {
  const [ev] = await pool.query(`SELECT r.tenant_id tenantId, r.id, r.engagement_id engagementId, i.accountable_user_id userId, o.name org, CONCAT(i.ref, ': ', r.title) base, DATE_FORMAT(r.due_date,'%Y-%m-%d') due
    FROM evidence_requests r JOIN checklist_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id JOIN engagements e ON e.tenant_id=r.tenant_id AND e.id=r.engagement_id JOIN organizations o ON o.id=r.tenant_id JOIN users u ON u.id=i.accountable_user_id
    WHERE r.status IN ('requested','rejected') AND r.due_date IS NOT NULL AND r.due_date <= DATE_ADD(?, INTERVAL ${SOON_DAYS} DAY) AND i.readiness_status <> 'not_applicable' AND ${LIVE} AND ${ACCESS('i.accountable_user_id', 'r.tenant_id')}`, [today]) as any;
  const [fi] = await pool.query(`SELECT f.tenant_id tenantId, f.id, f.engagement_id engagementId, f.owner_user_id userId, o.name org, CONCAT('F-', LPAD(f.finding_no, 3, '0'), ' ', f.title) base, DATE_FORMAT(f.due_date,'%Y-%m-%d') due
    FROM findings f JOIN engagements e ON e.tenant_id=f.tenant_id AND e.id=f.engagement_id JOIN organizations o ON o.id=f.tenant_id JOIN users u ON u.id=f.owner_user_id
    WHERE f.status NOT IN ('closed','risk_accepted','cancelled') AND f.due_date IS NOT NULL AND f.due_date <= DATE_ADD(?, INTERVAL ${SOON_DAYS} DAY) AND ${LIVE} AND ${ACCESS('f.owner_user_id', 'f.tenant_id')}`, [today]) as any;
  // Certificates still in force that expire within 60 days (or expired in the last 45), reminded to the organization's client administrators.
  const [ce] = await pool.query(`SELECT c.tenant_id tenantId, c.id, c.engagement_id engagementId, m.user_id userId, o.name org, CONCAT('ISG-', DATE_FORMAT(c.issued_on,'%Y'), '-', LPAD(c.serial, 6, '0'), ': ', c.framework_name, ' v', c.framework_version) base, DATE_FORMAT(c.valid_until,'%Y-%m-%d') due
    FROM certificates c JOIN organizations o ON o.id=c.tenant_id AND o.status='active' JOIN memberships m ON m.tenant_id=c.tenant_id AND m.role='client_admin' JOIN users u ON u.id=m.user_id AND u.status='active'
    WHERE c.revoked_at IS NULL AND c.superseded_by IS NULL AND c.valid_until <= DATE_ADD(?, INTERVAL 60 DAY) AND c.valid_until >= DATE_SUB(?, INTERVAL 45 DAY)`, [today, today]) as any;
  return [...ev.map((r: any) => ({ ...r, entityType: 'evidence_request' as const })), ...fi.map((r: any) => ({ ...r, entityType: 'finding' as const })), ...ce.map((r: any) => ({ ...r, entityType: 'certificate' as const }))];
}
export const clean = (s: string, max = 200) => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || '(untitled)';

/** Writes one notification per new stage. Returns how many were created. Safe to run twice: reminder_log is the memory. */
export async function sendReminders(pool: Pool, today: string, cands: Cand[]): Promise<number> {
  let made = 0; const off = new Map<string, Set<string>>();
  const prefOff = async (userId: string) => { if (!off.has(userId)) { const [r] = await pool.query("SELECT kind FROM notification_prefs WHERE user_id=? AND in_app=0 AND kind LIKE 'reminder.%'", [userId]) as any; off.set(userId, new Set(r.map((x: any) => x.kind))); } return off.get(userId)!; };
  for (const c of cands) {
    const s = stageOf(c, today); if (!s) continue; const kind = `reminder.${s.stage}`;
    const [ins] = await pool.query('INSERT IGNORE INTO reminder_log(entity_type,entity_id,user_id,stage,due_date,bucket) VALUES (?,?,?,?,?,?)', [c.entityType, c.id, c.userId, s.stage, c.due, s.bucket]) as any; if (!ins.affectedRows) continue;
    if ((await prefOff(c.userId)).has(kind)) continue;
    const [dup] = await pool.query('SELECT 1 x FROM notifications WHERE user_id=? AND kind=? AND entity_id=? AND read_at IS NULL LIMIT 1', [c.userId, kind, c.id]) as any; if (dup.length) continue;
    await pool.query('INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,NULL)', [c.tenantId, c.userId, kind, c.entityType, c.id, c.engagementId, clean(textOf(c, s), 240)]); made++;
  }
  return made;
}

/** One digest per person with something to say: their items due soon or overdue, and how many notifications are unread. Honors off / daily / weekly. */
export async function queueDigests(pool: Pool, today: string, cands: Cand[], now: Date, mail: MailEnv, log: Log): Promise<{ queued: number; skipped: string | null }> {
  if (!mail.config() && !mail.devLogEnabled()) { log.info({}, 'digests skipped: outgoing email is not configured'); return { queued: 0, skipped: 'email_not_configured' }; }
  const byUser = new Map<string, DigestItem[]>(); for (const c of cands) { const s = stageOf(c, today); if (!s) continue; if (!byUser.has(c.userId)) byUser.set(c.userId, []); byUser.get(c.userId)!.push({ org: c.org, tenantId: c.tenantId, label: clean(c.base), due: c.due, stage: s.stage, days: s.days, text: c.entityType === 'certificate' ? clean(textOf(c, s)) : undefined }); }
  const [unreadRows] = await pool.query(`SELECT n.user_id u, COUNT(*) c FROM notifications n JOIN users us ON us.id=n.user_id WHERE n.read_at IS NULL AND us.status='active' AND ${ACCESS('n.user_id', 'n.tenant_id')} GROUP BY n.user_id`) as any;
  const unread = new Map<string, number>(unreadRows.map((r: any) => [r.u, Number(r.c)])); const users = new Set([...byUser.keys(), ...unread.keys()]); let queued = 0;
  for (const userId of users) {
    const [r] = await pool.query("SELECT u.email, u.name, d.frequency, d.last_sent_at lastSent FROM users u LEFT JOIN user_digest d ON d.user_id=u.id WHERE u.id=? AND u.status='active'", [userId]) as any; if (!r.length) continue;
    const freq = (r[0].frequency ?? 'daily') as 'off' | 'daily' | 'weekly'; if (!digestDue(freq, r[0].lastSent ? new Date(r[0].lastSent) : null, now)) continue;
    const items = byUser.get(userId) ?? []; const groups = groupItems(items); const nUnread = unread.get(userId) ?? 0; if (!groups.length && !nUnread) continue;
    const overdue = items.filter(i => i.stage === 'overdue').length;
    await enqueue(pool, { type: 'email.digest', payload: { to: r[0].email, name: clean(r[0].name, 80), groups, unread: nUnread, overdue, dueSoon: items.length - overdue }, idempotencyKey: `digest:${userId}:${today}`, maxAttempts: 3 });
    await pool.query('INSERT INTO user_digest(user_id,frequency,last_sent_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_sent_at=VALUES(last_sent_at)', [userId, freq, now]); queued++;
  }
  return { queued, skipped: null };
}
export async function runDaily(pool: Pool, now: Date, mail: MailEnv, log: Log) {
  const today = now.toISOString().slice(0, 10); const cands = await candidates(pool, today); const reminders = await sendReminders(pool, today, cands); const d = await queueDigests(pool, today, cands, now, mail, log);
  log.info({ candidates: cands.length, reminders, digests: d.queued, digestSkipped: d.skipped }, 'daily reminder scan'); return { candidates: cands.length, reminders, ...d };
}
