// List exports (CSV and Excel). Pure cell handling plus one helper that writes the HTTP response.
//   Formula injection: a text cell that starts with = + - @ tab or CR would be run as a formula by Excel, so it is written with a leading single quote.
import ExcelJS from 'exceljs'; import type { FastifyReply } from 'fastify';
export const MAX_EXPORT_ROWS = 2000; export const FORMATS = ['csv', 'xlsx'] as const; export type Format = typeof FORMATS[number];
export type Cell = string | number | boolean | null | undefined | Date;
/** Text for a cell: dates as ISO, booleans as Yes/No, control characters removed, and anything that looks like a formula neutralised. */
export function safeText(v: Cell): string {
  if (v === null || v === undefined) return ''; if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString(); if (typeof v === 'boolean') return v ? 'Yes' : 'No'; if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const csvField = (s: string) => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
/** RFC 4180 with CRLF line ends and a UTF-8 byte-order mark, so Excel opens accented text correctly. */
export const toCsv = (headers: string[], rows: Cell[][]) => '﻿' + [headers.map(csvField).join(','), ...rows.map(r => r.map(c => csvField(safeText(c))).join(','))].join('\r\n') + '\r\n';
export async function toXlsx(sheetName: string, headers: string[], rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'iSecurify GRC'; const ws = wb.addWorksheet(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers).font = { bold: true }; for (const r of rows) ws.addRow(r.map(c => typeof c === 'number' && Number.isFinite(c) ? c : safeText(c)));
  ws.columns.forEach((col, i) => { col.width = Math.min(60, Math.max(10, headers[i].length + 2, ...rows.slice(0, 200).map(r => safeText(r[i]).length + 2))); }); ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export';
export async function sendTable(reply: FastifyReply, o: { base: string; format: Format; sheet: string; headers: string[]; rows: Cell[][]; today: string }) {
  const name = `${fileSlug(o.base)}-${o.today}.${o.format}`; reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', `attachment; filename="${name}"`);
  if (o.format === 'csv') return reply.type('text/csv; charset=utf-8').send(toCsv(o.headers, o.rows));
  return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await toXlsx(o.sheet, o.headers, o.rows));
}
