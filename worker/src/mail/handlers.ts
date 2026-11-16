// Email jobs: render -> send -> log. The log never holds a body or a link. Retries cover outages; unfixable errors (bad recipient) are recorded at once.
import type { Handler, Pool } from '../queue'; import type { Transporter } from 'nodemailer';
import { render } from './templates'; import { mailConfigFromEnv, makeTransport, sendMail, isPermanent, type MailConfig } from './smtp';
/** The name, colour and footer from the branding profile. If the table cannot be read the defaults are used: a branding problem must never stop an email. */
export async function brandFor(pool: Pool) { try { const [r] = await pool.query('SELECT company_name name, primary_color primaryColor, footer_text footerText FROM branding_profile WHERE id=1') as any; return r[0] ?? undefined; } catch { return undefined; } }
export type MailEnv = { config: () => MailConfig | null; transport: (c: MailConfig) => Transporter; devLog: (line: Record<string, unknown>, msg: string) => void; devLogEnabled: () => boolean };
let cached: { key: string; t: Transporter } | null = null;
export const defaultMailEnv = (log: { warn: (o: any, m?: string) => void }): MailEnv => ({
  config: () => mailConfigFromEnv(),
  transport: (c) => { const key = JSON.stringify([c.host, c.port, c.secure, c.user]); if (!cached || cached.key !== key) cached = { key, t: makeTransport(c) }; return cached.t; },
  devLog: (o, m) => log.warn(o, m), devLogEnabled: () => process.env.EMAIL_DEV_LOG === 'true' && process.env.NODE_ENV !== 'production',
});
const logRow = (pool: Pool, r: { jobId: number; template: string; to: string; subject: string; status: 'sent' | 'failed'; messageId?: string | null; error?: string | null; attempts: number }) =>
  pool.query('INSERT INTO email_log(job_id,template,to_email,subject,status,message_id,error,attempts) VALUES (?,?,?,?,?,?,?,?)', [r.jobId, r.template, r.to.slice(0, 190), r.subject.slice(0, 300), r.status, r.messageId?.slice(0, 300) ?? null, r.error?.slice(0, 500) ?? null, r.attempts]);
export const makeEmailHandler = (template: string, env: MailEnv): Handler => async (job, { pool }) => {
  const to = String(job.payload?.to ?? '').trim(); if (!to) throw new Error('email job has no recipient');
  const [done] = await pool.query("SELECT 1 x FROM email_log WHERE job_id=? AND status='sent' LIMIT 1", [job.id]) as any; if (done.length) return;   // a retry after a crash must not send twice
  const cfg = env.config();
  const last = job.attempts >= job.max_attempts; let subject = template;
  try {
    const origin = cfg?.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:5173'; const m = render(template, job.payload, origin, await brandFor(pool)); subject = m.subject;
    if (!cfg) {
      if (env.devLogEnabled()) { env.devLog({ to, template, subject, text: m.text }, 'DEV email (SMTP is not configured)'); return; }
      throw new Error('outgoing email is not configured: set SMTP_HOST and MAIL_FROM on the worker');
    }
    const sent = await sendMail(env.transport(cfg), cfg, to, m);
    await logRow(pool, { jobId: job.id, template, to, subject, status: 'sent', messageId: sent.messageId, attempts: job.attempts }); return;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 480);
    if (isPermanent(e)) { await logRow(pool, { jobId: job.id, template, to, subject, status: 'failed', error: msg, attempts: job.attempts }); return; }   // retrying cannot help; the failure is on record
    if (last) await logRow(pool, { jobId: job.id, template, to, subject, status: 'failed', error: msg, attempts: job.attempts });
    throw e;
  }
};
