// Search, My Work and the activity timeline for ONE organization, for ONE caller (Phase 10G).
// Nothing here widens access: every list comes from the same data function (with the same visibility arguments) that the module's own screen uses, and only then is it filtered by text.
// Results are built only from rows the caller may already read, so there is nothing to leak: no titles, snippets or counts from anything else.
import type { Conn } from '../../db'; import * as eng from '../engagements/data'; import { scopeOf } from '../engagements/access'; import { evalRow } from '../engagements/evaluation';
import * as td from '../tasks/data'; import * as fd from '../findings/data'; import * as fr from '../findings/rules'; import * as rd from '../risks/data'; import * as rr from '../risks/rules'; import * as id from '../incidents/data'; import * as ir from '../incidents/rules';
import * as vd from '../vendors/data'; import * as vr from '../vendors/rules'; import * as pd from '../policies/data'; import * as pr from '../policies/rules'; import * as ed from '../evidence/data'; import * as er from '../evidence/rules';
import { queryAudit } from '../audit/data'; import * as sd from './data'; import { hit, rank, snippet, humanize, TYPES, type Filters, type ResultType } from './rules';
export type Access = { via: 'member' | 'staff'; role: string; manage: boolean; readEvidence: boolean };
export type Org = { id: string; name: string }; export type User = { id: string };
const refOf = (p: string, n: number) => `${p}-${String(n).padStart(3, '0')}`; const MAX_ENG = 1000, SECTION_CAP = 50;
const base = (o: Org) => `/org/${o.id}`;

/** The engagements the caller may see, narrowed by the engagement and framework filters. */
async function visibleEngagements(c: Conn, org: Org, scope: eng.Scope, f: Filters) {
  let list = (await eng.listEngagements(c, org.id, scope)).slice(0, MAX_ENG); if (f.engagementId) list = list.filter((e: any) => e.id === f.engagementId);
  if (f.frameworkId && list.length) { const fw = await eng.engagementFrameworksFor(c, org.id, list.map((e: any) => e.id)); list = list.filter((e: any) => (fw.get(e.id) ?? []).some((x: any) => x.frameworkId === f.frameworkId)); }
  return list as any[];
}
export type Result = { type: ResultType; id: string; ref: string; title: string; snippet: string | null; status: string | null; owner: string | null; engagementId: string | null; engagementName: string | null; orgId: string; orgName: string; path: string; rank: number };

