// Email content. PURE: (template, payload, origin) -> subject + plain text + HTML. No I/O, no clock, so every message can be tested exactly.
// Rules: plain text is always produced; the HTML repeats the same words (no images, no tracking, no remote resources); every link points at APP_ORIGIN and nowhere else;
// every dynamic value is HTML-escaped; header injection is impossible because subjects are built from fixed words plus a sanitized organization name.
export type Mail = { subject: string; text: string; html: string };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Removes control characters and newlines (header injection) and caps the length. */
export const oneLine = (s: unknown, max = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const ROLE_TEXT: Record<string, string> = { client_admin: 'client administrator', client_staff: 'client team member', third_party_vendor: 'third-party vendor', tp_auditor: 'third-party auditor', isecurify_team: 'iSecurify team member', admin: 'administrator', super_admin: 'super administrator' };
export type MailBrand = { name?: string; primaryColor?: string; footerText?: string };
const DEFAULT_BRAND = { name: 'iSecurify GRC', primary: '#812671', footer: '' };
/** Only well-formed values are used, so a bad branding row can never break or inject into an email. */
export const brandOf = (b?: MailBrand) => ({ name: oneLine(b?.name, 80) || DEFAULT_BRAND.name, primary: /^#[0-9a-f]{6}$/i.test(String(b?.primaryColor ?? '')) ? String(b!.primaryColor).toLowerCase() : DEFAULT_BRAND.primary, footer: oneLine(b?.footerText, 300) });
type B = ReturnType<typeof brandOf>;
const shell = (title: string, paragraphs: string[], cta: { label: string; url: string } | null, footer: string, B: B) => ({
  text: [title, '', ...paragraphs, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), '', footer, ...(B.footer ? [B.footer] : []), ''].join('\n'),
  html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1f2937"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:24px"><div style="font-size:18px;font-weight:bold;color:${B.primary}">${esc(B.name)}</div><h1 style="font-size:18px;margin:16px 0 8px">${esc(title)}</h1>${paragraphs.map(p => `<p style="font-size:14px;line-height:1.5;margin:8px 0">${esc(p)}</p>`).join('')}${cta ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="background:${B.primary};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">${esc(cta.label)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">If the button does not work, copy this link into your browser:<br>${esc(cta.url)}</p>` : ''}<p style="font-size:12px;color:#6b7280;margin-top:24px">${esc(footer)}</p>${B.footer ? `<p style="font-size:12px;color:#6b7280;margin:4px 0 0">${esc(B.footer)}</p>` : ''}</td></tr></table></td></tr></table></body></html>`,
});
export type Rendered = Mail & { template: string };
export const KIND_HEADLINE: Record<string, string> = { 'item.assigned': 'A checklist item was assigned to you', 'evidence.requested': 'Evidence was requested', 'evidence.rejected': 'Evidence was rejected', 'evidence.malware': 'Malware found in an uploaded file', 'finding.assigned': 'A finding was assigned to you', 'finding.ready_for_retest': 'A finding is ready for retest', 'risk.assigned': 'A risk was assigned to you', 'policy.published': 'A policy needs your acknowledgement', 'policy.review': 'A policy is waiting for your approval', 'incident.assigned': 'An incident was assigned to you', 'incident.reported': 'A serious incident was reported', 'vendor.assessment_requested': 'A security assessment was requested', 'vendor.assessment_decided': 'Your vendor assessment was reviewed', 'certificate.issued': 'A certificate was issued', 'certificate.revoked': 'A certificate was revoked', 'engagement.phase_advanced': 'An engagement moved to the next phase', 'evidence.accepted': 'Evidence was accepted', 'evidence.submitted': 'Evidence was submitted', 'finding.closed': 'A finding was closed', 'finding.reopened': 'A finding was reopened', 'vendor.assessment_submitted': 'A vendor assessment was submitted', 'risk.decision': 'A risk decision was made', 'finding.comment': 'New comment on a finding' };
export function render(template: string, p: any, origin: string, brand?: MailBrand): Rendered {
  const base = origin.replace(/\/+$/, ''); const B = brandOf(brand); const sh = (t: string, ps: string[], c: { label: string; url: string } | null, f: string) => shell(t, ps, c, f, B);
  if (template === 'email.password_reset') {
    const url = `${base}/reset-password?token=${encodeURIComponent(String(p.token ?? ''))}`; const subject = `Reset your ${B.name} password`;
    const m = sh('Reset your password', [`We received a request to reset the password for your ${B.name} account.`, 'This link works once and expires in 30 minutes.'], { label: 'Choose a new password', url }, 'If you did not ask for this, you can ignore this email: your password stays the same.');
    return { template, subject, ...m };
  }
  if (template === 'email.invitation') {
    const url = `${base}/accept-invite?token=${encodeURIComponent(String(p.token ?? ''))}`; const org = oneLine(p.orgName, 80); const role = ROLE_TEXT[String(p.role)] ?? 'member'; const days = Number(p.expiresInDays) > 0 ? Math.floor(Number(p.expiresInDays)) : null;
    const subject = org ? `You are invited to ${org} on ${B.name}` : `You are invited to ${B.name}`;
    const m = sh(org ? `Join ${org}` : `Join ${B.name}`, [org ? `You have been invited to ${org} on ${B.name} as a ${role}.` : `You have been invited to ${B.name} as a ${role}.`, days ? `This invitation expires in ${days} day${days === 1 ? '' : 's'} and can be used once.` : 'This invitation can be used once.'], { label: 'Accept the invitation', url }, 'If you were not expecting this invitation, you can ignore this email.');
    return { template, subject, ...m };
  }
  if (template === 'email.digest') {
    const groups: any[] = Array.isArray(p.groups) ? p.groups : []; const overdue = Number(p.overdue) || 0; const soon = Number(p.dueSoon) || 0; const unread = Number(p.unread) || 0; const name = oneLine(p.name, 60);
    const parts: string[] = []; if (overdue) parts.push(`${overdue} overdue`); if (soon) parts.push(`${soon} due soon`); if (unread) parts.push(`${unread} unread notification${unread === 1 ? '' : 's'}`);
    const subject = `Your ${B.name} digest: ${parts.join(', ') || 'nothing urgent'}`; const paras: string[] = [name ? `Hello ${name}, here is what needs your attention.` : 'Here is what needs your attention.'];
    for (const g of groups) { paras.push(`${oneLine(g.org, 80)}`); for (const l of [...(g.overdue ?? []), ...(g.dueSoon ?? [])]) paras.push(`  • ${oneLine(l, 200)}`); if (Number(g.more) > 0) paras.push(`  … and ${Number(g.more)} more`); }
    if (unread) paras.push(`You have ${unread} unread notification${unread === 1 ? '' : 's'} in the app.`);
    const m = sh('Your daily digest', paras, { label: `Open ${B.name}`, url: `${base}/notifications` }, 'You can switch this digest off or make it weekly under Notifications → Email digest.'); return { template, subject, ...m };
  }
  if (template === 'email.test') {
    const m = sh('Test message', [`This is a test message from your ${B.name} server.`, 'If you can read this, outgoing email is working.'], null, 'Sent because an administrator asked for a test message.'); return { template, subject: `${B.name} test message`, ...m };
  }
  if (template === 'email.notification') {
    const headline = KIND_HEADLINE[String(p.kind)] ?? 'New notification'; const name = oneLine(p.name, 60); const label = oneLine(p.label, 240); const org = oneLine(p.org, 80);
    const paras = [name ? `Hello ${name},` : 'Hello,', label, ...(org ? [`Organization: ${org}`] : [])];
    const m = sh(headline, paras, { label: `Open ${B.name}`, url: `${base}/notifications` }, 'You can choose which notifications are emailed under Notifications → Settings.'); return { template, subject: `${B.name}: ${headline}`, ...m };
  }
  if (template === 'email.alert') {
    const list: string[] = (Array.isArray(p.alerts) ? p.alerts : []).slice(0, 20).map((x: unknown) => oneLine(x, 300)).filter(Boolean); const name = oneLine(p.name, 60);
    const m = sh('Attention needed', [name ? `Hello ${name},` : 'Hello,', 'These items need attention on your installation:', ...list.map(x => `  • ${x}`)], { label: 'Open System status', url: `${base}/platform/system` }, 'Sent to administrators when backups, disk space or storage limits need attention. The same problem is mailed once a day.'); return { template, subject: `${B.name}: attention needed (${list.length})`, ...m };
  }
  throw new Error(`unknown email template ${template}`);
}
