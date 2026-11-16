# iSecurify GRC Platform — through Phase 6C: Foundation, Tenancy, Framework Library, Engagements, Evidence, template library, malware scanning, Findings (API, screens, remediation tracking and evidence)

Stack: MySQL 8 · Node 22 + Fastify + Zod (TypeScript) · separate worker · React 18 + Vite + Tailwind · Caddy (HTTPS) · Docker Compose.

## Deploy on your Ubuntu server
```bash
sudo ./deploy/server-setup.sh                 # Docker, UFW (22/80/443), fail2ban, auto-updates, 2 GB swap
cp .env.example .env                           # fill: DOMAIN, 3 DB passwords, MFA_ENC_KEY (openssl rand -base64 32), CSRF_KEY
docker compose up -d --build                   # mysql -> init (migrations + restricted DB users) -> api, worker, web
```
Open `https://YOUR_DOMAIN`. First visit shows **Create the first Super Admin**. Platform roles must then enroll an authenticator app (enforced by the server).
Your domain's DNS A-record must point to the server before Caddy can obtain a certificate.
Update later: `./deploy/backup.sh && git pull && docker compose up -d --build` (init re-runs new migrations and re-applies grants).

## Develop and test
```bash
# MySQL 8 reachable; TEST_ADMIN_URL needs a user that may CREATE/DROP databases and CREATE USER/GRANT
export TEST_ADMIN_URL='mysql://user:pw@127.0.0.1:3306/'
(cd api && npm i && npm test)        # 151 tests, real MySQL, throw-away database per suite
(cd worker && npm i && npm test)     # 10 tests
(cd web && npm i && npm test && npm run build)   # 9 tests + production build
# Optional end-to-end smoke test of a running stack on a FRESH database (worker stopped, so the script can read invitation tokens):
#   BASE=http://127.0.0.1:4000 SMOKE_DB_URL=mysql://user:pw@127.0.0.1/grc npm run smoke   (in api/)
```
Local run: set `DATABASE_URL`, `MFA_ENC_KEY`, `CSRF_KEY`, run `ADMIN_DATABASE_URL=... APP_DB_USER=... npm run db:setup` once, then `npm run dev` in api, worker and web (`web` proxies `/api`).

## Phase 1 (unchanged)
- **Auth:** race-safe first-run setup, Argon2id, lockout (5 fails / 15 min) + per-IP rate limit, indistinguishable failure responses, HttpOnly + SameSite=Strict cookie (`__Host-` + Secure in production), only the SHA-256 of the session token stored, session rotation after MFA, expiry, disable cut-off, list/revoke sessions.
- **MFA:** TOTP (RFC 6238 vector tested), secret encrypted at rest (AES-256-GCM), replay protection, 10 hashed one-time recovery codes, rate-limited, mandatory for platform roles (server-enforced).
- **Passwords:** change (signs out other sessions); reset by single-use hashed 30-minute token.
- **Request hygiene:** per-session HMAC CSRF token on state-changing requests, Origin check, JSON-only, `no-store`, nosniff, log redaction.
- **Database:** append-only audit log (triggers + privileges), least-privilege `grc_app` / `grc_worker` accounts re-applied every deploy, migrations only in the one-shot `init` container.
- **Worker:** MySQL job queue (`SKIP LOCKED`), idempotency keys, backoff, dead letter, crash recovery, graceful shutdown, hourly cleanup; one-time secrets erased from job payloads after delivery.
- **Ops:** Docker Compose with memory limits and log rotation, health checks, Caddy HTTPS + CSP/HSTS, CI workflow, encrypted-backup script, server hardening script.
- **React:** setup, login, MFA, password reset, account security (MFA with QR, password change, sessions), widget framework with per-widget error isolation.

