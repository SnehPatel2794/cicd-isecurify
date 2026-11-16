// Pure parsing and mapping of scanner / pentest results into finding drafts. No I/O, no clock.
// Accepts CSV (Nessus, ZAP, Burp-style exports, or the iSecurify template) and JSON (an array, or {findings:[...]}).
import crypto from 'node:crypto'; import type { Severity } from './rules';
export const MAX_ROWS = 500; export const MAX_BYTES = 2 * 1024 * 1024;
export type Draft = { row: number; title: string; description: string; recommendation: string | null; severity: Severity; itemRef: string | null; host: string | null; port: string | null; cve: string | null; cvss: string | null; pluginId: string | null };
export type RowError = { row: number; message: string };
export type Parsed = { ok: true; drafts: Draft[]; errors: RowError[]; total: number } | { ok: false; message: string };

/** RFC 4180 style CSV: quoted fields, doubled quotes, newlines inside quotes, BOM, CRLF. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = '', q = false, i = 0; if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && cell === '') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) out.push(row); row = []; } else cell += ch; }
  if (q) throw new Error('A quoted value is not closed'); row.push(cell); if (row.some(c => c.trim() !== '')) out.push(row); return out;
}
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');
const ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'vulnerability', 'vulnerabilityname', 'pluginname', 'issue', 'finding', 'alert', 'issuename'],
  severity: ['severity', 'risk', 'riskdesc', 'riskrating', 'rating', 'priority', 'level'],
  description: ['description', 'synopsis', 'details', 'summary', 'issuedetail', 'desc'],
  recommendation: ['recommendation', 'solution', 'remediation', 'fix', 'mitigation', 'issueremediation'],
  item: ['item', 'itemref', 'control', 'controlref', 'checklistitem', 'ref', 'mapsto'],
  host: ['host', 'ip', 'ipaddress', 'asset', 'target', 'hostname', 'url', 'affectedasset'],
  port: ['port'], cve: ['cve', 'cves', 'cveid'], cvss: ['cvss', 'cvssscore', 'cvssv3basescore', 'cvssv30basescore', 'cvssv2basescore', 'cvssv20basescore', 'basescore', 'score'], pluginId: ['pluginid', 'id', 'findingid', 'issueid', 'pluginnumber'],
};
const lookup = (obj: Record<string, unknown>, field: keyof typeof ALIASES) => { const keys = Object.keys(obj); for (const a of ALIASES[field]) { const k = keys.find(k => norm(k) === a); if (k !== undefined && obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim(); } return null; };
/** Maps scanner wording and CVSS scores to our five severities. "Informational (High)" (ZAP) uses the first word. Unknown wording returns null. */
export function mapSeverity(raw: string | null, cvss?: string | null): Severity | null {
  const s = (raw ?? '').trim().toLowerCase().split(/[\s(]/)[0];
  if (['critical', 'crit', 'severe', '5'].includes(s)) return 'critical'; if (['high', '4'].includes(s)) return 'high'; if (['medium', 'moderate', 'med', '3'].includes(s)) return 'medium'; if (['low', '2', 'minor'].includes(s)) return 'low'; if (['info', 'informational', 'information', 'none', 'observation', 'note', '1', '0'].includes(s)) return 'observation';
  if (!s && cvss != null && cvss !== '') { const n = Number(cvss); if (Number.isFinite(n) && n >= 0 && n <= 10) return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'medium' : n > 0 ? 'low' : 'observation'; }
  return null;
}
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;
/** Builds a draft from one record. The description keeps the scanner's text and adds the affected asset, CVE and CVSS so nothing is lost. */
export function toDraft(rec: Record<string, unknown>, row: number): { draft?: Draft; error?: RowError } {
  const title = lookup(rec, 'title'); if (!title) return { error: { row, message: 'Missing title' } }; const cvss = lookup(rec, 'cvss'); const sevRaw = lookup(rec, 'severity'); const severity = mapSeverity(sevRaw, cvss);
  if (!severity) return { error: { row, message: sevRaw ? `Unknown severity "${cut(sevRaw, 30)}"` : 'Missing severity' } };
  const host = lookup(rec, 'host'), port = lookup(rec, 'port'), cve = lookup(rec, 'cve'), pluginId = lookup(rec, 'pluginId'); const body = lookup(rec, 'description') ?? title;
  const facts = [host ? `Affected: ${host}${port && port !== '0' ? `:${port}` : ''}` : null, cve ? `CVE: ${cve}` : null, cvss ? `CVSS: ${cvss}` : null, pluginId ? `Scanner ID: ${pluginId}` : null].filter(Boolean);
  return { draft: { row, title: cut(title, 300), description: cut(facts.length ? `${body}\n\n${facts.join('\n')}` : body, 10000), recommendation: (() => { const r = lookup(rec, 'recommendation'); return r ? cut(r, 10000) : null; })(), severity, itemRef: lookup(rec, 'item'), host, port, cve, cvss, pluginId } };
}
export function parseImport(format: 'csv' | 'json', content: string): Parsed {
  if (Buffer.byteLength(content) > MAX_BYTES) return { ok: false, message: 'The file is larger than 2 MB' }; let recs: Record<string, unknown>[];
  try {
    if (format === 'json') { const j = JSON.parse(content); const arr = Array.isArray(j) ? j : Array.isArray(j?.findings) ? j.findings : null; if (!arr) return { ok: false, message: 'The JSON must be a list of findings, or an object with a "findings" list' }; if (arr.some((x: unknown) => !x || typeof x !== 'object' || Array.isArray(x))) return { ok: false, message: 'Every entry in the JSON list must be an object' }; recs = arr; }
    else { const rows = parseCsv(content); if (rows.length < 2) return { ok: false, message: rows.length ? 'The file has a header but no rows' : 'The file is empty' }; const head = rows[0].map(h => h.trim()); if (!ALIASES.title.some(a => head.some(h => norm(h) === a))) return { ok: false, message: 'No title column found. Expected a column such as "Title", "Name" or "Vulnerability"' };
      recs = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))); }
  } catch (e) { return { ok: false, message: format === 'json' ? 'The file is not valid JSON' : (e as Error).message }; }
  if (!recs.length) return { ok: false, message: 'The file has no findings' }; if (recs.length > MAX_ROWS) return { ok: false, message: `The file has ${recs.length} rows; the limit is ${MAX_ROWS} per import` };
  const drafts: Draft[] = [], errors: RowError[] = []; recs.forEach((r, i) => { const x = toDraft(r, i + 1); if (x.draft) drafts.push(x.draft); else errors.push(x.error!); }); return { ok: true, drafts, errors, total: recs.length };
}
/** Stable fingerprint of one finding in one place: the same scanner finding on the same host and port, mapped to the same checklist item, is the same finding. */
export const importKey = (d: Pick<Draft, 'title' | 'host' | 'port' | 'cve' | 'pluginId'>, itemId: string) =>
  crypto.createHash('sha256').update([itemId, d.title.trim().toLowerCase(), (d.host ?? '').toLowerCase(), d.port ?? '', d.cve ?? '', d.pluginId ?? ''].join('\u0001')).digest('hex');
