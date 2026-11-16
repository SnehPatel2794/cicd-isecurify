// Pure rules for questionnaires (Phase 11E): reading an uploaded sheet, checking an answer, and working out how complete an engagement's questionnaire is.
import { readGrid } from '../frameworks/importer'; import { HttpError } from '../../platform/errors';
export const TYPES = ['yes_no', 'choice', 'multi_choice', 'text', 'number', 'date'] as const; export type AType = typeof TYPES[number];
export const TYPE_LABEL: Record<AType, string> = { yes_no: 'Yes / No', choice: 'Choose one', multi_choice: 'Choose all that apply', text: 'Free text', number: 'Number', date: 'Date' };
export const MAX_QUESTIONS = 1000;
/** Industries a question can be tagged with. Blank = every industry. */
export const INDUSTRIES = ['IT / SaaS', 'BFSI', 'Healthcare', 'Manufacturing', 'Retail / E-commerce', 'Education', 'Telecom', 'Public sector', 'Other'] as const;
const IND_KEY = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Reads an Industries cell ("BFSI | Healthcare", "All", blank). Returns the stored form "|BFSI|Healthcare|" or null for all industries, or an error. */
export function parseIndustries(raw: string): { value: string | null } | { error: string } {
  const parts = raw.split(/[|;,\n]/).map(x => x.trim()).filter(Boolean); if (!parts.length || parts.some(p => ['all', 'any', 'allindustries'].includes(IND_KEY(p)))) return { value: null };
  const out: string[] = []; for (const p of parts) { const hit = INDUSTRIES.find(i => IND_KEY(i) === IND_KEY(p)); if (!hit) return { error: `industry "${p}" is not one of: ${INDUSTRIES.join(', ')} (or leave blank for all)` }; if (!out.includes(hit)) out.push(hit); }
  return { value: '|' + out.join('|') + '|' };
}
export type QIn = { ref: string; section: string; question: string; answerType: AType; choices: string[] | null; required: boolean; helpText: string | null; core: boolean; industries: string | null };
export type QRow = { row: number; data: Partial<QIn>; errors: string[] };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS: Record<string, string[]> = { ref: ['ref', 'refno', 'questionid', 'qno', 'no', 'id', 'number'], section: ['section', 'domain', 'category', 'topic', 'area'], question: ['question', 'questiontext', 'checklistquestion', 'requirement'], answerType: ['answertype', 'type', 'responsetype', 'format'], choices: ['choices', 'options', 'answers', 'allowedanswers'], required: ['required', 'mandatory', 'compulsory'], core: ['core', 'corequestion', 'coreallclients', 'commonforall', 'lockedcore', 'locked'], industries: ['industry', 'industries', 'applicableindustries', 'applicableto'], helpText: ['help', 'helptext', 'guidance', 'hint', 'notes'] };
const fieldFor = (h: string) => { const n = norm(h.replace(/\(.*?\)/g, ''));   // "Choices (separate with |)" and "Core (all clients)" match by the words before the bracket
   return Object.keys(ALIAS).find(k => ALIAS[k].includes(n)) ?? null; };
const TYPE_WORDS: Record<string, AType> = { multichoice: 'multi_choice', multiselect: 'multi_choice', multiplechoice: 'multi_choice', checkboxes: 'multi_choice', choosemany: 'multi_choice', chooseall: 'multi_choice', multi: 'multi_choice', chooseallthatapply: 'multi_choice', yesno: 'yes_no', yn: 'yes_no', boolean: 'yes_no', choice: 'choice', select: 'choice', dropdown: 'choice', choose: 'choice', chooseone: 'choice', text: 'text', freetext: 'text', string: 'text', open: 'text', number: 'number', numeric: 'number', integer: 'number', date: 'date' };
const looksLikeFormula = (raw: string) => /^[=+\-@]/.test(raw.trim()) || /^[\t\r]/.test(raw);
export const parseBool = (s: string): boolean | null => { const n = s.trim().toLowerCase(); if (['', 'y', 'yes', 'true', '1', 'required', 'mandatory'].includes(n)) return true; if (['n', 'no', 'false', '0', 'optional'].includes(n)) return false; return null; };

