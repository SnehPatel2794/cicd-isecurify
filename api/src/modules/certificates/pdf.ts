// The certificate itself: one landscape A4 page with a QR code that opens the public status page. Built-in Helvetica (Western-European text; other scripts show as "?").
import PDFDocument from 'pdfkit'; import QRCode from 'qrcode'; import { latin } from '../reports/pdf'; import { DEFAULTS, type Brand } from '../branding/rules';
export type CertDoc = { number: string; organizationName: string; frameworkName: string; frameworkVersion: number; scope: string; issuedOn: string; validUntil: string; verifyUrl: string; issuedBy: string; engagementName: string; opinion?: string | null };
const INK = '#1f2937', MUTED = '#6b7280';
export async function renderCertificate(c: CertDoc, brand: Brand = { ...DEFAULTS, logo: null }): Promise<Buffer> {
  const BRAND = brand.primaryColor;
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: latin(`Certificate ${c.number}`), Author: latin(brand.companyName), Subject: latin(`${c.organizationName} — ${c.frameworkName}`), CreationDate: new Date(c.issuedOn + 'T00:00:00Z') } });
    const chunks: Buffer[] = []; doc.on('data', b => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width, H = doc.page.height; doc.rect(24, 24, W - 48, H - 48).lineWidth(2).strokeColor(BRAND).stroke(); doc.rect(32, 32, W - 64, H - 64).lineWidth(0.5).strokeColor(BRAND).stroke();
    if (brand.logo) { try { doc.image(brand.logo, W / 2 - 90, 38, { fit: [180, 40], align: 'center' }); } catch { /* an unreadable logo never blocks a certificate */ } }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(latin(brand.companyName).toUpperCase(), 0, brand.logo ? 80 : 62, { width: W, align: 'center', characterSpacing: 3 });
    doc.font('Helvetica-Bold').fontSize(30).fillColor(INK).text('Certificate of Assessment', 0, 92, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('This is to certify that', 0, 146, { width: W, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(24).fillColor(BRAND).text(latin(c.organizationName), 60, 170, { width: W - 120, align: 'center' });
    doc.font('Helvetica').fontSize(12).fillColor(INK).text(latin(`was assessed by ${brand.companyName} against ${c.frameworkName} (version ${c.frameworkVersion}) and the applicable controls within the scope below were found to be in place and effective as at ${c.issuedOn}.`), 110, doc.y + 12, { width: W - 220, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('SCOPE', 110, doc.y + 16, { width: W - 220, align: 'center', characterSpacing: 1.5 }); doc.font('Helvetica').fontSize(11).fillColor(INK).text(latin(c.scope), 110, doc.y + 3, { width: W - 220, align: 'center', height: 70, ellipsis: true });
    const y = H - 150; const col = (x: number, label: string, value: string, w = 150) => { doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 1 }); doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(latin(value), x, y + 13, { width: w }); };
    col(70, 'Certificate number', c.number, 170); col(250, 'Issued', c.issuedOn, 110); col(370, 'Valid until', c.validUntil, 110); col(490, 'Engagement', c.engagementName, 150);
    if (c.opinion === 'qualified') doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('AUDITOR OPINION: QUALIFIED. See the assessment report for the exceptions noted.', 70, y + 40, { width: W - 250 });
    doc.image(qr, W - 150, H - 170, { width: 84 }); doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Scan to verify', W - 150, H - 84, { width: 84, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(`Verify this certificate at ${c.verifyUrl}. A certificate that is revoked, superseded or past its valid-until date is shown as such there; this printed copy does not update.`), 70, H - 70, { width: W - 250 });
    if (brand.footerText) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(brand.footerText), 70, H - 52, { width: W - 250 });
    doc.end();
  });
}
