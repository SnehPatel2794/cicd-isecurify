import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import { SMTPServer } from 'smtp-server'; import type { AddressInfo } from 'node:net';
import { freshDb } from './helpers'; import { enqueue, runOnce, claim } from '../src/queue';
import { render, esc, oneLine } from '../src/mail/templates'; import { mailConfigFromEnv, makeTransport, type MailConfig } from '../src/mail/smtp'; import { makeEmailHandler, type MailEnv } from '../src/mail/handlers';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; before(async () => { db = await freshDb(); }); after(() => db.close());
const ORIGIN = 'https://grc.example.com'; const TOKEN = 'tok_ABC-123_secret';

type Inbox = { from: string; to: string[]; raw: string }[];
async function fakeSmtp(o: { auth?: { user: string; pass: string }; rejectRcpt?: string } = {}) {
  const inbox: Inbox = [];
  const srv = new SMTPServer({ authOptional: !o.auth, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(a, _s, cb) { if (o.auth && a.username === o.auth.user && a.password === o.auth.pass) return cb(null, { user: a.username }); cb(Object.assign(new Error('Invalid credentials'), { responseCode: 535 })); },
    onRcptTo(addr, _s, cb) { if (o.rejectRcpt && addr.address === o.rejectRcpt) return cb(Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 })); cb(); },
    onData(stream, session, cb) { const chunks: Buffer[] = []; stream.on('data', c => chunks.push(c)); stream.on('end', () => { inbox.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as any).address : '', to: session.envelope.rcptTo.map(r => r.address), raw: Buffer.concat(chunks).toString('utf8') }); cb(); }); } });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); const port = (srv.server.address() as AddressInfo).port;
  return { port, inbox, close: () => new Promise<void>(r => srv.close(() => r())) };
}
const cfgFor = (port: number, o: Partial<MailConfig> = {}): MailConfig => ({ host: '127.0.0.1', port, secure: false, requireTLS: false, from: 'iSecurify GRC <noreply@example.com>', origin: ORIGIN, allowPlain: true, ...o });
const envWith = (cfg: MailConfig | null, dev = false): MailEnv & { devLogged: any[] } => { const devLogged: any[] = []; return { config: () => cfg, transport: c => makeTransport(c), devLog: (o) => devLogged.push(o), devLogEnabled: () => dev, devLogged }; };
const logRows = async (jobId?: number) => ((await pool().query(`SELECT * FROM email_log ${jobId ? 'WHERE job_id=' + Number(jobId) : ''} ORDER BY id`))[0] as any[]);
const jobRow = async () => ((await pool().query('SELECT id,status,attempts,last_error,payload FROM jobs ORDER BY id DESC LIMIT 1'))[0] as any[])[0];
const run = async (env: MailEnv, template = 'email.password_reset', payload: any = { to: 'user@example.org', token: TOKEN }, maxAttempts = 3) => { await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: template, payload, maxAttempts }); return runOnce(pool(), { [template]: makeEmailHandler(template, env) }); };
const retryNow = () => pool().query("UPDATE jobs SET run_at=NOW(3) - INTERVAL 1 SECOND WHERE status='pending'");