## Phase 2 — organizations, access control, user management
- **Organizations (clients):** create, rename, suspend/reactivate (admin-level), archive/restore (Super Admin only), retention period per organization. Nothing is hard-deleted.
- **Tenant isolation:** every tenant route resolves access through one function and answers 404 when you have no access; platform admins have no implicit tenant access; tenant comes from the path, never the body; a source-scanning test enforces that only the data layer touches tenant tables (see `docs/TENANCY.md`).
- **iSecurify staff assignments:** per organization, with `can_manage`, `can_read_evidence` and an optional expiry; revoked or expired assignments stop working immediately; every assignment is audited.
- **Roles:** client_admin, client_staff, third_party_vendor, tp_auditor per organization; a person can belong to several organizations. Platform roles: super_admin, admin, isecurify_team with an escalation guard (admins cannot create or modify admins; nobody changes their own role; last Super Admin protected).
- **Invitations:** single-use, hashed, 7-day tokens; existing accounts must sign in as the invited address to accept; platform invitations create the platform role (MFA is then mandatory).
- **User management:** list/search, invite, change platform role, disable/enable (sessions cut immediately), soft delete with deletion summary, open-item blockers (extension point), account-backup PDF, delete-without-backup confirmation, append-only deletion log.
- **Audit:** every administrative action is written in the same transaction; tenant audit log (managers + auditors) and platform audit log (admin-level) with action/actor/date filters and cursor pagination.
- **React:** organization workspace (members, role changes, invitations, audit), organizations admin (create, suspend, archive, invite, staff access), users admin (invite, role, disable, delete dialog with backup step), platform audit log, accept-invitation page, working organization switcher.

## Phase 3 — framework library
- **Versioned frameworks:** create, edit metadata, archive/restore (no delete). Releases are `draft` → `published`; a published release is permanent (API **and** database triggers). Changing a framework = new draft release copied from the published one (controls and mappings); one open draft per framework, enforced in the database.
- **Controls:** add/edit/delete in drafts, bulk add, field set: Control ID, Domain/clause, Requirement, Owner (department), Evidence/reference, Additional evidence notes, Remarks.
- **Compare releases:** deterministic added/removed/changed report.
- **CSV / Excel import:** downloadable templates (CSV + XLSX), preview-then-confirm, header auto-detection, per-row errors, 5 MB / 5,000 rows, formula-injection and zip-bomb defences, disguised-file checks, audited with file SHA-256.
- **Common controls:** CRUD, map any control (even in a published release) to a common control; append-only mapping history; one common control can span many frameworks.
- **Access:** library is for iSecurify platform users only; drafts are visible to Super Admin/Admin only; customers get 403.
- **Sample data:** `npm run seed:sample` loads a clearly fictional framework and 5 common controls. No licensed text ships (see `docs/LICENSING.md`, `docs/FRAMEWORKS.md`).
- **React:** library grid, framework page with releases and compare picker, release viewer / draft editor grouped by domain, publish dialog (type-to-confirm), import wizard (choose → preview → confirm), comparison page, common-controls page, inline mapping selector.

## Phase 4 — engagements, checklist, SOA, evaluation, readiness
- **Engagements** with one or more published framework releases (primary + additional); the exact release ids are stored, so later framework changes never rewrite them. **Live overlap preview** and **merge via common controls** (3,000 + 3,000 controls build in <1 s). Audit-path selector when a framework's process template has path-specific milestones (e.g. SOC 2 Type I/II). Document-control fields.
- **Checklist:** domain-grouped, "satisfies" badges for merged items, accountable person (validated: active client/vendor member of the same organization), due dates, readiness, owner-department hints, custom items, N/A with mandatory justification.
- **SOA** per framework with mandatory justification; an item whose every satisfied control is N/A becomes not applicable.
- **Control-evaluation service:** one pure, exhaustively tested module decides every status; dashboards, lists and pages call it. Readiness is a progress measure, not certification (`docs/ENGAGEMENTS.md`).
- **Phases and timeline:** 5 phases with owners/dates, sequential advance (iSecurify managers only; never skips; last phase can only be closed), process milestones copied from templates (editable per engagement), closed engagements read-only.
- **Team:** iSecurify lead/team (must be assigned to the organization) and TP auditors (members of the organization); one lead enforced by the database.
- **Discovery questionnaire** (generic + per-framework; answered questions are never lost), **activity feed** per engagement, **dashboard** KPIs (active engagements, effective/applicable, readiness %, awaiting review, overdue) scoped per role.
- **Role scoping:** client staff and vendors see only their own items; auditors only engagements they belong to; everyone else per `docs/ENGAGEMENTS.md`.
- **Hooks now live:** open checklist items block removing a person from an organization or deleting their account; the account-backup PDF lists their assigned items.
- **React:** engagements list with KPI cards and progress bars, create dialog (multi-framework chips, live preview, audit path), workspace with phase rail and tabs (Checklist, Timeline, SOA, Team, Discovery, Activity).

