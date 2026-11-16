// Tiles and the org-wide item list (Phase 10H). Every tile's number comes from the SAME function (or the same data call with the same filters) as the list its drill-down link opens,
// so a tile can never disagree with the list behind it. See docs/WIDGETS.md.
import type { Conn } from '../../db'; import { q } from '../../db'; import * as eng from '../engagements/data'; import { scopeOf } from '../engagements/access';
import { evaluateItem, isOverdue, mergeSummaries, emptySummary, STATE_LABEL, type EvalState } from '../engagements/evaluation'; import { itemRows } from '../../../../shared/readiness';
import { readiness, type Freshness } from '../summary/service'; import * as fd from '../findings/data'; import * as rd from '../risks/data'; import * as rr from '../risks/rules'; import * as id from '../incidents/data'; import * as ir from '../incidents/rules';
import { workOrg, type Access, type Org, type User } from '../spog/service'; import { likeOf } from '../spog/rules';
export type ItemFilters = { state?: EvalState; overdue?: boolean; engagementId?: string; frameworkId?: string; ownerId?: string; q?: string; engagementStatus: 'active' | 'all' };

async function engagementsFor(c: Conn, org: Org, scope: eng.Scope, f: { engagementId?: string; frameworkId?: string; engagementStatus: 'active' | 'all' }) {
  let list: any[] = (await eng.listEngagements(c, org.id, scope)).slice(0, 1000); if (f.engagementStatus === 'active') list = list.filter(e => e.status === 'active'); if (f.engagementId) list = list.filter(e => e.id === f.engagementId);
  if (f.frameworkId && list.length) { const fw = await eng.engagementFrameworksFor(c, org.id, list.map(e => e.id)); list = list.filter(e => (fw.get(e.id) ?? []).some((x: any) => x.frameworkId === f.frameworkId)); } return list;
}
/** The org-wide checklist item list: every item the caller may see, evaluated, filtered, ordered (overdue first). Paging is done by the caller. */
export async function itemList(c: Conn, org: Org, user: User, access: Access, f: ItemFilters, today: string) {
  const scope = scopeOf(access, user.id); const engs = await engagementsFor(c, org, scope, f); const name = new Map(engs.map(e => [e.id, e.name as string]));
  const rows = await itemRows((sql, p) => q(c, sql, p), org.id, { today, engagementIds: engs.map(e => e.id), assignedUserId: scope.kind === 'assigned' ? scope.userId : undefined, ownerUserId: f.ownerId, overdue: f.overdue, state: f.state, like: f.q ? likeOf(f.q) : undefined });
  const out = [] as { id: string; ref: string; title: string; engagementId: string; engagementName: string; state: EvalState; stateLabel: string; dueDate: string | null; overdue: boolean; ownerUserId: string | null; owner: string | null }[];
  for (const r of rows) { const state = evaluateItem(r); const overdue = isOverdue(state, r.dueDate, today); if (f.state && state !== f.state) continue; if (f.overdue && !overdue) continue;
    out.push({ id: r.id, ref: r.ref, title: r.title, engagementId: r.engagementId, engagementName: name.get(r.engagementId) ?? '', state, stateLabel: STATE_LABEL[state], dueDate: r.dueDate, overdue, ownerUserId: r.ownerUserId, owner: r.ownerName }); }
  out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.engagementName.localeCompare(b.engagementName) || a.ref.localeCompare(b.ref, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  return out;
}

type Ctx = { c: Conn; org: Org; user: User; access: Access; today: string };
type Loaded = { value: number | null; unit?: string; detail?: string; universe: number; freshness?: Freshness };
export type TileDef = { id: string; title: string; allowed: (a: Access) => boolean; load: (x: Ctx) => Promise<Loaded>; drill: string };
const live: Freshness = { source: 'live', computedAt: null, ageMinutes: null, stale: false, staleAfterMinutes: 15 };
const w = (a: Access) => ({ via: a.via, role: a.role, manage: a.manage });
async function itemSummary(x: Ctx) {
  const scope = scopeOf(x.access, x.user.id); const engs = await engagementsFor(x.c, x.org, scope, { engagementStatus: 'active' }); const ids = engs.map(e => e.id);
  const r = await readiness(x.c, x.org.id, ids, { today: x.today, assignedUserId: scope.kind === 'assigned' ? scope.userId : undefined }); return { s: ids.length ? mergeSummaries(ids.map(i => r.of(i))) : emptySummary(), freshness: r.freshness };
}
const findingsTile = (filter: fd.OrgFilter | ((today: string) => fd.OrgFilter)) => async (x: Ctx): Promise<Loaded> => { const scope = scopeOf(x.access, x.user.id) as any; const f = typeof filter === 'function' ? filter(x.today) : filter;
  const [rows, all] = await Promise.all([fd.listOrgFindings(x.c, x.org.id, scope, f), fd.orgSummaryRows(x.c, x.org.id, scope, x.today)]); return { value: Math.min(rows.length, 2000), universe: all.reduce((n: number, r: any) => n + Number(r.n), 0), freshness: live }; };
export const TILES: TileDef[] = [
  { id: 'readiness', title: 'Readiness', allowed: () => true, drill: '/items', load: async x => { const { s, freshness } = await itemSummary(x); return { value: s.readinessPercent, unit: '%', detail: `${s.effective} of ${s.applicable} controls effective`, universe: s.applicable, freshness }; } },
  { id: 'items-overdue', title: 'Overdue items', allowed: () => true, drill: '/items?overdue=true', load: async x => { const { s, freshness } = await itemSummary(x); return { value: s.overdue, universe: s.total, freshness }; } },
  { id: 'items-awaiting-review', title: 'Awaiting review', allowed: () => true, drill: '/items?state=awaiting_review', load: async x => { const { s, freshness } = await itemSummary(x); return { value: s.awaitingReview, universe: s.total, freshness }; } },
  { id: 'findings-unresolved', title: 'Unresolved findings', allowed: () => true, drill: '/findings?unresolved=true', load: findingsTile({ unresolved: true }) },
  { id: 'findings-overdue', title: 'Overdue findings', allowed: () => true, drill: '/findings?overdue=true', load: findingsTile(t => ({ overdueToday: t })) },
  { id: 'findings-critical', title: 'Critical findings', allowed: () => true, drill: '/findings?severity=critical&unresolved=true', load: findingsTile({ severity: 'critical', unresolved: true }) },
  { id: 'risks-open', title: 'Open risks', allowed: a => rr.canSeeAll(w(a)), drill: '/risks?open=true', load: async x => { const rows = await rd.listRisks(x.c, x.org.id, {}); return { value: rows.slice(0, 2000).filter((r: any) => rr.isOpen(r.status)).length, universe: Math.min(rows.length, 2000), freshness: live }; } },
  { id: 'incidents-open', title: 'Open incidents', allowed: a => ir.canSeeAll(w(a)), drill: '/incidents?open=true', load: async x => { const rows = await id.listIncidents(x.c, x.org.id, {}); return { value: rows.slice(0, 2000).filter((r: any) => ir.isOpen(r.status)).length, universe: Math.min(rows.length, 2000), freshness: live }; } },
  { id: 'my-work', title: 'My work', allowed: () => true, drill: '/my-work', load: async x => { const s = await workOrg(x.c, x.org, x.user, x.access, {}, x.today); return { value: s.reduce((n, e) => n + e.entries.length, 0), universe: 0, freshness: live }; } },
];
export const tileById = (tid: string) => TILES.find(t => t.id === tid);
export function drillPath(t: TileDef, orgId: string) { const [p, qs] = t.drill.split('?'); return p === '/my-work' ? `/my-work?orgId=${orgId}` : `/org/${orgId}${p}${qs ? '?' + qs : ''}`; }
export async function loadTile(t: TileDef, x: Ctx) {
  const r = await t.load(x); const empty = r.universe === 0 && (r.value ?? 0) === 0 && t.id !== 'my-work' || (t.id === 'my-work' && r.value === 0);
  return { id: t.id, title: t.title, value: r.value, unit: r.unit ?? null, detail: r.detail ?? null, empty, drill: drillPath(t, x.org.id), freshness: r.freshness ?? live };
}
