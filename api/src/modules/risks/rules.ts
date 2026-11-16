// Risk rules: PURE functions (no I/O, no clock) so every rule is testable and the routes stay thin.
export const CATEGORIES = ['strategic', 'operational', 'compliance', 'security', 'privacy', 'vendor', 'financial', 'other'] as const; export type Category = typeof CATEGORIES[number];
export const STATUSES = ['identified', 'treating', 'accepted', 'closed'] as const; export type RStatus = typeof STATUSES[number];
export const TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid'] as const; export type Treatment = typeof TREATMENTS[number];
export const STATUS_LABEL: Record<RStatus, string> = { identified: 'Identified', treating: 'Being treated', accepted: 'Accepted', closed: 'Closed' };
export const LIKELIHOOD_LABEL = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']; export const IMPACT_LABEL = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];
export const MAX_ACCEPT_DAYS = 365;
export const LEVELS = ['low', 'medium', 'high', 'critical'] as const; export type Level = typeof LEVELS[number];
export const scoreOf = (l: number, i: number) => l * i;
/** 1-4 low, 5-9 medium, 10-16 high, 17-25 critical. */
export const levelOf = (score: number): Level => score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 16 ? 'high' : 'critical';
export const isOpen = (s: RStatus) => s === 'identified' || s === 'treating';
export const reviewOverdue = (s: RStatus, reviewDate: string | null, today: string) => s === 'accepted' && !!reviewDate && reviewDate < today;
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
const auditor = (w: Who) => w.via === 'member' && w.role === 'tp_auditor'; const clientAdmin = (w: Who) => w.via === 'member' && w.role === 'client_admin'; const staffMgr = (w: Who) => w.via === 'staff' && w.manage;
/** Describe, rate and re-rate a risk: the people who assess (auditor), client admins and managing staff. */
export const canRate = (w: Who) => auditor(w) || clientAdmin(w) || staffMgr(w);
/** Owner, review date, acceptance: client admins and managing staff. */
export const canAssign = (w: Who) => clientAdmin(w) || staffMgr(w);
/** Choose a treatment, write the plan, start treating: the risk's owner and the people who assign. */
export const canTreat = (w: Who, isOwner: boolean) => isOwner || canAssign(w);
/** Who sees a risk at all: client admins, auditors, managing staff. Others only risks they own. */
export const canSeeAll = (w: Who) => canRate(w);