## Phase 5A — evidence core (API only; screens come in 5B, scanning worker + template screens in 5C)
Requests on checklist items (single and bulk), file and link versions with SHA-256, immutable versions/reviews (API, triggers and grants), auditor accept/reject with mandatory note, self-review ban, expiry computed at read time and fed into the evaluation service, per-organization quotas, upload policy (allow-list, content sniffing, size), audited downloads and integrity verify, template-library endpoints. See `docs/EVIDENCE.md`. New volume `evidence_data` (api + worker); `backup.sh` now archives it.
Tests: `test/16_evidence_rules.test.ts` (pure rules, exhaustive), `test/17_evidence_workflow.test.ts` (13 integration tests incl. parallel-quota race, IDOR, raw-SQL immutability, tampering).

## Phase 5B — evidence screens
- **Evidence tab** on every engagement (2nd tab; staff and vendors see only their own items): summary chips, status filter, request table, bulk "request evidence" dialog.
- **Evidence drawer** per checklist item (button in the new Evidence column): create/edit/cancel requests, upload a file or add a link with a note, Download (the browser recomputes SHA-256 and compares it with the value recorded at upload), Verify, Scan, review history, and the auditor accept/reject panel (note mandatory, optional valid-until).
- **Storage** button on the Organizations page (platform admins): usage bar and quota override.
- Shared UI helpers moved to `web/src/kit.tsx`; pure helpers in `web/src/evidenceUi.ts`.
- Tests: `web/src/evidenceUi.test.ts`, `web/src/pages5.test.tsx` (21 web tests in total, `tsc` clean, production build OK).
- Browser-checked against the real API (Chromium): vendor uploads and downloads with hash match; auditor accepts with a note; the checklist then shows "Effective" and "Evidence accepted"; the vendor sees no review form.

## Phase 5C — templates, scanning, cleanup
- **Evidence templates** page and a template picker/download inside evidence requests (screens in `web/src/pages6.tsx`).
- **Malware scanning:** `evidence.scan` worker job with a small built-in clamd client (`worker/src/clamav.ts`, `worker/src/evidence.ts`); optional `clamav` compose profile. See `docs/EVIDENCE.md`.
- **Orphan-file sweep** in `maintenance.cleanup`, and a loud log line if files the database knows about are missing.
- Tests: `worker/test/evidence.test.ts` (fake clamd: clean, infected, tampered, missing, scanner down/hung/dropped, traversal key, sweep), `api/test/18_templates.test.ts` (6), `web/src/pages6.test.tsx`.
- Fix: retired templates remain downloadable for requests that already use them. Requests now also return the template's file name and SHA-256.

## Phase 6A + 6B + 6C — findings (API, screens, organization-wide remediation tracking, remediation evidence)
Audit findings raised by the auditor against checklist items: severity, owner, due date, remediation plan, retest and closure, comments, append-only history, per-engagement numbering (F-001). Unresolved findings of medium severity or above make a control *ineffective* and block engagement closure. See `docs/FINDINGS.md`.
6C: **Findings & remediation** page (my findings, overdue ageing, ready for retest) and evidence attached to findings (`migrations/008_finding_evidence.sql`, database-enforced same-item rule). Screens: Findings tab, finding drawer, per-item findings, `web/src/pages7.tsx`, `web/src/findingsUi.ts`. New: `migrations/007_findings.sql`, `api/src/modules/findings/{rules,data,routes}.ts`, `api/test/19_*` and `20_*`. Changed: the evaluation service (new input `blockingFindings`), engagement item queries, the close route (new `closeBlockers` hook), grants (findings: no delete; events: insert-only).

