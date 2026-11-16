// "Updated 3 minutes ago" and a "may be out of date" badge for screens built from the pre-computed summaries (Phase 10F).
import { Badge } from './kit';
export type FreshnessInfo = { source: 'summary' | 'live' | 'mixed'; computedAt: string | null; ageMinutes: number | null; stale: boolean; staleAfterMinutes?: number };
export function freshnessText(f?: FreshnessInfo | null): string {
  if (!f) return ''; if (f.ageMinutes === null || f.source === 'live') return 'Calculated just now';
  const m = f.ageMinutes; const ago = m < 1 ? 'less than a minute ago' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : m < 120 ? '1 hour ago' : `${Math.floor(m / 60)} hours ago`;
  return `Updated ${ago}`;
}
export function Freshness({ value }: { value?: FreshnessInfo | null }) {
  if (!value) return null;
  return (<p className="flex flex-wrap items-center gap-2 text-xs text-slate-500" aria-label="Data freshness"><span>{freshnessText(value)}</span>
    {value.stale && <Badge tone="amber" title={`These figures were last refreshed more than ${value.staleAfterMinutes ?? 15} minutes ago. The background refresh may be behind.`}>May be out of date</Badge>}</p>);
}
