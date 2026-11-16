// Vendor risk rules: PURE functions (no I/O, no clock). The questionnaire is fixed in code (version 1) so scores stay comparable over time.
export const CATEGORIES = ['cloud', 'software', 'professional_services', 'data_processing', 'infrastructure', 'hardware', 'other'] as const; export type Category = typeof CATEGORIES[number];
export const CRITICALITY = ['low', 'medium', 'high', 'critical'] as const; export type Criticality = typeof CRITICALITY[number];
export const DATA_ACCESS = ['none', 'internal', 'confidential', 'personal', 'regulated'] as const; export type DataAccess = typeof DATA_ACCESS[number];
export const STATUSES = ['onboarding', 'active', 'offboarding', 'offboarded'] as const; export type VStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<VStatus, string> = { onboarding: 'Onboarding', active: 'Active', offboarding: 'Offboarding', offboarded: 'Offboarded' };
export const DATA_LABEL: Record<DataAccess, string> = { none: 'No access to our data', internal: 'Internal data', confidential: 'Confidential data', personal: 'Personal data', regulated: 'Regulated data' };
export const TIERS = ['low', 'medium', 'high', 'critical'] as const; export type Tier = typeof TIERS[number];
/** Inherent risk tier = how much we depend on the vendor x how sensitive the data it can reach. 1-3 low, 4-8 medium, 9-14 high, 15+ critical. */
export const tierOf = (c: Criticality, d: DataAccess): Tier => { const s = (CRITICALITY.indexOf(c) + 1) * (DATA_ACCESS.indexOf(d) + 1); return s <= 3 ? 'low' : s <= 8 ? 'medium' : s <= 14 ? 'high' : 'critical'; };
/** Months between assessments, by tier. */
export const REVIEW_MONTHS: Record<Tier, number> = { critical: 6, high: 12, medium: 24, low: 36 };
export const addMonths = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last)); return t.toISOString().slice(0, 10); };
export const nextReview = (tier: Tier, decidedOn: string) => addMonths(decidedOn, REVIEW_MONTHS[tier]);
export const reviewOverdue = (status: VStatus, reviewDate: string | null, today: string) => (status === 'active' || status === 'onboarding') && !!reviewDate && reviewDate < today;
export const contractEnding = (status: VStatus, contractEnd: string | null, today: string, withinDays = 60) => status === 'active' && !!contractEnd && contractEnd >= today && contractEnd <= new Date(Date.parse(today + 'T00:00:00Z') + withinDays * 86400000).toISOString().slice(0, 10);
export const contractExpired = (status: VStatus, contractEnd: string | null, today: string) => (status === 'active' || status === 'onboarding') && !!contractEnd && contractEnd < today;

