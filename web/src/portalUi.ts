// Pure helpers for the portal-polish features (Phase 9D): exports, saved views, bulk assignment, getting started.
export const REASON_TEXT: Record<string, string> = { not_found: 'not found', closed: 'is closed', unchanged: 'already has that owner', reopen_first: 'is accepted: reopen it first', forbidden: 'you cannot change it', closed_: 'is closed' };
export const reasonText = (code: string) => REASON_TEXT[code] ?? code.replace(/_/g, ' ');
/** "Owner set on 3 risks. Skipped 2: R-004 is closed; one not found." */
export function bulkMessage(noun: string, res: { updated: number; skipped: { id: string; ref?: string; reason: string }[] }) {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`; const head = `Owner set on ${plural(res.updated)}.`; if (!res.skipped.length) return head;
  const parts = res.skipped.slice(0, 5).map(s => `${s.ref ?? 'one'} ${reasonText(s.reason)}`); return `${head} Skipped ${res.skipped.length}: ${parts.join('; ')}${res.skipped.length > 5 ? '; …' : ''}.`;
}
export const queryString = (params: Record<string, string | undefined | false>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v)); const s = q.toString(); return s ? `?${s}` : ''; };
export const EXPORT_EXT: Record<string, string> = { csv: 'csv', xlsx: 'xlsx' };
export const exportName = (base: string, format: string, today = new Date().toISOString().slice(0, 10)) => `${base}-${today}.${EXPORT_EXT[format] ?? 'csv'}`;
/** The findings screen keeps its filters as booleans; saved views keep plain strings. */
export type FindingsFilter = { mine: boolean; overdue: boolean; awaitingRetest: boolean; unresolved: boolean; status: string; severity: string };
export const findingsToView = (f: FindingsFilter): Record<string, string> => ({ unresolved: String(f.unresolved), ...(f.mine && { mine: 'true' }), ...(f.overdue && { overdue: 'true' }), ...(f.awaitingRetest && { awaitingRetest: 'true' }), ...(f.status && { status: f.status }), ...(f.severity && { severity: f.severity }) });
export const findingsFromView = (v: Record<string, string>): FindingsFilter => ({ unresolved: v.unresolved !== 'false', mine: v.mine === 'true', overdue: v.overdue === 'true', awaitingRetest: v.awaitingRetest === 'true', status: v.status ?? '', severity: v.severity ?? '' });
/** Remove empty values so "no filter" and "filter left blank" save as the same view. */
export const compact = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
export const sameFilters = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(compact(a)).sort()) === JSON.stringify(Object.entries(compact(b)).sort());
export const dismissKey = (tid: string) => `onboarding-dismissed:${tid}`;
export const readDismissed = (tid: string) => { try { return localStorage.getItem(dismissKey(tid)) === '1'; } catch { return false; } };
export const writeDismissed = (tid: string) => { try { localStorage.setItem(dismissKey(tid), '1'); } catch { /* private window: the card just comes back */ } };