export async function searchOrg(c: Conn, org: Org, user: User, access: Access, term: string, f: Filters, o: { type?: ResultType; limit: number }) {
  const w = { via: access.via, role: access.role, manage: access.manage }; const scope = scopeOf(access, user.id); const engs = await visibleEngagements(c, org, scope, f); const byId = new Map<string, any>(engs.map(e => [e.id, e]));
  const engBound = !!(f.engagementId || f.frameworkId); const want = (t: ResultType) => !o.type || o.type === t; const ownerOk = (x: unknown) => !f.ownerId || x === f.ownerId; const statusOk = (x: unknown) => !f.status || x === f.status;
  const out: Result[] = []; const mk = (r: Omit<Result, 'orgId' | 'orgName' | 'rank'>) => out.push({ ...r, orgId: org.id, orgName: org.name, rank: rank(term, r.ref, r.title) });
  const engOf = (id: string) => byId.get(id); const where = (id: string) => ({ engagementId: id, engagementName: engOf(id)?.name ?? null });
  const jobs: Promise<void>[] = [];
  if (want('engagement') && !f.ownerId) jobs.push((async () => { for (const e of engs) if (statusOk(e.status) && hit(term, e.name, e.clientRef)) mk({ type: 'engagement', id: e.id, ref: e.clientRef ?? '', title: e.name, snippet: null, status: e.status, owner: null, ...where(e.id), path: `${base(org)}/engagements/${e.id}` }); })());
  if (want('item')) jobs.push((async () => { const rows = await sd.searchItems(c, org.id, term, engs.map(e => e.id), { assignedUserId: scope.kind === 'assigned' ? scope.userId : undefined, limit: 200 });
    for (const r of rows) if (ownerOk(r.ownerUserId) && statusOk(r.status)) mk({ type: 'item', id: r.id, ref: r.ref, title: r.title, snippet: snippet(r.description, term) ?? snippet(r.domain, term), status: r.status, owner: r.ownerName ?? null, ...where(r.engagementId), path: `${base(org)}/engagements/${r.engagementId}?item=${r.id}` }); })());
  if (want('finding')) jobs.push((async () => { const rows = await fd.listOrgFindings(c, org.id, scope as any, {}); for (const r of rows.slice(0, 2000)) { if (!byId.has(r.engagementId) || !ownerOk(r.ownerUserId) || !statusOk(r.status)) continue; const ref = refOf('F', r.findingNo);
      if (hit(term, ref, r.title, r.description, r.itemRef)) mk({ type: 'finding', id: r.id, ref, title: r.title, snippet: snippet(r.description, term), status: r.status, owner: r.ownerName ?? null, ...where(r.engagementId), path: `${base(org)}/findings?focus=${r.id}` }); } })());
  const orgWide = (t: ResultType) => want(t) && !engBound;
  if (orgWide('risk')) jobs.push((async () => { const all = rr.canSeeAll(w); const rows = await rd.listRisks(c, org.id, { ownerUserId: all ? undefined : user.id }); for (const r of rows.slice(0, 2000)) { const ref = refOf('R', r.riskNo); if (ownerOk(r.ownerUserId) && statusOk(r.status) && hit(term, ref, r.title, r.description, r.category)) mk({ type: 'risk', id: r.id, ref, title: r.title, snippet: snippet(r.description, term), status: r.status, owner: r.ownerName ?? null, engagementId: null, engagementName: null, path: `${base(org)}/risks?focus=${r.id}` }); } })());
  if (orgWide('incident')) jobs.push((async () => { const all = ir.canSeeAll(w); const rows = await id.listIncidents(c, org.id, { userId: all ? undefined : user.id }); for (const r of rows.slice(0, 2000)) { const ref = refOf('INC', r.incidentNo); if (ownerOk(r.ownerUserId) && statusOk(r.status) && hit(term, ref, r.title, r.description, r.category)) mk({ type: 'incident', id: r.id, ref, title: r.title, snippet: snippet(r.description, term), status: r.status, owner: r.ownerName ?? null, engagementId: null, engagementName: null, path: `${base(org)}/incidents?focus=${r.id}` }); } })());
  if (orgWide('vendor')) jobs.push((async () => { const all = vr.canSeeAll(w); if (!all && w.role !== 'third_party_vendor') return; const rows = await vd.listVendors(c, org.id, { contactUserId: all ? undefined : user.id }); for (const r of rows.slice(0, 2000)) { const ref = refOf('V', r.vendorNo); if (ownerOk(r.ownerUserId) && statusOk(r.status) && hit(term, ref, r.name, r.service, r.category)) mk({ type: 'vendor', id: r.id, ref, title: r.name, snippet: snippet(r.service, term), status: r.status, owner: r.ownerName ?? null, engagementId: null, engagementName: null, path: `${base(org)}/vendors?focus=${r.id}` }); } })());
  if (orgWide('policy')) jobs.push((async () => { const all = pr.canReadAll(w); const [rows, vs] = await Promise.all([pd.listPolicies(c, org.id), pd.versionSummaries(c, org.id)]);
    for (const r of rows.slice(0, 2000)) { const live = vs.find((v: any) => v.policyId === r.id && v.status === 'published'); if (!all && (!live || r.archivedAt || !pr.appliesTo(w, r.audience))) continue; const status = r.archivedAt ? 'archived' : live ? 'published' : 'draft'; const ref = refOf('POL', r.policyNo);
      if (ownerOk(r.ownerUserId) && statusOk(status) && hit(term, ref, r.title, r.category)) mk({ type: 'policy', id: r.id, ref, title: r.title, snippet: null, status, owner: r.ownerName ?? null, engagementId: null, engagementName: null, path: `${base(org)}/policies?focus=${r.id}` }); } })());
  await Promise.all(jobs); return out;
}
/** Group, order and cap raw results: best matches first within each type; `more` says a type had further hits that were cut off. */
export function arrange(results: Result[], limit: number, type?: ResultType) {
  const groups: { type: ResultType; results: Omit<Result, 'rank'>[]; more: boolean }[] = [];
  for (const t of TYPES) { if (type && t !== type) continue; const rs = results.filter(r => r.type === t).sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)); if (!rs.length) continue; groups.push({ type: t, results: rs.slice(0, limit).map(({ rank: _r, ...x }) => x), more: rs.length > limit }); }
  return groups;
}

