// Pure rules for search, My Work and the activity timeline (Phase 10G). No I/O.
import { z } from 'zod';
export const MIN_TERM = 2, MAX_TERM = 80, DEFAULT_LIMIT = 8, MAX_LIMIT = 20;
export const TYPES = ['engagement', 'item', 'finding', 'risk', 'incident', 'vendor', 'policy'] as const; export type ResultType = typeof TYPES[number];
export const TYPE_LABEL: Record<ResultType, string> = { engagement: 'Engagements', item: 'Checklist items', finding: 'Findings', risk: 'Risks', incident: 'Incidents', vendor: 'Vendors', policy: 'Policies' };
/** The search text a person typed: trimmed, whitespace collapsed, control characters removed. null when it is too short to search. */
export function cleanTerm(raw: unknown): string | null { const t = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM); return t.length >= MIN_TERM ? t : null; }
/** Escape a term for LIKE with '!' as the escape character, so a typed % or _ is just text. */
export const likeOf = (term: string) => `%${term.replace(/[!%_]/g, c => '!' + c)}%`;
const fold = (s: unknown) => String(s ?? '').toLowerCase();
export const hit = (term: string, ...fields: unknown[]) => { const t = fold(term); return fields.some(f => fold(f).includes(t)); };
/** How well a result matches: 0 exact reference, 1 title starts with the text, 2 title contains it, 3 only another field does. */
export function rank(term: string, ref: string, title: string): number { const t = fold(term); if (fold(ref) === t) return 0; if (fold(title).startsWith(t)) return 1; if (fold(title).includes(t) || fold(ref).includes(t)) return 2; return 3; }
/** A short excerpt of `text` around the first occurrence of `term` (null when the text does not contain it). Only ever called on text the caller is already allowed to read. */
export function snippet(text: unknown, term: string, width = 70): string | null {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim(); const i = fold(s).indexOf(fold(term)); if (i < 0) return null;
  const a = Math.max(0, i - Math.floor(width / 2)), b = Math.min(s.length, i + term.length + Math.floor(width / 2)); return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '');
}
const Uuid = z.string().uuid(); const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); const Word = z.string().regex(/^[a-z_]{1,40}$/);
/** The filters every overview screen shares. Each screen lists which of them it honours; the others are ignored. */
export const FiltersSchema = z.object({ orgId: Uuid.optional(), frameworkId: Uuid.optional(), engagementId: Uuid.optional(), ownerId: Uuid.optional(), status: Word.optional(), from: Day.optional(), to: Day.optional() });
export type Filters = z.infer<typeof FiltersSchema>;
export const SearchSchema = FiltersSchema.extend({ q: z.string().max(400).optional(), type: z.enum(TYPES).optional(), limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT) });
/** "engagement.created" -> "Engagement created"; "export.risks" -> "Export risks". */
export const humanize = (action: string) => { const s = action.replace(/[._]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : action; };
export const ENTITY_TYPES = ['engagement', 'finding', 'risk', 'incident', 'vendor', 'policy', 'evidence', 'user'] as const;
