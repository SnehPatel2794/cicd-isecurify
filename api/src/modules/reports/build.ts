// Assembles everything a report or workbook needs into one plain object, using the same data functions (and so the same scoping) as the screens.
// The renderers (pdf.ts, xlsx.ts) only draw this object; they never query.
import type { Conn } from '../../db'; import * as d from '../engagements/data'; import * as f from '../findings/data'; import * as e from '../evidence/data';
import { evalRow, summarize, STATE_LABEL, type Summary } from '../engagements/evaluation'; import { isExpired } from '../evidence/rules'; import { STATUS_LABEL } from '../findings/rules';
export const LIMITS = { items: 5000, soa: 5000, findings: 2000, evidence: 2000 };
export class ReportTooLarge extends Error { constructor(public what: string, public limit: number) { super(`This engagement has more than ${limit} ${what}; export is limited to ${limit}`); } }
const ref = (n: number) => `F-${String(n).padStart(3, '0')}`;
export type ReportData = ReturnType<typeof shape>;
function shape(x: any) { return x as {
  meta: { reportId: string; generatedAt: string; today: string; generatedBy: string; organization: string };
  engagement: { name: string; clientRef: string | null; status: string; phase: number; phaseName: string; startDate: string | null; endDate: string | null; documentNumber: string | null; documentOwner: string | null; classification: string | null; documentVersion: string | null; reviewCycle: string | null; clientAddress: string | null; frameworks: { name: string; version: number; primary: boolean }[] };
  summary: Summary; stateLabels: Record<string, string>;
  items: { ref: string; domain: string; title: string; readiness: string; evidence: string; state: string; stateLabel: string; owner: string | null; dueDate: string | null; overdue: boolean; naJustification: string | null; remarks: string | null; controls: string }[];
  soa: { framework: string; ref: string; domain: string; title: string; applicable: boolean; justification: string | null }[] | null;
  findings: { ref: string; itemRef: string; title: string; severity: string; status: string; statusLabel: string; owner: string | null; dueDate: string | null; raisedBy: string | null; raisedOn: string; closedOn: string | null; description: string; recommendation: string | null; remediationPlan: string | null }[];
  evidence: { itemRef: string; title: string; status: string; dueDate: string | null; validUntil: string | null; expired: boolean; versions: number; kind: string | null; fileName: string | null; sizeBytes: number | null; sha256: string | null; uploadedBy: string | null; uploadedAt: string | null; scan: string | null }[];
  counts: { items: number; findings: number; evidence: number; soa: number } }; }
const iso = (v: any) => (v ? new Date(v).toISOString() : null);

export async function buildReport(c: Conn, o: { tenantId: string; engagement: any; scope: d.Scope; today: string; reportId: string; generatedBy: string; organization: string; includeSoa: boolean }): Promise<ReportData> {
  const { tenantId, engagement: eng, scope, today } = o;
  const [fw, rows, sat, soa, findings, requests] = await Promise.all([d.engagementFrameworks(c, tenantId, eng.id), d.listItems(c, tenantId, eng.id, scope, today), d.satisfiesFor(c, tenantId, eng.id), o.includeSoa ? d.listSoa(c, tenantId, eng.id) : Promise.resolve(null),
    f.listFindings(c, tenantId, eng.id, {}), e.listRequests(c, tenantId, eng.id, {})]);
  if (rows.length > LIMITS.items) throw new ReportTooLarge('checklist items', LIMITS.items); if (soa && soa.length > LIMITS.soa) throw new ReportTooLarge('statement-of-applicability entries', LIMITS.soa);
  if (findings.length > LIMITS.findings) throw new ReportTooLarge('findings', LIMITS.findings); if (requests.length > LIMITS.evidence) throw new ReportTooLarge('evidence requests', LIMITS.evidence);
  const by = new Map<string, string[]>(); for (const s of sat) { const k = s.itemId as string; (by.get(k) ?? by.set(k, []).get(k)!).push(`${s.frameworkName} ${s.ref}`); }
  const evaluated = rows.map((r: any) => ({ r, ev: evalRow(r, today) }));
  const items = evaluated.map(({ r, ev }: any) => ({ ref: r.ref, domain: r.domain, title: r.title, readiness: r.readiness, evidence: r.evidence, state: ev.state, stateLabel: ev.stateLabel, owner: r.accountableName ?? null, dueDate: r.dueDate ?? null, overdue: ev.overdue, naJustification: r.naJustification ?? null, remarks: r.remarks ?? null, controls: (by.get(r.id) ?? []).join('; ') }));
  const summary = summarize(rows.map((r: any) => ({ readiness: r.readiness, evidence: r.evidence, evidenceExpired: !!r.evidenceExpired, blockingFindings: !!r.blockingFindings, allControlsNotApplicable: r.linkCount > 0 && Number(r.naLinks) === Number(r.linkCount), dueDate: r.dueDate })), today);
  const out = {
    meta: { reportId: o.reportId, generatedAt: new Date().toISOString(), today, generatedBy: o.generatedBy, organization: o.organization },
    engagement: { name: eng.name, clientRef: eng.clientRef ?? null, status: eng.status, phase: eng.currentPhase, phaseName: d.PHASE_NAMES[eng.currentPhase - 1] ?? '', startDate: eng.startDate ?? null, endDate: eng.endDate ?? null, documentNumber: eng.documentNumber ?? null, documentOwner: eng.documentOwner ?? null, classification: eng.classification ?? null, documentVersion: eng.documentVersion ?? null, reviewCycle: eng.reviewCycle ?? null, clientAddress: eng.clientAddress ?? null, frameworks: fw.map((x: any) => ({ name: x.name, version: x.version, primary: !!x.isPrimary })) },
    summary, stateLabels: STATE_LABEL as any, items,
    soa: soa ? soa.map((s: any) => ({ framework: s.frameworkName, ref: s.ref, domain: s.domain, title: s.title, applicable: !!s.applicable, justification: s.justification ?? null })) : null,
    findings: findings.map((x: any) => ({ ref: ref(x.findingNo), itemRef: x.itemRef, title: x.title, severity: x.severity, status: x.status, statusLabel: (STATUS_LABEL as any)[x.status] ?? x.status, owner: x.ownerName ?? null, dueDate: x.dueDate ?? null, raisedBy: x.raisedByName ?? null, raisedOn: iso(x.createdAt)!.slice(0, 10), closedOn: x.closedAt ? iso(x.closedAt)!.slice(0, 10) : null, description: x.description, recommendation: x.recommendation ?? null, remediationPlan: x.remediationPlan ?? null })),
    evidence: requests.map((r: any) => ({ itemRef: r.itemRef, title: r.title, status: r.status, dueDate: r.dueDate ?? null, validUntil: r.validUntil ?? null, expired: r.status === 'accepted' && isExpired(r.validUntil, today), versions: r.latestVersionNo, kind: r.latestKind ?? null, fileName: r.latestKind === 'link' ? `(link: ${r.latestProvider ?? 'external'})` : (r.latestFileName ?? null), sizeBytes: r.latestSize ?? null, sha256: r.latestSha256 ?? null, uploadedBy: r.latestBy ?? null, uploadedAt: iso(r.latestAt), scan: r.latestScan ?? null })),
    counts: { items: items.length, findings: findings.length, evidence: requests.length, soa: soa?.length ?? 0 },
  };
  return shape(out);
}
