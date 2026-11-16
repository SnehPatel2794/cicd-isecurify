// In-app notifications (Phase 7B): the bell in the header, the notifications page and the preference switches.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './api'; import { useAuth } from './auth'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge } from './kit';
import { ago, countText, headline, targetOf, type Note } from './notificationsUi';

const KEY = 'notifications';
export const useUnread = () => useQuery({ queryKey: [KEY, 'count'], queryFn: () => api<{ unread: number }>('GET', '/me/notifications/count'), refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false });
function useMarkRead() { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { ids: number[] } | { all: true }) => api('POST', '/me/notifications/read', b), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) }); }

function Row({ n, onOpen }: { n: Note; onOpen: (n: Note) => void }) {
  return (<li><button type="button" onClick={() => onOpen(n)} className={`flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-slate-50 ${n.read ? 'text-slate-600' : 'bg-brand-light/40 font-medium'}`}>
    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} />
    <span className="min-w-0 flex-1"><span className="block">{headline(n)}</span><span className="block truncate text-slate-700">{n.label}</span><span className="block text-xs font-normal text-slate-500">{ago(n.createdAt)}{n.tenantName ? ` · ${n.tenantName}` : ''}</span></span>
    {!n.read && <span className="sr-only">Unread</span>}</button></li>);
}
function useOpen(close?: () => void) {
  const nav = useNavigate(); const mark = useMarkRead();
  return (n: Note) => { if (!n.read) mark.mutate({ ids: [n.id] }); close?.(); nav(targetOf(n)); };
}

export function NotificationBell() {
  const [open, setOpen] = useState(false); const box = useRef<HTMLDivElement>(null); const c = useUnread(); const unread = c.data?.unread ?? 0; const mark = useMarkRead();
  const list = useQuery({ queryKey: [KEY, 'recent'], queryFn: () => api<any>('GET', '/me/notifications?limit=10'), enabled: open, placeholderData: keepPreviousData });
  useEffect(() => { if (!open) return; const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('mousedown', out); document.addEventListener('keydown', key); return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key); }; }, [open]);
  const go = useOpen(() => setOpen(false));
  return (<div className="relative" ref={box}>
    <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)} className="relative rounded px-2 py-1 text-lg hover:bg-slate-100"><span aria-hidden>🔔</span>
      {unread > 0 && <span data-testid="unread-badge" className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{countText(unread)}</span>}</button>
    {open && <div role="dialog" aria-label="Notifications" className="absolute right-0 z-30 mt-1 w-[22rem] max-w-[92vw] rounded-md border bg-white shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2"><span className="font-semibold">Notifications</span><button type="button" className="text-xs text-brand underline disabled:text-slate-400 disabled:no-underline" disabled={!unread || mark.isPending} onClick={() => mark.mutate({ all: true })}>Mark all read</button></div>
      {list.isLoading ? <Spinner /> : list.isError ? <ErrorBox message="Could not load notifications" /> : !list.data.notifications.length ? <Empty>You are all caught up.</Empty> : <ul className="max-h-96 overflow-y-auto">{list.data.notifications.map((n: Note) => <Row key={n.id} n={n} onOpen={go} />)}</ul>}
      <div className="border-t px-3 py-2 text-right"><Link to="/notifications" className="text-sm text-brand underline" onClick={() => setOpen(false)}>See all and settings</Link></div></div>}</div>);
}

