import { Component, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api'; import { Spinner, Empty } from './ui';

/** Widget framework: every dashboard tile registers here with its own permission, data loader and drill-down link. */
export type WidgetDef = { id: string; title: string; permission: 'any' | 'platform'; load: () => Promise<unknown>; isEmpty?: (d: any) => boolean; render: (d: any) => ReactNode; drillDown?: string; staleAfterMs?: number; };
export const registry: WidgetDef[] = [];
export const registerWidget = (w: WidgetDef) => { if (!registry.find(x => x.id === w.id)) registry.push(w); };

export class WidgetBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* contained: one broken tile must never take the page down */ }
  render() { return this.state.failed ? <div role="alert" className="card text-sm text-red-700">“{this.props.title}” failed to render.</div> : this.props.children; }
}
export function WidgetCard({ def }: { def: WidgetDef }) {
  const q = useQuery({ queryKey: ['widget', def.id], queryFn: def.load, retry: false });
  const stale = def.staleAfterMs && q.dataUpdatedAt && Date.now() - q.dataUpdatedAt > def.staleAfterMs;
  return (
    <section className="card" aria-label={def.title}>
      <header className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{def.title}</h2>
        <span className="flex items-center gap-2 text-xs text-slate-500">{stale && <span className="rounded bg-amber-100 px-1 text-amber-800">stale</span>}{q.dataUpdatedAt ? `updated ${new Date(q.dataUpdatedAt).toLocaleTimeString()}` : ''}</span></header>
      {q.isLoading ? <Spinner /> : q.isError ? <p role="alert" className="text-sm text-red-700">Could not load this widget. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
        : (def.isEmpty?.(q.data)) ? <Empty>Nothing here yet.</Empty> : def.render(q.data)}
      {def.drillDown && <a className="mt-2 inline-block text-xs text-brand underline" href={def.drillDown}>View details</a>}
    </section>);
}
registerWidget({ id: 'system-health', title: 'System health', permission: 'any', staleAfterMs: 120_000, load: () => api('GET', '/ready'), render: d => <p className="text-sm">{d?.ok ? '● API and database are reachable' : '● Degraded'}</p> });
registerWidget({ id: 'my-work', title: 'My work', permission: 'any', load: async () => [], isEmpty: d => !d?.length, render: () => null });
export function WidgetGrid({ platform }: { platform: boolean }) {
  return (<div className="grid gap-4 md:grid-cols-2">{registry.filter(w => w.permission === 'any' || platform).map(w => <WidgetBoundary key={w.id} title={w.title}><WidgetCard def={w} /></WidgetBoundary>)}</div>);
}
