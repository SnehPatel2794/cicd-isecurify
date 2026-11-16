// The readiness service used by every read-only overview screen. It serves the pre-computed summary when it is trustworthy and computes live otherwise:
//   - stored for today, and nothing marked dirty since  -> served from the table (fast, even with thousands of engagements)
//   - missing, from an earlier day, or marked dirty      -> computed live right now (always correct, never waits for the worker)
//   - "assigned" scope (a person sees only their own items) -> always live, because a stored summary covers the whole engagement
// `freshness` tells the screen how old the stored numbers are, and whether the worker has fallen behind (stale).
import { computeSummaries, itemFacts, isStale, STALE_MINUTES, type EngagementSummary } from '../../../../shared/readiness';
import { summarize, type Summary } from '../engagements/evaluation'; import { q, type Conn } from '../../db'; import * as sd from './data';
export type Freshness = { source: 'summary' | 'live' | 'mixed'; computedAt: string | null; ageMinutes: number | null; stale: boolean; staleAfterMinutes: number };
export type Readiness = { of: (id: string) => Summary; findings: (id: string) => { unresolved: number; critical: number; overdue: number } | null; freshness: Freshness };
export async function readiness(c: Conn, tenantId: string, ids: string[], o: { today: string; assignedUserId?: string; now?: number }): Promise<Readiness> {
  const now = o.now ?? Date.now(); const query = (sql: string, p?: any[]) => q(c, sql, p);
  if (o.assignedUserId) {
    const rows = await itemFacts(query, tenantId, { today: o.today, engagementIds: ids, assignedUserId: o.assignedUserId }); const by = new Map<string, any[]>(); for (const r of rows) (by.get(r.engagementId) ?? by.set(r.engagementId, []).get(r.engagementId)!).push(r);
    return { of: id => summarize(by.get(id) ?? [], o.today), findings: () => null, freshness: { source: 'live', computedAt: null, ageMinutes: null, stale: false, staleAfterMinutes: STALE_MINUTES } };
  }
  const [stored, dirty] = await Promise.all([sd.readStored(c, tenantId, ids), sd.readDirty(c, tenantId, ids)]);
  const usable = new Map<string, sd.Stored>(); for (const s of stored) if (s.computedFor === o.today && !dirty.has(s.engagementId)) usable.set(s.engagementId, s);
  const need = ids.filter(id => !usable.has(id)); const live = new Map<string, EngagementSummary>(); for (const x of await computeSummaries(query, tenantId, need, o.today)) live.set(x.engagementId, x);
  const oldest = usable.size ? Math.min(...[...usable.values()].map(s => s.computedAt.getTime())) : null;
  const source = !usable.size ? 'live' : need.length ? 'mixed' : 'summary';
  return { of: id => (usable.get(id)?.summary ?? live.get(id)?.summary ?? summarize([], o.today)) as Summary, findings: id => usable.get(id)?.findings ?? live.get(id)?.findings ?? { unresolved: 0, critical: 0, overdue: 0 },
    freshness: { source, computedAt: oldest ? new Date(oldest).toISOString() : null, ageMinutes: oldest ? Math.max(0, Math.round((now - oldest) / 60000)) : null, stale: oldest !== null && isStale(oldest, now), staleAfterMinutes: STALE_MINUTES } };
}
/** Combine several freshness blocks (one per organization) into one: the oldest stored figure, stale if any is. */
export function worstFreshness(list: Freshness[]): Freshness {
  const base: Freshness = { source: 'live', computedAt: null, ageMinutes: null, stale: false, staleAfterMinutes: STALE_MINUTES }; if (!list.length) return base;
  const stored = list.filter(f => f.computedAt); const kinds = new Set(list.map(f => f.source));
  const oldest = stored.length ? stored.reduce((a, b) => (a.computedAt! < b.computedAt! ? a : b)) : null;
  return { source: kinds.size === 1 ? list[0].source : 'mixed', computedAt: oldest?.computedAt ?? null, ageMinutes: oldest?.ageMinutes ?? null, stale: list.some(f => f.stale), staleAfterMinutes: STALE_MINUTES };
}
