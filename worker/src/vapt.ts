// Phase 11D: reminds the people running a VAPT round (the engagement's iSecurify team and auditor, and the client administrators) before a planned round,
// on its day, and when it is three days late. One notice per person, round, stage and planned date; vapt_notice_log is the memory.
import type { Pool } from './queue'; import { reminderStage, type Stage } from './vaptRules'; import { ACCESS } from './reminders/scan';
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };
export const label = (title: string, no: number, plannedOn: string, stage: Stage) => stage === 'upcoming' ? `VAPT round ${no} (${title}) is planned for ${plannedOn}` : stage === 'due' ? `VAPT round ${no} (${title}) was planned to start ${plannedOn === new Date().toISOString().slice(0, 10) ? 'today' : plannedOn}` : `VAPT round ${no} (${title}) has not started; it was planned for ${plannedOn}`;
export async function runVaptReminders(pool: Pool, now: Date, log: Log) {
  const today = now.toISOString().slice(0, 10); const horizon = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10); let made = 0;
  const [rounds] = await pool.query(`SELECT r.tenant_id tenantId, r.id, r.engagement_id engagementId, r.round_no no, r.title, DATE_FORMAT(r.planned_on,'%Y-%m-%d') plannedOn FROM vapt_rounds r JOIN engagements e ON e.tenant_id=r.tenant_id AND e.id=r.engagement_id JOIN organizations o ON o.id=r.tenant_id
    WHERE r.status='planned' AND r.planned_on <= ? AND e.status='active' AND o.status='active'`, [horizon]) as any;
  for (const r of rounds) { const stage = reminderStage(r.plannedOn, today); if (!stage) continue;
    const [users] = await pool.query(`SELECT DISTINCT u.id FROM users u WHERE u.status='active' AND ${ACCESS('u.id', '?')} AND (u.id IN (SELECT user_id FROM engagement_members WHERE tenant_id=? AND engagement_id=?) OR u.id IN (SELECT user_id FROM memberships WHERE tenant_id=? AND role='client_admin' AND status='active'))`, [r.tenantId, r.tenantId, r.tenantId, r.engagementId, r.tenantId]) as any;
    for (const u of users) {
      const [seen] = await pool.query('SELECT 1 x FROM vapt_notice_log WHERE round_id=? AND user_id=? AND stage=? AND planned_on=?', [r.id, u.id, stage, r.plannedOn]) as any; if (seen.length) continue;
      await pool.query('INSERT INTO vapt_notice_log(round_id,user_id,stage,planned_on) VALUES (?,?,?,?)', [r.id, u.id, stage, r.plannedOn]);
      const [off] = await pool.query("SELECT 1 x FROM notification_prefs WHERE user_id=? AND kind='vapt.round_due' AND in_app=0", [u.id]) as any; if (off.length) continue;
      await pool.query('INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,engagement_id,label,actor_id) VALUES (?,?,?,?,?,?,?,NULL)', [r.tenantId, u.id, 'vapt.round_due', 'engagement', r.engagementId, r.engagementId, label(r.title, r.no, r.plannedOn, stage).slice(0, 300)]); made++;
    } }
  await pool.query('DELETE FROM vapt_notice_log WHERE created_at < DATE_SUB(NOW(3), INTERVAL 400 DAY)');
  log.info({ rounds: rounds.length, notices: made }, 'vapt round reminders'); return { rounds: rounds.length, notices: made };
}