## Phase 7A — email delivery
The worker now sends real email (invitations, password resets) over SMTP with TLS required by default, retries outages without ever sending twice, and writes an append-only delivery log (`migrations/009_email_log.sql`) that holds no message text, links or tokens. Admins get an **Email delivery** page to check the setup, send a test message and read the log. Set `SMTP_HOST`, `MAIL_FROM` and the rest in `.env`; details in `docs/EMAIL.md`. 7B (in-app notifications) and 7C (reminders and digests) follow.

## Phase 7B — in-app notifications
A bell with an unread count, a **Notifications** page (filter by unread or organization, load older) and per-kind switches. Assignments, evidence requests and decisions, and finding updates notify the right person inside the same transaction (`migrations/010_notifications.sql`). Details and rules in `docs/NOTIFICATIONS.md`. Next, 7C adds due/overdue reminders and digests.

## Phase 7C — reminders and email digest
A daily scan reminds the responsible person once when evidence requests and findings are due within 3 days, and weekly while they are overdue; each person gets at most one email digest (daily, weekly or never, their choice). Idempotent by design (`migrations/011_reminders.sql`). See `docs/REMINDERS.md`. This completes Phase 7.

## Phase 8A — reports and exports
PDF report and Excel workbook per engagement (checklist, findings, SOA, evidence index), every export recorded with its SHA-256 so a file can be checked later (`migrations/012_report_exports.sql`, `docs/REPORTS.md`). 
## Phase 8B — certificates
iSecurify staff managers issue a numbered certificate (`ISG-YYYY-NNNNNN`) for a closed engagement and one of its frameworks, with a scope statement, expiry (at most 1100 days), a PDF with a QR code, and a public no-sign-in verification page at `/verify/:code`. All applicable controls must be effective, or the issuer records a reason. Re-issuing supersedes the older certificate; revoking is permanent. Client admins get expiry reminders at 60, 30 and 7 days and once on expiry (`migrations/013_certificates.sql`, `docs/CERTIFICATES.md`). Phase 8 continues with 8C VAPT import, 8D dashboards.

## Phase 8C — VAPT / scanner import
On an engagement's Findings tab, the TP auditor or managing iSecurify staff can upload a CSV or JSON export (Nessus, ZAP, Burp-style columns recognised), review a row-by-row preview, and confirm. Each row becomes a finding on a checklist item; re-importing never creates duplicates. Every import is recorded append-only with the file's SHA-256 (`migrations/014_finding_imports.sql`, `docs/FINDING_IMPORT.md`).

## Phase 8D — dashboards and analytics
An **Analytics** page per organization (readiness overall and by framework, findings by severity, age and lateness, raised-versus-closed trend, evidence status and expiry, certificates) and a **Portfolio overview** for iSecurify staff across the organizations they are assigned to, with what needs attention first. Read-only, no new tables (`docs/ANALYTICS.md`). Phase 8 is complete.

## Phase 9A — admin screens and mapping approval
**Process & discovery** screen for milestone templates (per phase, with audit-path filters) and discovery questions (add, edit, retire); read-only for non-administrators. **Mapping approvals**: an optional policy (off by default, Super Admin switch) where changes to a *published* framework's control mappings become requests that a different administrator approves or rejects (`migrations/015_mapping_approval.sql`, `docs/ADMIN.md`). Phase 9 continues with 9B risk register, 9C policies and incidents, 9D portal polish, 9E production hardening.

