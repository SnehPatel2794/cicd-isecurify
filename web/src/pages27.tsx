// Dashboards (Phase 13C): the engagement dashboard, the task panels shared with organization analytics, and the demo-organization wipe dialog.
import { useState, type ReactNode } from 'react'; import { Link } from 'react-router-dom'; import { useQuery } from '@tanstack/react-query';
import { api } from './api'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge, Modal, useDo, msg } from './kit'; import { Freshness } from './freshness'; import { barPct, pctText, SEV_ORDER, SEV_BAR } from './analyticsUi';

export const TASK_BAR: Record<string, string> = { not_started: 'bg-slate-400', in_progress: 'bg-brand', waiting: 'bg-amber-500', blocked: 'bg-red-600', done: 'bg-green-600', cancelled: 'bg-slate-300' };
export const TASK_ORDER = ['not_started', 'in_progress', 'waiting', 'blocked', 'done'] as const;
const label = (s: string) => s.replace('_', ' ').replace(/^./, c => c.toUpperCase());
/** Share of tasks that are done, as a whole percent; null when there are none. */
export const donePct = (t: { done: number; total: number }) => t.total > 0 ? Math.round((t.done / t.total) * 100) : null;
/** Where a click on a dashboard figure should lead: the engagement tab and an optional filter. */
export const goto = (tid: string, eid: string, tab: string, extra = '') => `/org/${tid}/engagements/${eid}?tab=${tab}${extra}`;

