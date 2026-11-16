// Webhook rules shared by the API (management, test pings, signature documentation) and the worker (delivery). Pure: no database, no network.
import crypto from 'node:crypto'; import net from 'node:net';
/** Actions that are never sent to a customer's endpoint: sign-in and account events, and the integration settings themselves. */
export const NEVER_SENT = /^(auth|user|mfa|session|password|platform|api_key|webhook|invitation|backup)\b/;
export const isSendable = (action: string) => !NEVER_SENT.test(action) && /^[a-z0-9_.]+$/.test(action);
/** Subscription patterns: "*" (everything sendable), "finding.*" (a prefix), or an exact action such as "finding.raised". */
export const validPattern = (p: string) => p === '*' || /^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$/.test(p);
export const matches = (patterns: string[], action: string) => isSendable(action) && patterns.some(p => p === '*' || p === action || (p.endsWith('.*') && action.startsWith(p.slice(0, -1))));
export const MAX_ATTEMPTS = 8; export const DISABLE_AFTER = 15;   // a delivery is parked after 8 tries; an endpoint switches itself off after 15 failures in a row
export const backoffSeconds = (attempt: number) => Math.min(6 * 3600, 30 * 2 ** (attempt - 1));
export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Header value: "t=<unix seconds>,v1=<hex hmac-sha256 of '<t>.<raw body>' with the endpoint secret>". */
export const sign = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
/** What a receiver does. Exported so it is tested and documented from one place. */
export function verify(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? ''); if (!m) return false; const t = Number(m[1]); if (Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest(); return crypto.timingSafeEqual(want, Buffer.from(m[2], 'hex'));
}
export const newSecret = () => 'whsec_' + crypto.randomBytes(32).toString('base64url');
/** Addresses a customer-supplied URL must never make us call: loopback, private, link-local (cloud metadata), carrier, multicast, reserved. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip); if (!v) return true;
  if (v === 4) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)); }
  const x = ip.toLowerCase(); if (x === '::' || x === '::1') return true; const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe[89ab]|ff)/.test(x) || x.startsWith('2001:db8');
}
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };
/** Shape check of the URL itself (the address it resolves to is checked again at delivery time). https only; plain http only when `allowHttp` (development). */
export function checkUrl(raw: string, o: { allowHttp?: boolean } = {}): UrlCheck {
  let u: URL; try { u = new URL(raw); } catch { return { ok: false, reason: 'Not a valid URL' }; }
  if (u.protocol !== 'https:' && !(o.allowHttp && u.protocol === 'http:')) return { ok: false, reason: o.allowHttp ? 'The URL must start with https:// (or http:// in development)' : 'The URL must start with https://' };
  if (u.username || u.password) return { ok: false, reason: 'The URL must not contain a user name or password' }; if (u.hash) return { ok: false, reason: 'The URL must not contain a #fragment' };
  const h = u.hostname.replace(/^\[|\]$/g, ''); if (!o.allowHttp) { if (net.isIP(h) && isPrivateAddress(h)) return { ok: false, reason: 'That address is private and cannot be called' }; if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return { ok: false, reason: 'That host name is internal and cannot be called' }; }
  if (raw.length > 500) return { ok: false, reason: 'The URL is too long' }; return { ok: true, url: u };
}
export const SCOPES = ['items:read', 'findings:read', 'findings:write', 'tests:read', 'tests:write', 'posture:read', 'audit:read'] as const; export type Scope = typeof SCOPES[number];
export const SCOPE_LABEL: Record<Scope, string> = { 'items:read': 'Read checklist items and their status', 'findings:read': 'Read findings', 'findings:write': 'Raise findings (for scanners and ticketing)', 'tests:read': 'Read recurring control tests', 'tests:write': 'Record control test results (automated checks)', 'posture:read': 'Read the compliance posture per framework', 'audit:read': 'Read the activity log (for a SIEM)' };
export const KEY_PATTERN = /^isg_([0-9a-f]{8})_([A-Za-z0-9_-]{40,64})$/;
export const payloadOf = (e: { auditId: number; tenantId: string; action: string; actorId: string | null; entity: string | null; entityId: string | null; detail: unknown; createdAt: Date | string }) =>
  ({ id: `evt_${e.auditId}`, type: e.action, organizationId: e.tenantId, occurredAt: new Date(e.createdAt).toISOString(), actorId: e.actorId, entity: e.entity, entityId: e.entityId, data: e.detail ?? {} });