## Phase 9B — risk register
A per-organization **Risk register**: risks with a 5×5 likelihood/impact rating, inherent and residual heat maps, owner, treatment (mitigate / accept / transfer / avoid) and plan, and a lifecycle (identified, being treated, accepted, closed). Accepting needs a second person, a reason, a residual rating and a review date within a year. Risks link to findings and checklist items, every change is an append-only event, and the analytics page and portfolio view include risks (`migrations/016_risks.sql`, `docs/RISKS.md`).

## Phase 9C — policies and incident register
**Policies** (`/org/:id/policies`): each policy has numbered versions. A client admin or managing staff member drafts and submits a version; a *different* manager approves and publishes it, which supersedes the previous version. Published versions are permanent (database triggers). The people the policy is meant for (client admins and staff, or everyone including vendors) are notified and acknowledge the live version; a new version needs fresh acknowledgements. Review dates follow the policy's review period and show as overdue. See `docs/POLICIES.md`.

**Incidents** (`/org/:id/incidents`): anyone in the organization can report an incident. Client admins and managing staff triage it (severity, owner, whether the authorities must be told); it moves reported, investigating, contained, resolved (root cause), closed (lessons, corrective actions, authority notification, and not by the owner). Incidents can be linked to risks and are never deleted. See `docs/INCIDENTS.md`.

Both feed organization analytics and the portfolio attention list (`migrations/017_policies_incidents.sql`).

## Phase 9D — portal polish
- **Exports:** *Export CSV* / *Export Excel* above the risk register, incident list, policy list and findings list. The file holds what the current filters show; spreadsheet formulas in text are neutralised; each export is audited (`export.*`).
- **Saved views:** private, named filter sets for risks, incidents and findings (20 per list).
- **Bulk assign:** tick rows on the risk register or incident list and set one owner; each item is checked on its own and skipped items are explained.
- **Getting started and Help:** a role-aware checklist on the organization home page and a searchable Help page (`/help`).
See `docs/PORTAL.md` (`migrations/018_saved_views.sql`).

## Phase 9E — production hardening
Security headers on every API response and a stricter Caddyfile; the API refuses to start in production with unsafe settings; **Administration > System status** shows version, migrations, backup and restore-drill health, queue health and warnings (`GET /platform/system`). Scripts in `deploy/`: `backup.sh`, `restore-drill.sh` (restores the newest backup into a throwaway MySQL and verifies it with `api/scripts/verify-restore.ts`), `restore.sh`, `monitor.sh`. Compose drops container capabilities. CI gains deploy-file linting, CodeQL and Dependabot. See `docs/RUNBOOK.md` and `docs/SECURITY.md`. Migration `019_backup_log.sql`.

