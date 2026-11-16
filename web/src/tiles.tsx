// Dashboard tiles driven by the server (Phase 10H). Each tile loads from its own endpoint, so a slow or failing tile never holds up the others, and shows its own loading, empty, error and stale states.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api'; import { Badge } from './kit'; import { WidgetBoundary } from './widgets';
export type TileData = { id: string; title: string; value: number | null; unit: string | null; detail: string | null; empty: boolean; drill: string; freshness: { source: string; stale: boolean; ageMinutes: number | null } };
export const tileValue = (t: Pick<TileData, 'value' | 'unit'>) => t.value == null ? '—' : `${t.value}${t.unit ?? ''}`;
export function Tile({ tid, id, title, drill }: { tid: string; id: string; title: string; drill: string }) {
  const q = useQuery({ queryKey: ['tile', tid, id], queryFn: () => api<TileData>('GET', `/t/${tid}/widgets/${id}`), retry: false, staleTime: 30_000 }); const d = q.data;
  return (<section className="card flex flex-col gap-1 px-3 py-2" aria-label={title} aria-busy={q.isLoading}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs uppercase text-slate-500">{title}</h3>{d?.freshness.stale && <Badge tone="amber" title={`Last refreshed ${d.freshness.ageMinutes} minutes ago`}>May be out of date</Badge>}</div>
    {q.isLoading ? <div role="status" className="h-8 w-16 animate-pulse rounded bg-slate-100"><span className="sr-only">Loading</span></div>
      : q.isError ? <p role="alert" className="text-sm text-red-700">Could not load. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
      : d!.empty ? <p className="text-sm text-slate-500">Nothing here yet.</p>
      : <Link to={d!.drill} className="text-2xl font-semibold text-brand hover:underline" aria-label={`${title}: ${tileValue(d!)}. Show the list`}>{tileValue(d!)}</Link>}
    {d && !d.empty && d.detail && <p className="text-xs text-slate-500">{d.detail}</p>}
    {!q.isLoading && !q.isError && !d?.empty && <Link to={drill} className="text-xs text-brand underline">Show the list</Link>}
  </section>);
}
/** The tiles this person may see in this organization, each loading on its own. */
export function OrgTiles({ tid }: { tid: string }) {
  const cat = useQuery({ queryKey: ['tiles', tid], queryFn: () => api<{ widgets: { id: string; title: string; drill: string }[] }>('GET', `/t/${tid}/widgets`), retry: false });
  if (cat.isLoading) return <div role="status" className="text-sm text-slate-500">Loading…</div>; if (cat.isError || !cat.data?.widgets.length) return null;
  return (<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5" aria-label="At a glance">{cat.data.widgets.map(w => <WidgetBoundary key={w.id} title={w.title}><Tile tid={tid} id={w.id} title={w.title} drill={w.drill} /></WidgetBoundary>)}</div>);
}
