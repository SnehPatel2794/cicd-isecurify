# Certificates (Phase 8B)

## Who can do what
- **Issue and revoke:** iSecurify staff assigned to the organization with manage rights.
- **View and download the PDF:** client administrators, managing staff, and a third-party auditor for certificates of engagements they are on.
- **Verify:** anyone, without signing in, at `/verify/<code>` (also the QR code on the PDF).

## Issuing
- The engagement must be **closed**, and the framework must be one of its frameworks.
- **Readiness gate:** every applicable control of that framework must be effective (evaluated exactly as the checklist does). Otherwise the API answers 409 `not_ready` unless an override reason of at least 10 characters is given; it is stored and shown to staff and client admins (never on the public page). A framework with no applicable controls cannot be certified.
- Validity: after today, at most 1100 days. The database enforces this too.
- Number `ISG-YYYY-NNNNNN` comes from the row's auto-increment serial and issue year. The public code is 16 random bytes (22 base64url characters), so numbers cannot be guessed from codes.
- Organization, engagement and framework names and the framework version are copied onto the certificate, so later renames do not change it.
- Issuing a new certificate for the same organization and framework **supersedes** the older active ones.
- Client admins are notified (`certificate.issued`). Limit: 30 issues per hour per person.

## Status
`revoked` beats `superseded` beats `expired` beats `valid`. A certificate is valid through its last day. "Expiring soon" means 60 days or fewer left.

## Revoking
Needs a reason. Cannot be undone. Downloads stop (409 `certificate_revoked`); the public page says revoked without the reason. Client admins are notified (`certificate.revoked`).

## Immutability
Database triggers refuse deletes and any edit except the one-time revoke fields and the one-time `superseded_by`. The app account can SELECT, INSERT and UPDATE; the worker can only SELECT.

## Public endpoint
`GET /public/certificates/:code` returns only: valid flag, status, number, organization, framework and version, scope, dates and issuer. Unknown or malformed codes are 404. Limit 60 lookups per minute per address. Responses are `no-store`.

## Expiry reminders
The daily reminder scan (see `REMINDERS.md`) tells client admins at 60, 30 and 7 days before expiry and once after expiry, using the `reminder.due_soon` / `reminder.overdue` kinds and the same log, so nothing is sent twice. Revoked and superseded certificates are skipped. Digest emails list them too.

## Audit
`certificate.issued`, `certificate.downloaded`, `certificate.revoked`.

## Auditor opinion (Phase 11C)

Issuing now looks at the engagement's active sign-off. No sign-off: `no_signoff`. An *adverse* opinion: `adverse_opinion`, no certificate. A *qualified* opinion is issued, stored on the certificate (`opinion`, `signoff_id`), printed on the PDF ("AUDITOR OPINION: QUALIFIED") and returned by the public verify endpoint as `auditorOpinion`. A waiver (no external auditor) is issued with no opinion line. The opinion is part of the certificate record and does not change after issue.