// ---------------------------------------------------------------- templates (pure)
test('password reset: subject, expiry, one link on our origin with the encoded token; plain text and HTML say the same', () => {
  const m = render('email.password_reset', { token: 'a b/c?d' }, ORIGIN + '/'); assert.equal(m.subject, 'Reset your iSecurify GRC password'); const link = `${ORIGIN}/reset-password?token=a%20b%2Fc%3Fd`;
  assert.ok(m.text.includes(link)); assert.ok(m.html.includes(esc(link))); assert.match(m.text, /30 minutes/); assert.match(m.html, /30 minutes/); assert.ok(!/<img|<script|<iframe|src=/i.test(m.html), 'no remote content or scripts');
  for (const href of [...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1])) assert.ok(href.startsWith(ORIGIN + '/'), href);
});
test('invitation: organization and role in words, expiry, accept link; hostile organization names cannot inject headers or markup', () => {
  const m = render('email.invitation', { token: TOKEN, role: 'tp_auditor', orgName: 'Acme\r\nBcc: evil@x.test <script>alert(1)</script>', expiresInDays: 7 }, ORIGIN);
  assert.ok(!/[\r\n]/.test(m.subject), 'subject is one line'); assert.ok(!m.html.includes('<script>')); assert.match(m.html, /&lt;script&gt;/); assert.match(m.text, /third-party auditor/); assert.match(m.text, /7 days/); assert.ok(m.text.includes(`${ORIGIN}/accept-invite?token=${TOKEN}`));
  assert.equal(render('email.invitation', { token: 'x', role: 'client_admin', orgName: null, expiresInDays: 1 }, ORIGIN).subject, 'You are invited to iSecurify GRC'); assert.match(render('email.invitation', { token: 'x', role: 'client_admin', expiresInDays: 1 }, ORIGIN).text, /1 day and/);
  assert.equal(oneLine('a\u0000b\n\nc  d', 10), 'a b c d'); assert.equal(oneLine('x'.repeat(200), 80).length, 80); assert.throws(() => render('email.nope', {}, ORIGIN), /unknown email template/);
});
// ---------------------------------------------------------------- configuration
test('SMTP configuration: absent when SMTP_HOST is empty; strict about TLS mode, production, sender and port', () => {
  assert.equal(mailConfigFromEnv({} as any), null); assert.equal(mailConfigFromEnv({ SMTP_HOST: '  ' } as any), null);
  const ok = mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'noreply@example.com' } as any)!; assert.deepEqual([ok.port, ok.secure, ok.requireTLS, ok.allowPlain], [587, false, true, false]);
  const tls = mailConfigFromEnv({ SMTP_HOST: 'h', SMTP_TLS: 'tls', MAIL_FROM: 'iSecurify <n@example.com>' } as any)!; assert.deepEqual([tls.port, tls.secure, tls.requireTLS], [465, true, false]);
  assert.throws(() => mailConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'n@example.com', SMTP_TLS: 'none', NODE_ENV: 'production' } as any), /not allowed in production/); assert.equal(mailConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'n@example.com', SMTP_TLS: 'none' } as any)!.allowPlain, true);
  assert.throws(() => mailConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'not an address' } as any), /MAIL_FROM/); assert.throws(() => mailConfigFromEnv({ SMTP_HOST: 'h' } as any), /MAIL_FROM/); assert.throws(() => mailConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'a@b.co', SMTP_TLS: 'sometimes' } as any), /SMTP_TLS/); assert.throws(() => mailConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'a@b.co', SMTP_PORT: '99999' } as any), /SMTP_PORT/);
});
// ---------------------------------------------------------------- delivery
test('delivery: the message arrives with the right headers and link; the log records it without any token or link; the job payload (token) is erased', async () => {
  const smtp = await fakeSmtp(); await run(envWith(cfgFor(smtp.port))); const j = await jobRow(); assert.equal(j.status, 'done'); assert.equal(j.payload, null, 'one-time token no longer stored');
  assert.equal(smtp.inbox.length, 1); const m = smtp.inbox[0]; assert.deepEqual(m.to, ['user@example.org']); assert.equal(m.from, 'noreply@example.com'); assert.match(m.raw, /Subject: Reset your iSecurify GRC password/); assert.match(m.raw, /Auto-Submitted: auto-generated/); assert.ok(m.raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=').includes(`reset-password?token=${TOKEN}`));
  const rows = await logRows(j.id); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'sent'); assert.equal(rows[0].to_email, 'user@example.org'); assert.ok(rows[0].message_id); assert.ok(!JSON.stringify(rows).includes(TOKEN), 'log holds no token'); assert.ok(!JSON.stringify(rows).includes('reset-password'), 'log holds no link'); await smtp.close();
});
test('a retry after a crash does not send twice (the job id is already logged as sent)', async () => {
  const smtp = await fakeSmtp(); const env = envWith(cfgFor(smtp.port)); await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'email.invitation', payload: { to: 'new@example.org', token: TOKEN, role: 'client_staff', orgName: 'Acme', expiresInDays: 7 } });
  const job = (await claim(pool()))!; const h = makeEmailHandler('email.invitation', env); await h(job, { pool: pool() }); await h(job, { pool: pool() }); assert.equal(smtp.inbox.length, 1); assert.equal((await logRows(job.id)).length, 1); await smtp.close();
});
test('SMTP authentication: right credentials deliver; wrong credentials are a configuration problem, retried, and recorded as failed only after the last attempt', async () => {
  const smtp = await fakeSmtp({ auth: { user: 'mailer', pass: 'pw' } }); await run(envWith(cfgFor(smtp.port, { user: 'mailer', pass: 'pw' }))); assert.equal(smtp.inbox.length, 1); assert.equal((await jobRow()).status, 'done');
  const bad = envWith(cfgFor(smtp.port, { user: 'mailer', pass: 'WRONG' })); await run(bad); let j = await jobRow(); assert.equal(j.status, 'pending', 'retry later'); assert.equal((await logRows(j.id)).length, 0); await retryNow(); await runOnce(pool(), { 'email.password_reset': makeEmailHandler('email.password_reset', bad) }); assert.equal((await logRows(j.id)).length, 0); await retryNow();
  await runOnce(pool(), { 'email.password_reset': makeEmailHandler('email.password_reset', bad) }); j = await jobRow(); assert.equal(j.status, 'dead'); const r = await logRows(j.id); assert.equal(r.length, 1); assert.equal(r[0].status, 'failed'); assert.equal(r[0].attempts, 3); assert.match(r[0].error, /credentials|auth/i); assert.equal(smtp.inbox.length, 1, 'nothing extra was sent'); await smtp.close();
});
test('a recipient the server refuses is recorded as failed at once and never retried', async () => {
  const smtp = await fakeSmtp({ rejectRcpt: 'gone@example.org' }); await run(envWith(cfgFor(smtp.port)), 'email.password_reset', { to: 'gone@example.org', token: TOKEN }); const j = await jobRow(); assert.equal(j.status, 'done'); const r = await logRows(j.id); assert.equal(r.length, 1); assert.equal(r[0].status, 'failed'); assert.equal(r[0].attempts, 1); assert.equal(smtp.inbox.length, 0);
  await run(envWith(cfgFor(smtp.port)), 'email.password_reset', { to: 'not-an-address', token: TOKEN }); const r2 = await logRows((await jobRow()).id); assert.equal(r2[0].status, 'failed'); assert.match(r2[0].error, /invalid recipient/); await smtp.close();
});
test('mail server down: retried with back-off, failure recorded only after the last attempt', async () => {
  const tmp = await fakeSmtp(); const port = tmp.port; await tmp.close(); const env = envWith(cfgFor(port)); await run(env, 'email.invitation', { to: 'a@example.org', token: TOKEN, role: 'client_admin', orgName: 'X', expiresInDays: 7 }, 2); let j = await jobRow(); assert.equal(j.status, 'pending'); assert.equal((await logRows(j.id)).length, 0);
  await retryNow(); await runOnce(pool(), { 'email.invitation': makeEmailHandler('email.invitation', env) }); j = await jobRow(); assert.equal(j.status, 'dead'); assert.equal((await logRows(j.id))[0].status, 'failed'); assert.match((await logRows(j.id))[0].error, /ECONNREFUSED|connect/i);
});
test('not configured: production fails loudly (retry, then a failed row); development logging prints the message and writes no log row; links never reach the production log', async () => {
  const prod = envWith(null, false); await run(prod, 'email.password_reset', { to: 'u@example.org', token: TOKEN }, 1); let j = await jobRow(); assert.equal(j.status, 'dead'); assert.match(j.last_error, /not configured/); assert.equal((await logRows(j.id))[0].status, 'failed');
  const dev = envWith(null, true); await run(dev); j = await jobRow(); assert.equal(j.status, 'done'); assert.equal((await logRows(j.id)).length, 0); assert.equal(dev.devLogged.length, 1); assert.ok(dev.devLogged[0].text.includes(TOKEN));
  assert.ok(!JSON.stringify(prod.devLogged).includes(TOKEN));
});
test('the test message and the log table: append-only, and a missing recipient is an error', async () => {
  const smtp = await fakeSmtp(); await run(envWith(cfgFor(smtp.port)), 'email.test', { to: 'admin@example.org' }); assert.match(smtp.inbox[0].raw, /Subject: iSecurify GRC test message/); await smtp.close();
  await assert.rejects(() => pool().query("UPDATE email_log SET status='failed', error='x'"), /append-only/); await assert.rejects(() => pool().query('DELETE FROM email_log'), /append-only/);
  await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'email.test', payload: {}, maxAttempts: 1 }); await runOnce(pool(), { 'email.test': makeEmailHandler('email.test', envWith(null)) }); assert.equal((await jobRow()).status, 'dead');
});
test('digest email is delivered through the same path, and the queued content (item titles) is erased afterwards', async () => {
  const smtp = await fakeSmtp(); await run(envWith(cfgFor(smtp.port)), 'email.digest', { to: 'p@example.org', name: 'Priya', groups: [{ org: 'Acme', tenantId: 't', overdue: ['F-001 Weak passwords — overdue by 2 days (was due 2026-10-22)'], dueSoon: [], more: 0 }], unread: 2, overdue: 1, dueSoon: 0 });
  const j = await jobRow(); assert.equal(j.status, 'done'); assert.equal(j.payload, null); assert.match(smtp.inbox[0].raw, /Subject: Your iSecurify GRC digest: 1 overdue, 2 unread notifications/); assert.match(smtp.inbox[0].raw, /Weak passwords/); const r = await logRows(j.id); assert.equal(r[0].status, 'sent'); assert.ok(!JSON.stringify(r).includes('Weak passwords'), 'the log never keeps content'); await smtp.close();
});