// ---------------------------------------------------------------- questionnaire v1
export type Question = { id: string; domain: string; text: string; weight: 1 | 2 | 3 };
export const QUESTIONNAIRE_VERSION = 1;
export const QUESTIONS: Question[] = [
  { id: 'gov1', domain: 'Governance', text: 'Do you have a documented information security policy approved by management and reviewed at least yearly?', weight: 3 },
  { id: 'gov2', domain: 'Governance', text: 'Is someone named as responsible for information security?', weight: 2 },
  { id: 'gov3', domain: 'Governance', text: 'Do you hold a current independent certification or audit report (for example ISO 27001 or SOC 2)?', weight: 3 },
  { id: 'acc1', domain: 'Access control', text: 'Is multi-factor authentication required for administrators and for remote access?', weight: 3 },
  { id: 'acc2', domain: 'Access control', text: 'Is access granted on a least-privilege basis and reviewed at least every six months?', weight: 2 },
  { id: 'acc3', domain: 'Access control', text: 'Is access removed within one working day when people leave or change role?', weight: 2 },
  { id: 'dat1', domain: 'Data protection', text: 'Is our data encrypted in transit and at rest?', weight: 3 },
  { id: 'dat2', domain: 'Data protection', text: 'Is our data separated from other customers\' data?', weight: 2 },
  { id: 'dat3', domain: 'Data protection', text: 'Do you delete or return our data at the end of the contract and confirm that in writing?', weight: 2 },
  { id: 'dat4', domain: 'Data protection', text: 'Do you tell us before using sub-processors that handle our data?', weight: 2 },
  { id: 'ops1', domain: 'Operations', text: 'Are systems patched on a defined schedule, with critical fixes applied within 30 days?', weight: 3 },
  { id: 'ops2', domain: 'Operations', text: 'Do you run independent vulnerability scans or penetration tests at least yearly and fix the findings?', weight: 3 },
  { id: 'ops3', domain: 'Operations', text: 'Are security events logged and monitored, with logs kept for at least 90 days?', weight: 2 },
  { id: 'ops4', domain: 'Operations', text: 'Is malware protection in place on servers and staff devices?', weight: 1 },
  { id: 'inc1', domain: 'Incident response', text: 'Do you have a tested incident response plan?', weight: 2 },
  { id: 'inc2', domain: 'Incident response', text: 'Do you commit to telling us about a breach affecting our data within 72 hours?', weight: 3 },
  { id: 'bcp1', domain: 'Continuity', text: 'Are backups taken regularly and restores tested at least yearly?', weight: 3 },
  { id: 'bcp2', domain: 'Continuity', text: 'Do you have a business continuity and disaster recovery plan with defined recovery times?', weight: 2 },
  { id: 'peo1', domain: 'People', text: 'Are staff background-checked where the law allows and bound by confidentiality?', weight: 1 },
  { id: 'peo2', domain: 'People', text: 'Do staff receive security awareness training at least yearly?', weight: 1 },
  { id: 'dev1', domain: 'Secure development', text: 'Is there a secure development process with code review and separate test and production environments?', weight: 2 },
  { id: 'dev2', domain: 'Secure development', text: 'Are third-party components checked for known vulnerabilities?', weight: 1 },
  { id: 'phy1', domain: 'Physical', text: 'Are facilities and equipment that hold our data physically protected?', weight: 1 },
  { id: 'pri1', domain: 'Privacy', text: 'Do you comply with the data protection laws that apply to our data, and can you support requests from the people it concerns?', weight: 3 },
];
export const QUESTION_IDS = QUESTIONS.map(q => q.id); export const ANSWERS = ['yes', 'partial', 'no', 'na'] as const; export type Answer = typeof ANSWERS[number];
export type AnswerMap = Record<string, { answer: Answer; note?: string | null }>;
const VALUE: Record<Answer, number> = { yes: 1, partial: 0.5, no: 0, na: 0 };
/** Unknown question ids and bad answers are dropped; notes are trimmed and capped. PURE. */
export function cleanAnswers(raw: unknown): AnswerMap {
  const out: AnswerMap = {}; if (!raw || typeof raw !== 'object') return out;
  for (const id of QUESTION_IDS) { const a = (raw as any)[id]; if (!a || typeof a !== 'object' || !(ANSWERS as readonly string[]).includes(a.answer)) continue; const note = typeof a.note === 'string' ? a.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 1000) : ''; out[id] = { answer: a.answer, note: note || null }; }
  return out;
}
export const unanswered = (a: AnswerMap) => QUESTIONS.filter(q => !a[q.id]).map(q => q.id);
/** 0-100: weighted share of applicable questions met (partial counts half). All "not applicable" is not a pass: it scores 0. */
export function scoreOf(a: AnswerMap): number { let got = 0, max = 0; for (const q of QUESTIONS) { const x = a[q.id]; if (!x || x.answer === 'na') continue; max += q.weight; got += q.weight * VALUE[x.answer]; } return max === 0 ? 0 : Math.round(got / max * 100); }
export const RATINGS = ['poor', 'fair', 'good'] as const; export type Rating = typeof RATINGS[number];
export const ratingOf = (score: number): Rating => score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
/** Gaps a reviewer must look at: every "no" on a weight-3 question, then every other "no", then partials on weight 3. Ordered most serious first. */
export function gapsOf(a: AnswerMap) { const g: { id: string; domain: string; text: string; answer: Answer; weight: number; severity: 'high' | 'medium' | 'low' }[] = [];
  for (const q of QUESTIONS) { const x = a[q.id]; if (!x) continue; if (x.answer === 'no') g.push({ id: q.id, domain: q.domain, text: q.text, answer: 'no', weight: q.weight, severity: q.weight === 3 ? 'high' : 'medium' }); else if (x.answer === 'partial' && q.weight === 3) g.push({ id: q.id, domain: q.domain, text: q.text, answer: 'partial', weight: q.weight, severity: 'low' }); }
  const o = { high: 0, medium: 1, low: 2 }; return g.sort((x, y) => o[x.severity] - o[y.severity] || y.weight - x.weight); }