export function Tile({ label: l, value, tone, to, onClick, note }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green'; to?: string; onClick?: () => void; note?: string }) {
  const body = <><div className="text-xs uppercase text-slate-500">{l}</div><div className={`text-2xl font-semibold ${tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-green-700' : ''}`}>{value}</div>{note && <div className="text-xs text-slate-500">{note}</div>}</>;
  const cls = 'card block px-3 py-2 text-left'; const hover = ' hover:ring-2 hover:ring-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';
  return to ? <Link to={to} className={cls + hover} aria-label={`${l}: open`}>{body}</Link> : onClick ? <button type="button" className={cls + hover + ' w-full'} onClick={onClick} aria-label={`${l}: open`}>{body}</button> : <div className={cls}>{body}</div>;
}
function Bars({ title, rows, onPick }: { title: string; rows: { key: string; label: string; n: number; cls?: string }[]; onPick?: (key: string) => void }) {
  const max = Math.max(0, ...rows.map(r => r.n));
  return (<section className="card" aria-label={title}><h2 className="mb-2 text-sm font-semibold">{title}</h2><ul className="space-y-1.5">{rows.map(r => <li key={r.key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
    {onPick ? <button type="button" className="truncate text-left text-brand underline" onClick={() => onPick(r.key)}>{r.label}</button> : <span className="truncate">{r.label}</span>}<span className="h-2 rounded bg-slate-100" aria-hidden="true"><span className={`block h-2 rounded ${r.cls ?? 'bg-brand'}`} style={{ width: `${barPct(r.n, max)}%` }} /></span><span className="text-right tabular-nums">{r.n}</span></li>)}</ul></section>);
}

/** Task panels: status mix, who carries the load, progress per phase, overdue and coming up. `link` builds the link for one task row. */
export function TaskPanels({ t, link, onStatus }: { t: any; link: (x: any) => string; onStatus?: (status: string) => void }) {
  if (!t || !t.total) return <section className="card" aria-label="Tasks"><h2 className="mb-1 text-sm font-semibold">Tasks</h2><Empty>No tasks yet.</Empty></section>;
  const list = (title: string, rows: any[], empty: string, late: boolean) => (<section className="card" aria-label={title}><h2 className="mb-2 text-sm font-semibold">{title}</h2>{!rows.length ? <p className="text-sm text-slate-500">{empty}</p> : <ul className="space-y-1 text-sm">{rows.map((x: any) => <li key={x.id} className="flex flex-wrap items-baseline gap-x-2"><Link className="text-brand underline" to={link(x)}>T-{String(x.taskNo).padStart(3, '0')} {x.title}</Link><span className={late ? 'text-red-700' : 'text-slate-600'}>{x.dueDate}</span><span className="text-xs text-slate-500">{x.assigneeName ?? 'Unassigned'}{x.engagementName ? ` · ${x.engagementName}` : ''}</span></li>)}</ul>}</section>);
  const ph = (t.byPhase ?? []).map((p: any) => ({ key: String(p.phase), label: t.phaseNames?.[p.phase - 1] ?? `Phase ${p.phase}`, done: p.done, open: p.open }));
  return (<>
    <Bars title="Tasks by status" onPick={onStatus} rows={TASK_ORDER.map(s => ({ key: s, label: label(s), n: t.byStatus?.[s] ?? 0, cls: TASK_BAR[s] }))} />
    <section className="card" aria-label="Workload"><h2 className="mb-2 text-sm font-semibold">Open tasks per person</h2>{!t.byAssignee.length ? <p className="text-sm text-slate-500">Nothing is assigned yet.</p> : <ul className="space-y-1 text-sm">{t.byAssignee.map((w: any) => <li key={w.id} className="flex items-center gap-2"><span className="flex-1 truncate">{w.name}</span><span className="tabular-nums">{w.open} open</span>{w.overdue > 0 && <Badge tone="red">{w.overdue} overdue</Badge>}</li>)}</ul>}{t.unassigned > 0 && <p className="mt-2 text-xs text-amber-800">{t.unassigned} open task{t.unassigned === 1 ? ' has' : 's have'} nobody assigned.</p>}</section>
    {ph.length > 0 && <section className="card" aria-label="Progress by phase"><h2 className="mb-2 text-sm font-semibold">Progress by engagement phase</h2><ul className="space-y-1.5 text-sm">{ph.map((p: any) => { const tot = p.done + p.open; return <li key={p.key} className="grid grid-cols-[8rem_1fr_5rem] items-center gap-2"><span className="truncate">{p.label}</span><span className="h-2 rounded bg-slate-100" aria-hidden="true"><span className="block h-2 rounded bg-green-600" style={{ width: `${tot ? Math.round((p.done / tot) * 100) : 0}%` }} /></span><span className="text-right tabular-nums">{p.done}/{tot}</span></li>; })}</ul></section>}
    {list('Overdue tasks', t.overdueList ?? [], 'Nothing is overdue.', true)}{list('Due in the next 14 days', t.upcoming ?? [], 'Nothing is due soon.', false)}</>);
}

/** The engagement dashboard: one screen for where the engagement stands. Every figure leads to the list behind it. */
export function EngagementDashboard({ tid, eid, onGo }: { tid: string; eid: string; onGo: (tab: string, filter?: string) => void }) {
  const q = useQuery({ queryKey: ['dashboard', tid, eid], queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/dashboard`) });
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message={msg(q.error)} />; const d = q.data, r = d.readiness, f = d.findings, e = d.evidence, t = d.tasks, ev = e.byStatus;
  return (<section className="grid gap-4" aria-label="Engagement dashboard"><Freshness value={d.freshness} />
    <ol className="flex flex-wrap gap-1 text-xs" aria-label="Engagement phase">{d.engagement.phases.map((n: string, i: number) => <li key={n} aria-current={i + 1 === d.engagement.phase ? 'step' : undefined} className={`rounded px-2 py-1 ${i + 1 < d.engagement.phase ? 'bg-green-100 text-green-900' : i + 1 === d.engagement.phase ? 'bg-brand font-medium text-white' : 'bg-slate-100 text-slate-600'}`}>{i + 1}. {n}</li>)}</ol>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Tile label="Readiness" value={pctText(r.readinessPercent)} note={`${r.effective} of ${r.applicable} items effective`} onClick={() => onGo('Checklist')} />
      <Tile label="Overdue items" value={r.overdue} tone={r.overdue ? 'red' : 'green'} onClick={() => onGo('Checklist')} />
      <Tile label="Awaiting review" value={ev.submitted} tone={ev.submitted ? 'amber' : undefined} onClick={() => onGo('Evidence')} />
      <Tile label="Unresolved findings" value={f.unresolved} tone={f.unresolved ? 'amber' : undefined} onClick={() => onGo('Findings')} />
      <Tile label="Open tasks" value={t.open} note={donePct(t) === null ? undefined : `${donePct(t)}% done`} onClick={() => onGo('Tasks')} />
      <Tile label="Overdue tasks" value={t.overdue} tone={t.overdue ? 'red' : 'green'} onClick={() => onGo('Tasks', 'overdue')} /></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <TaskPanels t={t} link={x => goto(tid, eid, 'tasks', `&task=${x.id}`)} onStatus={s => onGo('Tasks', `status:${s}`)} />
      <Bars title="Unresolved findings by severity" onPick={() => onGo('Findings')} rows={SEV_ORDER.map(s => ({ key: s, label: label(s), n: f.unresolvedBySeverity[s], cls: SEV_BAR[s] }))} />
      <section className="card" aria-label="Evidence"><h2 className="mb-2 text-sm font-semibold">Evidence</h2><p className="text-sm">{ev.requested} requested · {ev.submitted} awaiting review · {ev.accepted} accepted · {ev.rejected} rejected</p><p className="mt-1 text-sm">Accepted evidence expiring in 30 days: <b>{e.expiring30}</b> · expired: <b className={e.expired ? 'text-red-700' : ''}>{e.expired}</b></p><button className="mt-1 text-xs text-brand underline" onClick={() => onGo('Evidence')}>Open evidence</button></section>
      <section className="card" aria-label="Certificates"><h2 className="mb-2 text-sm font-semibold">Certificates</h2><p className="text-sm">{d.certificates.valid} valid · {d.certificates.expiringSoon} expiring soon · {d.certificates.expired} expired</p><Link className="mt-1 inline-block text-xs text-brand underline" to={`/org/${tid}/certificates`}>Open certificates</Link></section></div></section>);
}

/** Super Admin: permanently wipe a demo organization. Needs the organization name and the Super Admin's password. */
export function WipeDialog({ org, onClose, onDone }: { org: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const [name, setName] = useState(''); const [pw, setPw] = useState(''); const [people, setPeople] = useState(true); const [done, setDone] = useState<any>(null);
  const st = useQuery({ queryKey: ['demo-status'], queryFn: () => api<any>('GET', '/platform/demo') });
  const go = () => a.run(async () => setDone(await api('POST', `/platform/organizations/${org.id}/wipe`, { confirmName: name, password: pw, removePeople: people })));
  return (<Modal title={`Wipe demo organization: ${org.name}`} onClose={done ? onDone : onClose}>{done ? <div className="grid gap-2 text-sm"><p role="status" className="font-medium text-green-800">The organization has been wiped.</p><p>{done.rowsTotal} records, {done.filesRemoved} file{done.filesRemoved === 1 ? '' : 's'} and {done.peopleRemoved} {done.peopleRemoved === 1 ? 'person' : 'people'} were removed.{done.filesFailed > 0 && <b className="text-red-700"> {done.filesFailed} file(s) could not be removed from storage; ask your administrator to delete them.</b>}</p><p className="text-slate-600">A record that the wipe happened (not what was deleted) stays in the platform audit log.</p><button className="btn" onClick={onDone}>Close</button></div>
    : <div className="grid gap-3 text-sm">{st.data && !st.data.wipeConfigured && <p className="rounded bg-amber-50 p-2 text-amber-900">The wipe is not set up on this server. Set <code>PURGE_DB_PASSWORD</code> in <code>.env</code> and re-run the database setup (see docs/DEMO_DATA.md).</p>}
      <p className="rounded bg-red-50 p-2 text-red-900"><b>This cannot be undone.</b> Every engagement, task, finding, evidence file, report, risk, policy, incident, vendor, certificate and audit entry of this organization is permanently deleted. Only organizations created as demo organizations can be wiped; real client organizations never can.</p>
      {a.err && <ErrorBox message={a.err} />}
      <label className="block font-medium">Type the organization name to confirm<input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="off" placeholder={org.name} /></label>
      <label className="block font-medium">Your password<input className="input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={people} onChange={e => setPeople(e.target.checked)} />Also delete people who belong only to this organization (never platform users, never people in a real organization)</label>
      <div className="flex gap-2"><button className="btn bg-red-700" disabled={a.busy || name !== org.name || !pw || (st.data && !st.data.wipeConfigured)} onClick={go}>Wipe permanently</button><button className="btn-secondary" onClick={onClose}>Cancel</button></div></div>}</Modal>);
}
