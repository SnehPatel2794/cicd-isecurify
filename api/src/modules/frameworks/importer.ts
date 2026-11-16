import path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { HttpError, bad } from '../../platform/errors';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024, MAX_ZIP_ENTRIES = 1000, HEADER_SCAN_ROWS = 6;

export type ControlInput = { ref: string; domain: string; title: string; description: string | null; ownerDepartment: string | null; secondaryGuidanceNote: string | null; remarks: string | null };
export type ParsedRow = { row: number; data: ControlInput; errors: string[] };
export type ParseResult = { format: 'csv' | 'xlsx'; headerRow: number; columns: Record<string, string>; rows: ParsedRow[]; blankRows: number };

const ALIASES: Record<keyof ControlInput, string[]> = {
  ref: ['ref', 'refno', 'controlid', 'controlref', 'id'],
  domain: ['domain', 'domainclause', 'clause', 'category'],
  title: ['requirement', 'requirementtext', 'title', 'control', 'controlname'],
  ownerDepartment: ['owner', 'ownerdepartment', 'department'],
  description: ['evidencereference', 'evidence', 'guidance', 'guidancenote', 'description'],
  secondaryGuidanceNote: ['additionalevidencenotes', 'additionalevidence', 'secondaryguidance', 'secondaryguidancenote'],
  remarks: ['remarks', 'remark', 'comments'],
};
const LIMITS: Record<keyof ControlInput, number> = { ref: 60, domain: 190, title: 500, description: 5000, ownerDepartment: 190, secondaryGuidanceNote: 5000, remarks: 5000 };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const fieldFor = (header: string): keyof ControlInput | null => { const n = norm(header); for (const [k, v] of Object.entries(ALIASES)) if (v.includes(n)) return k as keyof ControlInput; return null; };
/** CSV/Excel formula injection: a cell that a spreadsheet would execute. We refuse the row rather than silently altering data. */
const looksLikeFormula = (raw: string) => /^[=+\-@]/.test(raw.trim()) || /^[\t\r]/.test(raw);

// ---------- file sniffing & safety ----------
function zipGuard(buf: Buffer) {
  // Central-directory scan: refuse "zip bombs" (tiny upload that expands to gigabytes) before any decompression happens.
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad('The file is not a valid .xlsx workbook');
  const entries = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16); let total = 0;
  if (entries > MAX_ZIP_ENTRIES) throw bad('The workbook contains too many parts');
  for (let n = 0; n < entries; n++) { if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw bad('The file is not a valid .xlsx workbook'); total += buf.readUInt32LE(off + 24); off += 46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32); }
  if (total > MAX_UNZIPPED_BYTES) throw bad('The workbook expands to an unreasonable size');
}
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 6); const count = (d: string) => first.reduce((n, l) => n + (l.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g'))?.length ?? 0), 0);
  const delim = [',', ';', '\t'].map(d => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true; else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; if (rows.length > MAX_IMPORT_ROWS + HEADER_SCAN_ROWS + 5) throw new HttpError(413, `Too many rows (maximum ${MAX_IMPORT_ROWS})`); }
    else cell += c; }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); } if (q) throw bad('The CSV has an unterminated quoted value');
  return rows;
}
const cellText = (v: unknown): string => v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);

