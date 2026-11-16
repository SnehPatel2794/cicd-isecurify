# Webhooks (Phase 11B)

iSecurify tells your system when something changes. Managed under **Integrations → Webhooks** (organization administrators and staff with manage rights).

## Switching it on

Webhooks need `WEBHOOK_ENC_KEY` in `.env` (`openssl rand -base64 32`, a different value from `MFA_ENC_KEY`), shared by the api and worker containers. It seals the signing secrets in the database. Without it webhooks stay off and the page says so; API keys are unaffected. Do not lose the key: secrets sealed with it could no longer be read, and you would need to rotate each one.

## Events

Pick patterns: `*` (everything that can be sent), `finding.*`, `evidence.*`, `control_test.failed`, and so on. Events come from the audit log, so anything recorded there can be sent. **Never sent**: sign-in, user, session, MFA, password, invitation, API-key, webhook, backup and platform events.

Only events that happen **after** the endpoint is created are sent; there is no back-fill.

## Delivery

`POST` to your https address with `content-type: application/json`:

```json
{ "id": "evt_1042", "type": "finding.raised", "organizationId": "…", "occurredAt": "2026-10-31T05:40:00.000Z",
  "actorId": "…", "entity": "finding", "entityId": "…", "data": { } }
```

Headers: `x-isg-event`, `x-isg-delivery` (delivery id), `x-isg-signature`, `user-agent: iSecurify-GRC-Webhooks/1`. Your endpoint should answer `2xx` within 10 seconds. The `id` is stable: **de-duplicate on it**, delivery is at least once.

## Verifying the signature

`x-isg-signature: t=<unix seconds>,v1=<hex>`, where `v1` = HMAC-SHA256 of `"<t>.<raw request body>"` with your signing secret. Use the raw bytes, compare in constant time, and reject if `t` is more than 5 minutes old.

```js
const [t, v1] = header.split(',').map(p => p.split('=')[1]);
const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected)) && Math.abs(Date.now() / 1000 - Number(t)) < 300;
```

The secret (`whsec_…`) is shown once. **Rotate secret** issues a new one and the old one stops immediately.

## Retries and switching off

A failure (non-2xx, timeout, network error, redirect) is retried with growing waits (30 s, then longer, up to 6 hours) for 8 tries, then parked as **Failed**; use *Try again* on the Deliveries list. After 15 failures in a row the endpoint is switched off and says why; turning it on resets the count. **Send test** sends a `webhook.test` event whenever you want. Delivery history is kept 30 days.

## Safety rules

- https only; no credentials in the address; no `localhost`, `.internal` or `.local` names.
- The name is resolved **at delivery time** and refused if any answer is a private, loopback, link-local or similar address (so a name that later points inward is still blocked).
- Redirects are not followed.
- An organization may have 10 endpoints. Another organization's events are never matched to your endpoints.