## Acceptance checklist (Phase 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9A + 9B + 9C + 9D + 9E + 10A + 10B + 10C + 10D + 10E)
| Item | Status |
|---|---|
| All Phase 1 items (auth, MFA, CSRF, lockout, audit append-only, DB accounts, worker queue) | tested (see test names in `api/test/01-04`, `worker/test`) |
| Client of tenant A gets 404 on every tenant B route; unknown tenant ids also 404 | tested |
| IDOR: ids from another tenant are unreachable through your own tenant path | tested |
| Platform admin without assignment: 404 on tenant data, 200 on organization metadata; isecurify_team: 403 on platform routes | tested |
| Staff assignment expiry/revocation effective immediately; can_manage honored | tested |
| Composite foreign keys reject cross-tenant references at the database level | tested (pattern test; first product use in Phase 4) |
| Source-scan lint: only the data layer queries tenant tables | tested and mutation-checked |
| Escalation guard (admin cannot create/modify admins), self-protection, last Super Admin | tested |
| client_admin cannot appoint auditors or client admins; staff/vendor cannot manage | tested |
| Deactivated or deleted user loses access at once; email reusable after deletion | tested |
| Deletion blocked by open items; backup-or-confirm rule; PDF manifest is a real PDF | tested |
| Every admin action appears in the audit trail; tenant audit scoped; pagination without gaps | tested |
| Invitation tokens hashed, single-use, expiring, revocable; existing-account path needs matching sign-in | tested |
| Published release cannot be edited/extended/deleted via API **or** raw SQL (incl. moving a control into it) | tested; trigger mutation-checked |
| New draft leaves the published release byte-for-byte unchanged; one open draft per framework (API + DB) | tested |
| Release comparison correct, deterministic, symmetric | tested |
| Import preview never writes; confirm imports valid rows only; re-import refused | tested |
| Formula injection (CSV and XLSX), disguised files, zip bomb, >5 MB, >5000 rows rejected; 5000 rows accepted | tested; guards mutation-checked |
| Templates (CSV, XLSX) re-import cleanly | tested |
| Mapping on published controls allowed, history append-only, drafts carry mappings forward, archived frameworks protected | tested |
| Customers/non-admins refused on library routes; drafts invisible to non-admins | tested |
| Evaluation service: all 120 input combinations vs an independent table; file never makes a control effective | tested (pure unit tests), mutation-checked |
| Multi-framework merge, preview equals actual, same-framework merge, SOA complete; later releases/mappings never rewrite an engagement | tested |
| Composite FKs, same-engagement links, one primary/one lead, justification CHECKs, no deletes (raw SQL) | tested; FK and CHECK mutation-checked |
| Role scoping (client admin / staff / vendor / auditor / iSecurify staff / other tenants), IDOR sweep incl. a real iSecurify manager of another tenant | tested; scoping mutation-checked |
| Phase rules (no skipping, staff-manager only, close from last phase only), closed engagements read-only | tested |
| Open work blocks removal/deletion; N/A, accepted and closed items do not | tested; blocker mutation-checked |
| Dashboard = evaluation service = checklist; scoped; overdue logic | tested |
| Scale: two 3,000-control frameworks → 5,500 items; create 0.85 s, checklist 0.2 s, dashboard 62 ms | tested (thresholds 20 s / 3 s / 1.5 s) |
| Real HTTP run with MFA enforced and restricted DB accounts (47 checks incl. multipart import and engagements) + worker delivery | run (`npm run smoke`) |
| Evidence: request→upload→reject→re-upload→accept→effective; expiry; every-request-accepted rule | tested |
| Evidence versions/reviews/scans cannot be changed or deleted (API, trigger, grant) | tested |
| Evidence role matrix, IDOR (other tenant, other vendor's item), self-review, closed engagement | tested |
| Upload policy (type, disguised content, executables, size, links) and tampering detection | tested; 9 MB and 30 MB uploads also run over real HTTP |
| Quota atomic under 3 parallel uploads; counters equal the sum of versions | tested |
| `docker compose up` on a fresh server | **NOT tested here** (no Docker in my sandbox) |
| Tests were run on **MariaDB 10.11** (sandbox has no MySQL 8) with 4 conditional-unique columns removed; 8 Phase 3/4 tests that rely on them fail there and must be run on MySQL 8 (CI does) | **please run `npm test` on MySQL 8** |
| Browser click-through of the React screens | **NOT done** (type-check, component tests and production build only) |

## Known limitations
- **Dev-tool advisory (web build only):** `npm audit` flags `braces`/`chokidar`/`postcss-selector-parser` inside Tailwind CSS 3's build tooling (denial-of-service on malicious glob patterns). It is a devDependency, never shipped to browsers, and our globs are fixed in `tailwind.config.js`; CI therefore audits **production** dependencies (`--omit=dev`), which are clean. Upgrading to Tailwind 4 removes it but needs a styling migration (planned in the hardening phase).
- **Excel import** relies on `read-excel-file`; the zip-bomb guard inspects the archive directory before parsing, but very unusual crafted workbooks within the 5 MB / 50 MB limits could still be slow to parse. Imports run in the API process, not the worker.
- **Evidence:** Evidence is never deleted, so storage only grows; there is no retention purge yet. Links cannot be verified. The malware scanner is optional: `POST …/scan` returns 409 `scanner_unavailable` until `CLAMAV_HOST` is set. The ClamAV compose profile and the scanner protocol were tested against a fake clamd only, not against the real ClamAV image.
- **iSecurify access is per client organization** (staff assignment), not per engagement: an assigned manager sees every engagement of that client. Engagement membership labels the lead/team and scopes TP auditors.
- **Process templates and discovery questions** now have admin screens (Phase 9A). Earlier note: (engagements keep their own copy of milestones). Adding a framework to an existing engagement does not add that framework's template milestones.
- **Mapping is editable after publish** by design (metadata with append-only history). Two-person approval is available as an opt-in policy (Phase 9A, off by default).
- Invitation and password-reset **emails are not sent yet** (SMTP is Phase 7). Until then set `EMAIL_DEV_LOG=true` on the worker (non-production only) and copy the link from the worker log, e.g. `docker compose logs worker | grep DEV`. Production without SMTP: invitations cannot be delivered.
- An admin-level user can assign themselves to a tenant (audited, visible in the tenant's audit log). If you need two-person control, that is a later policy decision.
- "Open items" blockers and backup-manifest sections for evidence/comments/findings are wired as extension points; they show content once Phases 4-6 exist. Today the manifest states that those modules are not installed.
- Client admins can remove memberships but cannot delete the underlying account (iSecurify admin-level action).
- Rate limiting is in-memory per API process. API/worker run TypeScript through `tsx`.
- Single server: no high availability; copy backups off-server.

## Phase 10A — vendor risk
Vendor register with criticality and data-access tiering, a scored 24-question security assessment (vendor contact or manager answers, a different person reviews), reassessment dates by tier, exports, analytics and help. Migration `020_vendors.sql`; see `docs/VENDORS.md`. Phase 10 continues with 10B continuous controls, 10C integrations and API keys, 10D deployment follow-ups.

## Next
The Phase 9 series is complete. Possible follow-ups: off-site backup automation for your storage provider, read-only container filesystems, and external log shipping.

## Phase 10B: Branding
Company name, three colours, logo and footer text in one profile, applied to screens, PDFs, certificates and emails. Super admin only. See `docs/BRANDING.md`.

## Phase 10C: Email
Transactional outbox, per-kind email choices, branded notification emails, new events (malware found, phase advanced), parked-event retry. SMTP stays in `.env` (Google Workspace guide in `docs/EMAIL.md`).

## Phase 10D: Evidence storage and archival
No storage limit by default (per-organization limits optional), disk-space guard, retention-based archival (never deletes), legal hold, restore, quarantine views and a Storage admin page. See `docs/STORAGE.md`.

## Phase 10E: Backup and recovery
Same-server backups with an optional verified off-server copy (rclone, rsync or command), a one-step cron installer (nightly backup, weekly automatic restore drill), alert emails to administrators, a separate migrator database account, an admin-recovery script, MFA key rotation tool and runbooks. See `docs/RUNBOOK.md`.

## Phase 10F: Summary data for the overview screens
Pre-computed readiness and finding counts per engagement (`engagement_summary`), kept fresh by the worker: database triggers mark an engagement dirty on any change, the worker recomputes within seconds, and a catch-up pass runs every 10 minutes. One readiness service (`shared/readiness.ts`) is used by the API and the worker. Dashboard, engagement list and detail, analytics and the portfolio overview read from it, show "Updated … ago" and a "May be out of date" badge after 15 minutes. See `docs/SUMMARIES.md`.

## Phase 10G: Search, My Work and Activity
Search (per organization and across all the person's organizations) that only ever returns what the person can already open, a real My Work page (assigned items, evidence to provide, reviews waiting, things I own, policies to acknowledge), an activity timeline from the audit log, and one shared filter bar. See `docs/SPOG.md`.

## Phase 10H: Tiles, drill-down and performance
Server-defined dashboard tiles (one endpoint each, with its own permission, empty, error and out-of-date states) whose numbers are tested to equal the list their link opens, a paged organization-wide Checklist items list, "Open only" and URL filters on the findings, risk and incident lists, and a 50,000-item performance test with measured timings. See `docs/WIDGETS.md` and `docs/PERFORMANCE.md`.

## Phase 10I: Security suite and end-to-end

- Threat-model tests: injection probes on every route and parameter (`45`), mass assignment (`46`), session fixation/theft/forgery (`47`), export leaks (`48`). See `docs/THREAT_MODEL.md`.
- Playwright run of the main journey in a real browser: `e2e/`, `docs/E2E.md`. It found and fixed a sign-out bug.
- CI: new `e2e` job; new `security-scan.yml` (gitleaks on history, Trivy on the api, worker and web images, weekly).
- Small hardening: the user-list search now escapes `%`, `_` and `\` in the typed text.

## Phase 11A: Continuous controls

Recurring control tests with an append-only result history, evidence refresh schedules (a person opens the request, the worker only reminds), and a daily compliance-posture snapshot per engagement and framework with a trend. See `docs/CONTINUOUS.md`.

## Phase 11B: Integrations and API

Scoped API keys (shown once, stored hashed, per-key rate limit), a documented public `/v1` API for scanners, ticketing and SIEM (`docs/API.md`), and signed, retried webhooks with private-address protection (`docs/WEBHOOKS.md`). Webhooks need `WEBHOOK_ENC_KEY`.

## Phase 11C: Engagement lifecycle

Auditor sign-off (unqualified, qualified, adverse; a waiver when no auditor is assigned) required before an engagement closes and reflected on the certificate; phase-advance checks with acknowledged warnings; renewal of a closed engagement; add a framework to a running engagement; request all due evidence; mapping history. See `docs/ENGAGEMENTS.md` and `docs/CERTIFICATES.md`.

## Phase 11D: VAPT rounds

Two or three penetration-test rounds inside an engagement: plan, status flow, report reference, findings tagged to a round (on raising, on import or afterwards), round-to-round comparison and reminders. See `docs/VAPT.md`.

## Phase 11E: Engagement questionnaires

A standard questionnaire per framework (Excel/CSV upload, versioned, draft then publish), copied unchanged into each engagement, answered by the client, reviewed by iSecurify staff, with progress feeding the phase checks. See `docs/QUESTIONNAIRES.md`.

## Phase 11F: Deployment follow-ups

Read-only application containers, nightly log bundles (optionally copied off the server), a staging environment with scrubbed production data, a post-deploy smoke test and the release process. See `docs/RELEASE.md` and `docs/STAGING.md`.

## Phase 12A: Release documents

Administrator guide, client guide, go-live checklist, readiness report and restore evidence: see `docs/ADMIN_GUIDE.md`, `docs/CLIENT_GUIDE.md`, `docs/GO_LIVE.md`, `docs/READINESS.md`, `docs/RESTORE_EVIDENCE.md`.

## Phase 13A: Core and industry questionnaires

Core (locked) and industry-tagged questions, per-engagement add, edit, remove and restore by staff, and ready-made DPDP and ISO 27001 questionnaires. See `docs/QUESTIONNAIRES.md`.

## Phase 13B: Tasks

Per-engagement tasks with assignee, due date, status, dependencies and comments; list and board views; My work; reminders; plans loaded from a spreadsheet or a platform template; the phase check warns about overdue tasks. See `docs/TASKS.md`.

## Phase 13C: Dashboards and demo data

Portfolio overview for administrators (all organizations), task panels in organization analytics, an engagement dashboard with click-through, and demo organizations that the Super Admin can wipe completely. See `docs/DASHBOARDS.md` and `docs/DEMO_DATA.md`. New optional setting `PURGE_DB_PASSWORD`; migration 033.

## Deployment and patches

First install from the full release zip; updates as small patches with automatic backup, checks and rollback: `docs/DEPLOY.md`. The whole customer journey (organization to certificate) is covered by one API test, `api/test/51_lifecycle.test.ts`.
