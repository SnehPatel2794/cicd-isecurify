// Policy rules: PURE functions (no I/O, no clock) so every rule is testable and the routes stay thin.
//   A policy has numbered versions. A version is drafted, submitted, then published by a DIFFERENT person than its author.
//   Publishing a version supersedes the previous one; people in the audience acknowledge the version that is live.
export const CATEGORIES = ['security', 'privacy', 'hr', 'operations', 'compliance', 'other'] as const; export type Category = typeof CATEGORIES[number];
export const AUDIENCES = ['staff', 'everyone'] as const; export type Audience = typeof AUDIENCES[number];
export const VSTATUSES = ['draft', 'in_review', 'published', 'superseded'] as const; export type VStatus = typeof VSTATUSES[number];
export const VSTATUS_LABEL: Record<VStatus, string> = { draft: 'Draft', in_review: 'In review', published: 'Published', superseded: 'Superseded' };
export const AUDIENCE_LABEL: Record<Audience, string> = { staff: 'Client admins and staff', everyone: 'Everyone, including vendors' };
export const AUDIENCE_ROLES: Record<Audience, string[]> = { staff: ['client_admin', 'client_staff'], everyone: ['client_admin', 'client_staff', 'third_party_vendor'] };
export const MAX_BODY = 50000;

export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
const auditor = (w: Who) => w.via === 'member' && w.role === 'tp_auditor'; const clientAdmin = (w: Who) => w.via === 'member' && w.role === 'client_admin'; const staffMgr = (w: Who) => w.via === 'staff' && w.manage;
/** Write policies: create, edit drafts, submit, archive. */
export const canManage = (w: Who) => clientAdmin(w) || staffMgr(w);
/** Approve (publish) or send back a version: a manager who is not its author. */
export const canApprove = (w: Who, isAuthor: boolean) => canManage(w) && !isAuthor;
/** See drafts, history and who has acknowledged. */
export const canReadAll = (w: Who) => canManage(w) || auditor(w);
/** Must this member acknowledge a policy with the given audience? Only organization members do, never iSecurify staff. */
export const appliesTo = (w: Who, audience: Audience) => w.via === 'member' && AUDIENCE_ROLES[audience].includes(w.role);

export type Check = { ok: true } | { ok: false; status: 400 | 403 | 409; code: string; message: string };
const no = (status: 400 | 403 | 409, code: string, message: string): Check => ({ ok: false, status, code, message });

/** Status changes of a version. `to` is 'in_review' (submit), 'draft' (send back or withdraw) or 'published'. */
export function versionCheck(from: VStatus, to: VStatus, w: Who, isAuthor: boolean, note: string | null | undefined, archived: boolean): Check {
  if (archived) return no(409, 'archived', 'This policy is archived. Restore it first');
  const n = (note ?? '').trim();
  if (from === 'draft' && to === 'in_review') return canManage(w) ? { ok: true } : no(403, 'forbidden', 'Only client admins and managing staff can submit a policy for approval');
  if (from === 'in_review' && to === 'draft') {
    if (isAuthor && canManage(w)) return { ok: true };                                    // withdraw
    if (!canApprove(w, isAuthor)) return no(403, 'forbidden', 'Only the author or another client admin or managing staff member can send this version back');
    return n ? { ok: true } : no(400, 'note_required', 'Say what needs to change');
  }
  if (from === 'in_review' && to === 'published') {
    if (!canManage(w)) return no(403, 'forbidden', 'Only client admins and managing staff can publish a policy');
    if (isAuthor) return no(403, 'self_review', 'You cannot publish a version you wrote: someone else must');
    return { ok: true };
  }
  return no(409, 'bad_transition', `A ${VSTATUS_LABEL[from].toLowerCase()} version cannot become ${VSTATUS_LABEL[to].toLowerCase()}`);
}
export const versionTargets = (from: VStatus, w: Who, isAuthor: boolean, archived: boolean): VStatus[] => (['in_review', 'draft', 'published'] as VStatus[]).filter(to => versionCheck(from, to, w, isAuthor, 'x', archived).ok);

/** Body of a version must be non-empty and within the limit. */
export const bodyCheck = (body: string): Check => { const b = body.trim(); if (!b) return no(400, 'body_required', 'The policy text cannot be empty'); if (b.length > MAX_BODY) return no(400, 'too_long', `The policy text is limited to ${MAX_BODY} characters`); return { ok: true }; };

/** today + n calendar months, clamped to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number); const t = (y * 12 + (m - 1)) + n; const ny = Math.floor(t / 12), nm = t % 12; const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const reviewOverdue = (nextReview: string | null, today: string) => !!nextReview && nextReview < today;
export const reviewSoon = (nextReview: string | null, today: string, days = 30) => !!nextReview && nextReview >= today && nextReview <= new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

export type PolicyFacts = { archived: boolean; liveVersionNo: number | null; nextReviewDate: string | null; draftStatus: VStatus | null; required: number; acknowledged: number };
export function summarize(rows: PolicyFacts[], today: string) {
  const out = { total: 0, published: 0, neverPublished: 0, inReview: 0, drafts: 0, reviewOverdue: 0, reviewSoon: 0, fullyAcknowledged: 0, acknowledgementsPending: 0, archived: 0 };
  for (const p of rows) { if (p.archived) { out.archived++; continue; } out.total++; if (p.liveVersionNo === null) out.neverPublished++; else { out.published++; if (reviewOverdue(p.nextReviewDate, today)) out.reviewOverdue++; else if (reviewSoon(p.nextReviewDate, today)) out.reviewSoon++; if (p.required > 0 && p.acknowledged >= p.required) out.fullyAcknowledged++; out.acknowledgementsPending += Math.max(0, p.required - p.acknowledged); }
    if (p.draftStatus === 'in_review') out.inReview++; else if (p.draftStatus === 'draft') out.drafts++; }
  return out;
}
