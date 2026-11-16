// Pure helpers for the certificates screens.
export type CertTone = 'green' | 'amber' | 'red' | 'slate';
export const statusTone = (status: string, expiringSoon: boolean): CertTone => status === 'valid' ? (expiringSoon ? 'amber' : 'green') : status === 'superseded' ? 'slate' : 'red';
export const statusText = (c: { status: string; statusLabel?: string; expiringSoon?: boolean; daysLeft?: number | null }) => c.status === 'valid' && c.expiringSoon && c.daysLeft != null ? `Valid · expires in ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}` : (c.statusLabel ?? c.status);
export const optionKey = (o: { engagementId: string; frameworkId: string }) => `${o.engagementId}|${o.frameworkId}`;
export const readyText = (o: { applicable: number; effective: number; ready: boolean }) => o.ready ? `All ${o.applicable} applicable controls effective` : o.applicable === 0 ? 'No applicable controls' : `${o.effective} of ${o.applicable} applicable controls effective`;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const verifyCodeOf = (path: string) => /^[A-Za-z0-9_-]{22}$/.test(path) ? path : null;
