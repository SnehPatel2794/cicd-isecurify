// Saved views: which filter keys each list accepts. PURE.
export const PAGES = ['risks', 'incidents', 'findings'] as const; export type Page = typeof PAGES[number];
export const MAX_VIEWS = 20;
export const ALLOWED: Record<Page, string[]> = { risks: ['status', 'category', 'mine'], incidents: ['status', 'severity', 'category', 'mine'], findings: ['status', 'severity', 'mine', 'unresolved', 'overdue', 'awaitingRetest', 'engagementId'] };
/** Keeps only known keys with short, plain values. Returns null when something else is present, so a view can never carry unexpected data. */
export function cleanFilters(page: Page, input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null; const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) { if (!ALLOWED[page].includes(k) || typeof v !== 'string' || v.length > 64 || !/^[A-Za-z0-9_.-]+$/.test(v)) return null; out[k] = v; }
  return out;
}