export const domainScores = (a: AnswerMap) => { const ds = [...new Set(QUESTIONS.map(q => q.domain))]; return ds.map(d => { const qs = QUESTIONS.filter(q => q.domain === d); return { domain: d, score: scoreOf(Object.fromEntries(qs.filter(q => a[q.id]).map(q => [q.id, a[q.id]]))) }; }); };

// ---------------------------------------------------------------- who may do what
export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
const auditor = (w: Who) => w.via === 'member' && w.role === 'tp_auditor'; const clientAdmin = (w: Who) => w.via === 'member' && w.role === 'client_admin'; const staffMgr = (w: Who) => w.via === 'staff' && w.manage; const vendorUser = (w: Who) => w.via === 'member' && w.role === 'third_party_vendor';
/** Manage vendors (create, edit, assess, change status): client admins and managing staff. */
export const canManage = (w: Who) => clientAdmin(w) || staffMgr(w);
/** Review (approve, reject) an assessment: the people who manage, and auditors. */
export const canReview = (w: Who) => canManage(w) || auditor(w);
/** See the whole register: managers and auditors. Vendor users see only the vendor they are the contact for. Others see nothing. */
export const canSeeAll = (w: Who) => canReview(w);
export const isVendorSide = vendorUser;
/** Fill in and submit an assessment: the vendor's own contact, or a manager on the vendor's behalf. */
export const canAnswer = (w: Who, isContact: boolean) => canManage(w) || (vendorUser(w) && isContact);

