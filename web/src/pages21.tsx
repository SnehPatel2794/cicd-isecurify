// The organization-wide checklist item list the dashboard tiles drill into (Phase 10H).
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from './api'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge } from './kit'; import { STATE_TONE } from './engagementUi'; import { shortDate } from './spogUi';
export const ITEM_STATES: [string, string][] = [['not_assessed', 'Not assessed'], ['not_implemented', 'Not implemented'], ['partially_implemented', 'Partially implemented'], ['implemented_pending_validation', 'Pending validation'], ['awaiting_review', 'Awaiting review'], ['blocked_missing_evidence', 'Blocked: evidence'], ['ineffective', 'Ineffective'], ['effective', 'Effective'], ['not_applicable', 'Not applicable']];
const KEYS = ['state', 'overdue', 'engagementId', 'q', 'page'] as const;
export function ItemsPage() {
  const { tid } = useParams(); const [sp, setSp] = useSearchParams(); const get = (k: string) => sp.get(k) ?? ''; const page = Math.max(1, Number(get('page')) || 1); const PAGE = 50;
  const qs = new URLSearchParams(); for (const k of KEYS) if (get(k)) qs.set(k, get(k)); qs.set('page', String(page)); qs.set('pageSize', String(PAGE));
  const q = useQuery({ queryKey: ['items', tid, qs.toString()], queryFn: () => api<any>('GET', `/t/${tid}/items?${qs}`), placeholderData: keepPreviousData });
  const engs = useQuery({ queryKey: ['engagements', tid], queryFn: () => api<any[]>('GET', `/t/${tid}/engagements`) });
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n); };
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="The items could not be loaded." />; const d = q.data; const last = Math.max(1, Math.ceil(d.total / PAGE));
  return (<div className="space-y-3"><div className="flex flex-wrap items-baseline gap-3"><h1 className="text-xl font-semibold">Checklist items</h1><span className="text-sm text-slate-500" aria-label="Count">{d.total} item{d.total === 1 ? '' : 's'}</span></div>
    <div className="flex flex-wrap items-end gap-3 rounded border bg-white p-2" role="group" aria-label="Filters">
      <label className="text-xs text-slate-600">State<select className="input ml-1 w-auto" aria-label="State" value={get('state')} onChange={e => set('state', e.target.value)}><option value="">Any state</option>{ITEM_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-xs text-slate-600">Engagement<select className="input ml-1 w-auto" aria-label="Engagement" value={get('engagementId')} onChange={e => set('engagementId', e.target.value)}><option value="">All active engagements</option>{(engs.data ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={get('overdue') === 'true'} onChange={e => set('overdue', e.target.checked ? 'true' : '')} />Overdue only</label>
      <label className="text-xs text-slate-600">Search<input className="input ml-1 w-40" aria-label="Search items" value={get('q')} onChange={e => set('q', e.target.value)} placeholder="Reference or title" maxLength={80} /></label>
      {KEYS.some(k => k !== 'page' && get(k)) && <button className="btn-secondary" onClick={() => setSp(new URLSearchParams())}>Clear filters</button>}</div>
    {!d.items.length ? <Empty>No items match.</Empty> : <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Reference</th><th>Title</th><th>Engagement</th><th>State</th><th>Owner</th><th>Due</th></tr></thead><tbody>
      {d.items.map((i: any) => <tr key={i.id} className="border-t"><td className="p-1 whitespace-nowrap">{i.ref}</td><td><Link className="text-brand underline" to={`/org/${tid}/engagements/${i.engagementId}?item=${i.id}`}>{i.title}</Link></td><td>{i.engagementName}</td><td><Badge tone={(STATE_TONE[i.state] ?? 'slate') as any}>{i.stateLabel}</Badge></td><td>{i.owner ?? '—'}</td>
        <td className={i.overdue ? 'font-medium text-red-700' : ''}>{i.dueDate ? shortDate(i.dueDate) : '—'}{i.overdue ? ' (overdue)' : ''}</td></tr>)}</tbody></table></div>}
    {last > 1 && <nav className="flex items-center gap-3 text-sm" aria-label="Pages"><button className="btn-secondary" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</button><span>Page {page} of {last}</span><button className="btn-secondary" disabled={page >= last} onClick={() => set('page', String(page + 1))}>Next</button></nav>}
  </div>);
}
