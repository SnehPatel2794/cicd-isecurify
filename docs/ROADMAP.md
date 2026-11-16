# iSecurify GRC: Phase Tracker (done, pending, and the order to the end)

Last updated 2026-11-11, after Phase 13C. One part = one chat reply = one full-project zip (`isecurify-grc-phase<part>.zip`) containing everything before it, with its tests run and the real results reported.

**Rule that never changes:** no AI or Copilot features anywhere in iSecurify GRC code.

## 1. Done (delivered and tested)

| Part | What it delivered |
|---|---|
| Phases 1 to 6 | Foundation and auth, tenancy and users, framework library, engagements, evidence loop, findings |
| 7A | Email delivery admin (status, test send, log) |
| 7B | In-app notifications and preferences |
| 7C | Due and overdue reminders, daily digest |
| 8A | Engagement reports (PDF and Excel) with history and verification |
| 8B | Certificates with public verification |
| 8C | Finding import from scanner output |
| 8D | Analytics and portfolio views |
| 9A | Admin screens (mapping approvals, process templates) |
| 9B | Risk register |
| 9C | Policies and incidents |
| 9D | Portal polish (exports, saved views, bulk assign, onboarding, help) |
| 9E | Production hardening (security headers, config guard, backup and restore drill, system status, CI, runbook) |
| 10A | Vendor risk |

## 2. Pending: in the order they will be built

Each part lists its scope. "Blueprint" means the attached `iSecurify_GRC_ZAI_Phase_Prompts.md`.

### Phase 10: align with the blueprint (8 parts)

| Part | Area | Scope | Status |
|---|---|---|---|
| 10B | **Branding** | Branding profile (company name, logo PNG or JPG up to 2 MB, primary and secondary colour, report footer). Super admin only; admin gets 403. Logo validated and stored under a random name. Colours and logo applied live in the app shell. Letterhead, footer and logo used in PDF reports, certificates and emails. Branding page with live letterhead preview. | [x] |
| 10C | **Email** | SMTP stays in `.env` (Google Workspace guide; decision 2026-10-27), admin screen shows status and sends a test. Transactional outbox: business changes write an outbox event; the worker turns events into notifications and emails with idempotency, retries and dead letters. Add the missing events (malware found, phase advanced, member invited). Email templates use the branding. A send failure never breaks the action that caused it. Per-kind email choices, hourly cap, parked-event retry. | [x] |
| 10D | **Evidence storage and archival** | Per-organization storage usage table and meter; no quota by default (decision 2026-10-27), optional per-organization limit, disk-space guard. Files already use `evidence/<tenant>/<uuid>`, so no file move was needed. Retention: archive evidence after the retention period, never delete; **legal hold** flag blocks archival. Archival job in the worker, archived state shown and filterable, audit entries. Quarantine view for infected files. Storage admin page. | [x] |
| 10E | **Backup and off-server copy** | Configured off-server target (rclone or rsync settings), copy and verify step, 14-day retention, scheduled automatic restore drill, failure and staleness alerts by email and on the System status page, disk and quota alerts, separate migrator database account, locked-out admin recovery and key rotation runbooks. | [x] |
| 10F | **SPOG 1: summary data** | Summary tables refreshed by the worker (from events and on a schedule) with `computed_at`; one readiness service feeding dashboards and reports; "last updated" and a stale badge after 15 minutes; organization dashboard and portfolio read from the summaries. | [x] |
| 10G | **SPOG 2: search and My Work** | Global full-text search with tenant and permission filtering applied before results (no leaked titles, snippets or counts). Real **My Work** (my open items, reviews waiting, my actions). Activity timeline from the audit log. Shared filters (client, framework, engagement, period, owner, status). | [x] |
| 10H | **SPOG 3: widgets and performance** | Finish the widget framework (each tile has its own endpoint, permission, loading, empty, error and stale states). Drill-down from every tile to the exact filtered list, with the tile number equal to the list count. Performance test with 50,000 checklist rows and measured response times. | [x] |
| 10I | **Security suite and end-to-end** | Threat-model tests: SQL-injection probes on every filter parameter, mass-assignment attempts, session fixation and theft, export leaks. Playwright end-to-end run of the main journey. Container-image and secret scanning in CI. | [x] |

### Phase 11: new capabilities (6 parts)

