// Pure rules for reminders and digests (no database, no clock of their own: the caller passes "today").
export const SOON_DAYS = 3;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86400000);
export type Stage = { stage: 'due_soon' | 'overdue'; bucket: number; days: number };
/** due_soon: due within SOON_DAYS days (including today). overdue: nudged on day 1, 8, 15 ... late (bucket = week), so a long-late item is a weekly reminder, not a daily one. */
export function stageFor(due: string, today: string): Stage | null {
  const d = daysBetween(today, due); if (d < 0) { const late = -d; return { stage: 'overdue', bucket: Math.floor((late - 1) / 7), days: late }; } if (d <= SOON_DAYS) return { stage: 'due_soon', bucket: 0, days: d }; return null;
}
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const reminderLabel = (base: string, due: string, s: Stage) => s.stage === 'overdue' ? `${base} — overdue by ${plural(s.days, 'day')} (was due ${due})` : s.days === 0 ? `${base} — due today` : `${base} — due ${due} (in ${plural(s.days, 'day')})`;
/** The daily scan runs once per UTC day, from 03:00 UTC (08:30 in India) onwards, so people see reminders at the start of their working day. */
export const scanDue = (now: Date) => now.getUTCHours() >= 3;
/** Daily = at most once a day; weekly = at most once in 7 days (with a little slack so a 08:30 send is not skipped by a few minutes of drift). */
export function digestDue(freq: 'off' | 'daily' | 'weekly', lastSent: Date | null, now: Date): boolean {
  if (freq === 'off') return false; if (!lastSent) return true; const hours = (now.getTime() - lastSent.getTime()) / 3600000; return hours >= (freq === 'daily' ? 20 : 6.5 * 24);
}
/** Certificates are reminded at 60, 30 and 7 days before expiry, then once when expired. (Mirrors api/src/modules/certificates/rules.ts certReminder; a test keeps the two identical.) */
export const CERT_STEPS = [60, 30, 7];
export function certStage(validUntil: string, today: string): Stage | null {
  const d = daysBetween(today, validUntil); if (d < 0) return { stage: 'overdue', bucket: 0, days: -d }; const step = [...CERT_STEPS].sort((a, b) => a - b).find(s => d <= s); return step === undefined ? null : { stage: 'due_soon', bucket: step, days: d };
}
export const certLabel = (base: string, validUntil: string, s: Stage) => s.stage === 'overdue' ? `${base} — expired on ${validUntil} (${plural(s.days, 'day')} ago)` : s.days === 0 ? `${base} — expires today` : `${base} — expires ${validUntil} (in ${plural(s.days, 'day')})`;
export type DigestItem = { org: string; tenantId: string; label: string; due: string; stage: 'due_soon' | 'overdue'; days: number; text?: string };
export type DigestGroup = { org: string; tenantId: string; overdue: string[]; dueSoon: string[]; more: number };
export const PER_GROUP = 10;
/** Groups one person's items by organization, worst first (most overdue), capped per organization with a "and N more" count. */
export function groupItems(items: DigestItem[]): DigestGroup[] {
  const by = new Map<string, DigestItem[]>(); for (const i of items) { const k = i.tenantId; if (!by.has(k)) by.set(k, []); by.get(k)!.push(i); }
  return [...by.values()].map(list => { const od = list.filter(i => i.stage === 'overdue').sort((a, b) => b.days - a.days); const ds = list.filter(i => i.stage === 'due_soon').sort((a, b) => a.days - b.days || a.label.localeCompare(b.label));
    const line = (i: DigestItem) => i.text ?? reminderLabel(i.label, i.due, { stage: i.stage, bucket: 0, days: i.days }); const all = [...od.map(line), ...ds.map(line)].slice(0, PER_GROUP); const shownOd = Math.min(od.length, PER_GROUP);
    return { org: list[0].org, tenantId: list[0].tenantId, overdue: all.slice(0, shownOd), dueSoon: all.slice(shownOd), more: Math.max(0, list.length - PER_GROUP) }; }).sort((a, b) => a.org.localeCompare(b.org));
}
