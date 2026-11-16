# Evidence (Phase 5: core API, screens, template library, malware scanning)

## Model
`checklist item` → `evidence request` (what to provide) → `version` (each upload, immutable) → `review` (accept/reject, append-only).
* **Request**: title, instructions, due date, optional validity in months, optional template (5C). Statuses: `requested → submitted → accepted | rejected`, or `cancelled` (reason mandatory). One item may have several requests (max 20 open).
* **Version**: a file (SHA-256 of the exact bytes, size, stored on the evidence volume) or a link (https only; cannot be hashed, so the UI must say it is not verifiable). Uploading while `submitted`/`accepted`/`rejected` creates the next version and puts the request back to `submitted`; any earlier validity is cleared. Max 50 versions per request.
* **Review**: only the **newest** version can be reviewed; the note is mandatory (database CHECK); a decision can be reversed only by a newer decision (history kept); repeating the current decision is refused. Reviewers cannot review their own uploads.
* Database rules (raw SQL tested): versions, reviews and scans cannot be updated or deleted (triggers + insert-only grants); a review's version must belong to its request and tenant (composite FKs); blank notes, cancelled-without-reason and accepted-without-version are rejected.

## Item status and the evaluation service
`modules/evidence/rules.ts → deriveItemEvidence` turns the item's non-cancelled requests into the single `evidence_status` that Phase 4's evaluation service reads: none → `not_requested`; all accepted → `accepted`; any rejected → `rejected`; any submitted → `submitted`; some accepted and the rest still requested → `in_progress`; else `requested`. It is recomputed in the same transaction as every change. **Effective still requires the claim `implemented` AND accepted, unexpired evidence on every open request** (exhaustively tested).
**Expiry** is computed at read time (`valid_until < today`): the item shows *Blocked: missing or stale evidence*; lists, dashboards and the checklist agree. Validity = auditor-chosen date, else request `valid_months` from the acceptance day; evidence is valid through its date.

## Who may do what
| | Request / cancel | Upload | See metadata | Download / open link | Accept / reject | Scan |
|---|---|---|---|---|---|---|
| client_admin | yes | yes | all | yes | **no** | yes |
| client_staff, vendor | no | own items | own items only (others are 404) | own items | no | no |
| tp_auditor (engagement member) | no | no | yes | yes | **yes** | yes |
| iSecurify staff, manage + can_read_evidence | yes | yes | yes | yes | **yes** | yes |
| iSecurify staff, manage only | yes | yes (on the client's behalf) | yes | **no** | no | yes |
| iSecurify staff, read-only | no | no | yes | if can_read_evidence | no | no |
Closed engagements are read-only (409). A link's address counts as content and is hidden from people who may not open content.

## Files
Stored on the `evidence_data` volume at `evidence/<tenantId>/<versionId>` (generated ids, never user names). Written to `.tmp`, hashed while streaming, moved with an atomic no-overwrite link. Allow-list: pdf, png, jpg/jpeg, gif, docx/xlsx/pptx, odt/ods/odp, doc/xls/ppt/msg, csv, txt, md, json, xml, log, eml, zip. Content must match the extension; executables and `#!` scripts are refused whatever the name. Default 25 MB per file (`EVIDENCE_MAX_FILE_MB`). Downloads are always `application/octet-stream` + `attachment` + `nosniff`, carry `X-Evidence-SHA256`, and are written to the audit log. `GET …/verify` re-hashes the stored file; mismatch or a missing file is audited as `evidence.integrity_failure`.
**Quota:** none by default (unlimited); an administrator can set a limit for one organization (`EVIDENCE_DEFAULT_QUOTA_MB` can set a platform-wide default, 0 = none). See docs/STORAGE.md. Overridable by admins (`PUT /platform/organizations/:id/evidence-quota`). Checked under a row lock, so parallel uploads cannot overshoot. Versions are never deleted, so usage only grows; lowering a quota below usage blocks further uploads.

## Endpoints (all under `/t/:tenantId` unless noted)
`GET evidence/config` · `GET engagements/:id/evidence` · `GET checklist/:itemId/evidence` · `GET evidence-requests/:id` · `POST checklist/:itemId/evidence-requests` · `POST engagements/:id/evidence-requests/bulk` ({itemIds} or {allWithoutRequests:true}) · `PATCH evidence-requests/:id` · `POST evidence-requests/:id/cancel` · `POST evidence-requests/:id/versions` (multipart `file`, optional `note` field sent BEFORE the file; or JSON `{linkUrl, note}`) · `POST evidence-requests/:id/review` · `GET evidence-versions/:id/download|verify|scans` · `POST evidence-versions/:id/scan` (needs the scanner, 5C) · `GET/PUT /platform/organizations/:id/evidence-usage|evidence-quota`.
Template-library endpoints: `GET /templates` · `GET /templates/:id/download` · `POST /templates` (multipart; text fields first, file last) · `PATCH /templates/:id` · `POST /templates/:id/retire` · `GET /templates/meta/allowed-types`.
Platform users upload and edit, admin-level users retire, everybody who belongs to an organization can list and download. Template files never change: "new version" uploads a new row (`replacesId`) and retires the old one. Retired templates are hidden from clients and from new requests, but stay downloadable so requests that already use them keep working. Nothing is deleted.

## Template screens (5C)
**Evidence templates** page (sidebar): grouped by category, download with SHA-256 check; staff also get Add template, Edit, New version, Show retired; admins get Retire. A request form offers a template drop-down, and a request that has one shows **Download template** (also hash-checked).

## Malware scanning (5C)
Optional. Without it, evidence works exactly as before and the Scan button is hidden.
1. `docker compose --profile scan up -d` starts ClamAV (needs about 3 GB RAM and a few minutes for the first signature download).
2. In `.env`: `CLAMAV_HOST=clamav:3310` and, to scan every upload, `EVIDENCE_AUTO_SCAN=true`. Restart api and worker.
How it works: the API enqueues an `evidence.scan` job; the worker (read-only on the evidence volume) first re-hashes the stored file and compares it with the SHA-256 recorded at upload (a mismatch is recorded as an `error` result and is never retried), then streams the file to clamd (INSTREAM). The result is one append-only row in `evidence_scans`: `clean`, `infected` (with signature) or `error` (with reason).
* An `infected` result is sticky: the file cannot be downloaded or accepted, and a later `clean` scan does not undo it.
* If clamd is unreachable, the job is retried with back-off; only after the last attempt is an `error` row written, so the screen shows a result instead of silence. An `error` result blocks nothing; scan again once the scanner is healthy.
* Scanner limits: clamd's `StreamMaxLength` must be at least `EVIDENCE_MAX_FILE_MB` (the compose profile sets 100M).

## Orphan-file sweep (5C)
The hourly `maintenance.cleanup` job deletes files on the evidence volume that no database row refers to (failed uploads, rolled-back transactions) once they are older than 24 hours, and stale `.tmp` files. It never touches a file that has a row, a recent file, or a file whose name is not one the server generates. Files that the database refers to but that are missing are reported in the worker log at error level (`evidence files referenced by the database are MISSING`) and are never "repaired". Watch for that line after restoring a backup.
