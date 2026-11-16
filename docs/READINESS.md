# Readiness report (Phase 12A)

Release 12A of iSecurify GRC. Written to be read by the owner before go-live. It states what the automated tests verify, what they cannot, and the risks that remain.

## 1. Scope delivered (Phases 1 to 12A)
Multi-tenant platform (organizations, roles, platform staff assignments), frameworks with releases and mappings, common controls, engagements with five-phase lifecycle, checklist and evidence workflow, auditor sign-off, renewal, VAPT rounds, questionnaires, findings, risks, policies, incidents, vendors, notifications and email, webhooks and API keys, certificates, reports, analytics, audit log, backups with restore drills, log shipping, staging, patch and release tooling. Deliberately not included: AI features, single sign-on, billing.

## 2. What the tests verify
Last full runs (Phase 11F; 12A changed no application code):
| Suite | Result |
|---|---|
| API (Node test runner, MariaDB in the sandbox) | 538 tests: 530 pass, 8 fail |
| Worker | 75 of 75 pass |
| Web (typecheck + vitest) | clean; 187 of 187 pass |

The 8 API failures are known and are all **MariaDB-versus-MySQL differences in framework-versioning and composite-foreign-key tests** (framework new draft, editing the draft, comparison, archive, list, metadata, "unpublished/archived/duplicated releases", "composite foreign keys, CHECK rules and unique markers"). They are expected to pass on MySQL 8 but **have not been run there**.

What the tests do cover: tenant isolation on every route (a route list is scanned and each is called with the wrong tenant); role rules per endpoint; the data-layer rule that tenant SQL lives only in approved files; database-level protections (append-only logs, composite foreign keys, one-pending-request rules); evidence integrity (SHA-256, size, tamper detection); two-step verification, sessions, password rules, rate limits; CSRF; security headers config; least-privilege database accounts; lifecycle rules (phase checks, sign-off, renewal); import parsing; reminders and the worker queue; backup, restore, patch, staging-scrub and log-shipping scripts (with stand-in Docker); the restore proof in `docs/RESTORE_EVIDENCE.md`.

## 3. What the tests do not verify
| Gap | Why it matters | How to close it |
|---|---|---|
| Real MySQL 8 | The 8 failures above | Run the API suite against MySQL 8 in CI before first release |
| Real Docker and Caddy | Compose, read-only containers, certificates, headers served by Caddy, health checks were never run | Go-live steps 3 and 4; `smoke.sh`, `verify-readonly.sh` |
| Real SMTP | Mail rendering and delivery | Test email in go-live step 2 |
| Real malware scanner | ClamAV path is tested with a stand-in | Upload the EICAR test file on staging |
| Backups with GPG, off-server copy, real `restore.sh` | Scripted, tested with stand-ins only | Rehearsal on the server (go-live step 4) |
| Browser end-to-end (Playwright) and visual checks | Last run in an earlier phase, not re-run after 11C to 11F; no screen-reader or cross-browser testing | Run `e2e/` against staging; manual pass in Chrome, Edge, Safari, Firefox |
| Load and capacity | Only the performance notes in `docs/PERFORMANCE.md` | Test with realistic data on the real server size |
| Independent security assessment | The builder wrote the code and the tests | External penetration test (go-live step 5) |
| Patch tooling on a real server | Tested with stand-in Docker | Dry run on staging first |
| Accessibility conformance | Not audited against WCAG | Audit if contracts require it |

## 4. Remaining risks
1. **Single server.** One machine holds the application, database, evidence and (by default) backups. A disk or machine loss without an off-server copy loses everything since the last copy. Switch the off-server copy on before real client data arrives.
2. **First real deploy is the first real test of the container hardening.** If a container fails to start under the read-only filesystem, the fix is usually one writable path. Do it on staging first.
3. **Uploads are not guaranteed malware-free** unless ClamAV is switched on; evidence files are stored, not executed.
4. **Operational dependence on a few people.** Backup key custody and admin recovery need at least two trained people.
5. **Legal and contractual items are outside the software**: privacy notice, data processing terms, retention, breach-notification periods.
6. **Dependencies age.** Review `docs/DEPENDENCIES.md` and apply security updates at least quarterly.

## 5. Recommendation
Ready for a **staged go-live**: deploy to staging, close the gaps in section 3 marked for staging, complete `docs/GO_LIVE.md`, then take the first client. Do not onboard real client evidence until the off-server copy is on and a restore has been rehearsed on the real server.
