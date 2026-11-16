# Outgoing email (Phase 7A)

The **worker** sends all email; the API only queues it. Messages: invitations, password resets, the daily digest, notification emails and the admin test message.

## Setup
Put these in `.env` (see `.env.example`) and restart `api` and `worker`:

| Setting | Meaning |
|---|---|
| `SMTP_HOST` | Mail server. Empty = email not configured. |
| `SMTP_PORT` | Default 587 (STARTTLS) or 465 (`SMTP_TLS=tls`). |
| `SMTP_TLS` | `starttls` (default; the connection must upgrade to TLS or the send fails), `tls` (implicit TLS), `none` (development only; the worker refuses to send with it in production). |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional login. Only the worker uses them; they are never shown in the app. |
| `MAIL_FROM` | Required with `SMTP_HOST`. e.g. `iSecurify GRC <noreply@your-domain.com>`. Use an address your provider allows, and set SPF/DKIM for that domain. |
| `MAIL_REPLY_TO` | Optional. |
| `APP_ORIGIN` | Already set from `DOMAIN`. Every link in an email points only here. |

Then open **Administration → Email delivery**, send a test message to yourself and check the log.

## Google Workspace
1. Use a dedicated mailbox, for example `noreply@your-domain.com`, and turn on 2-Step Verification for it.
2. Create an **App Password** (Google Account → Security → App passwords). Use it as `SMTP_PASSWORD`. Never use the account password.
3. Settings: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_TLS=starttls`, `SMTP_USER=<the mailbox>`, `MAIL_FROM=iSecurify GRC <the mailbox>`.
4. `MAIL_FROM` must be that mailbox or an alias set under "Send mail as"; otherwise Google rewrites the sender.
5. Set SPF, DKIM and DMARC for your domain in Google Admin. Google limits sending to about 2,000 messages a day per user; the hourly cap per person (below) keeps this platform far from it.
Settings come only from `.env` (nothing is stored in the database), so changing provider later is an edit and a restart.

## Notification emails (Phase 10C)
- A business change writes an **outbox event** in the same database transaction. The worker reads events every few seconds and queues the email. If the mail server is down the email job is retried; if the worker is down the events wait. An email failure never affects the action that caused it.
- Each person chooses, per kind, whether to also receive the notification by email (Notifications → settings). Important kinds (assignments, requests, rejections, malware found, serious incidents, certificates and similar) are emailed by default; the rest stay in the app.
- Nothing is emailed when the notification was already read, the account is not active, or the person already got 20 notification emails in the last hour (the daily digest still covers them).
- The email holds the short notification line, the organization name and one link to the app. It never holds files, findings text beyond that line, or tokens.
- New events: **malware found** (uploader and requester are notified, only if they still have access) and **phase advanced** (every member of the engagement except the person who advanced it).
- An event that fails 5 times is parked as dead. *Administration → Email delivery* lists parked events with the reason and has a **Retry parked events** button (also audited). Delivered emails are logged exactly as before.
- Invitations were already emailed directly, so there is no separate "member invited" event.

## Behaviour
- **Retries.** A mail server outage is retried with back-off. If the job crashes after sending, the retry notices the message is already logged and does not send it again.
- **Permanent errors** (mailbox does not exist, recipient refused, invalid address) are logged as failed straight away and not retried. Wrong credentials or a missing configuration are treated as setup problems: retried, then logged as failed after the last attempt.
- **Not configured.** In production the job fails and is retried (so messages are not lost if you configure email a few minutes late). In development, set `EMAIL_DEV_LOG=true` to print messages to the worker log instead; this is ignored in production.
- **Log.** `email_log` stores recipient, subject, result, error text and attempts. It never stores the message text, links or one-time tokens; the queued job payload that holds the token is erased after delivery. The table is append-only (database triggers and permissions).
- **Messages.** Plain text plus simple HTML, no images, no tracking, one link each, marked `Auto-Submitted`. Recipient-controlled text (organization names) cannot inject headers or markup.

## Not covered yet
Bounce handling and a stored (database) SMTP configuration; by decision, settings stay in `.env`. (The daily digest is described in docs/REMINDERS.md.)