| Part | Area | Scope | Status |
|---|---|---|---|
| 11A | **Continuous controls** | Recurring control tests, evidence refresh schedules, compliance-posture score over time per framework. | [x] |
| 11B | **Integrations and API** | Scoped API keys, webhooks with signed deliveries, a documented public API for scanners, ticketing and SIEM. | [x] |
| 11C | **Engagement lifecycle** | Auditor sign-off (unqualified / qualified / adverse, or an audited waiver when no auditor is assigned); phase-advance checks (blocks and acknowledged warnings); renewal of a closed engagement (decisions, team and open findings carried, evidence never); add a framework to a running engagement; request all due evidence in one click; mapping history screen. | [x] |
| 11D | **VAPT rounds** | Two or three VAPT rounds inside the one-year engagement: planned date, scope, status and report per round; findings tagged to a round; retest per round; new / closed / carried comparison between rounds; reminders before each round. Reuses the finding import. | [x] |
| 11E | **Engagement questionnaires** | Upload a standard questionnaire per framework (Excel or CSV) with answer types and required flags; copied as a snapshot into each engagement; the client answers, staff review; completeness feeds the phase-1 check; CSV export of answers (not in the PDF report yet). | [x] |
| 11F | **Deployment follow-ups** | Read-only container filesystems, log shipping, a staging environment, release process (patch tooling and `docs/DEPLOY.md` delivered in 11B.1). Delivered: read-only containers, nightly log bundles with optional off-server copy, staging overlay with data scrubbing and a STAGING bar, post-deploy smoke test, `docs/RELEASE.md`. Not yet run on real Docker. | [x] |

Explicitly out of scope for now: single sign-on and billing.

### Phase 12: go-live (1 part)

| Part | Area | Scope | Status |
|---|---|---|---|
| 12A | **Release** | Admin guide, client user guide, go-live checklist, final readiness report (what tests verify, what they do not, remaining risks), a real restore performed with evidence. Delivered: `docs/ADMIN_GUIDE.md`, `CLIENT_GUIDE.md`, `GO_LIVE.md`, `READINESS.md`, `RESTORE_EVIDENCE.md` (restore proven on the sandbox's MariaDB, not on real Docker/MySQL). | [x] |

| 13A | **Questionnaires** | Core (locked) vs optional and industry questions, choose-all answers, staff add / edit / remove / restore per engagement, upload template columns, ready-made DPDP and ISO 27001 questionnaires. Fixed template header bug. | [x] |
| 13B | **Tasks** | Engagement tasks: assignee, due date, status, priority, dependencies, comments; list and board; My work; due-soon and overdue reminders; plans from spreadsheet or platform templates with dates worked out; overdue warning in the phase check; CSV export; audited. Techify plan shipped as a template. Not built: file attachments, time tracking, Gantt. | [x] |
| 13C | **Dashboards and demo data** | Portfolio overview for Super Admin/administrators across all organizations (counts only), task panels and click-through in organization analytics, engagement dashboard tab, overdue tasks in attention flags. Demo organizations (marked at creation, immutable) that the Super Admin can wipe completely with password + name; real clients cannot be wiped (database triggers). Optional PURGE_DB_PASSWORD. | [x] |

**Total remaining: 0 build parts.** Left for you: the go-live checklist on the real server (`docs/GO_LIVE.md`).

## 3. Decisions I will need from you (so I do not stop mid-build)

| Needed by | Question |
|---|---|
| 10C | Which SMTP provider will you use (company mail server, SendGrid, SES)? I can build and test without it, but a real test email needs one. |
| 10E | Where should the off-server backup go: a second VPS, an S3-compatible bucket, or an external disk? |
| 10B | Do you have the logo and colours ready (iSecurify purple #812671, dark grey #2B2A29 and teal #1B887D are my defaults)? |
| 10D | Is the default 5 GB per organization right, and how many client companies do you expect in year one? |

## 4. Known limits that stay until addressed

- The sandbox has MariaDB, not MySQL 8, so 8 older tests fail only there; they pass on MySQL 8 in CI.
- Shell scripts, Docker Compose, the Caddyfile and CI workflows cannot be run in the sandbox; the first real run on your server or in CI is their first test. Run `deploy/backup.sh` then `deploy/restore-drill.sh` once before relying on them.
- Single server means no high availability; the runbook lists mitigations.

## Decisions (2026-10-27)
- 10B: defaults purple #812671, dark grey #2B2A29, teal #1B887D (teal is accent only, too light for white text).
- 10C: SMTP stays env-driven (Google Workspace); no SMTP settings stored in the database.
- 10D: no storage quota by default (unlimited); per-file cap stays configurable; add a host free-disk guard.
- 10E: backups on the same server, with a configurable off-server target to switch on later.
