// Evidence rules: PURE functions (no I/O, no clock) so every rule can be tested exhaustively and the routes stay thin.
import type { EvidenceStatus } from '../engagements/evaluation';

export const REQUEST_STATUS = ['requested', 'submitted', 'accepted', 'rejected', 'cancelled'] as const;
export type ReqStatus = typeof REQUEST_STATUS[number];

/** The item-level evidence status that the control-evaluation service consumes, derived from the item's NON-cancelled requests.
 *  Conservative on purpose: an item is "accepted" only when EVERY active request is accepted.
 *    none active -> not_requested | all accepted -> accepted | any rejected -> rejected | any submitted -> submitted
 *    some accepted (the rest still requested) -> in_progress | otherwise -> requested */
export function deriveItemEvidence(statuses: ReqStatus[]): EvidenceStatus {
  const active = statuses.filter(s => s !== 'cancelled'); if (!active.length) return 'not_requested';
  if (active.every(s => s === 'accepted')) return 'accepted';
  if (active.includes('rejected')) return 'rejected';
  if (active.includes('submitted')) return 'submitted';
  if (active.includes('accepted')) return 'in_progress';
  return 'requested';
}

// ---------------------------------------------------------------- who may do what (inputs come from tenancy `resolveAccess`)
export type Who = { via: 'member' | 'staff'; role: string; manage: boolean; readEvidence: boolean };
const isProvider = (w: Who) => w.via === 'member' && (w.role === 'client_staff' || w.role === 'third_party_vendor');
/** Create / edit / cancel requests: client admins and iSecurify staff with manage rights. */
export const canManageRequests = (w: Who) => w.manage;
/** Upload a version: managers (iSecurify staff often collect evidence on the client's behalf) and the accountable person of that item. Auditors never upload. */
export const canUpload = (w: Who, userId: string, accountableUserId: string | null) => w.manage || (isProvider(w) && !!accountableUserId && accountableUserId === userId);
/** Open or download file content. Staff need the explicit can_read_evidence flag; staff/vendors only for items assigned to them. */
export const canViewContent = (w: Who, userId: string, accountableUserId: string | null) =>
  w.via === 'staff' ? w.readEvidence : w.role === 'client_admin' || w.role === 'tp_auditor' || (isProvider(w) && !!accountableUserId && accountableUserId === userId);
/** Accept / reject: the TP auditor (engagement membership is enforced by the caller's scope) or iSecurify staff who can both manage AND read evidence. Client admins provide evidence, they never judge it. */
export const canReview = (w: Who) => (w.via === 'member' && w.role === 'tp_auditor') || (w.via === 'staff' && w.manage && w.readEvidence);
export const canScan = (w: Who) => canReview(w) || w.manage;

// ---------------------------------------------------------------- request state machine
export const canReceiveUpload = (s: ReqStatus) => s !== 'cancelled';
export type ReviewCheck = { ok: true } | { ok: false; code: 'cancelled' | 'nothing_to_review' | 'not_latest_version' | 'no_change'; message: string };
/** `isLatestVersion`: the reviewed version must be the newest one. Re-deciding is allowed (accepted <-> rejected) but repeating the current decision is not. */
export function reviewCheck(status: ReqStatus, decision: 'accepted' | 'rejected', isLatestVersion: boolean): ReviewCheck {
  if (status === 'cancelled') return { ok: false, code: 'cancelled', message: 'This request was cancelled' };
  if (status === 'requested') return { ok: false, code: 'nothing_to_review', message: 'Nothing has been submitted yet' };
  if (!isLatestVersion) return { ok: false, code: 'not_latest_version', message: 'Only the newest version can be reviewed' };
  if (status === decision) return { ok: false, code: 'no_change', message: `This version is already ${decision}` };
  return { ok: true };
}

// ---------------------------------------------------------------- dates
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** Calendar-month arithmetic on YYYY-MM-DD with end-of-month clamping (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number); const idx = (m - 1) + months; const ny = y + Math.floor(idx / 12); const nm = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate(); return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}
/** Evidence is expired from the day AFTER its valid-until date. */
export const isExpired = (validUntil: string | null, today: string) => !!validUntil && validUntil < today;

