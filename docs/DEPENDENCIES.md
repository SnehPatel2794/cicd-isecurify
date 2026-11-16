# Module dependency rules (modular monolith)
A module may import only from `platform/` and `db`, plus the modules listed here. No cycles.

| Module (api/src/modules) | May depend on |
|---|---|
| auth | platform, db |
| tenancy (Phase 2) | auth, platform, db |
| users (Phase 2) | tenancy, auth, platform |
| frameworks (Phase 3) | auth, platform |
| engagements (Phase 4) | tenancy (membership/staff lookups), audit (activity feed), users/hooks (registers deletion blockers + backup section), platform. Reads framework tables read-only. |
| evidence (Phase 5) | engagements, tenancy, platform |
| findings (Phase 6) | engagements, evidence, platform |
| notifications (Phase 7) | tenancy, platform (consumes outbox events only) |
| reports (Phase 8) | engagements, evidence, findings (read-only) |
| dashboard (Phase 9) | reads summary tables only |

`platform/` = crypto, totp, ratelimit, audit, jobs, errors. The worker never imports API code; both talk through MySQL tables (`jobs`, `outbox_events`).

Note (6A): the engagement item queries contain one read-only `EXISTS` on `findings` (to evaluate "blocking findings"), the same way they already read `evidence_requests`. Writes to findings stay inside `modules/findings`; engagement closure calls findings only through the `closeBlockers` hook.

Note (7A): the worker gains `nodemailer` (SMTP client, MIT-style licence). Dev-only: `smtp-server` (fake mail server for tests). The API has no mail dependency; it only queues jobs and reads `email_log`.

Note (8A): the API gains `pdfkit` (PDF writer, MIT; built-in Helvetica only, no font files shipped) and `exceljs` (xlsx writer, MIT). Dev-only: `@types/pdfkit`. Tests use the `pdftotext` command (poppler-utils) when it is installed, to read generated PDFs.

Note (8B): the API gains `qrcode` (QR code generator, MIT) for the verification code on the certificate PDF. Dev-only: `@types/qrcode`.
