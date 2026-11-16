// Pure helpers for the process-template and discovery-question admin screens.
export const PATHS = ['TYPE1_ONLY', 'TYPE2_ONLY', 'TYPE1_THEN_TYPE2'] as const; export type AuditPath = typeof PATHS[number];
export const PATH_LABEL: Record<AuditPath, string> = { TYPE1_ONLY: 'Type I only', TYPE2_ONLY: 'Type II only', TYPE1_THEN_TYPE2: 'Type I then Type II' };
export const PHASE_NAMES = ['Planning', 'Evidence collection', 'Audit fieldwork', 'Reporting', 'Closure'];
export type MsRow = { phase: number; title: string; paths: AuditPath[] };
/** The API stores the path filter as a comma-separated string (or null = every path). */
export const parsePaths = (s: string | null | undefined): AuditPath[] => (s ?? '').split(',').map(x => x.trim()).filter((x): x is AuditPath => (PATHS as readonly string[]).includes(x));
export const toRows = (milestones: { phase: number; title: string; pathFilter?: string | null; sortOrder?: number }[]): MsRow[] => [...milestones].sort((a, b) => a.phase - b.phase || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(m => ({ phase: m.phase, title: m.title, paths: parsePaths(m.pathFilter) }));
/** Rows in screen order -> the request body. Returns the first problem as text instead of sending a request the server would refuse. */
export function buildBody(name: string, rows: MsRow[]): { ok: true; body: { name: string; milestones: { phase: number; title: string; pathFilter?: AuditPath[] }[] } } | { ok: false; message: string } {
  if (!name.trim()) return { ok: false, message: 'Give the template a name' }; if (!rows.length) return { ok: false, message: 'Add at least one milestone' }; if (rows.length > 200) return { ok: false, message: 'A template can have at most 200 milestones' };
  const bad = rows.findIndex(r => !r.title.trim()); if (bad >= 0) return { ok: false, message: `Milestone ${bad + 1} has no title` };
  return { ok: true, body: { name: name.trim(), milestones: [...rows].sort((a, b) => a.phase - b.phase).map(r => ({ phase: r.phase, title: r.title.trim(), ...(r.paths.length ? { pathFilter: r.paths } : {}) })) } };
}
export const groupQuestions = <T extends { frameworkName: string | null; active: number | boolean }>(qs: T[], showRetired: boolean) => { const m = new Map<string, T[]>(); for (const x of qs) { if (!showRetired && !x.active) continue; const k = x.frameworkName ?? 'All engagements'; (m.get(k) ?? m.set(k, []).get(k)!).push(x); } return [...m.entries()].sort(([a], [b]) => a === 'All engagements' ? -1 : b === 'All engagements' ? 1 : a.localeCompare(b)); };