// ---------------------------------------------------------------- My Work
export type Entry = { id: string; ref: string; title: string; status: string | null; dueDate: string | null; overdue: boolean; engagementId: string | null; engagementName: string | null; path: string };
export type Section = { key: string; title: string; kind: 'item' | 'action' | 'review'; entries: Entry[]; more: boolean };
const inPeriod = (due: string | null, f: Filters) => (!f.from && !f.to) || (!!due && (!f.from || due >= f.from) && (!f.to || due <= f.to));
export async function workOrg(c: Conn, org: Org, user: User, access: Access, f: Filters, today: string): Promise<Section[]> {
  const w = { via: access.via, role: access.role, manage: access.manage }; const mine: eng.Scope = { kind: 'assigned', userId: user.id }; const sections: Section[] = [];
  const put = (key: string, title: string, kind: Section['kind'], all: Entry[]) => { const entries = all.filter(e => inPeriod(e.dueDate, f)); if (entries.length) sections.push({ key, title, kind, entries: entries.slice(0, SECTION_CAP), more: entries.length > SECTION_CAP }); };
  const active = (await visibleEngagements(c, org, mine, f)).filter(e => e.status === 'active').slice(0, 50); const name = new Map(active.map(e => [e.id, e.name]));
  const items: Entry[] = [], requests: Entry[] = [];
  for (const e of active) {
    for (const i of await eng.listItems(c, org.id, e.id, mine, today)) { const ev = evalRow(i, today); if (ev.state === 'effective' || ev.state === 'not_applicable') continue; if (f.status && ev.state !== f.status) continue; items.push({ id: i.id, ref: i.ref, title: i.title, status: ev.state, dueDate: i.dueDate ?? null, overdue: ev.overdue, engagementId: e.id, engagementName: e.name, path: `${base(org)}/engagements/${e.id}?item=${i.id}` }); }
    for (const r of await ed.listRequests(c, org.id, e.id, { assignedUserId: user.id })) if (r.status === 'requested' || r.status === 'rejected') requests.push({ id: r.id, ref: r.itemRef ?? '', title: r.title, status: r.status, dueDate: r.dueDate ?? null, overdue: !!r.dueDate && r.dueDate < today, engagementId: e.id, engagementName: e.name, path: `${base(org)}/engagements/${e.id}?item=${r.itemId}` });
  }
  const byDue = (a: Entry, b: Entry) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title);
  put('items', 'Checklist items assigned to me', 'item', items.sort(byDue)); put('evidence', 'Evidence I need to provide', 'action', requests.sort(byDue));
  const tasks = (await td.openFor(c, org.id, user.id)).filter((r: any) => (!f.engagementId || r.engagementId === f.engagementId)).map((r: any): Entry => ({ id: r.id, ref: refOf('T', r.taskNo), title: r.title, status: r.status, dueDate: r.dueDate ?? null, overdue: !!r.dueDate && r.dueDate < today, engagementId: r.engagementId, engagementName: r.engagementName ?? null, path: `${base(org)}/engagements/${r.engagementId}?tab=tasks&task=${r.id}` }));
  put('tasks', 'Tasks assigned to me', 'action', tasks.filter(t => !f.status || t.status === f.status));
  // reviews waiting
  const scope = scopeOf(access, user.id); const viewable = (await visibleEngagements(c, org, scope, f)).filter(e => e.status === 'active'); const vname = new Map(viewable.map(e => [e.id, e.name]));
  if (er.canReview(access)) { const rows = await sd.submittedEvidence(c, org.id, viewable.map(e => e.id), 200); put('review_evidence', 'Evidence waiting for my review', 'review', rows.map(r => ({ id: r.id, ref: r.itemRef, title: r.title, status: 'submitted', dueDate: r.dueDate, overdue: !!r.dueDate && r.dueDate < today, engagementId: r.engagementId, engagementName: vname.get(r.engagementId) ?? null, path: `${base(org)}/engagements/${r.engagementId}?item=${r.itemId}` }))); }
  const fshape = (r: any): Entry => ({ id: r.id, ref: refOf('F', r.findingNo), title: r.title, status: r.status, dueDate: r.dueDate ?? null, overdue: !!r.dueDate && r.dueDate < today && ['open', 'in_remediation', 'ready_for_retest'].includes(r.status), engagementId: r.engagementId, engagementName: r.engagementName ?? null, path: `${base(org)}/findings?focus=${r.id}` });
  if (fr.canAssess(w)) put('review_retest', 'Findings waiting for my re-test', 'review', (await fd.listOrgFindings(c, org.id, scope as any, { awaitingRetest: true })).filter((r: any) => vname.has(r.engagementId)).map(fshape));
  if (pr.canManage(w)) { const [ps, vs] = await Promise.all([pd.listPolicies(c, org.id), pd.versionSummaries(c, org.id)]); put('review_policy', 'Policies waiting for my approval', 'review', vs.filter((v: any) => v.status === 'in_review' && pr.canApprove(w, v.authorId === user.id)).map((v: any) => { const p = ps.find((x: any) => x.id === v.policyId); return { id: v.policyId, ref: refOf('POL', p?.policyNo ?? 0), title: p?.title ?? 'Policy', status: 'in_review', dueDate: null, overdue: false, engagementId: null, engagementName: null, path: `${base(org)}/policies?focus=${v.policyId}` }; })); }
  // my actions
  put('findings', 'Findings I own', 'action', (await fd.listOrgFindings(c, org.id, scope as any, { mineUserId: user.id, unresolved: true })).filter((r: any) => !(f.engagementId || f.frameworkId) || vname.has(r.engagementId)).filter((r: any) => !f.status || r.status === f.status).map(fshape).sort(byDue));
  if (!(f.engagementId || f.frameworkId)) {
    put('risks', 'Risks I own', 'action', (await rd.listRisks(c, org.id, { ownerUserId: user.id })).filter((r: any) => rr.isOpen(r.status) && (!f.status || r.status === f.status)).map((r: any) => ({ id: r.id, ref: refOf('R', r.riskNo), title: r.title, status: r.status, dueDate: r.reviewDate ?? null, overdue: !!r.reviewDate && r.reviewDate < today, engagementId: null, engagementName: null, path: `${base(org)}/risks?focus=${r.id}` })).sort(byDue));
    put('incidents', 'Incidents I own', 'action', (await id.listIncidents(c, org.id, { userId: user.id })).filter((r: any) => r.ownerUserId === user.id && ir.isOpen(r.status) && (!f.status || r.status === f.status)).map((r: any) => ({ id: r.id, ref: refOf('INC', r.incidentNo), title: r.title, status: r.status, dueDate: null, overdue: false, engagementId: null, engagementName: null, path: `${base(org)}/incidents?focus=${r.id}` })));
    if (pr.appliesTo(w, 'everyone') || pr.appliesTo(w, 'staff')) { const [ps, vs, acks] = await Promise.all([pd.listPolicies(c, org.id), pd.versionSummaries(c, org.id), pd.ackCounts(c, org.id)]);
      put('acks', 'Policies I need to acknowledge', 'action', ps.filter((p: any) => !p.archivedAt && pr.appliesTo(w, p.audience)).map((p: any) => ({ p, live: vs.find((v: any) => v.policyId === p.id && v.status === 'published') })).filter((x: any) => x.live && !acks.some((a: any) => a.versionId === x.live.id && a.userId === user.id)).map((x: any) => ({ id: x.p.id, ref: refOf('POL', x.p.policyNo), title: x.p.title, status: 'to_acknowledge', dueDate: null, overdue: false, engagementId: null, engagementName: null, path: `${base(org)}/policies?focus=${x.p.id}` }))); }
  }
  void name; return sections;
}

