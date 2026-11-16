# Tiles and drill-down (Phase 10H)

## Tiles
`GET /t/:tenantId/widgets` lists the tiles the caller may see; `GET /t/:tenantId/widgets/:id` loads one. Every tile is its own endpoint, so a slow or failing tile never holds up the others (the page shows each tile's own loading, empty, error-with-retry and "May be out of date" states).

| Tile | Who sees it | Number | Opens |
|---|---|---|---|
| `readiness` | everyone | effective / applicable controls, as a % | Checklist items |
| `items-overdue` | everyone | items past due and not effective (own items only for client staff and vendors) | Checklist items, overdue only |
| `items-awaiting-review` | everyone | items whose evidence is awaiting the auditor | Checklist items, state awaiting review |
| `findings-unresolved` / `findings-overdue` / `findings-critical` | everyone (within what they can see) | findings | Findings, same filters |
| `risks-open` | whoever sees the whole register (client admins, auditors, managing staff) | open risks | Risk register, "Open only" |
| `incidents-open` | whoever sees every incident | open incidents | Incidents, "Open only" |
| `my-work` | everyone | total of My Work for this organization | My Work |

Response: `value`, `unit`, `detail`, `empty` (nothing in that area yet), `drill` (the link), `freshness` (`source`, `stale`, `ageMinutes`). An unknown tile is 404; a tile the role may not see is 403; another organization is 404.

## The number equals the list
Each tile's number comes from the same data call, with the same filters, as the list its link opens (or, for item tiles, from the stored summaries that the item list is checked against). `api/test/43_widgets.test.ts` opens every tile's drill link for four roles, live and again after the worker has refreshed the summaries, and asserts tile value = list count. Findings, risk and incident lists are capped at 2,000 rows; a tile reports at most 2,000.

Item tiles are served from the stored summaries (Phase 10F), so they can lag a change by seconds; they show "May be out of date" after 15 minutes. The item list is always live.

## Checklist items list
`GET /t/:tenantId/items` — every item the caller may see in active engagements (`engagementStatus=all` to include closed ones), evaluated by the one evaluation service. Filters: `state`, `overdue`, `engagementId`, `frameworkId`, `ownerId`, `q` (2 to 80 characters, reference or title); `page`, `pageSize` (1 to 200, default 50). Overdue items first, then by due date, engagement and reference. `total` is the full match count. Client staff and vendors see only items assigned to them; auditors only engagements they belong to.