/** Reads a questionnaire sheet. Needs Ref, Question and Answer type columns in the first rows. Every row carries its own errors; nothing is dropped silently. */
export async function parseQuestionnaire(filename: string, buf: Buffer): Promise<{ format: string; headerRow: number; rows: QRow[]; blank: number }> {
  const { grid, ext } = await readGrid(filename, buf); let h = -1; let cols: Record<string, number> = {};
  for (let r = 0; r < Math.min(6, grid.length) && h < 0; r++) { const m: Record<string, number> = {}; grid[r].forEach((c, i) => { const f = fieldFor(c); if (f && m[f] === undefined) m[f] = i; }); if (m.ref !== undefined && m.question !== undefined && m.answerType !== undefined) { h = r; cols = m; } }
  if (h < 0) throw new HttpError(422, 'Could not find a header row with "Ref", "Question" and "Answer type" columns in the first 6 rows');
  const rows: QRow[] = []; const seen = new Set<string>(); let blank = 0; const g = (line: string[], f: string) => cols[f] === undefined ? '' : (line[cols[f]] ?? '');
  for (let r = h + 1; r < grid.length; r++) { const line = grid[r]; if (Object.keys(cols).every(f => !g(line, f).trim())) { blank++; continue; }
    const errors: string[] = []; const data: Partial<QIn> = {};
    for (const f of Object.keys(cols)) { const raw = g(line, f); if (raw && looksLikeFormula(raw)) errors.push(`"${grid[h][cols[f]]}" starts with a formula character (= + - @) and was refused`); }
    data.ref = g(line, 'ref').trim(); data.section = g(line, 'section').trim() || 'General'; data.question = g(line, 'question').trim(); data.helpText = g(line, 'helpText').trim() || null;
    if (!data.ref) errors.push('ref is required'); else if (data.ref.length > 60) errors.push('ref is longer than 60 characters'); else { const k = data.ref.toLowerCase(); if (seen.has(k)) errors.push(`duplicate ref "${data.ref}" in this file`); seen.add(k); }
    if (!data.question) errors.push('question is required'); else if (data.question.length > 1000) errors.push('question is longer than 1000 characters'); if (data.section.length > 190) errors.push('section is longer than 190 characters'); if (data.helpText && data.helpText.length > 1000) errors.push('help text is longer than 1000 characters');
    const t = TYPE_WORDS[norm(g(line, 'answerType'))]; if (!t) errors.push(`answer type "${g(line, 'answerType')}" is not one of: yes/no, choice, choose all, text, number, date`); else data.answerType = t;
    const rawCore = g(line, 'core').trim(); const core = rawCore ? (rawCore.toLowerCase() === 'core' ? true : parseBool(rawCore)) : false; if (core === null) errors.push(`core must be yes or no, not "${g(line, 'core')}"`); data.core = core === true;
    const ind = parseIndustries(g(line, 'industries')); if ('error' in ind) errors.push(ind.error); else data.industries = ind.value;
    const rq = parseBool(g(line, 'required')); if (rq === null) errors.push(`required must be yes or no, not "${g(line, 'required')}"`); else data.required = rq;
    const ch = g(line, 'choices').split(/[|;\n]/).map(x => x.trim()).filter(Boolean);
    if (data.answerType === 'choice' || data.answerType === 'multi_choice') { if (ch.length < 2) errors.push('a "choice" question needs at least two choices, separated by | '); else if (new Set(ch.map(x => x.toLowerCase())).size !== ch.length) errors.push('choices must be different from each other'); else if (ch.some(x => x.length > 190)) errors.push('a choice is longer than 190 characters'); else data.choices = ch; }
    else if (ch.length && data.answerType) errors.push(`choices are only used by "choice" and "choose all" questions (this one is "${data.answerType}")`);
    rows.push({ row: r + 1, data, errors }); }
  if (!rows.length) throw new HttpError(422, 'The file has a header row but no questions'); if (rows.length > MAX_QUESTIONS) throw new HttpError(413, `Too many questions (maximum ${MAX_QUESTIONS})`);
  return { format: ext === '.csv' ? 'csv' : 'xlsx', headerRow: h + 1, rows, blank };
}

export type Q = { answerType: AType; choices: string[] | null };
/** Returns the cleaned answer, or an error message. Dates must be real calendar dates. */
export function checkAnswer(q: Q, raw: string): { value: string } | { error: string } {
  const v = raw.trim(); if (!v) return { error: 'An answer is required' };
  switch (q.answerType) {
    case 'yes_no': { const n = v.toLowerCase(); if (['yes', 'y'].includes(n)) return { value: 'yes' }; if (['no', 'n'].includes(n)) return { value: 'no' }; if (['n/a', 'na', 'not applicable'].includes(n)) return { value: 'n/a' }; return { error: 'Answer yes, no or n/a' }; }
    case 'choice': { const hit = q.choices?.find(c => c.toLowerCase() === v.toLowerCase()); return hit ? { value: hit } : { error: `Choose one of: ${(q.choices ?? []).join(', ')}` }; }
    case 'multi_choice': { const picks = v.split('|').map(x => x.trim()).filter(Boolean); const out: string[] = []; for (const p of picks) { const hit = q.choices?.find(c => c.toLowerCase() === p.toLowerCase()); if (!hit) return { error: `"${p}" is not one of: ${(q.choices ?? []).join(', ')}` }; if (!out.includes(hit)) out.push(hit); } return out.length ? { value: out.join('|') } : { error: 'Choose at least one' }; }
    case 'number': return /^-?\d{1,15}(\.\d{1,6})?$/.test(v) ? { value: v } : { error: 'Enter a number' };
    case 'date': { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Enter a date like 2026-12-31' }; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? { value: v } : { error: 'That is not a real date' }; }
    default: return v.length > 4000 ? { error: 'The answer is longer than 4000 characters' } : { value: v };
  }
}
export type Prog = { required: boolean; answered: boolean; review: 'pending' | 'accepted' | 'needs_change' | null };
/** Counts used by the phase checks and the progress bar. `open` = required questions with no answer; `toReview` = answers waiting for staff; `sentBack` = answers staff asked to change. */
export function progress(qs: Prog[]) { const open = qs.filter(q => q.required && !q.answered).length; return { total: qs.length, answered: qs.filter(q => q.answered).length, open, toReview: qs.filter(q => q.answered && q.review === 'pending').length, sentBack: qs.filter(q => q.answered && q.review === 'needs_change').length, accepted: qs.filter(q => q.answered && q.review === 'accepted').length }; }