/** Safety checks and reading of an uploaded .csv or .xlsx into rows of text. Shared by the control import and the questionnaire import. */
export async function readGrid(filename: string, buf: Buffer): Promise<{ grid: string[][]; ext: string }> {
  const ext = path.extname(path.basename(filename || '')).toLowerCase(); if (!['.csv', '.xlsx'].includes(ext)) throw bad('Only .csv and .xlsx files are accepted');
  if (!buf.length) throw bad('The file is empty'); if (buf.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'File is larger than 5 MB');
  const isZip = buf.subarray(0, 4).toString('hex') === '504b0304'; let grid: string[][];
  if (ext === '.xlsx') {
    if (!isZip) throw bad('The file content is not an Excel workbook'); zipGuard(buf);
    try { grid = (await readSheet(buf) as unknown[][]).map(r => r.map(cellText)); } catch { throw bad('The workbook could not be read'); }
  } else {
    if (isZip || buf.subarray(0, 4).toString() === '%PDF' || buf.subarray(0, 8192).includes(0)) throw bad('The file content is not a CSV text file');
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw bad('The CSV must be UTF-8 encoded'); }
    grid = parseCsv(text.replace(/^\uFEFF/, ''));
  }
  return { grid, ext };
}
export async function parseUpload(filename: string, buf: Buffer): Promise<ParseResult> {
  const { grid, ext } = await readGrid(filename, buf);
  if (grid.length > MAX_IMPORT_ROWS + HEADER_SCAN_ROWS + 5) throw new HttpError(413, `Too many rows (maximum ${MAX_IMPORT_ROWS})`);
  // header detection: first of the top rows that has Ref, Domain and Requirement columns
  let headerIdx = -1; let cols: Partial<Record<keyof ControlInput, number>> = {};
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, grid.length) && headerIdx < 0; r++) {
    const m: Partial<Record<keyof ControlInput, number>> = {}; grid[r].forEach((h, i) => { const f = fieldFor(h); if (f && m[f] === undefined) m[f] = i; });
    if (m.ref !== undefined && m.domain !== undefined && m.title !== undefined) { headerIdx = r; cols = m; }
  }
  if (headerIdx < 0) throw new HttpError(422, 'Could not find a header row with "Ref", "Domain" and "Requirement" columns in the first 6 rows');
  const rows: ParsedRow[] = []; const seen = new Set<string>(); let blank = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const line = grid[r]; const g = (f: keyof ControlInput) => cols[f] === undefined ? '' : (line[cols[f]!] ?? '');
    if (Object.keys(cols).every(f => !g(f as keyof ControlInput).trim())) { blank++; continue; }
    const errors: string[] = []; const data = {} as ControlInput;
    for (const f of Object.keys(ALIASES) as (keyof ControlInput)[]) {
      const raw = g(f); const v = raw.trim();
      if (cols[f] !== undefined && raw && looksLikeFormula(raw)) errors.push(`"${grid[headerIdx][cols[f]!]}" starts with a formula character (= + - @) and was refused`);
      if (v.length > LIMITS[f]) errors.push(`${f} is longer than ${LIMITS[f]} characters`);
      (data as any)[f] = v === '' && !['ref', 'domain', 'title'].includes(f) ? null : v;
    }
    for (const f of ['ref', 'domain', 'title'] as const) if (!data[f]) errors.push(`${f} is required`);
    if (data.ref) { const k = data.ref.toLowerCase(); if (seen.has(k)) errors.push(`duplicate ref "${data.ref}" in this file`); seen.add(k); }
    rows.push({ row: r + 1, data, errors });
  }
  if (!rows.length) throw new HttpError(422, 'The file has a header row but no control rows');
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(413, `Too many rows (maximum ${MAX_IMPORT_ROWS})`);
  return { format: ext === '.csv' ? 'csv' : 'xlsx', headerRow: headerIdx + 1, columns: Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, grid[headerIdx][i!]])), rows, blankRows: blank };
}

// ---------- templates (fictional example rows only) ----------
const HEADERS = ['Ref #', 'Domain / Clause', 'Requirement', 'Owner (Department)', 'Evidence / Reference', 'Additional Evidence Notes', 'Remarks'];
const EXAMPLES = [['EX-1.1', 'Governance', 'Example requirement: an information security policy is approved and reviewed annually.', 'Security team', 'Signed policy document with approval date', '', 'Fictional example row: replace with your own licensed content'],
  ['EX-2.1', 'Access control', 'Example requirement: user access is reviewed at least quarterly.', 'IT operations', 'Access review report with reviewer sign-off', 'Type II: provide reviews for every quarter in the period', '']];
export const csvTemplate = () => '\uFEFF' + [HEADERS, ...EXAMPLES].map(r => r.map(c => /[",\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\r\n') + '\r\n';
export async function xlsxTemplate(): Promise<Buffer> {
  const rows = [HEADERS.map(h => ({ value: h, fontWeight: 'bold' as const })), ...EXAMPLES.map(r => r.map(c => ({ value: c })))];
  return writeXlsxFile(rows, { columns: [{ width: 12 }, { width: 22 }, { width: 60 }, { width: 22 }, { width: 40 }, { width: 40 }, { width: 40 }] } as any).toBuffer();
}
