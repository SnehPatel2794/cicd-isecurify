export const STATE_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'brand'> = { effective: 'green', awaiting_review: 'brand', implemented_pending_validation: 'amber', partially_implemented: 'amber', blocked_missing_evidence: 'red', ineffective: 'red', not_implemented: 'slate', not_assessed: 'slate', not_applicable: 'slate' };
export const READINESS_OPTIONS = [['not_started', 'Not started'], ['in_progress', 'In progress'], ['partially_implemented', 'Partially implemented'], ['implemented', 'Implemented'], ['not_applicable', 'Not applicable']] as const;
export const PHASES = ['Preparation', 'Scheduling', 'Audit Meeting', 'Follow-up', 'Closure'] as const;
export const pct = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
/** Tabs a viewer may see: client staff and vendors only get their own checklist items. */
export const tabsFor = (p: { seesDetail: boolean; manage: boolean; export?: boolean }) => p.seesDetail ? ['Dashboard', 'Checklist', 'Evidence', 'Findings', 'Tasks', 'Timeline', 'SOA', 'Team', 'Discovery', ...(p.export ? ['Reports'] : []), 'Activity'] : ['Checklist', 'Evidence', 'Findings', 'Tasks'];
