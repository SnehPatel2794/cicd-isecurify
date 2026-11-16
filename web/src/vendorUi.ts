// Pure helpers for the vendor risk screens.
import type { Tone } from './kit';
export const TIER_TONE: Record<string, Tone> = { low: 'green', medium: 'amber', high: 'red', critical: 'red' };
export const STATUS_TONE: Record<string, Tone> = { onboarding: 'slate', active: 'green', offboarding: 'amber', offboarded: 'slate' };
export const RATING_TONE: Record<string, Tone> = { good: 'green', fair: 'amber', poor: 'red' };
export const CATEGORY_LABEL: Record<string, string> = { cloud: 'Cloud', software: 'Software', professional_services: 'Professional services', data_processing: 'Data processing', infrastructure: 'Infrastructure', hardware: 'Hardware', other: 'Other' };
export const CRITICALITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const DATA_LABEL: Record<string, string> = { none: 'No access to our data', internal: 'Internal data', confidential: 'Confidential data', personal: 'Personal data', regulated: 'Regulated data' };
export const ASSESSMENT_LABEL: Record<string, string> = { draft: 'Waiting for answers', submitted: 'Waiting for review', approved: 'Approved', rejected: 'Rejected' };
export const ANSWER_LABEL: Record<string, string> = { yes: 'Yes', partial: 'Partly', no: 'No', na: 'Not applicable' };
export const TO_LABEL: Record<string, string> = { active: 'Activate', offboarding: 'Start offboarding', offboarded: 'Mark offboarded' };
export type Question = { id: string; domain: string; text: string; weight: number };
/** Questions grouped by domain in questionnaire order. */
export function byDomain(questions: Question[]): { domain: string; questions: Question[] }[] { const out: { domain: string; questions: Question[] }[] = []; for (const q of questions) { let g = out.find(x => x.domain === q.domain); if (!g) { g = { domain: q.domain, questions: [] }; out.push(g); } g.questions.push(q); } return out; }
export type Answers = Record<string, { answer: string; note?: string | null }>;
export const answeredCount = (answers: Answers, questions: Question[]) => questions.filter(q => answers[q.id]?.answer).length;
/** Why Submit is not available yet, or null when it is. */
export function submitBlock(answers: Answers, questions: Question[]): string | null { const missing = questions.length - answeredCount(answers, questions); if (missing) return `${missing} question${missing === 1 ? '' : 's'} left to answer`; if (questions.some(q => answers[q.id]?.answer === 'na' && !(answers[q.id]?.note ?? '').trim())) return 'Explain each "not applicable" answer'; return null; }
export const scoreText = (score: number | null | undefined, rating: string | null | undefined) => score == null ? 'Not scored yet' : `${score}/100 · ${rating ?? ''}`.trim();
export const dueText = (date: string | null, today: string) => !date ? '' : date < today ? `Overdue since ${date}` : `Due ${date}`;
