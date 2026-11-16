// Phase 11A, the worker's part of continuous controls (runs once a day after the reminder scan):
//   1. reminds the people responsible for recurring control tests and evidence refresh schedules that are due or overdue (once per due date and stage),
//   2. writes the day's compliance-posture snapshot for every active engagement and framework.
// The worker never creates evidence requests or test results itself: a person opens the request and records the result, so nothing changes a control's status unattended.
import { runVaptReminders } from './vapt'; import { runTaskReminders } from './tasks'; import type { Pool } from './queue'; import { frameworkSummaries, testHealth, emptyHealth } from '../../shared/posture'; import { ACCESS, clean } from './reminders/scan';
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const OVERDUE_AFTER_DAYS = 7;
export const stageOf = (due: string, today: string): 'due' | 'overdue' | null => due > today ? null : daysBetween(due, today) >= OVERDUE_AFTER_DAYS ? 'overdue' : 'due';
export const noticeLabel = (kind: 'test' | 'refresh', base: string, due: string, stage: 'due' | 'overdue', today: string) => {
  const n = daysBetween(due, today); const what = kind === 'test' ? 'test' : 'evidence refresh';
  return stage === 'due' ? `${base} - ${what} due ${n <= 0 ? 'today' : `since ${due}`}` : `${base} - ${what} overdue by ${n} day${n === 1 ? '' : 's'} (was due ${due})`;
};
type Cand = { type: 'control_test' | 'evidence_schedule'; id: string; tenantId: string; engagementId: string; itemId: string; userId: string; base: string; due: string };
const LIVE = `o.status='active' AND e.status='active' AND u.status='active'`;
export async function candidates(pool: Pool, today: string): Promise<Cand[]> {
  const [tests] = await pool.query(`SELECT t.tenant_id tenantId, t.id, t.engagement_id engagementId, t.item_id itemId, COALESCE(t.owner_user_id, i.accountable_user_id) userId, CONCAT(i.ref, ': ', t.title) base, DATE_FORMAT(t.next_due_on,'%Y-%m-%d') due
    FROM control_tests t JOIN checklist_items i ON i.tenant_id=t.tenant_id AND i.id=t.item_id JOIN engagements e ON e.tenant_id=t.tenant_id AND e.id=t.engagement_id JOIN organizations o ON o.id=t.tenant_id JOIN users u ON u.id=COALESCE(t.owner_user_id, i.accountable_user_id)
    WHERE t.status='active' AND t.next_due_on <= ? AND i.readiness_status <> 'not_applicable' AND ${LIVE} AND ${ACCESS('u.id', 't.tenant_id')}`, [today]) as any;
  const [sch] = await pool.query(`SELECT s.tenant_id tenantId, s.id, s.engagement_id engagementId, s.item_id itemId, u.id userId, CONCAT(i.ref, ': ', s.title) base, DATE_FORMAT(s.next_run_on,'%Y-%m-%d') due
    FROM evidence_schedules s JOIN checklist_items i ON i.tenant_id=s.tenant_id AND i.id=s.item_id JOIN engagements e ON e.tenant_id=s.tenant_id AND e.id=s.engagement_id JOIN organizations o ON o.id=s.tenant_id
    JOIN users u ON (u.id=i.accountable_user_id OR u.id=s.created_by)
    WHERE s.status='active' AND s.next_run_on <= ? AND i.readiness_status <> 'not_applicable' AND ${LIVE} AND ${ACCESS('u.id', 's.tenant_id')}`, [today]) as any;
  return [...tests.map((r: any) => ({ ...r, type: 'control_test' as const })), ...sch.map((r: any) => ({ ...r, type: 'evidence_schedule' as const }))];
}
/** One in-app notification per person, thing, due date and stage. Safe to run twice: continuous_notice_log is the memory. */
export async function sendNotices(pool: Pool, today: string, cands: Cand[]): Promise<number> {
  let made = 0; const off = new Map<string, Set<string>>();
  const prefOff = async (userId: string) => { if (!off.has(userId)) { const [r] = await pool.query("SELECT kind FROM notification_prefs WHERE user_id=? AND in_app=0", [userId]) as any; off.set(userId, new Set(r.map((x: any) => x.kind))); } return off.get(userId)!; };
  const remember = (c: Cand, stage: string) => pool.query('INSERT IGNORE INTO continuous_notice_log(entity_type,entity_id,user_id,stage,due_on) VALUES (?,?,?,?,?)', [c.type, c.id, c.userId, stage, c.due]);
  for (const c of cands) {
    const stage = stageOf(c.due, today); if (!stage) continue; const kind = c.type === 'control_test' ? 'control_test.due' : 'evidence.refresh_due';
    const [seen] = await pool.query('SELECT 1 x FROM continuous_notice_log WHERE entity_type=? AND entity_id=? AND user_id=? AND stage=? AND due_on=?', [c.type, c.id, c.userId, stage, c.due]) as any; if (seen.length) continue;
    if ((await prefOff(c.userId)).has(kind)) { await remember(c, stage); continue; }
    const [dup] = await pool.query('SELECT 1 x FROM notifications WHERE user_id=? AND kind=? AND entity_id=? AND read_at IS NULL LIMIT 1', [c.userId, kind, c.itemId]) as any; if (dup.length) continue;   // an unread one is still waiting: try again tomorrow rather than pile up
    await remember(c, stage);
    await pool.query('INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,NULL)', [c.tenantId, c.userId, kind, 'checklist_item', c.itemId, c.engagementId, clean(noticeLabel(c.type === 'control_test' ? 'test' : 'refresh', c.base, c.due, stage, today), 240)]); made++;
  }
  return made;
}
/** Today's score for every framework of every active engagement (replaces the same day's row when run again). */
export async function snapshotPosture(pool: Pool, today: string): Promise<number> {
  const [engs] = await pool.query("SELECT e.tenant_id tenantId, e.id FROM engagements e JOIN organizations o ON o.id=e.tenant_id WHERE e.status='active' AND o.status='active'") as any;
  const by = new Map<string, string[]>(); for (const r of engs) (by.get(r.tenantId) ?? by.set(r.tenantId, []).get(r.tenantId)!).push(r.id); let rows = 0;
  const query = async (sql: string, p?: any[]) => (await pool.query(sql, p))[0] as any[];
  for (const [tenantId, ids] of by) for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100); const [fs, health] = await Promise.all([frameworkSummaries(query, tenantId, chunk, today), testHealth(query, tenantId, chunk, today)]);
    for (const f of fs) { const h = health.get(f.engagementId) ?? emptyHealth();
      await pool.query(`INSERT INTO posture_snapshots(tenant_id,engagement_id,framework_id,snap_date,applicable,effective,awaiting_review,overdue,percent,tests_total,tests_overdue,tests_failing,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))
        ON DUPLICATE KEY UPDATE applicable=VALUES(applicable), effective=VALUES(effective), awaiting_review=VALUES(awaiting_review), overdue=VALUES(overdue), percent=VALUES(percent), tests_total=VALUES(tests_total), tests_overdue=VALUES(tests_overdue), tests_failing=VALUES(tests_failing), computed_at=VALUES(computed_at)`,
        [tenantId, f.engagementId, f.frameworkId, today, f.summary.applicable, f.summary.effective, f.summary.awaitingReview, f.summary.overdue, Math.min(100, Math.max(0, f.summary.readinessPercent)), h.total, h.overdue, h.failing]); rows++; }
  }
  return rows;
}
export async function runContinuous(pool: Pool, now: Date, log: Log) {
  const today = now.toISOString().slice(0, 10); await runVaptReminders(pool, now, log); await runTaskReminders(pool, now, log); const cands = await candidates(pool, today); const notices = await sendNotices(pool, today, cands); const snapshots = await snapshotPosture(pool, today);
  await pool.query('DELETE FROM continuous_notice_log WHERE created_at < DATE_SUB(NOW(3), INTERVAL 400 DAY)');
  log.info({ candidates: cands.length, notices, snapshots }, 'continuous controls daily run'); return { candidates: cands.length, notices, snapshots };
}