export type Check = { ok: true } | { ok: false; status: 400 | 403 | 409; code: string; message: string };
const no = (status: 400 | 403 | 409, code: string, message: string): Check => ({ ok: false, status, code, message });
export type RiskFacts = { status: RStatus; treatment: Treatment | null; treatmentPlan: string | null; residualLikelihood: number | null; residualImpact: number | null; reviewDate: string | null };
export type Input = { note?: string | null; treatment?: Treatment | null; residualLikelihood?: number | null; residualImpact?: number | null; reviewDate?: string | null };
export const TRANSITIONS: Record<RStatus, RStatus[]> = { identified: ['treating', 'accepted', 'closed'], treating: ['identified', 'accepted', 'closed'], accepted: ['identified', 'closed'], closed: ['identified'] };
export const allowedTargets = (from: RStatus, w: Who, isOwner: boolean) => TRANSITIONS[from].filter(to => transitionCheck({ status: from, treatment: null, treatmentPlan: 'x', residualLikelihood: 1, residualImpact: 1, reviewDate: '9999-12-31' }, to, w, isOwner, { note: 'x', treatment: to === 'accepted' ? 'accept' : 'mitigate', residualLikelihood: 1, residualImpact: 1, reviewDate: '9999-12-31' }, '1970-01-01').ok);
/** Checks a status change. `r` is the current risk, `inp` what the request supplies; the facts that will hold afterwards are the supplied ones, else the stored ones. */
export function transitionCheck(r: RiskFacts, to: RStatus, w: Who, isOwner: boolean, inp: Input, today: string): Check {
  if (r.status === to) return no(409, 'no_change', 'The risk is already in that status'); if (!TRANSITIONS[r.status].includes(to)) return no(409, 'bad_transition', `A risk cannot go from ${STATUS_LABEL[r.status].toLowerCase()} to ${STATUS_LABEL[to].toLowerCase()}`);
  const note = (inp.note ?? '').trim(); const treatment = inp.treatment === undefined ? r.treatment : inp.treatment; const rl = inp.residualLikelihood === undefined ? r.residualLikelihood : inp.residualLikelihood; const ri = inp.residualImpact === undefined ? r.residualImpact : inp.residualImpact; const review = inp.reviewDate === undefined ? r.reviewDate : inp.reviewDate;
  const who = (ok: boolean, msg: string) => ok ? null : no(403, 'forbidden', msg);
  switch (to) {
    case 'treating': { const f = who(canTreat(w, isOwner), 'Only the risk owner, client admins and managing staff can start treatment'); if (f) return f; if (!treatment || treatment === 'accept') return no(400, 'treatment_required', 'Choose a treatment (mitigate, transfer or avoid) before starting treatment'); if (!(r.treatmentPlan ?? '').trim()) return no(400, 'plan_required', 'Write the treatment plan first'); return { ok: true }; }
    case 'accepted': { const f = who(canAssign(w), 'Only client admins and managing staff can accept a risk'); if (f) return f; if (isOwner) return no(403, 'self_review', 'You cannot accept a risk you own: someone else must'); if (!note) return no(400, 'note_required', 'Explain why the risk is accepted');
      if (rl == null || ri == null) return no(400, 'residual_required', 'Rate the remaining (residual) likelihood and impact first'); if (!review) return no(400, 'review_required', 'Set a date to review the acceptance'); if (review <= today) return no(400, 'review_past', 'The review date must be in the future'); if (days(today, review) > MAX_ACCEPT_DAYS) return no(400, 'review_too_far', `An accepted risk must be reviewed within ${MAX_ACCEPT_DAYS} days`); return { ok: true }; }
    case 'closed': { const f = who(canAssign(w) || auditor(w), 'Only client admins, auditors and managing staff can close a risk'); if (f) return f; if (isOwner) return no(403, 'self_review', 'You cannot close a risk you own: someone else must'); if (!note) return no(400, 'note_required', 'Explain why the risk is closed');
      if (r.status === 'treating' && treatment === 'mitigate' && (rl == null || ri == null)) return no(400, 'residual_required', 'Rate the remaining (residual) likelihood and impact before closing a mitigated risk'); return { ok: true }; }
    case 'identified': { const f = who(canTreat(w, isOwner) || auditor(w), 'You cannot reopen this risk'); if (f) return f; if (!note) return no(400, 'note_required', 'Say why the risk is reopened'); return { ok: true }; }
  }
}
export type EditField = 'title' | 'description' | 'category' | 'likelihood' | 'impact' | 'residual' | 'ownerUserId' | 'reviewDate' | 'treatment' | 'treatmentPlan';
/** Which fields a person may change in the risk's current status. */
export function editCheck(status: RStatus, fields: EditField[], w: Who, isOwner: boolean): Check {
  if (status === 'closed') return no(409, 'closed', 'A closed risk cannot be edited. Reopen it first');
  for (const f of fields) {
    if (['title', 'description', 'category', 'likelihood', 'impact'].includes(f)) { if (!canRate(w)) return no(403, 'forbidden', 'Only client admins, auditors and managing staff can change what the risk is or how it is rated'); if (status === 'accepted' && (f === 'likelihood' || f === 'impact')) return no(409, 'reopen_first', 'An accepted risk cannot be re-rated. Reopen it first so it is accepted again on the new rating'); }
    else if (f === 'ownerUserId' || f === 'reviewDate') { if (!canAssign(w)) return no(403, 'forbidden', 'Only client admins and managing staff can set the owner or the review date'); }
    else if (f === 'treatment' || f === 'treatmentPlan' || f === 'residual') { if (!canTreat(w, isOwner)) return no(403, 'forbidden', 'Only the risk owner, client admins and managing staff can change the treatment'); if (status === 'accepted') return no(409, 'reopen_first', 'An accepted risk cannot be changed. Reopen it first'); }
  }
  return { ok: true };
}
export function summarize(rows: { status: RStatus; likelihood: number; impact: number; residualLikelihood: number | null; residualImpact: number | null; reviewDate: string | null; count?: number }[], today: string) {
  const out = { total: 0, open: 0, byLevel: { low: 0, medium: 0, high: 0, critical: 0 } as Record<Level, number>, residualByLevel: { low: 0, medium: 0, high: 0, critical: 0 } as Record<Level, number>, reviewOverdue: 0, byStatus: { identified: 0, treating: 0, accepted: 0, closed: 0 } as Record<RStatus, number> };
  for (const r of rows) { const n = r.count ?? 1; out.total += n; out.byStatus[r.status] += n; if (r.status === 'closed') continue; if (isOpen(r.status)) out.open += n; out.byLevel[levelOf(scoreOf(r.likelihood, r.impact))] += n; const l = r.residualLikelihood ?? r.likelihood, i = r.residualImpact ?? r.impact; out.residualByLevel[levelOf(scoreOf(l, i))] += n; if (reviewOverdue(r.status, r.reviewDate, today)) out.reviewOverdue += n; }
  return out;
}
/** 5x5 counts, index [likelihood-1][impact-1], for risks that are not closed; `residual` uses the residual rating where one exists. */
export function heatmap(rows: { status: RStatus; likelihood: number; impact: number; residualLikelihood: number | null; residualImpact: number | null }[], residual: boolean) {
  const g = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]); for (const r of rows) { if (r.status === 'closed') continue; const l = residual ? r.residualLikelihood ?? r.likelihood : r.likelihood, i = residual ? r.residualImpact ?? r.impact : r.impact; g[l - 1][i - 1]++; } return g;
}