export function NotificationsPage() {
  const { me } = useAuth(); const qc = useQueryClient(); const [unreadOnly, setUnreadOnly] = useState(false); const [tenantId, setTenantId] = useState(''); const [extra, setExtra] = useState<Note[]>([]); const [before, setBefore] = useState<number | null>(null);
  const qs = `?limit=30${unreadOnly ? '&unread=true' : ''}${tenantId ? `&tenantId=${tenantId}` : ''}`;
  const q = useQuery({ queryKey: [KEY, 'page', qs], queryFn: () => api<any>('GET', `/me/notifications${qs}`), placeholderData: keepPreviousData }); const more = useMutation({ mutationFn: (b: number) => api<any>('GET', `/me/notifications${qs}&before=${b}`), onSuccess: d => { setExtra(e => [...e, ...d.notifications]); setBefore(d.nextBefore); } });
  const mark = useMarkRead(); const go = useOpen(); const reset = () => { setExtra([]); setBefore(null); };
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load notifications" />;
  const d = q.data; const rows: Note[] = [...d.notifications, ...extra]; const next = extra.length ? before : d.nextBefore; const orgs = me!.organizations.filter((o, i, a) => a.findIndex(x => x.id === o.id) === i);
  return (<div className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Notifications</h1>{d.unread > 0 && <Badge tone="brand">{d.unread} unread</Badge>}
      <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={e => { setUnreadOnly(e.target.checked); reset(); }} />Unread only</label>
      {orgs.length > 1 && <select aria-label="Organization" className="input w-auto" value={tenantId} onChange={e => { setTenantId(e.target.value); reset(); }}><option value="">All organizations{''}</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}{d.unreadByTenant?.[o.id] ? ` (${d.unreadByTenant[o.id]})` : ''}</option>)}</select>}
      <button type="button" className="btn-secondary" disabled={!d.unread || mark.isPending} onClick={() => mark.mutate({ all: true })}>Mark all read</button></div>
    <section className="card p-0">{!rows.length ? <Empty>{unreadOnly ? 'No unread notifications.' : 'Nothing yet. You will see assignments, evidence decisions and finding updates here.'}</Empty> : <ul>{rows.map(n => <Row key={n.id} n={n} onOpen={go} />)}</ul>}
      {next && <div className="p-3 text-center"><button type="button" className="btn-secondary" disabled={more.isPending} onClick={() => more.mutate(next)}>Load older</button></div>}</section>
    <DigestSetting /><Preferences onChange={() => qc.invalidateQueries({ queryKey: [KEY] })} /></div>);
}

function DigestSetting() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: [KEY, 'digest'], queryFn: () => api<{ frequency: 'off' | 'daily' | 'weekly'; lastSentAt: string | null }>('GET', '/me/email-digest') });
  const set = useMutation({ mutationFn: (frequency: string) => api('PUT', '/me/email-digest', { frequency }), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'digest'] }) });
  if (q.isLoading) return null; if (q.isError) return <ErrorBox message="Could not load your email digest setting" />;
  return (<section className="card" aria-label="Email digest"><h2 className="mb-1 font-semibold">Email digest</h2><p className="mb-3 text-sm text-slate-600">One email with everything of yours that is overdue or due within 3 days, plus a count of unread notifications. Nothing is sent when there is nothing to say.</p>
    {set.isError && <ErrorBox message="Could not save that setting" />}
    <label className="flex items-center gap-2 text-sm">How often<select aria-label="Digest frequency" className="input w-auto" value={q.data!.frequency} disabled={set.isPending} onChange={e => set.mutate(e.target.value)}><option value="daily">Every day</option><option value="weekly">Once a week</option><option value="off">Never</option></select></label>
    {q.data!.lastSentAt && <p className="mt-2 text-xs text-slate-500">Last sent {ago(q.data!.lastSentAt)}.</p>}</section>);
}

function Preferences({ onChange }: { onChange: () => void }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: [KEY, 'prefs'], queryFn: () => api<any>('GET', '/me/notification-prefs') });
  const set = useMutation({ mutationFn: (b: { kind: string; inApp?: boolean; email?: boolean }) => api('PUT', '/me/notification-prefs', b), onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, 'prefs'] }); onChange(); } });
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load your notification settings" />;
  const groups: Record<string, any[]> = {}; for (const k of q.data.kinds) (groups[k.group] ??= []).push(k);
  return (<section className="card" aria-label="Notification settings"><h2 className="mb-1 font-semibold">What shows up in the app</h2><p className="mb-3 text-sm text-slate-600">Switch off anything you do not want to be told about. Tick Email to also get it by email (important items are emailed by default). You are never notified about your own actions.</p>
    {set.isError && <ErrorBox message="Could not save that setting" />}
    {Object.entries(groups).map(([g, ks]) => <fieldset key={g} className="mb-3"><legend className="text-xs font-semibold uppercase text-slate-500">{g}</legend>{ks.map(k => <div key={k.kind} className="flex items-center gap-3 py-1 text-sm"><label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={k.inApp} disabled={set.isPending} onChange={e => set.mutate({ kind: k.kind, inApp: e.target.checked })} />{k.label}</label><label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" aria-label={`Email: ${k.label}`} checked={!!k.email} disabled={set.isPending || !k.inApp} onChange={e => set.mutate({ kind: k.kind, email: e.target.checked })} />Email</label></div>)}</fieldset>)}</section>);
}
