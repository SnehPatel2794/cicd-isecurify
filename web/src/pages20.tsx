// Search, My Work and the activity timeline (Phase 10G).
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api'; import { useAuth } from './auth'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge } from './kit';
import { toQuery, fromParams, activeCount, TYPE_LABEL, statusLabel, shortDate, type FilterState } from './spogUi';

/** The filters every overview screen shares. `show` picks the ones the screen honours. */
export function FilterBar({ value, onChange, show, engagements, frameworks, orgs, statuses }: { value: FilterState; onChange: (f: FilterState) => void; show: (keyof FilterState)[]; engagements?: { id: string; name: string }[]; frameworks?: { id: string; name: string }[]; orgs?: { id: string; name: string }[]; statuses?: { value: string; label: string }[] }) {
  const set = (k: keyof FilterState, v: string) => { const n = { ...value }; if (v) n[k] = v; else delete n[k]; if (k === 'orgId') { delete n.engagementId; delete n.frameworkId; } onChange(n); };
  const sel = (k: keyof FilterState, label: string, opts: { value: string; label: string }[], all: string) => <label className="text-xs text-slate-600">{label}<select className="input ml-1 w-auto" aria-label={label} value={value[k] ?? ''} onChange={e => set(k, e.target.value)}><option value="">{all}</option>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  return (<div className="flex flex-wrap items-end gap-3 rounded border bg-white p-2" role="group" aria-label="Filters">
    {show.includes('orgId') && orgs && orgs.length > 1 && sel('orgId', 'Client', orgs.map(o => ({ value: o.id, label: o.name })), 'All clients')}
    {show.includes('frameworkId') && frameworks && sel('frameworkId', 'Framework', frameworks.map(o => ({ value: o.id, label: o.name })), 'All frameworks')}
    {show.includes('engagementId') && engagements && sel('engagementId', 'Engagement', engagements.map(o => ({ value: o.id, label: o.name })), 'All engagements')}
    {show.includes('status') && statuses && sel('status', 'Status', statuses, 'Any status')}
    {show.includes('from') && <label className="text-xs text-slate-600">From<input type="date" className="input ml-1 w-auto" aria-label="From" value={value.from ?? ''} onChange={e => set('from', e.target.value)} /></label>}
    {show.includes('to') && <label className="text-xs text-slate-600">To<input type="date" className="input ml-1 w-auto" aria-label="To" value={value.to ?? ''} onChange={e => set('to', e.target.value)} /></label>}
    {show.includes('ownerId') && <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" aria-label="Only mine" checked={!!value.ownerId} onChange={e => set('ownerId', e.target.checked ? '__me__' : '')} />Only mine</label>}
    {activeCount(value) > 0 && <button type="button" className="btn-secondary" onClick={() => onChange({})}>Clear filters</button>}</div>);
}
const useOrgChoices = (orgId?: string) => { const { me } = useAuth(); const orgs = (me?.organizations ?? []).map(o => ({ id: o.id, name: o.name })); const tid = orgId ?? (orgs.length === 1 ? orgs[0].id : undefined);
  const engs = useQuery({ queryKey: ['engagements', tid], queryFn: () => api<any[]>('GET', `/t/${tid}/engagements`), enabled: !!tid });
  const frameworks = new Map<string, string>(); for (const e of engs.data ?? []) for (const f of e.frameworks ?? []) frameworks.set(f.frameworkId, f.name);
  return { orgs, tid, engagements: (engs.data ?? []).map((e: any) => ({ id: e.id, name: e.name })), frameworks: [...frameworks].map(([id, name]) => ({ id, name })) }; };
const meId = (f: FilterState, uid: string): FilterState => f.ownerId === '__me__' ? { ...f, ownerId: uid } : f;

// ---------------------------------------------------------------- search
export function SearchBox() {
  const nav = useNavigate(); const [sp] = useSearchParams(); const [q, setQ] = useState(sp.get('q') ?? '');
  const go = (e: FormEvent) => { e.preventDefault(); const t = q.trim(); if (t.length >= 2) nav(`/search?q=${encodeURIComponent(t)}`); };
  return <form role="search" className="min-w-0 flex-1" onSubmit={go}><input aria-label="Global search" placeholder="Search engagements, items, findings, risks, policies…" className="w-full min-w-0 rounded border px-3 py-1 text-sm" value={q} onChange={e => setQ(e.target.value)} maxLength={80} /></form>;
}
export function SearchPage() {
  const [sp, setSp] = useSearchParams(); const { me } = useAuth(); const q = sp.get('q') ?? ''; const filters = fromParams(sp); const ch = useOrgChoices(filters.orgId); const type = sp.get('type') ?? '';
  const setFilters = (f: FilterState) => { const n = new URLSearchParams(); if (q) n.set('q', q); if (type) n.set('type', type); for (const [k, v] of Object.entries(f)) if (v) n.set(k, v); setSp(n); };
  const query = toQuery(meId(filters, me?.user.id ?? ''), { q, type });
  const r = useQuery({ queryKey: ['search', query], queryFn: () => api<any>('GET', `/me/search?${query}`), enabled: q.trim().length >= 2 });
  return (<div className="space-y-3"><h1 className="text-xl font-semibold">Search</h1>
    <FilterBar value={filters} onChange={setFilters} show={['orgId', 'frameworkId', 'engagementId', 'ownerId']} orgs={ch.orgs} engagements={ch.tid ? ch.engagements : undefined} frameworks={ch.tid ? ch.frameworks : undefined} />
    {q.trim().length < 2 ? <Empty>Type at least 2 characters in the search box above.</Empty> : r.isLoading ? <Spinner /> : r.isError ? <ErrorBox message="The search could not be completed." /> : !r.data.groups.length ? <Empty>Nothing found for “{r.data.q}”.</Empty> :
      r.data.groups.map((g: any) => (<section key={g.type} className="card" aria-label={TYPE_LABEL[g.type]}><h2 className="mb-2 text-sm font-semibold">{TYPE_LABEL[g.type]}{g.more && <span className="ml-2 text-xs font-normal text-slate-500">showing the best {g.results.length}</span>}</h2>
        <ul className="divide-y">{g.results.map((x: any) => <li key={x.type + x.id} className="py-1.5"><div className="flex flex-wrap items-center gap-2"><Link className="text-brand underline" to={x.path}>{x.ref ? `${x.ref} · ` : ''}{x.title}</Link>{x.status && <Badge tone="slate">{statusLabel(x.status)}</Badge>}
          <span className="text-xs text-slate-500">{[ch.orgs.length > 1 ? x.orgName : '', x.engagementName, x.owner].filter(Boolean).join(' · ')}</span></div>{x.snippet && <p className="text-xs text-slate-600">{x.snippet}</p>}</li>)}</ul></section>))}
  </div>);
}

// ---------------------------------------------------------------- My Work
const KIND_TONE: Record<string, any> = { review: 'blue', action: 'amber', item: 'slate' };
export function MyWorkPage() {
  const [sp, setSp] = useSearchParams(); const filters = fromParams(sp); const ch = useOrgChoices(filters.orgId); const query = toQuery(filters);
  const r = useQuery({ queryKey: ['mywork', query], queryFn: () => api<any>('GET', `/me/work${query ? '?' + query : ''}`) });
  const setFilters = (f: FilterState) => { const n = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) n.set(k, v); setSp(n); };
  return (<div className="space-y-3"><div className="flex flex-wrap items-baseline gap-3"><h1 className="text-xl font-semibold">My work</h1>{r.data && <span className="text-sm text-slate-500">{r.data.total} thing{r.data.total === 1 ? '' : 's'} need{r.data.total === 1 ? 's' : ''} you</span>}</div>
    <FilterBar value={filters} onChange={setFilters} show={['orgId', 'frameworkId', 'engagementId', 'from', 'to']} orgs={ch.orgs} engagements={ch.tid ? ch.engagements : undefined} frameworks={ch.tid ? ch.frameworks : undefined} />
    <p className="text-xs text-slate-500">The date range applies to due dates; entries without a due date are hidden while a range is set.</p>
    {r.isLoading ? <Spinner /> : r.isError ? <ErrorBox message="Your work could not be loaded." /> : !r.data.organizations.length ? <Empty>Nothing is waiting for you.</Empty> :
      r.data.organizations.map((o: any) => (<section key={o.id} className="space-y-2" aria-label={o.name}>{(r.data.organizations.length > 1 || ch.orgs.length > 1) && <h2 className="text-sm font-semibold uppercase text-slate-500">{o.name} <span className="font-normal">({o.total})</span></h2>}
        {o.sections.map((s: any) => (<div key={s.key} className="card" aria-label={s.title}><h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">{s.title}<Badge tone={KIND_TONE[s.kind]}>{s.entries.length}{s.more ? '+' : ''}</Badge></h3>
          <ul className="divide-y">{s.entries.map((e: any) => <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm"><Link className="text-brand underline" to={e.path}>{e.ref ? `${e.ref} · ` : ''}{e.title}</Link>{e.status && <Badge tone="slate">{statusLabel(e.status)}</Badge>}
            {e.dueDate && <span className={`text-xs ${e.overdue ? 'font-medium text-red-700' : 'text-slate-500'}`}>{e.overdue ? 'Overdue · ' : 'Due '}{shortDate(e.dueDate)}</span>}{e.engagementName && <span className="text-xs text-slate-500">{e.engagementName}</span>}</li>)}</ul></div>))}</section>))}
  </div>);
}

