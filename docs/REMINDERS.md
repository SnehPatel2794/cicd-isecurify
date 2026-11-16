# Reminders and the email digest (Phase 7C)

## The daily scan
The worker runs `reminders.scan` once per UTC day, from 03:00 UTC (08:30 in India). It looks for:
- **Evidence requests** with a due date that are still `requested` or `rejected` (waiting on the accountable person; submitted and accepted ones are not reminders), on items that are not "not applicable".
- **Findings** with a due date that are not closed, risk-accepted or cancelled, to the finding's owner.

Only active engagements in active organizations, for active users who can still enter the organization, are included.

| Stage | When | Repeats |
|---|---|---|
| `reminder.due_soon` | due today or within the next 3 days | never (once per due date) |
| `reminder.overdue` | from the first day late | on day 8, 15, 22 ... (weekly) |

Each reminder appears in the bell (kind `reminder.*`, shown as "Due soon" / "Overdue") with a label such as `A.5.1: Policy — overdue by 3 days (was due 2026-10-21)`.

### Never twice
`reminder_log` holds one row per person, thing, stage, due date and weekly step. Running the scan again (or after a crash) adds nothing. Moving the due date starts fresh. If you already have an unread reminder of the same kind for the same thing, a new one is not stacked on top of it. If someone switches a reminder kind off, that stage is skipped and not replayed later.

## The email digest
After the scan, each person with something to say gets **one** email: their overdue and due-soon items grouped by organization (up to 10 per organization, then "and N more") and a count of unread notifications. Nothing is sent when there is nothing to say.
- Default is **daily**; each person can choose daily, weekly or never under **Notifications → Email digest** (`GET|PUT /me/email-digest`).
- At most one per day (the job has a per-person, per-day key), and weekly means at least 7 days apart.
- **If outgoing email is not configured** (see `docs/EMAIL.md`) digests are skipped and logged; in-app reminders still go out.
- The email has no tokens and no tracking; its only link is to `/notifications` on your own domain. Item titles are in the email, but not in `email_log`, and the queued content is erased after delivery.

## Operating notes
- To change how soon "due soon" is, edit `SOON_DAYS` in `worker/src/reminders/rules.ts`; to change the default digest from daily to off, change the column default in `migrations/011_reminders.sql` before first deploy and the fallback in `reminders/scan.ts`.
- `reminder_log` rows are removed after 400 days by the hourly cleanup. Deleting an account removes its digest setting and log rows.
- Reminders are calendar-date based in UTC, the same "today" the findings screens use.
