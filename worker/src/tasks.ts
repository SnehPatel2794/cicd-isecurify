// Phase 13B: tells the assignee of an open task when it is due within two days and when it is overdue. One notice per person, task, stage and due date; task_notice_log is the memory.
import type { Pool } from './queue'; import { ACCESS } from './reminders/scan';
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };
export const label = (no: number, title: string, due: string, stage: 'due_soon' | 'overdue', today: string) => `T-${String(no).padStart(3, '0')} ${title} ${stage === 'overdue' ? `was due ${due}` : due === today ? 'is due today' : `is due ${due}`}`.slice(0, 300);
export async function runTaskReminders(pool: Pool, now: Date, log: Log) {
  const today = now.toISOString().slice(0, 10); const horizon = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10); let made = 0;
  const [rows] = await pool.query(`SELECT t.tenant_id tenantId, t.id, t.engagement_id engagementId, t.task_no no, t.title, t.assignee_id userId, DATE_FORMAT(t.due_date,'%Y-%m-%d') due FROM tasks t JOIN engagements e ON e.tenant_id=t.tenant_id AND e.id=t.engagement_id JOIN organizations o ON o.id=t.tenant_id JOIN users u ON u.id=t.assignee_id
    WHERE t.status NOT IN ('done','cancelled') AND t.due_date IS NOT NULL AND t.due_date <= ? AND e.status='active' AND o.status='active' AND u.status='active' AND ${ACCESS('u.id', 't.tenant_id')}`, [horizon]) as any;
  for (const r of rows) { const stage = r.due < today ? 'overdue' : 'due_soon';
    const [seen] = await pool.query('SELECT 1 x FROM task_notice_log WHERE task_id=? AND user_id=? AND stage=? AND due_date=?', [r.id, r.userId, stage, r.due]) as any; if (seen.length) continue;
    await pool.query('INSERT INTO task_notice_log(task_id,user_id,stage,due_date) VALUES (?,?,?,?)', [r.id, r.userId, stage, r.due]);
    const [off] = await pool.query("SELECT 1 x FROM notification_prefs WHERE user_id=? AND kind='task.due' AND in_app=0", [r.userId]) as any; if (off.length) continue;
    await pool.query('INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,NULL)', [r.tenantId, r.userId, 'task.due', 'engagement', r.engagementId, r.engagementId, label(r.no, r.title, r.due, stage, today)]); made++; }
  await pool.query('DELETE FROM task_notice_log WHERE created_at < DATE_SUB(NOW(3), INTERVAL 400 DAY)');
  log.info({ tasks: rows.length, notices: made }, 'task reminders'); return { tasks: rows.length, notices: made };
}