test('branding: name, colour and footer reach the subject and the message; hostile or malformed values cannot', () => {
  const brand = { name: 'Acme Assurance', primaryColor: '#1D4ED8', footerText: 'Confidential. Acme Assurance Ltd.' };
  const m = render('email.invitation', { token: 'tok', orgName: 'Org A', role: 'client_admin', expiresInDays: 7 }, 'https://grc.example.com', brand);
  assert.equal(m.subject, 'You are invited to Org A on Acme Assurance'); assert.ok(m.text.includes('Acme Assurance') && !m.text.includes('iSecurify')); assert.ok(m.text.includes('Confidential. Acme Assurance Ltd.')); assert.ok(m.html.includes('#1d4ed8') && !m.html.includes('#812671')); assert.ok(m.html.includes('Confidential. Acme Assurance Ltd.'));
  assert.equal(render('email.password_reset', { token: 't' }, 'https://x.test', brand).subject, 'Reset your Acme Assurance password'); assert.match(render('email.digest', { groups: [], overdue: 1 }, 'https://x.test', brand).subject, /^Your Acme Assurance digest/);
  const evil = render('email.test', {}, 'https://x.test', { name: '<script>alert(1)</script>\r\nBcc: x@evil.test', primaryColor: 'red;background:url(//evil)', footerText: '<img src=x onerror=1>' }); assert.ok(!evil.html.includes('<script>') && !evil.html.includes('<img src=x')); assert.ok(!/[\r\n]/.test(evil.subject)); assert.ok(evil.html.includes('#812671') && !evil.html.includes('evil)'));
  const plain = render('email.test', {}, 'https://x.test'); assert.ok(plain.text.includes('iSecurify GRC') && plain.html.includes('#812671'), 'defaults are unchanged');
});

test('brandFor reads the profile from the database, and the defaults apply when it cannot', async () => {
  const { brandFor } = await import('../src/mail/handlers');
  assert.deepEqual(await brandFor(pool()), { name: 'iSecurify GRC', primaryColor: '#812671', footerText: '' });
  await pool().query("UPDATE branding_profile SET company_name='Acme Assurance', primary_color='#1d4ed8', footer_text='Confidential' WHERE id=1"); const b = await brandFor(pool()); assert.equal(b!.name, 'Acme Assurance'); assert.ok(render('email.test', {}, ORIGIN, b).html.includes('#1d4ed8'));
  assert.equal(await brandFor({ query: async () => { throw new Error('down'); } } as any), undefined);
});