// ---------------------------------------------------------------- activity timeline
export function TimelinePage() {
  const { tid } = useParams(); const { me } = useAuth(); const [sp, setSp] = useSearchParams(); const filters = fromParams(sp); const ch = useOrgChoices(tid); const query = toQuery(meId(filters, me?.user.id ?? ''), { limit: 30 });
  const r = useInfiniteQuery({ queryKey: ['timeline', tid, query], initialPageParam: '' as string, queryFn: ({ pageParam }) => api<any>('GET', `/t/${tid}/timeline?${query}${pageParam ? `&beforeId=${pageParam}` : ''}`), getNextPageParam: (last: any) => last.nextBeforeId ? String(last.nextBeforeId) : undefined });
  const setFilters = (f: FilterState) => { const n = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) n.set(k, v); setSp(n); };
  const items = (r.data?.pages ?? []).flatMap((p: any) => p.items); const scope = r.data?.pages[0]?.scope;
  return (<div className="space-y-3"><div className="flex items-baseline gap-3"><h1 className="text-xl font-semibold">Activity</h1>{scope && <span className="text-sm text-slate-500">{scope === 'organization' ? 'Everything in this organization' : 'Your own activity'}</span>}</div>
    <FilterBar value={filters} onChange={setFilters} show={['engagementId', 'from', 'to', ...(scope === 'organization' ? ['ownerId' as const] : [])]} engagements={ch.engagements} />
    {r.isLoading ? <Spinner /> : r.isError ? <ErrorBox message="The activity could not be loaded." /> : !items.length ? <Empty>No activity for these filters.</Empty> :
      <ol className="card divide-y" aria-label="Activity timeline">{items.map((x: any) => <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm"><time className="w-40 shrink-0 text-xs text-slate-500" dateTime={x.at}>{new Date(x.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time>
        <span className="font-medium">{x.label}</span><span className="text-slate-600">{x.actor?.name ?? 'System'}</span>{x.path && <Link className="text-xs text-brand underline" to={x.path}>Open engagement</Link>}</li>)}</ol>}
    {r.hasNextPage && <button className="btn-secondary" disabled={r.isFetchingNextPage} onClick={() => r.fetchNextPage()}>{r.isFetchingNextPage ? 'Loading…' : 'Show older'}</button>}</div>);
}