// ---------------------------------------------------------------- file policy
type Magic = 'pdf' | 'png' | 'jpg' | 'gif' | 'zip' | 'ole' | 'text';
export const FILE_TYPES: Record<string, { mime: string; magic: Magic }> = {
  pdf: { mime: 'application/pdf', magic: 'pdf' }, png: { mime: 'image/png', magic: 'png' }, jpg: { mime: 'image/jpeg', magic: 'jpg' }, jpeg: { mime: 'image/jpeg', magic: 'jpg' }, gif: { mime: 'image/gif', magic: 'gif' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' }, xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' }, odt: { mime: 'application/vnd.oasis.opendocument.text', magic: 'zip' }, ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', magic: 'zip' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', magic: 'zip' }, zip: { mime: 'application/zip', magic: 'zip' },
  doc: { mime: 'application/msword', magic: 'ole' }, xls: { mime: 'application/vnd.ms-excel', magic: 'ole' }, ppt: { mime: 'application/vnd.ms-powerpoint', magic: 'ole' }, msg: { mime: 'application/vnd.ms-outlook', magic: 'ole' },
  csv: { mime: 'text/csv', magic: 'text' }, txt: { mime: 'text/plain', magic: 'text' }, md: { mime: 'text/markdown', magic: 'text' }, json: { mime: 'application/json', magic: 'text' }, xml: { mime: 'application/xml', magic: 'text' },
  log: { mime: 'text/plain', magic: 'text' }, eml: { mime: 'message/rfc822', magic: 'text' },
};
export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES).sort();
export const extOf = (name: string) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name); return m ? m[1].toLowerCase() : ''; };
/** Display name only: never used to build a path. Removes directories, control and shell-ish characters, caps the length but keeps the extension. */
export function sanitizeFileName(raw: string): string {
  let n = String(raw ?? '').split(/[\\/]/).pop() ?? ''; n = n.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!n) return 'file'; if (n.length > 180) { const ext = extOf(n); n = n.slice(0, 180 - (ext ? ext.length + 1 : 0)) + (ext ? '.' + ext : ''); } return n;
}
const startsWith = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const EXEC_SIGS: number[][] = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0xca, 0xfe, 0xba, 0xbe], [0xfe, 0xed, 0xfa], [0xcf, 0xfa, 0xed, 0xfe], [0x23, 0x21]];   // MZ (Windows), ELF, Mach-O/Java class, #! scripts
export type FileVerdict = { ok: true; mediaType: string; ext: string } | { ok: false; reason: string };
/** Extension allow-list + content sniffing on the first bytes: the content must match what the extension claims, and executables are refused whatever the name. */
export function checkFile(fileName: string, head: Buffer, size: number): FileVerdict {
  const ext = extOf(fileName); const t = FILE_TYPES[ext];
  if (!t) return { ok: false, reason: `Files of type .${ext || '(none)'} are not accepted. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  if (size <= 0) return { ok: false, reason: 'The file is empty' };
  if (EXEC_SIGS.some(s => startsWith(head, s))) return { ok: false, reason: 'Executable or script content is not accepted' };
  const ok = t.magic === 'pdf' ? startsWith(head, [0x25, 0x50, 0x44, 0x46]) || head.subarray(0, 1024).includes(Buffer.from('%PDF-')) : t.magic === 'png' ? startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : t.magic === 'jpg' ? startsWith(head, [0xff, 0xd8, 0xff]) : t.magic === 'gif' ? startsWith(head, [0x47, 0x49, 0x46, 0x38]) : t.magic === 'zip' ? startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
    : t.magic === 'ole' ? startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) : !head.includes(0);   // text: no NUL bytes
  return ok ? { ok: true, mediaType: t.mime, ext } : { ok: false, reason: `The content does not look like a .${ext} file` };
}

// ---------------------------------------------------------------- link policy (Drive and similar)
export type LinkVerdict = { ok: true; url: string; provider: string } | { ok: false; reason: string };
const providerOf = (h: string) => /(^|\.)(drive|docs)\.google\.com$/.test(h) ? 'google_drive' : /(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/.test(h) ? 'microsoft' : /(^|\.)dropbox\.com$/.test(h) ? 'dropbox' : /(^|\.)box\.com$/.test(h) ? 'box' : 'other';
/** https only; no embedded credentials; a real hostname (no IP literals, no localhost); optional host allow-list from configuration. The link is never fetched by the server. */
export function checkLink(raw: string, allowedHosts: string[] = []): LinkVerdict {
  const s = String(raw ?? '').trim(); if (!s || s.length > 2000) return { ok: false, reason: 'Enter a link of at most 2000 characters' };
  let u: URL; try { u = new URL(s); } catch { return { ok: false, reason: 'That is not a valid link' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only https links are accepted' };
  if (u.username || u.password) return { ok: false, reason: 'Links with embedded credentials are not accepted' };
  const h = u.hostname.toLowerCase(); if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return { ok: false, reason: 'The link must point to a public website' };
  if (allowedHosts.length && !allowedHosts.some(a => h === a || h.endsWith('.' + a))) return { ok: false, reason: `Links must point to one of: ${allowedHosts.join(', ')}` };
  return { ok: true, url: u.toString(), provider: providerOf(h) };
}

/** Human-readable size for messages. */
export const fmtBytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
