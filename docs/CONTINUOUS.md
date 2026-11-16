# Continuous controls (Phase 11A)

Compliance is not a one-off. Three things keep a control honest between audits. Screen: **Continuous controls** in the organization menu.

## 1. Recurring control tests
A test belongs to one checklist item: a title, optional steps, and how often (weekly, monthly, quarterly, every 6 months, yearly).
- **Who creates:** client admins and iSecurify team members with manage rights. Up to 20 tests per item. Not allowed on "not applicable" items or closed engagements.
- **Who is responsible:** the owner chosen for the test, otherwise the person accountable for the item.
- **Who records a result:** the responsible person (client staff or vendor), a client admin, or managing iSecurify staff. TP auditors only read. A **note is required** (what was done and found). The date defaults to today; it can be back-dated up to a year, never into the future.
- **What happens:** the next due date moves one period after the date performed (31 Jan + 1 month = 28/29 Feb). A **fail** marks the test "Last test failed" until a later pass, and notifies the client admins, the accountable person and the owner (not the person who recorded it). The newest *performed* date decides the state, so a late back-filled entry cannot hide a recent failure.
- **History is append-only:** results are never edited or deleted (the application's database account has no right to).
- **States:** On track, Due soon (7 days), Overdue, Last test failed, Paused.

## 2. Evidence refresh schedules
"This evidence must be asked for again every N months." A schedule holds the request title, instructions, optional template, validity and how many days the person has to deliver.
- When it is due, a manager clicks **Request now** (or "open all due" for an engagement). That creates the normal evidence request, exactly as if asked by hand: same limits, same audit entry, same notification. The schedule then moves on by its period.
- **The worker never creates requests itself.** It only reminds. This is deliberate: nothing changes a control's status without a person, and the worker keeps its limited database rights.
- If a request cannot be opened (item not applicable, too many open requests, template retired) the reason is reported and the schedule stays due.

## 3. Compliance posture over time
Every day (from 03:00 UTC, after the reminder scan) the worker stores one snapshot **per active engagement and framework**: applicable controls, effective, awaiting review, overdue, percentage, plus test health. The screen shows today's live score, the 30-day change and a trend line for 30 to 365 days. History builds one point per day from the day this phase is installed; there is no back-fill.
- **Per-framework score** uses the same evaluation rules as engagement readiness. An item counts toward every framework it satisfies. Custom items (no linked control) belong to no framework, so they are part of the engagement's readiness but not of a framework score.
- Visible to client admins, auditors on the engagement, and iSecurify staff. Client staff and vendors do not see it.

## Reminders
The daily run sends one in-app notification per person, thing, due date and stage: **due** (from the due date up to 6 days late) and **overdue** (7 days late and more). An unread earlier notice on the same item holds the next one back (no pile-up; it is retried the next day). Kinds `control_test.due`, `control_test.failed` and `evidence.refresh_due` can be switched off per person under Notifications. Nothing is sent for paused items, not-applicable items, closed engagements or disabled users.

## Operating notes
- Tables: `control_tests`, `control_test_runs`, `evidence_schedules`, `posture_snapshots`, `continuous_notice_log` (migration 026). Snapshots are written only by the worker; runs are insert-only.
- Run the day's job again safely at any time: snapshots replace the same day's row, notices are remembered.
- Tests: `api/test/49_continuous.test.ts`, `worker/test/continuous.test.ts`, `web/src/pages22.test.tsx`.
