// Pure helpers for the evidence screens (unit-tested; no React).
import type { Tone } from './kit';
export const fmtBytes = (n: number | null | undefined) => n == null ? '—' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
export const REQUEST_LABEL: Record<string, string> = { requested: 'Requested', submitted: 'Awaiting review', accepted: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled' };
export const REQUEST_TONE: Record<string, Tone> = { requested: 'slate', submitted: 'brand', accepted: 'green', rejected: 'red', cancelled: 'slate' };
/** The label a request shows: accepted evidence past its validity date is shown as expired. */
export const requestLabel = (r: { status: string; expired?: boolean }) => r.status === 'accepted' && r.expired ? 'Expired' : REQUEST_LABEL[r.status] ?? r.status;
export const requestTone = (r: { status: string; expired?: boolean }): Tone => r.status === 'accepted' && r.expired ? 'amber' : REQUEST_TONE[r.status] ?? 'slate';
export const ITEM_EVIDENCE_LABEL: Record<string, string> = { not_requested: 'No evidence requested', requested: 'Evidence requested', in_progress: 'Partly accepted', submitted: 'Awaiting review', accepted: 'Evidence accepted', rejected: 'Evidence rejected' };
export const ITEM_EVIDENCE_TONE: Record<string, Tone> = { not_requested: 'slate', requested: 'amber', in_progress: 'amber', submitted: 'brand', accepted: 'green', rejected: 'red' };
export const SCAN_LABEL: Record<string, [string, Tone]> = { not_scanned: ['Not scanned', 'slate'], clean: ['Scan clean', 'green'], infected: ['Malware found', 'red'], error: ['Scan failed', 'amber'] };
export const usagePercent = (used: number, quota: number) => quota > 0 ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 100;
export const usageTone = (pct: number): Tone => pct >= 95 ? 'red' : pct >= 80 ? 'amber' : 'green';
/** Client-side pre-check so people learn about a too-large or wrong-type file before uploading; the server enforces the same rules. */
export function checkPick(name: string, size: number, maxBytes: number, allowed: string[]): string | null {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? ''; if (!allowed.includes(ext)) return `Files of type .${ext || '(none)'} are not accepted`; if (size <= 0) return 'The file is empty'; if (size > maxBytes) return `The file is larger than ${fmtBytes(maxBytes)}`; return null;
}
/** Short display form of a SHA-256 for tables; the full value is in the tooltip. */
export const shortHash = (h: string | null | undefined) => h ? `${h.slice(0, 10)}…${h.slice(-4)}` : '—';
/** Compares the SHA-256 of downloaded bytes with the one the server recorded. */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------- template library (5C)
export type TemplateRow = { id: string; name: string; category: string | null; frameworkName: string | null; active: number | boolean; versionLabel: string | null };
/** Groups templates by category (alphabetical, "Uncategorised" last); templates keep the server's order inside a group. */
export function groupTemplates<T extends { category: string | null }>(rows: T[]): { category: string; items: T[] }[] {
  const m = new Map<string, T[]>(); for (const r of rows) { const k = r.category?.trim() || 'Uncategorised'; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.entries()].sort(([a], [b]) => a === 'Uncategorised' ? 1 : b === 'Uncategorised' ? -1 : a.localeCompare(b)).map(([category, items]) => ({ category, items }));
}
/** Text for the template drop-down in a request form. */
export const templateOption = (t: TemplateRow) => `${t.name}${t.versionLabel ? ' · ' + t.versionLabel : ''}${t.frameworkName ? ' (' + t.frameworkName + ')' : ''}`;