// ---------------------------------------------------------------- timeline
/** Administrators, managing staff and auditors see everything in the organization; everyone else sees only what they did themselves. */
export const sees = (a: { manage: boolean; role: string }) => a.manage || a.role === 'tp_auditor';
export async function timelineOrg(c: Conn, org: Org, user: User, access: Access, f: Filters, o: { beforeId?: number; limit: number; entity?: string }) {
  if (f.ownerId && !sees(access) && f.ownerId !== user.id) return { items: [], nextBeforeId: null };
  const actorId = sees(access) ? f.ownerId : user.id; const from = f.from ? new Date(`${f.from}T00:00:00.000Z`) : undefined, to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : undefined;
  const r = await queryAudit(c, { tenantId: org.id, actorId, from, to, engagementId: f.engagementId, entity: o.entity, beforeId: o.beforeId, limit: o.limit });
  return { items: r.items.map((x: any) => { const d = typeof x.detail === 'string' ? safe(x.detail) : x.detail; const engagementId = x.entity === 'engagement' ? x.entity_id : (d?.engagementId ?? null);
    return { id: x.id, at: x.created_at, actor: x.actor_id ? { id: x.actor_id, name: x.actor_name ?? null } : null, action: x.action, label: humanize(x.action), entity: x.entity, entityId: x.entity_id, engagementId, path: engagementId ? `${base(org)}/engagements/${engagementId}` : null }; }), nextBeforeId: r.nextBeforeId };
}
const safe = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
