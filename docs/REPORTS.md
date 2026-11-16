# Reports and exports (Phase 8A)

On an engagement, **Reports** (visible to client admins, iSecurify team members with manage rights, and the TP auditor on that engagement) offers:

- **PDF report**: cover (organization, engagement, frameworks, document-control fields), summary, findings register with details, control checklist, statement of applicability (optional), evidence index.
- **Excel workbook**: Summary, Checklist, Findings, SOA, Evidence sheets, with filters and frozen headers. Text is stored as text (a title such as `=HYPERLINK(...)` is never evaluated).

Both are a **snapshot at the moment of export**. An open engagement says so on the cover and in history ("open snapshot"); a closed one is marked closed.

## What is in it, and what is not
Same data and same visibility as the screens (an auditor sees only engagements they are on). Evidence appears as an **index** (request, status, validity, latest file name, size, uploader, SHA-256, scan result). The evidence files themselves and link URLs are **not** included.

## Tamper evidence
Every export is recorded in `report_exports` (append-only, enforced by database permissions and triggers): id, engagement, format, size, **SHA-256 of the exact file**, whether the engagement was open or closed, counts, who and when. The file is not stored.
To check a file you were given, open **Reports → Check a file** and select it. The browser calculates the SHA-256 (the file is not uploaded) and the server answers whether that fingerprint is one it recorded for your organization, naming the engagement, person and time. Any edit to the file, even a single byte, gives "No match". Auditors cannot learn about exports of engagements they are not on. Checks are audited (`report.verified`).
This proves the file is what the platform produced; it is not a digital signature, so someone with the original can still forward it.

## Limits and safety
- At most 5,000 checklist items, 5,000 SOA entries, 2,000 findings and 2,000 evidence requests per export; larger engagements get a clear 413 error.
- 20 exports per hour per person.
- The PDF uses the built-in Helvetica font: Western-European characters print normally, other scripts print as `?`. The Excel workbook keeps full Unicode.
- Audit events: `report.exported`, `report.verified`.

## API
`POST /t/:tenantId/engagements/:id/exports {format: pdf|xlsx, includeSoa}` returns the file (`x-report-id`, `x-report-sha256` headers); `GET .../exports` lists history; `POST /t/:tenantId/exports/verify {sha256}`.
