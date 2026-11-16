// System status rules: PURE. Turns the backup log and queue counts into plain-language health and warnings.
export const BACKUP_MAX_HOURS = 36; export const DRILL_MAX_DAYS = 10; export const OFFSITE_MAX_HOURS = 36; export const QUEUE_STALE_MINUTES = 30;
export type LogRow = { kind: 'backup' | 'drill' | 'offsite'; ok: boolean; takenAt: Date | string; encrypted?: boolean; note?: string | null };
const at = (d: Date | string) => new Date(d).getTime(); const iso = (t: number) => new Date(t).toISOString();
export type Health = { backup: 'ok' | 'stale' | 'never'; drill: 'ok' | 'overdue' | 'never'; offsite: 'not_configured' | 'ok' | 'stale' | 'never'; lastOffsite: { at: string; ageHours: number } | null; lastBackup: { at: string; ageHours: number; encrypted: boolean } | null; lastDrill: { at: string; ageDays: number } | null; warnings: string[] };
export function backupHealth(rows: LogRow[], now: number): Health {
  const sorted = [...rows].sort((a, b) => at(b.takenAt) - at(a.takenAt)); const lastOk = (k: LogRow['kind']) => sorted.find(r => r.kind === k && r.ok); const latest = (k: LogRow['kind']) => sorted.find(r => r.kind === k);
  const b = lastOk('backup'), d = lastOk('drill'); const warnings: string[] = []; const ageH = b ? Math.max(0, Math.round((now - at(b.takenAt)) / 360000) / 10) : null; const ageD = d ? Math.max(0, Math.floor((now - at(d.takenAt)) / 86400000)) : null;
  const backup = !b ? 'never' : ageH! > BACKUP_MAX_HOURS ? 'stale' : 'ok'; const drill = !d ? 'never' : ageD! > DRILL_MAX_DAYS ? 'overdue' : 'ok';
  if (backup === 'never') warnings.push('No successful backup has been recorded. Run deploy/backup.sh and schedule it nightly.'); if (backup === 'stale') warnings.push(`The last successful backup is ${Math.round(ageH!)} hours old (expected every 24 hours).`);
  const lb = latest('backup'); if (lb && !lb.ok && (!b || at(lb.takenAt) > at(b.takenAt))) warnings.push('The most recent backup attempt failed. Check the backup log on the server.');
  if (b && !b.encrypted) warnings.push('The last backup is not encrypted. Set BACKUP_GPG_RECIPIENT so backups (and any copy kept off the server) are protected.');
  if (drill === 'never') warnings.push('No restore drill has been recorded. A backup that has never been restored is not proven: run deploy/restore-drill.sh.'); if (drill === 'overdue') warnings.push(`The last successful restore drill was ${ageD} days ago (run one at least every ${DRILL_MAX_DAYS} days).`);
  const ld = latest('drill'); if (ld && !ld.ok && (!d || at(ld.takenAt) > at(d.takenAt))) warnings.push('The most recent restore drill failed. The backups may not be restorable: investigate now.');
  const anyOff = sorted.some(r => r.kind === 'offsite'); const o = lastOk('offsite'); const ageO = o ? Math.max(0, Math.round((now - at(o.takenAt)) / 360000) / 10) : null;
  const offsite = !anyOff ? 'not_configured' : !o ? 'never' : ageO! > OFFSITE_MAX_HOURS ? 'stale' : 'ok';
  if (offsite === 'never') warnings.push('The off-server copy is configured but has never succeeded. Check BACKUP_OFFSITE_TARGET and the backup log.'); if (offsite === 'stale') warnings.push(`The last successful off-server copy is ${Math.round(ageO!)} hours old.`);
  const lo = latest('offsite'); if (lo && !lo.ok && (!o || at(lo.takenAt) > at(o.takenAt))) warnings.push('The most recent off-server copy failed. The newest backup exists only on this server.');
  return { backup, drill, offsite, lastOffsite: o ? { at: iso(at(o.takenAt)), ageHours: ageO! } : null, lastBackup: b ? { at: iso(at(b.takenAt)), ageHours: ageH!, encrypted: !!b.encrypted } : null, lastDrill: d ? { at: iso(at(d.takenAt)), ageDays: ageD! } : null, warnings };
}
export type Queue = { pending: number; running: number; dead: number; oldestPendingMinutes: number | null };
export function queueWarnings(q: Queue, failedEmails24h: number): string[] {
  const w: string[] = []; if (q.dead > 0) w.push(`${q.dead} background job${q.dead === 1 ? ' has' : 's have'} failed permanently. See Email delivery and the worker logs.`);
  if (q.oldestPendingMinutes !== null && q.oldestPendingMinutes > QUEUE_STALE_MINUTES) w.push(`The oldest waiting job has been queued for ${q.oldestPendingMinutes} minutes: is the worker running?`);
  if (failedEmails24h > 0) w.push(`${failedEmails24h} email${failedEmails24h === 1 ? '' : 's'} failed in the last 24 hours.`); return w;
}
/** Low disk is a warning when less than the guard level plus 1 GB is free (the guard itself pauses uploads at that level). */
export function diskWarnings(d: { freeBytes: number; totalBytes: number } | null, guardBytes: number): string[] {
  if (!d) return []; const level = Math.max(guardBytes, 2 * 1073741824); return d.freeBytes < level ? [`Only ${Math.round(d.freeBytes / 1048576)} MB of disk space is free on the evidence disk. Uploads and backups may stop.`] : [];
}
