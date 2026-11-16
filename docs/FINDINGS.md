# Findings (Phase 6: API, screens, remediation tracking, remediation evidence)

A finding is an audit issue raised against ONE checklist item of an engagement. Findings are never deleted; every change adds an append-only event (who, what, mandatory note).

## Lifecycle
`open → in_remediation → ready_for_retest → closed`, with these side paths:
* `ready_for_retest → in_remediation` (retest failed, note required)
* `open | in_remediation | ready_for_retest → risk_accepted` (note required) and `→ cancelled` (note required, "raised in error")
* `closed | risk_accepted → open` (reopen, note required). `cancelled` is final.
Nothing can skip retest: `open`/`in_remediation` can never go straight to `closed`.

## Who may do what
| | Raise / edit substance / retest / close / accept risk / cancel | Assign owner | Due date | Remediation plan, "ready for retest", start remediation |
|---|---|---|---|---|
| TP auditor (member of the engagement) | yes | no | yes | no |
| iSecurify staff with manage | yes | yes | yes | yes |
| Client admin | no | yes | no | yes |
| Client staff / vendor | no | no | no | only if they are the finding's owner |
| Staff without manage | no | no | no | no |
Nobody may close or accept the risk of a finding they own. Changing the severity needs a note. Closed findings are frozen until reopened. The remediation owner must be an active client admin, client staff member or vendor of the organization.

## Visibility
Client admins, staff and (member) auditors see every finding of the engagements they can see. Client staff and vendors see only findings they OWN or on items assigned to them; anything else is a 404. Other organizations and auditors who are not engagement members get 404.

## Effect on control status
An **unresolved finding (open, in remediation, ready for retest) of severity critical, high or medium** turns an otherwise *effective* control into **ineffective** (computed by the single evaluation service). Low and observation findings never block. Accepted risk, closed and cancelled findings do not block. The same rule drives the dashboards.
It also **blocks closing the engagement** (409 `close_blocked`) and **removing a person who owns an unresolved finding** (409 `has_open_items`). Findings are listed in the account-backup PDF for the person who raised them.

## Endpoints (all under `/t/:tenantId`)
`GET engagements/:id/findings?status&severity&itemId&ownerUserId&unresolved` (summary included) · `GET checklist/:itemId/findings` · `GET findings/:id` (with events) · `POST checklist/:itemId/findings` · `PATCH findings/:id` · `POST findings/:id/transition {to, note}` · `POST findings/:id/comments {note}`.
Each finding comes back with `can` (the transitions and edits the caller may make right now), `blocking`, `overdue`. Numbers (`F-001`) run per engagement.

## Tests
`test/19_findings_rules.test.ts` (exhaustive transition matrix), `test/20_findings_workflow.test.ts` (9 integration tests: lifecycle, roles, status effect, visibility/IDOR, comments, owners, raw-SQL immutability, closure block), plus a case in `test/12_evaluation.test.ts`.

## Screens (6B)
* **Findings tab** on every engagement (3rd tab; staff and vendors see only their own): chips (unresolved, blocking controls, overdue, ready for retest, closed), filters (status, severity, unresolved only), table with "blocks control" and "overdue" flags, **Raise a finding** (auditors and managing staff). The due date is pre-filled from the severity (critical 7, high 30, medium 60, low 90, observation 180 days) until edited; owner can be picked by client admins and managing staff.
* **Finding drawer:** details, **Next step** buttons (only the ones the server allows for you; the note box asks the right question and is required where the server requires it), **Edit details** (fields shown depend on your role; a severity change asks for a reason), history with every event, comments.
* **Checklist:** new **Findings** column; a red "blocked" badge marks controls held back by an unresolved finding and opens that item's findings.
* Tests: `findingsUi.test.ts`, `pages7.test.tsx` (web: 43 tests in total). Browser-checked against the real API: auditor raises, control turns Ineffective, admin assigns owner, vendor starts remediation and marks ready for retest (note required), auditor closes, control is Effective again; admins see no workflow buttons, vendors no raise button.
Remediation tracking views and evidence links come in 6C.

## Remediation tracking (6C)
* **Findings & remediation** page (sidebar, per organization): everything the caller may see across all engagements. Filters: assigned to me, overdue, ready for retest, unresolved only, status, severity. Overdue findings show "N days late", an age-bucket summary (1-7, 8-30, 31-90, over 90 days) and how long each finding has been open. Rows are ordered by due date, then severity.
* API: `GET /t/:tenantId/findings?engagementId&mine&status&severity&unresolved&overdue&awaitingRetest` returns `summary`, `overdueBuckets` and the findings (each with `engagementName`, `ageDays`, `daysOverdue`). The summary covers the caller's whole scope, not just the filtered rows.
* **Owning a finding is enough to open it**, even when none of the engagement's items are assigned to you. (Client staff and vendors reach the findings through this page; the engagement itself stays hidden unless one of its items is theirs.)
* Auditors see only engagements they are members of; client staff and vendors only findings they own or on items assigned to them.

## Remediation evidence (6C)
A finding can have evidence requests of the SAME checklist item attached ("this is the proof of the fix"). The drawer shows each attached request with its live status (requested, awaiting review, accepted, rejected, expired) and the number of versions; "Open evidence" opens the normal evidence screen for the item, where access rules are unchanged.
* Who may attach: auditors, client admins, managing staff and the finding's owner. A client admin or managing staff can also "ask for new evidence", which creates the request and attaches it in one step.
* Rules: only requests of the same item (database-enforced through composite keys), not cancelled, not already attached, finding not closed, engagement not closed. Links are permanent (no update or delete); to withdraw evidence, cancel the evidence request.
* Attaching evidence does not change the finding's status and does not close anything: the auditor still decides at retest. `POST /t/:tenantId/findings/:id/evidence {requestId}`, `GET /t/:tenantId/findings/:id/linkable-evidence`; the finding detail now includes `evidence`.
* Tests: `api/test/21_findings_tracking.test.ts` (5), more cases in `19_findings_rules.test.ts`, web `pages7.test.tsx` (48+ web tests).

## Not included
Reminders and notifications for due and overdue findings need email (Phase 7). Findings are still raised per checklist item; engagement-level findings and VAPT imports are not part of this phase.
