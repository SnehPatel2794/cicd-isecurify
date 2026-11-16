# Portal polish (Phase 9D)

## List exports
| List | Endpoint | Who | Filters |
|---|---|---|---|
| Risk register | `GET /t/:id/risks/export` | client admins, auditors, managing staff | status, category |
| Incidents | `GET /t/:id/incidents/export` | client admins, auditors, managing staff | status, severity, category |
| Policies | `GET /t/:id/policies/export` | client admins, auditors, managing staff | none (includes acknowledgement counts) |
| Findings | `GET /t/:id/findings-export` | everyone who can open the findings list, limited to what they can see | same as the list |

`?format=csv` (default) or `?format=xlsx`. CSV is UTF-8 with a byte-order mark and CRLF line ends so Excel opens it correctly. Any text cell starting with `=`, `+`, `-`, `@`, tab or carriage return is written with a leading single quote, so a spreadsheet never runs it as a formula; control characters are removed. Limits: 2,000 rows (narrow the filters otherwise, HTTP 413) and 20 exports per person per hour. Every export is audited (`export.risks`, `export.incidents`, `export.policies`, `export.findings`) with the format, row count and filters. Files are sent with `Cache-Control: no-store`.

## Saved views
`GET/POST /t/:id/views?page=risks|incidents|findings`, `DELETE /t/:id/views/:viewId`. A view is a name (up to 60 characters) and a set of filters; only the filter keys the list understands are accepted, with short plain values. Views belong to one person in one organization (nobody else can see or delete them), names are unique per person and list, and 20 are kept per list. Choosing a view applies its filters; *Save this view* appears when filters are set; *Delete view* when the current filters match a saved view.

## Bulk assign
`POST /t/:id/risks/bulk-assign` (`ids` up to 50, `ownerUserId` or `null` to clear) and `POST /t/:id/incidents/bulk-assign` (`ownerUserId` required). Only client admins and managing staff. The owner is validated once; then every item is checked and saved in its own transaction with the same rules as a single edit (closed items are skipped, an item that already has that owner is skipped, other organizations' ids count as not found). The answer is `{ updated, skipped: [{ id, ref, reason }] }`. Each change is an `assigned` event on the item, notifies the new owner and is audited with `bulk: true`. 20 bulk changes per person per hour.

## Getting started and Help
`GET /t/:id/onboarding` returns the steps for the caller's role: managers (client admins, managing staff) invite the team, start an engagement, publish a policy and log a risk; auditors open an engagement; client staff and vendors acknowledge their policies; other staff have none. Steps tick off as the organization fills up. The card on the organization home page can be dismissed; that is remembered in the browser only. The Help page (`/help`) is searchable text that mirrors the rules the server enforces.

Not built: scheduled or emailed exports, exports of engagement checklists (the engagement report already covers them), shared team views, bulk actions on findings and checklist items.
