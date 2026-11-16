// PDF writer (pdfkit, built-in Helvetica). Draws a ReportData; never queries. The built-in fonts cover Western European text only,
// so characters outside that range are shown as "?" (the Excel export keeps full Unicode).
import PDFDocument from 'pdfkit'; import type { ReportData } from './build'; import { DEFAULTS, type Brand } from '../branding/rules';
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const latin = (s: unknown) => { let o = ''; for (const ch of String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')) { const c = ch.codePointAt(0)!; o += (c <= 255 || CP1252_EXTRA.includes(ch)) ? ch : '?'; } return o; };
const INK = '#1f2937', MUTED = '#6b7280', BRAND = '#812671', LINE = '#e5e7eb', HEAD = '#f3f4f6';
const SEV: Record<string, string> = { critical: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#1d4ed8', observation: '#4b5563' };
type Col = { key: string; label: string; w: number; color?: (row: any) => string | undefined };

export function renderPdf(r: ReportData, brand: Brand = { ...DEFAULTS, logo: null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const BRAND = brand.primaryColor;   // the colour comes from the branding profile (defaults to the iSecurify purple)
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 56, left: 44, right: 44 }, bufferPages: true, info: { Title: latin(`${r.engagement.name} — audit readiness report`), Author: latin(brand.companyName), Subject: latin(r.meta.organization), Creator: latin(brand.companyName), CreationDate: new Date(r.meta.generatedAt) } });
    const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width - 88; const x0 = 44; const ensure = (h: number) => { if (doc.y + h > doc.page.height - 56) doc.addPage(); };
    const h1 = (t: string) => { ensure(60); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(14).fillColor(BRAND).text(latin(t), x0, doc.y, { width: W }); doc.moveTo(x0, doc.y + 2).lineTo(x0 + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5).fillColor(INK); };
    const para = (t: string, o: { size?: number; color?: string; bold?: boolean } = {}) => { doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size ?? 9.5).fillColor(o.color ?? INK).text(latin(t), x0, doc.y, { width: W }); };
    const kv = (pairs: [string, string | null | undefined][]) => { for (const [k, v] of pairs) { if (v == null || v === '') continue; ensure(16); const y = doc.y; doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(latin(k), x0, y, { width: 120 }); doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(latin(v), x0 + 125, y, { width: W - 125 }); doc.y = Math.max(doc.y, y + 13); } };
    const table = (cols: Col[], rows: any[], empty: string) => {
      if (!rows.length) { para(empty, { color: MUTED }); return; } const total = cols.reduce((a, c) => a + c.w, 0); const ws = cols.map(c => (c.w / total) * W);
      const header = () => { const y = doc.y; doc.rect(x0, y, W, 16).fill(HEAD); let x = x0; cols.forEach((c, i) => { doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(latin(c.label), x + 3, y + 4, { width: ws[i] - 6, lineBreak: false }); x += ws[i]; }); doc.y = y + 18; };
      ensure(40); header();
      for (const row of rows) {
        const cells = cols.map(c => latin(row[c.key] ?? '')); doc.font('Helvetica').fontSize(8.5); const hs = cells.map((t, i) => doc.heightOfString(t, { width: ws[i] - 6 })); const h = Math.min(Math.max(...hs, 10), 110) + 6;
        if (doc.y + h > doc.page.height - 56) { doc.addPage(); header(); }
        const y = doc.y; let x = x0; cols.forEach((c, i) => { doc.font('Helvetica').fontSize(8.5).fillColor(c.color?.(row) ?? INK).text(cells[i], x + 3, y + 3, { width: ws[i] - 6, height: 104, ellipsis: true }); x += ws[i]; });
        doc.moveTo(x0, y + h).lineTo(x0 + W, y + h).strokeColor(LINE).lineWidth(0.5).stroke(); doc.y = y + h + 1;
      }
    };
    const e = r.engagement, s = r.summary;
    // ---- cover
    let top = 70; if (brand.logo) { try { doc.image(brand.logo, x0, 54, { fit: [170, 48] }); top = 112; } catch { /* an unreadable logo never blocks a report */ } }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text(latin(brand.companyName).toUpperCase(), x0, top); doc.moveDown(2.5);
    doc.font('Helvetica-Bold').fontSize(26).fillColor(INK).text('Audit readiness report', x0, doc.y, { width: W }); doc.moveDown(0.4).font('Helvetica').fontSize(15).fillColor(MUTED).text(latin(e.name), { width: W });
    doc.moveDown(1.5); kv([['Organization', r.meta.organization], ['Engagement', e.name], ['Client reference', e.clientRef], ['Frameworks', e.frameworks.map(f => `${f.name} v${f.version}${f.primary ? ' (primary)' : ''}`).join(', ')], ['Status', e.status === 'closed' ? 'Closed' : `Open, phase ${e.phase}: ${e.phaseName} (this report is a snapshot, not a final report)`],
      ['Period', [e.startDate, e.endDate].filter(Boolean).join(' to ') || null], ['Document number', e.documentNumber], ['Document owner', e.documentOwner], ['Classification', e.classification], ['Version', e.documentVersion], ['Review cycle', e.reviewCycle], ['Client address', e.clientAddress]]);
    doc.moveDown(1); kv([['Generated', r.meta.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC'], ['Generated by', r.meta.generatedBy], ['Report ID', r.meta.reportId]]);
    doc.moveDown(1.5); para('How to check this file', { bold: true }); para('The platform records a SHA-256 fingerprint of this exact file when it is generated. In the engagement\'s Reports tab, choose "Check a file" and select this PDF: it is reported as genuine only if its fingerprint matches a recorded export of this organization. Any later edit to the file changes the fingerprint.', { color: MUTED, size: 9 });
    // ---- summary
    doc.addPage(); h1('1. Summary'); kv([['Checklist items', String(s.total)], ['Applicable', String(s.applicable)], ['Effective controls', `${s.effective} of ${s.applicable}`], ['Readiness', s.readinessPercent == null ? 'n/a' : `${s.readinessPercent}%`], ['Awaiting review', String(s.awaitingReview)], ['Overdue', String(s.overdue)],
      ['Findings', `${r.findings.length} (${r.findings.filter(f => ['open', 'in_remediation', 'ready_for_retest'].includes(f.status)).length} unresolved)`], ['Evidence requests', String(r.evidence.length)]]);
    doc.moveDown(0.8); para('Control status', { bold: true }); doc.moveDown(0.2);
    table([{ key: 'label', label: 'State', w: 3 }, { key: 'n', label: 'Items', w: 1 }], Object.entries(s.byState).filter(([, n]) => n > 0).map(([k, n]) => ({ label: r.stateLabels[k] ?? k, n: String(n) })), 'No items.');
    // ---- findings
    h1('2. Findings'); const unresolved = r.findings.filter(f => ['open', 'in_remediation', 'ready_for_retest'].includes(f.status));
    para(`${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}; ${unresolved.length} unresolved. Unresolved findings of medium severity or above stop a control being treated as effective.`, { color: MUTED, size: 9 }); doc.moveDown(0.3);
    table([{ key: 'ref', label: 'Ref', w: 1 }, { key: 'severity', label: 'Severity', w: 1.3, color: (x: any) => SEV[x.severity] }, { key: 'statusLabel', label: 'Status', w: 1.6 }, { key: 'itemRef', label: 'Control', w: 1.2 }, { key: 'title', label: 'Title', w: 4 }, { key: 'owner', label: 'Owner', w: 1.8 }, { key: 'dueDate', label: 'Due', w: 1.4 }], r.findings, 'No findings were raised.');
    for (const x of r.findings) { ensure(70); doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).fillColor(INK).text(latin(`${x.ref}  ${x.title}`), x0, doc.y, { width: W }); doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(`${x.severity} · ${x.statusLabel} · control ${x.itemRef} · raised ${x.raisedOn}${x.raisedBy ? ' by ' + x.raisedBy : ''}${x.closedOn ? ' · closed ' + x.closedOn : ''}`), { width: W });
      for (const [k, v] of [['Finding', x.description], ['Recommendation', x.recommendation], ['Remediation plan', x.remediationPlan]] as const) if (v) { doc.moveDown(0.15).font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(k, { width: W }); doc.font('Helvetica').fontSize(9).fillColor(INK).text(latin(v), { width: W }); } }
    // ---- checklist
    doc.addPage(); h1('3. Control checklist'); table([{ key: 'ref', label: 'Control', w: 1.4 }, { key: 'title', label: 'Requirement', w: 4.4 }, { key: 'stateLabel', label: 'State', w: 2 }, { key: 'evidence', label: 'Evidence', w: 1.5 }, { key: 'owner', label: 'Accountable', w: 1.8 }, { key: 'due', label: 'Due', w: 1.4, color: (x: any) => x.overdue ? '#b91c1c' : undefined }],
      r.items.map(i => ({ ...i, due: i.dueDate ? i.dueDate + (i.overdue ? ' (overdue)' : '') : '' })), 'No checklist items.');
    const na = r.items.filter(i => i.naJustification); if (na.length) { doc.moveDown(0.8); para('Items marked not applicable', { bold: true }); doc.moveDown(0.2); table([{ key: 'ref', label: 'Control', w: 1.4 }, { key: 'naJustification', label: 'Justification', w: 8 }], na, ''); }
    // ---- SOA
    if (r.soa) { doc.addPage(); h1('4. Statement of applicability'); const applicable = r.soa.filter(x => x.applicable).length; para(`${applicable} of ${r.soa.length} controls applicable; ${r.soa.length - applicable} not applicable (justification required).`, { color: MUTED, size: 9 }); doc.moveDown(0.3);
      table([{ key: 'framework', label: 'Framework', w: 2 }, { key: 'ref', label: 'Control', w: 1.3 }, { key: 'title', label: 'Title', w: 4 }, { key: 'app', label: 'Applicable', w: 1.2 }, { key: 'justification', label: 'Justification', w: 3.5 }], r.soa.map(x => ({ ...x, app: x.applicable ? 'Yes' : 'No' })), 'No entries.'); }
    // ---- evidence
    doc.addPage(); h1(`${r.soa ? 5 : 4}. Evidence index`); para('Metadata only: the evidence files themselves are not included. The fingerprint is the SHA-256 recorded when the file was submitted.', { color: MUTED, size: 9 }); doc.moveDown(0.3);
    table([{ key: 'itemRef', label: 'Control', w: 1.2 }, { key: 'title', label: 'Request', w: 3 }, { key: 'status', label: 'Status', w: 1.3 }, { key: 'validity', label: 'Valid until', w: 1.5, color: (x: any) => x.expired ? '#b91c1c' : undefined }, { key: 'file', label: 'Latest file', w: 3 }, { key: 'sha', label: 'SHA-256 (first 16)', w: 2.3 }],
      r.evidence.map(x => ({ ...x, validity: x.validUntil ? x.validUntil + (x.expired ? ' (expired)' : '') : '', file: x.fileName ? `v${x.versions}: ${x.fileName}${x.uploadedBy ? ' — ' + x.uploadedBy : ''}` : '', sha: x.sha256 ? x.sha256.slice(0, 16) : '' })), 'No evidence requests.');
    // ---- headers and footers on every page
    const range = doc.bufferedPageRange(); for (let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); const b = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      if (i > 0) { doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(`${r.meta.organization} · ${e.name}`), x0, 36, { width: W, lineBreak: false }); if (e.classification) doc.text(latin(e.classification), x0, 36, { width: W, align: 'right', lineBreak: false }); }
      if (brand.footerText) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(latin(brand.footerText), x0, doc.page.height - 48, { width: W, lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${latin(brand.companyName)} · report ${r.meta.reportId.slice(0, 8)} · generated ${r.meta.generatedAt.slice(0, 10)}`, x0, doc.page.height - 36, { width: W / 1.5, lineBreak: false }); doc.text(`Page ${i + 1} of ${range.count}`, x0, doc.page.height - 36, { width: W, align: 'right', lineBreak: false }); doc.page.margins.bottom = b; }
    doc.end();
  });
}
