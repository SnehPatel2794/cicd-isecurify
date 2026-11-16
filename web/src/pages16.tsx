// System status (Phase 9E). Administrators see whether the installation is healthy and, above all, recoverable.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge } from './kit';

export const useSystem = () => useQuery({ queryKey: ['system'], queryFn: () => api<any>('GET', '/platform/system'), refetchInterval: 60_000 } as any);
const mb = (n: number | null) => n === null || n === undefined ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const when = (s: string | null | undefined) => s ? new Date(s).toLocaleString() : 'never';
const dur = (s: number) => s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor(s % 86400 / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : `${Math.floor(s / 60)} min`;
const BK: Record<string, [string, 'green' | 'red' | 'amber']> = { ok: ['Recent', 'green'], stale: ['Out of date', 'red'], never: ['Never run', 'red'] };
const DR: Record<string, [string, 'green' | 'red' | 'amber']> = { ok: ['Proven', 'green'], overdue: ['Overdue', 'amber'], never: ['Never run', 'red'] };

export function SystemPage() {
  const qc = useQueryClient(); const q: any = useSystem();
  if (q.isLoading) return <Spinner />; if (q.isError || !q.data) return <ErrorBox message="Could not load the system status" />;
  const s = q.data; const bk = BK[s.backups.backup], dr = DR[s.backups.drill];
  return (<div className="space-y-4"><div className="flex items-center gap-3"><h1 className="text-xl font-semibold">System status</h1>
      <Badge tone={s.status === 'ok' ? 'green' : 'amber'}>{s.status === 'ok' ? 'All good' : 'Needs attention'}</Badge>
      <button className="btn-secondary ml-auto" onClick={() => qc.invalidateQueries({ queryKey: ['system'] })}>Refresh</button></div>
    {s.warnings.length > 0 && <section className="card border-amber-300 bg-amber-50" aria-label="Warnings"><h2 className="mb-1 font-semibold">Needs attention</h2><ul className="list-disc space-y-1 pl-5 text-sm">{s.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></section>}
    <section className="card text-sm" aria-label="Installation"><h2 className="mb-2 font-semibold">Installation</h2>
      <dl className="grid grid-cols-[12rem_1fr] gap-y-1"><dt className="text-slate-500">Version</dt><dd>{s.version}</dd><dt className="text-slate-500">Running for</dt><dd>{dur(s.uptimeSeconds)}</dd><dt className="text-slate-500">Database changes applied</dt><dd>{s.schema.count} (latest {s.schema.latest ?? '—'})</dd>
        <dt className="text-slate-500">Administrator sign-in</dt><dd>{s.security.mfaRequiredForPlatform ? 'Two-step verification required' : <Badge tone="red">Two-step verification not required</Badge>}</dd><dt className="text-slate-500">Mode</dt><dd>{s.production ? 'Production' : 'Development'}</dd></dl></section>
    <section className="card text-sm" aria-label="Backups"><h2 className="mb-2 font-semibold">Backups and restore drills</h2>
      <p className="flex flex-wrap items-center gap-2"><span>Backup:</span><Badge tone={bk[1]}>{bk[0]}</Badge>{s.backups.lastBackup && <span className="text-slate-600">last {when(s.backups.lastBackup.at)} ({Math.round(s.backups.lastBackup.ageHours)} h ago, {s.backups.lastBackup.encrypted ? 'encrypted' : 'not encrypted'})</span>}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2"><span>Restore drill:</span><Badge tone={dr[1]}>{dr[0]}</Badge>{s.backups.lastDrill && <span className="text-slate-600">last {when(s.backups.lastDrill.at)} ({s.backups.lastDrill.ageDays} days ago)</span>}</p>
      <p className="mt-1 flex flex-wrap items-center gap-2"><span>Off-server copy:</span>{s.backups.offsite === 'not_configured' || s.backups.offsite === undefined ? <><Badge>not set up</Badge><span className="text-slate-600">backups are kept on this server only</span></> : <><Badge tone={s.backups.offsite === 'ok' ? 'green' : s.backups.offsite === 'stale' ? 'amber' : 'red'}>{s.backups.offsite === 'ok' ? 'OK' : s.backups.offsite === 'stale' ? 'stale' : 'never succeeded'}</Badge>{s.backups.lastOffsite && <span className="text-slate-600">last {when(s.backups.lastOffsite.at)} ({Math.round(s.backups.lastOffsite.ageHours)} h ago)</span>}</>}</p>
      {s.disk && <p className="mt-1 flex flex-wrap items-center gap-2"><span>Disk:</span><span className="text-slate-600">{mb(s.disk.freeBytes)} free of {mb(s.disk.totalBytes)}</span></p>}
      {!s.backups.log.length ? <Empty>No backups have been recorded yet.</Empty> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr className="text-xs uppercase text-slate-500"><th className="py-1">When</th><th>Kind</th><th>Result</th><th>Database</th><th>Files</th><th>Note</th></tr></thead><tbody>
        {s.backups.log.slice(0, 10).map((l: any) => <tr key={l.id} className="border-t"><td className="py-1 whitespace-nowrap">{when(l.takenAt)}</td><td>{l.kind === 'drill' ? 'Restore drill' : l.kind === 'offsite' ? 'Off-server copy' : 'Backup'}</td><td>{l.ok ? <Badge tone="green">OK</Badge> : <Badge tone="red">Failed</Badge>}</td><td>{mb(l.dbBytes)}</td><td>{mb(l.evidenceBytes)}</td><td className="text-xs text-slate-600">{l.note}</td></tr>)}</tbody></table></div>}</section>
    <section className="card text-sm" aria-label="Background work"><h2 className="mb-2 font-semibold">Background work and email</h2>
      <p>{s.queue.pending} waiting, {s.queue.running} running, {s.queue.dead} given up. Email: {s.email.configured ? 'configured' : 'not configured'}; {s.email.failedLast24h} failed in the last 24 hours.</p></section></div>);
}
