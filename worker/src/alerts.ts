// Operational alerts by email: stale or failed backups, a stale or failed off-server copy, an overdue restore drill, low disk, organizations near their storage limit.
// The rules are PURE (state in, alerts out). The handler gathers the state, and queues at most one email per administrator per day for each distinct set of alerts.
import crypto from 'node:crypto'; import fsp from 'node:fs/promises';
import type { Handler, Pool } from './queue';
export const BACKUP_MAX_HOURS = 36, OFFSITE_MAX_HOURS = 36, DRILL_MAX_DAYS = 10, QUOTA_ALERT_PERCENT = 90;
export type Row = { ok: boolean; at: number } | null;
export type State = { now: number; lastBackup: Row; lastBackupTry: Row; lastOffsite: Row; lastOffsiteTry: Row; lastDrill: Row; lastDrillTry: Row; offsiteUsed: boolean; disk: { freeBytes: number; minFreeBytes: number } | null; nearQuota: { name: string; percent: number }[] };
export type Alert = { code: string; text: string };
const hours = (now: number, r: Row) => r ? Math.round((now - r.at) / 360000) / 10 : null;
export function alertsFrom(s: State): Alert[] {
  const a: Alert[] = []; const bh = hours(s.now, s.lastBackup);
  if (!s.lastBackup) a.push({ code: 'backup.never', text: 'No successful backup has ever been recorded.' }); else if (bh! > BACKUP_MAX_HOURS) a.push({ code: 'backup.stale', text: `The newest successful backup is ${Math.round(bh!)} hours old.` });
  if (s.lastBackupTry && !s.lastBackupTry.ok && (!s.lastBackup || s.lastBackupTry.at > s.lastBackup.at)) a.push({ code: 'backup.failed', text: 'The most recent backup attempt failed. Check the backup log on the server.' });
  if (s.offsiteUsed) {
    const oh = hours(s.now, s.lastOffsite); if (!s.lastOffsite) a.push({ code: 'offsite.never', text: 'The off-server copy is configured but has never succeeded.' }); else if (oh! > OFFSITE_MAX_HOURS) a.push({ code: 'offsite.stale', text: `The newest off-server copy is ${Math.round(oh!)} hours old.` });
    if (s.lastOffsiteTry && !s.lastOffsiteTry.ok && (!s.lastOffsite || s.lastOffsiteTry.at > s.lastOffsite.at)) a.push({ code: 'offsite.failed', text: 'The most recent off-server copy failed.' });
  }
  if (s.lastBackup) { const dd = s.lastDrill ? (s.now - s.lastDrill.at) / 86400000 : null; if (dd === null) a.push({ code: 'drill.never', text: 'No restore drill has passed yet, so the backups are not proven.' }); else if (dd > DRILL_MAX_DAYS) a.push({ code: 'drill.overdue', text: `The last passing restore drill was ${Math.round(dd)} days ago.` }); }
  if (s.lastDrillTry && !s.lastDrillTry.ok && (!s.lastDrill || s.lastDrillTry.at > s.lastDrill.at)) a.push({ code: 'drill.failed', text: 'The most recent restore drill failed: the backups may not be restorable.' });
  if (s.disk && s.disk.freeBytes < s.disk.minFreeBytes) a.push({ code: 'disk.low', text: `Only ${Math.round(s.disk.freeBytes / 1048576)} MB of disk space is free (alert level ${Math.round(s.disk.minFreeBytes / 1048576)} MB). Uploads and backups may stop.` });
  for (const o of s.nearQuota) a.push({ code: `quota.${o.name}`.slice(0, 60), text: `${o.name} has used ${o.percent}% of its storage limit.` });
  return a;
}
/** One stable key per administrator, day and set of alerts: the same problem is mailed once a day, a NEW problem is mailed straight away. */
export const alertKey = (day: string, userId: string, alerts: Alert[]) => `alerts:${day}:${userId}:${crypto.createHash('sha1').update(alerts.map(x => x.code).sort().join('|')).digest('hex').slice(0, 12)}`;
const last = async (pool: Pool, kind: string, ok?: boolean): Promise<Row> => { const [r]: any = await pool.query(`SELECT ok, taken_at t FROM backup_log WHERE kind=? ${ok ? 'AND ok=1' : ''} ORDER BY taken_at DESC, id DESC LIMIT 1`, [kind]); return r[0] ? { ok: !!r[0].ok, at: new Date(r[0].t).getTime() } : null; };
export async function gatherState(pool: Pool, o: { evidenceDir: string; minFreeBytes: number; now?: number }): Promise<State> {
  const [off]: any = await pool.query("SELECT COUNT(*) n FROM backup_log WHERE kind='offsite'"); let disk: State['disk'] = null;
  try { const f = await fsp.statfs(o.evidenceDir); disk = { freeBytes: Number(f.bavail) * Number(f.bsize), minFreeBytes: o.minFreeBytes }; } catch { /* the directory may not exist in development */ }
  const [q]: any = await pool.query('SELECT o.name, u.used_bytes used, u.quota_bytes quota FROM evidence_usage u JOIN organizations o ON o.id=u.tenant_id WHERE u.quota_bytes IS NOT NULL AND u.quota_bytes>0 AND u.used_bytes >= u.quota_bytes*?', [QUOTA_ALERT_PERCENT / 100]);
  return { now: o.now ?? Date.now(), lastBackup: await last(pool, 'backup', true), lastBackupTry: await last(pool, 'backup'), lastOffsite: await last(pool, 'offsite', true), lastOffsiteTry: await last(pool, 'offsite'), lastDrill: await last(pool, 'drill', true), lastDrillTry: await last(pool, 'drill'), offsiteUsed: Number(off[0].n) > 0, disk,
    nearQuota: q.map((r: any) => ({ name: String(r.name).slice(0, 80), percent: Math.min(100, Math.round((Number(r.used) / Number(r.quota)) * 100)) })) };
}
export async function queueAlerts(pool: Pool, state: State): Promise<number> {
  const alerts = alertsFrom(state); if (!alerts.length) return 0; const day = new Date(state.now).toISOString().slice(0, 10);
  const [admins]: any = await pool.query("SELECT id, email, name FROM users WHERE status='active' AND platform_role IN ('super_admin','admin')"); let n = 0;
  for (const u of admins) {
    const key = alertKey(day, u.id, alerts); const [have]: any = await pool.query('SELECT 1 x FROM jobs WHERE idempotency_key=?', [key]); if (have.length) continue;
    await pool.query("INSERT INTO jobs(type,payload,idempotency_key,max_attempts) VALUES ('email.alert',?,?,5) ON DUPLICATE KEY UPDATE id=id", [JSON.stringify({ to: u.email, name: u.name, alerts: alerts.map(a => a.text) }), key]); n++;
  }
  return n;
}
export const makeAlertHandler = (o: () => { evidenceDir: string; minFreeBytes: number }, log: { info: (x: any, m?: string) => void }): Handler => async (_j, { pool }) => { const n = await queueAlerts(pool, await gatherState(pool, o())); if (n) log.info({ emails: n }, 'operational alert emails queued'); };
