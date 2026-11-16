# Public API (Phase 11B)

For scanners, ticketing tools and SIEMs. Base path `/v1`. JSON in, JSON out, always over HTTPS.

## Keys

An organization administrator (or iSecurify staff with manage rights) creates keys under **Integrations → API keys**.

- Pick only the scopes the tool needs. Set an expiry (the page suggests 90 days; the API allows 1–730 days or none).
- The key looks like `isg_<8 characters>_<secret>`. **It is shown once.** Only a SHA-256 hash is stored.
- A key belongs to **one organization**. It can never reach another one.
- Actions taken with a key are recorded under the name of the person who created it, and the audit entry says it came through an API key.
- A key stops working at once when it is revoked or expires, when its creator is disabled or loses manage rights, or when the organization is suspended.
- Send it as `Authorization: Bearer <key>`. Cookies, sessions and CSRF tokens play no part, and a key cannot call the normal (browser) API.

Every authentication failure returns the same `401 {"error":"Invalid API key","code":"unauthorized"}`, so the response does not reveal why. Repeated bad keys from one address are slowed down (429). Each key may make 600 requests per minute (429 `rate_limited` after that).

## Scopes

| Scope | Allows |
|---|---|
| `items:read` | `GET /v1/items` |
| `findings:read` | `GET /v1/findings` |
| `findings:write` | `POST /v1/findings` |
| `tests:read` | `GET /v1/control-tests` |
| `tests:write` | `POST /v1/control-tests/:id/runs` |
| `posture:read` | `GET /v1/posture` |
| `audit:read` | `GET /v1/audit` |

`GET /v1/me` works with any valid key and shows its organization and scopes.

## Endpoints

### `GET /v1/items`
Checklist items. Query: `engagementId`, `overdue=true|false`, `state`, `page` (default 1), `pageSize` (1–200, default 100). Returns `{total, page, pageSize, items[]}`.

### `GET /v1/findings`
Query: `engagementId`, `status`, `severity` (`critical|high|medium|low|info`), `unresolved=true`. Returns `{total, findings[]}` including `externalRef`.

### `POST /v1/findings` (scanners and ticketing)
```json
{ "itemId": "<checklist item id>", "title": "Outdated TLS on api.example.com", "description": "TLS 1.0 accepted",
  "severity": "high", "recommendation": "Disable TLS 1.0/1.1", "dueDate": "2026-12-01", "externalRef": "scan-8841-1" }
```
- `externalRef` (your scanner's or ticket's own id; printable characters, no spaces) makes the call **idempotent**: sending it again returns `200` with `"duplicate": true` and the original `id`, and changes nothing. Retry freely.
- New finding: `201 {id, ref, findingNo, duplicate:false}`.
- `404` if the item is not in your organization, `409` if its engagement is closed or the item is marked not applicable.
- Limit: 600 new findings per hour per key.

### `GET /v1/control-tests` / `POST /v1/control-tests/:id/runs`
Record the result of an automated check:
```json
{ "result": "pass", "note": "Restore job 5521 succeeded", "performedOn": "2026-10-30" }
```
`note` is required. `201 {id}`. A failed result notifies the people accountable, exactly as in the app. `409` if the test is paused. History is append-only.

### `GET /v1/posture`
Compliance percentage per framework for each engagement, with the recent trend.

### `GET /v1/audit?afterId=<n>&limit=<1–500>` (SIEM)
Activity events in order. Resume by passing the `nextAfterId` you were given. Sign-in, user, session, API-key, webhook, invitation, backup and platform events are **never** included.

## Examples

```bash
curl -s https://grc.example.com/v1/me -H "Authorization: Bearer $ISG_KEY"

curl -s -X POST https://grc.example.com/v1/findings -H "Authorization: Bearer $ISG_KEY" -H 'content-type: application/json' \
  -d '{"itemId":"…","title":"Open S3 bucket","description":"Public read","severity":"critical","externalRef":"ticket-4412"}'

# SIEM: poll every minute, keep the last id
curl -s "https://grc.example.com/v1/audit?afterId=$LAST" -H "Authorization: Bearer $ISG_KEY"
```

## Errors

`{"error": "<message>", "code": "<code>"}` with the usual statuses: 400 invalid input, 401 invalid key, 403 missing scope, 404 not found (also for another organization's data), 409 conflict, 429 rate limited.
