# Search, My Work and Activity (Phase 10G)

Three read-only views that answer "where is it", "what is waiting for me" and "what happened". None of them adds access: each list is built from the same data function, with the same visibility arguments, that the module's own screen uses, and only then is it filtered by the typed text. A result can only be something the person could already open.

## Search
- `GET /t/:tenantId/search?q=` for one organization; `GET /me/search?q=` across every active organization the person can enter (client admins, staff and auditors, vendors, each with their own access in each organization). Organizations the person cannot enter are never queried, so nothing from them can appear, including counts.
- Text must be 2 to 80 characters. It is matched as a case-insensitive substring; `%`, `_` and quotes are plain text. The header search box opens the results page.
- Searched: engagements (name, client reference), checklist items (reference, title, domain, description), findings, risks, incidents, vendors, policies. Evidence file names and contents are not searched.
- What each role finds: client admins and managing staff everything in the organization; auditors the engagements they belong to plus the whole risk, incident, vendor and policy registers; client staff and vendors only their own assigned items and findings, their own incidents, vendors where they are the contact, and published policies for their audience (never drafts).
- Results are grouped by type, best match first (exact reference, title starts with, title contains, other field), up to `limit` per type (default 8, max 20), with a short excerpt of matching description text. The answer contains no totals; a `more` flag says a type was cut off.
- Rate limit: 300 searches per person per hour.

## My Work
`GET /t/:tenantId/my-work` and `GET /me/work`. Sections appear only when they have entries, and the number shown is the number listed (each section lists up to 50; `more` says there are further entries).
| Section | Who | Contents |
|---|---|---|
| Checklist items assigned to me | anyone with assigned items | items in active engagements that are not yet effective, overdue first |
| Evidence I need to provide | same | requests in state requested or rejected |
| Evidence waiting for my review | auditors, managing staff who can read evidence | submitted evidence in engagements they can see |
| Findings waiting for my re-test | auditors, managing staff | findings ready for re-test |
| Policies waiting for my approval | client admins, managing staff | versions in review that someone else wrote |
| Findings / Risks / Incidents I own | owners | unresolved findings, open risks (due date is the review date), open incidents |
| Policies I need to acknowledge | client admins, client staff, vendors per policy audience | published policies not yet acknowledged |

## Activity timeline
`GET /t/:tenantId/timeline`: the audit log in plain words, newest first, paged with `beforeId`. Client admins, managing staff and auditors see the whole organization; everyone else sees only what they did themselves. IP addresses are not included.

## Shared filters
One filter bar and one parameter set across the three screens: `orgId` (client), `frameworkId`, `engagementId`, `ownerId`, `status`, `from`, `to`. Each screen honours the ones that make sense and ignores the rest:
| Filter | Search | My Work | Activity |
|---|---|---|---|
| Client (`orgId`) | cross-organization only | cross-organization only | n/a (one organization) |
| Framework | yes (engagement-bound types only) | yes | n/a |
| Engagement | yes (engagement-bound types only) | yes | yes |
| Owner (`ownerId`) | yes | n/a (always me) | yes (actor); others only themselves |
| Status | yes (the record's own status) | yes | n/a |
| Period (`from`, `to`) | n/a | due dates | yes |
Engagement-bound types are engagements, checklist items and findings; setting an engagement or framework filter removes risks, incidents, vendors and policies from search results. Malformed filter values are refused with 400.