export type Fail = { ok: false; status: number; code: string; message: string }; const no = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });
export const NEXT: Record<VStatus, VStatus[]> = { onboarding: ['active', 'offboarded'], active: ['offboarding'], offboarding: ['active', 'offboarded'], offboarded: [] };
export type VendorFacts = { status: VStatus; tier: Tier; ownerUserId: string | null; contractEnd: string | null; latestApproved: { decidedOn: string } | null };
/** Status changes. Activating needs an owner, a contract that has not already ended, and (for high and critical vendors) an approved assessment. */
export function statusCheck(v: VendorFacts, to: VStatus, w: Who, note: string | null | undefined, today: string): { ok: true } | Fail {
  if (!canManage(w)) return no(403, 'forbidden', 'Only client admins and managing iSecurify staff can change a vendor\'s status');
  if (v.status === to) return no(409, 'unchanged', 'The vendor already has this status'); if (!NEXT[v.status].includes(to)) return no(409, 'bad_transition', `A ${STATUS_LABEL[v.status].toLowerCase()} vendor cannot move to ${STATUS_LABEL[to].toLowerCase()}`);
  if (to === 'active') { if (!v.ownerUserId) return no(422, 'needs_owner', 'Name an owner before activating the vendor'); if (v.contractEnd && v.contractEnd < today) return no(422, 'contract_ended', 'The contract end date has passed: update it first');
    if ((v.tier === 'high' || v.tier === 'critical') && !v.latestApproved) return no(422, 'needs_assessment', 'A high or critical vendor needs an approved security assessment before it can be activated'); }
  if ((to === 'offboarding' || to === 'offboarded') && !(note ?? '').trim()) return no(422, 'needs_note', 'Say why the vendor is being offboarded');
  return { ok: true };
}
export type AssessFacts = { status: 'draft' | 'submitted' | 'approved' | 'rejected'; submittedBy: string | null; answers: AnswerMap };
export function submitCheck(a: AssessFacts, w: Who, isContact: boolean): { ok: true } | Fail {
  if (!canAnswer(w, isContact)) return no(403, 'forbidden', 'Only the vendor\'s contact or a manager can submit this assessment'); if (a.status !== 'draft') return no(409, 'not_draft', 'Only a draft assessment can be submitted');
  const missing = unanswered(a.answers); if (missing.length) return no(422, 'incomplete', `${missing.length} question${missing.length === 1 ? ' is' : 's are'} not answered yet`);
  const noNote = QUESTIONS.filter(q => a.answers[q.id]?.answer === 'na' && !a.answers[q.id]?.note); if (noNote.length) return no(422, 'na_needs_note', 'Explain every "not applicable" answer in its note'); return { ok: true };
}
/** Decide a submitted assessment. Never the person who submitted it. Rejecting or returning needs a reason. */
export function decideCheck(a: AssessFacts, action: 'approve' | 'reject' | 'return', actorId: string, w: Who, note: string | null | undefined): { ok: true } | Fail {
  if (!canReview(w)) return no(403, 'forbidden', 'Only client admins, auditors and managing iSecurify staff can review an assessment'); if (a.status !== 'submitted') return no(409, 'not_submitted', 'Only a submitted assessment can be reviewed');
  if (a.submittedBy === actorId) return no(403, 'self_review', 'You submitted this assessment: someone else must review it'); if (action !== 'approve' && !(note ?? '').trim()) return no(422, 'needs_note', 'Say what needs to change'); return { ok: true };
}
export function startCheck(v: { status: VStatus }, w: Who, hasOpen: boolean): { ok: true } | Fail {
  if (!canManage(w)) return no(403, 'forbidden', 'Only client admins and managing iSecurify staff can request an assessment'); if (v.status === 'offboarded') return no(409, 'offboarded', 'This vendor has been offboarded'); if (hasOpen) return no(409, 'already_open', 'This vendor already has an assessment in progress'); return { ok: true };
}
/** Plain-language list of what needs doing next for a vendor, most urgent first. */
export function attention(v: { status: VStatus; tier: Tier; ownerUserId: string | null; reviewDate: string | null; contractEnd: string | null; openAssessment: 'draft' | 'submitted' | null; latest: { status: string; score: number | null } | null }, today: string): string[] {
  const out: string[] = []; if (v.status === 'offboarded') return out;
  if (contractExpired(v.status, v.contractEnd, today)) out.push('The contract has ended'); else if (contractEnding(v.status, v.contractEnd, today)) out.push('The contract ends within 60 days');
  if (v.openAssessment === 'submitted') out.push('An assessment is waiting for review'); else if (v.openAssessment === 'draft') out.push('An assessment is waiting for answers');
  if (v.status !== 'offboarding' && !v.ownerUserId) out.push('No owner is named');
  if (reviewOverdue(v.status, v.reviewDate, today)) out.push('The assessment is overdue'); else if (!v.latest && !v.openAssessment && v.status !== 'offboarding') out.push('No assessment has been requested yet');
  if (v.latest?.status === 'approved' && (v.latest.score ?? 100) < 60) out.push('Approved with a poor score: follow up on the gaps');
  return out;
}
export type Fact = { status: VStatus; tier: Tier; reviewDate: string | null; contractEnd: string | null; latestScore: number | null; hasApproved: boolean };
export function summarize(vs: Fact[], today: string) {
  const live = vs.filter(v => v.status !== 'offboarded'); const by = (t: Tier) => live.filter(v => v.tier === t).length;
  return { total: vs.length, live: live.length, byTier: { critical: by('critical'), high: by('high'), medium: by('medium'), low: by('low') }, byStatus: Object.fromEntries(STATUSES.map(s => [s, vs.filter(v => v.status === s).length])),
    overdue: live.filter(v => reviewOverdue(v.status, v.reviewDate, today)).length, contractsEnding: live.filter(v => contractEnding(v.status, v.contractEnd, today)).length, contractsExpired: live.filter(v => contractExpired(v.status, v.contractEnd, today)).length,
    unassessed: live.filter(v => !v.hasApproved && v.status !== 'offboarding').length, poor: live.filter(v => v.latestScore !== null && ratingOf(v.latestScore) === 'poor').length };
}
