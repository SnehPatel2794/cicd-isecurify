# Importing scanner / VAPT results (Phase 8C)

**Who:** the TP auditor on the engagement and iSecurify staff with manage rights. Closed engagements refuse the import (a preview still works).

## Flow
1. Choose a `.csv` or `.json` file (max 2 MB, 500 rows). Optionally choose a default checklist item.
2. The preview (`POST .../findings/import` with `commit: false`) writes nothing and shows each row as New, Already imported, or Invalid with the reason.
3. Confirm. The import runs in one transaction. Invalid rows stop it unless "skip invalid rows" is chosen. Nothing is created if every row is a duplicate or invalid.

## Columns (case and punctuation ignored)
| Field | Accepted headers |
|---|---|
| Title (required) | title, name, vulnerability, plugin name, issue, finding, alert |
| Severity (required unless CVSS given) | severity, risk, risk desc, rating, priority |
| Description | description, synopsis, details, summary |
| Recommendation | recommendation, solution, remediation, fix |
| Checklist item | item, control, ref, checklist item |
| Asset | host, ip, asset, target, url |
| Port, CVE, CVSS, scanner ID | port, cve, cvss / base score, plugin id / id |

Severity words: critical, high, medium/moderate, low, informational/none/info (= observation); "Medium (High)" uses the first word. With no severity text, a CVSS score maps 9+ critical, 7+ high, 4+ medium, above 0 low, 0 observation. Unknown wording is an invalid row.
The description keeps the scanner text and appends Affected host:port, CVE, CVSS and scanner ID. JSON: a list, or `{"findings": [...]}`, using the same field names.

Each row needs a checklist item: its own `item` value (must match a checklist item ref) or the default. Not-applicable items are refused.

## Duplicates
A finding's key is item + title + host + port + CVE + scanner ID. The same key in the same engagement is skipped, in the file or already imported (unique key in the database). The same finding on another host or item is new.

## What is recorded
Findings are numbered after the existing ones, in file order, raised by the importer, status Open, with a "raised" history entry naming the file and row. Owner and due date are assigned afterwards as usual; imported findings follow every normal rule (blocking, retest, closing).
`finding_imports` holds one append-only row per import (file name, format, SHA-256, counts, who). The audit entry `finding.imported` holds the same counts but not the scan content. Limits: 20 imports and 60 previews per hour per person.
