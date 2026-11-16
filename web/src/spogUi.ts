// Pure helpers for the search, My Work and activity pages (Phase 10G).
export type FilterState = { orgId?: string; frameworkId?: string; engagementId?: string; ownerId?: string; status?: string; from?: string; to?: string };
export const FILTER_KEYS = ['orgId', 'frameworkId', 'engagementId', 'ownerId', 'status', 'from', 'to'] as const;
/** Only the filters that have a value, as a query string (without the leading ?). Stable key order so cache keys do not flap. */
export const toQuery = (f: FilterState, extra: Record<string, string | number | undefined> = {}) => { const p = new URLSearchParams(); for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!); for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v)); return p.toString(); };
export const fromParams = (sp: URLSearchParams): FilterState => { const f: FilterState = {}; for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) f[k] = v; } return f; };
export const activeCount = (f: FilterState) => FILTER_KEYS.filter(k => !!f[k]).length;
export const TYPE_LABEL: Record<string, string> = { engagement: 'Engagements', item: 'Checklist items', finding: 'Findings', risk: 'Risks', incident: 'Incidents', vendor: 'Vendors', policy: 'Policies' };
export const STATUS_LABEL: Record<string, string> = { to_acknowledge: 'To acknowledge', in_review: 'In review', ready_for_retest: 'Ready for re-test', in_remediation: 'In remediation', not_started: 'Not started', in_progress: 'In progress', awaiting_review: 'Awaiting review', needs_work: 'Needs work' };
export const statusLabel = (s: string | null | undefined) => !s ? '' : STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const shortDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
export const SECTION_TONE: Record<string, 'amber' | 'blue' | 'slate'> = { review: 'blue', action: 'amber', item: 'slate' } as any;
