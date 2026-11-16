// Pure helpers for the risk register screens.
export const LEVEL_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { low: 'green', medium: 'amber', high: 'red', critical: 'red' };
export const LEVEL_CELL: Record<string, string> = { low: 'bg-green-100', medium: 'bg-amber-100', high: 'bg-orange-200', critical: 'bg-red-300' };
export const levelOf = (score: number) => score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 16 ? 'high' : 'critical';
export const CATEGORY_LABEL: Record<string, string> = { strategic: 'Strategic', operational: 'Operational', compliance: 'Compliance', security: 'Security', privacy: 'Privacy', vendor: 'Vendor', financial: 'Financial', other: 'Other' };
export const TREATMENT_LABEL: Record<string, string> = { mitigate: 'Mitigate', accept: 'Accept', transfer: 'Transfer', avoid: 'Avoid' };
export const STATUS_TONE: Record<string, 'slate' | 'amber' | 'green' | 'brand'> = { identified: 'slate', treating: 'amber', accepted: 'brand', closed: 'green' };
export const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']; export const IMPACT = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];
export const scaleLabel = (n: number, labels: string[]) => `${n} · ${labels[n - 1]}`;
/** What the status dialog must collect for a target status (mirrors the server rules so people are not sent through avoidable errors). */
export type Need = { note: boolean; noteRequired: boolean; treatment: boolean; residual: boolean; review: boolean };
export function needsFor(to: string, risk: { treatment: string | null }): Need {
  switch (to) { case 'accepted': return { note: true, noteRequired: true, treatment: false, residual: true, review: true }; case 'closed': return { note: true, noteRequired: true, treatment: false, residual: risk.treatment === 'mitigate', review: false };
    case 'identified': return { note: true, noteRequired: true, treatment: false, residual: false, review: false }; default: return { note: false, noteRequired: false, treatment: !risk.treatment || risk.treatment === 'accept', residual: false, review: false }; }
}
export const TO_LABEL: Record<string, string> = { treating: 'Start treatment', accepted: 'Accept risk', closed: 'Close risk', identified: 'Reopen / send back' };
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
