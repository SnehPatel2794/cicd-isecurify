// SMTP delivery with nodemailer. Configuration comes only from the environment; nothing here logs a message body or a link.
import nodemailer, { type Transporter } from 'nodemailer';
export type MailConfig = { host: string; port: number; secure: boolean; requireTLS: boolean; user?: string; pass?: string; from: string; replyTo?: string; origin: string; allowPlain: boolean };
/** null when SMTP_HOST is not set. SMTP_TLS: "starttls" (default, TLS is REQUIRED), "tls" (implicit TLS, usually port 465) or "none" (development only, refused when NODE_ENV=production). */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const host = (env.SMTP_HOST ?? '').trim(); if (!host) return null;
  const mode = (env.SMTP_TLS ?? 'starttls').toLowerCase(); if (!['starttls', 'tls', 'none'].includes(mode)) throw new Error('SMTP_TLS must be starttls, tls or none');
  if (mode === 'none' && env.NODE_ENV === 'production') throw new Error('SMTP_TLS=none is not allowed in production');
  const from = (env.MAIL_FROM ?? '').trim(); if (!/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/.test(from)) throw new Error('MAIL_FROM must be an address such as "iSecurify GRC <noreply@example.com>"');
  const port = Number(env.SMTP_PORT ?? (mode === 'tls' ? 465 : 587)); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid');
  return { host, port, secure: mode === 'tls', requireTLS: mode === 'starttls', user: env.SMTP_USER || undefined, pass: env.SMTP_PASSWORD || undefined, from, replyTo: env.MAIL_REPLY_TO || undefined, origin: (env.APP_ORIGIN || 'http://localhost:5173'), allowPlain: mode === 'none' };
}
export const makeTransport = (c: MailConfig): Transporter => nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, requireTLS: c.requireTLS, ignoreTLS: c.allowPlain, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, tls: { minVersion: 'TLSv1.2' } });
export type Sent = { messageId: string | null };
export async function sendMail(t: Transporter, c: MailConfig, to: string, m: { subject: string; text: string; html: string }): Promise<Sent> {
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) throw new PermanentMailError('invalid recipient address');
  const info = await t.sendMail({ from: c.from, to, replyTo: c.replyTo, subject: m.subject, text: m.text, html: m.html, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
  const rejected = [...(info.rejected ?? [])]; if (rejected.length) throw new PermanentMailError('recipient rejected by the mail server');
  return { messageId: info.messageId ?? null };
}
/** Errors that retrying cannot fix (bad address, rejected recipient): the job records a failure at once instead of retrying. */
export class PermanentMailError extends Error {}
export const isPermanent = (e: any) => e instanceof PermanentMailError || (typeof e?.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600 && e.responseCode !== 535 && e.responseCode !== 530);
