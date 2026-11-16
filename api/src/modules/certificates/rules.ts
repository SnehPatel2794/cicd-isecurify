// Pure rules for certificates. No database, no clock of their own ("today" is passed in).
export const MAX_DAYS = 1100;                 // about three years, also enforced by the database
export const EXPIRING_DAYS = 60;
export const REMINDER_STEPS = [60, 30, 7] as const;
export type CertStatus = 'valid' | 'expired' | 'revoked' | 'superseded';
export const STATUS_LABEL: Record<CertStatus, string> = { valid: 'Valid', expired: 'Expired', revoked: 'Revoked', superseded: 'Superseded' };
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86400000);
/** Revoked beats everything; then superseded; then expiry. A certificate is valid up to and including its last day. */
export function statusOf(c: { revokedAt: unknown; supersededBy: unknown; validUntil: string }, today: string): CertStatus {
  if (c.revokedAt) return 'revoked'; if (c.supersededBy) return 'superseded'; return c.validUntil < today ? 'expired' : 'valid';
}
export const daysLeft = (validUntil: string, today: string) => daysBetween(today, validUntil);
export const expiringSoon = (s: CertStatus, validUntil: string, today: string) => s === 'valid' && daysLeft(validUntil, today) <= EXPIRING_DAYS;
export const numberOf = (serial: number | string, issuedOn: string) => `ISG-${issuedOn.slice(0, 4)}-${String(serial).padStart(6, '0')}`;
export type Readiness = { applicable: number; effective: number };
/** A certificate is issued only when every applicable control for that framework is effective, unless the issuer records a reason. */
export function readinessCheck(r: Readiness, override: string | null | undefined): { ok: true; overridden: boolean } | { ok: false; code: string; message: string } {
  if (r.applicable === 0) return { ok: false, code: 'nothing_assessed', message: 'This framework has no applicable controls in the engagement, so there is nothing to certify' };
  if (r.effective === r.applicable) return { ok: true, overridden: false };
  if ((override ?? '').trim().length >= 10) return { ok: true, overridden: true };
  return { ok: false, code: 'not_ready', message: `${r.applicable - r.effective} of ${r.applicable} applicable controls are not yet effective. Resolve them, or record a reason (at least 10 characters) to issue anyway.` };
}
export type DateCheck = { ok: true } | { ok: false; message: string };
export function validityCheck(issuedOn: string, validUntil: string): DateCheck {
  if (validUntil <= issuedOn) return { ok: false, message: 'The expiry date must be after today' }; if (daysBetween(issuedOn, validUntil) > MAX_DAYS) return { ok: false, message: 'A certificate can be valid for at most three years' }; return { ok: true };
}
/** Reminder step for a certificate: the 60, 30 and 7 day marks, then once when it has expired. */
export function certReminder(validUntil: string, today: string): { stage: 'due_soon' | 'overdue'; bucket: number; days: number } | null {
  const d = daysBetween(today, validUntil); if (d < 0) return { stage: 'overdue', bucket: 0, days: -d };
  const step = [...REMINDER_STEPS].sort((a, b) => a - b).find(s => d <= s); return step === undefined ? null : { stage: 'due_soon', bucket: step, days: d };
}
