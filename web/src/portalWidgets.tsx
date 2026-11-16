// Shared pieces for lists (Phase 9D): export buttons, saved views, bulk owner assignment, the getting-started card, and the help page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBlob, saveBlob } from './api'; import { ErrorBox } from './ui'; import { useDo } from './kit';
import { queryString, exportName, bulkMessage, compact, sameFilters, readDismissed, writeDismissed } from './portalUi'; import { HELP, searchHelp } from './helpContent';

export function ExportButtons({ tid, path, base, params }: { tid: string; path: string; base: string; params: Record<string, string | undefined | false> }) {
  const a = useDo(); const go = (format: 'csv' | 'xlsx') => a.run(async () => { saveBlob(await apiBlob(`/t/${tid}${path}${queryString({ ...params, format })}`), exportName(base, format)); });
  return (<span className="inline-flex items-center gap-2"><button className="btn-secondary btn" disabled={a.busy} onClick={() => go('csv')}>Export CSV</button><button className="btn-secondary btn" disabled={a.busy} onClick={() => go('xlsx')}>Export Excel</button>{a.err && <span role="alert" className="text-sm text-red-700">{a.err}</span>}</span>);
}
export function SavedViews({ tid, page, current, onApply }: { tid: string; page: 'risks' | 'incidents' | 'findings'; current: Record<string, string>; onApply: (f: Record<string, string>) => void }) {
  const qc = useQueryClient(); const a = useDo(); const [name, setName] = useState(''); const [saving, setSaving] = useState(false); const q = useQuery({ queryKey: ['views', tid, page], queryFn: () => api<{ views: { id: string; name: string; filters: Record<string, string> }[]; max: number }>('GET', `/t/${tid}/views?page=${page}`) });
  const views = q.data?.views ?? []; const active = views.find(v => sameFilters(v.filters, current)); const reload = () => qc.invalidateQueries({ queryKey: ['views', tid, page] }); const hasFilters = Object.keys(compact(current)).length > 0;
  return (<span className="inline-flex flex-wrap items-center gap-2"><select className="input w-auto" aria-label="Saved views" value={active?.id ?? ''} onChange={e => { const v = views.find(x => x.id === e.target.value); if (v) onApply(v.filters); }}><option value="">{views.length ? 'Saved views…' : 'No saved views'}</option>{views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
    {active && <button className="text-sm text-brand underline" disabled={a.busy} onClick={() => a.run(async () => { await api('DELETE', `/t/${tid}/views/${active.id}`); reload(); })}>Delete view</button>}
    {!active && hasFilters && !saving && <button className="text-sm text-brand underline" onClick={() => setSaving(true)}>Save this view</button>}
    {saving && <form className="inline-flex gap-2" onSubmit={e => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/views`, { page, name, filters: compact(current) }); setName(''); setSaving(false); reload(); }); }}><input className="input w-40" aria-label="View name" required maxLength={60} placeholder="Name this view" value={name} onChange={e => setName(e.target.value)} /><button className="btn" disabled={a.busy}>Save</button><button type="button" className="text-sm underline" onClick={() => setSaving(false)}>Cancel</button></form>}
    {a.err && <span role="alert" className="text-sm text-red-700">{a.err}</span>}</span>);
}
/** Select-all checkbox state for a list of ids. */
export const useSelection = (ids: string[]) => { const [sel, setSel] = useState<string[]>([]); const live = sel.filter(x => ids.includes(x)); return { selected: live, all: ids.length > 0 && live.length === ids.length, toggle: (id: string) => setSel(live.includes(id) ? live.filter(x => x !== id) : [...live, id]), toggleAll: () => setSel(live.length === ids.length ? [] : ids), clear: () => setSel([]) }; };
export function BulkBar({ tid, path, noun, ids, allowClear, onDone }: { tid: string; path: string; noun: string; ids: string[]; allowClear: boolean; onDone: () => void }) {
  const a = useDo(); const [owner, setOwner] = useState(''); const [result, setResult] = useState(''); const owners = useQuery({ queryKey: ['bulk-owners', tid], queryFn: async () => (await api<any[]>('GET', `/t/${tid}/members`)).filter(m => m.status === 'active' && ['client_admin', 'client_staff', 'third_party_vendor'].includes(m.role)) });
  if (!ids.length && !result) return null;
  return (<div className="card flex flex-wrap items-center gap-2 p-3 text-sm" aria-label="Bulk actions">{ids.length > 0 && <><b>{ids.length} selected</b><select className="input w-auto" aria-label="New owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="" disabled>Choose an owner…</option>{allowClear && <option value="none">No owner</option>}{(owners.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    <button className="btn" disabled={a.busy || !owner} onClick={() => a.run(async () => { const res = await api<any>('POST', `/t/${tid}${path}`, { ids, ownerUserId: owner === 'none' ? null : owner }); setResult(bulkMessage(noun, res)); setOwner(''); onDone(); })}>Set owner</button></>}
    {result && <span role="status">{result}</span>}{a.err && <ErrorBox message={a.err} />}</div>);
}
export function OnboardingCard({ tid }: { tid: string }) {
  const [hidden, setHidden] = useState(() => readDismissed(tid)); const q = useQuery({ queryKey: ['onboarding', tid], queryFn: () => api<{ steps: { id: string; title: string; description: string; done: boolean; href: string }[]; completed: number; total: number }>('GET', `/t/${tid}/onboarding`), enabled: !hidden });
  if (hidden || !q.data || q.data.total === 0 || q.data.completed === q.data.total) return null; const d = q.data;
  return (<section className="card" aria-label="Getting started"><div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">Getting started</h2><span className="text-xs text-slate-500">{d.completed} of {d.total} done</span><Link className="ml-auto text-sm text-brand underline" to="/help">Help</Link><button className="text-sm text-slate-500 underline" onClick={() => { writeDismissed(tid); setHidden(true); }}>Dismiss</button></div>
    <ul className="space-y-2 text-sm">{d.steps.map(s => <li key={s.id} className="flex gap-2"><span aria-hidden>{s.done ? '✓' : '○'}</span><div><Link className={s.done ? 'text-slate-500 line-through' : 'font-medium text-brand underline'} to={s.href}>{s.title}</Link>{!s.done && <p className="text-slate-600">{s.description}</p>}</div></li>)}</ul></section>);
}
export function HelpPage() {
  const [text, setText] = useState(''); const found = searchHelp(HELP, text);
  return (<div className="space-y-4"><h1 className="text-xl font-semibold">Help</h1><input className="input max-w-md" aria-label="Search help" placeholder="Search, for example “acknowledge” or “export”" value={text} onChange={e => setText(e.target.value)} />
    {!found.length ? <p className="text-sm text-slate-600">Nothing matches “{text}”. Try a shorter word.</p> : found.map(s => <section key={s.id} className="card" aria-label={s.title}><h2 className="mb-2 text-sm font-semibold">{s.title}</h2><dl className="space-y-3 text-sm">{s.items.map(i => <div key={i.q}><dt className="font-medium">{i.q}</dt><dd className="text-slate-700">{i.a}</dd></div>)}</dl></section>)}</div>);
}
