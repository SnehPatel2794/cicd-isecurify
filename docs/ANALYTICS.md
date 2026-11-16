# Analytics (Phase 8D)

Read-only views built from existing data; nothing is stored and nothing is audited.

## Organization analytics: `GET /t/:tenantId/analytics?months=1..12` (default 6)
- **Who:** client administrators, iSecurify staff assigned to the organization, and TP auditors (auditors see only engagements they are members of). Client staff and vendors get 403. Other organizations get 404.
- **Readiness:** exactly the evaluation service used by the checklist, dashboard and reports, so the numbers always agree (a test compares them). Overall figure covers active engagements; each engagement is listed with its own figure. The framework breakdown counts each checklist item once per framework it satisfies, skips not-applicable items, and uses the 30 most recent active engagements (flagged when sampled).
- **Findings:** totals by status and severity, unresolved by severity, overdue with buckets (1-7, 8-30, 31-90, 90+ days late), age of unresolved findings (0-30, 31-90, 91-180, 180+), average days to close for findings closed within the window, and a raised-versus-closed series per month with the backlog change this month.
- **Evidence:** requests by status, accepted evidence expiring in 30 and 60 days or already expired, accepted/rejected reviews per month and the rejection rate.
- **Certificates:** counts by status and expiring soon (same status rules as certificates).
- Months with no activity appear as zeros. At most 200 engagements are included (flagged).

## Portfolio: `GET /platform/analytics`
For iSecurify platform users: one row per organization they are **assigned to** (assignment is required, as everywhere else; being an administrator alone shows nothing). Each row: active engagements, readiness, unresolved and critical findings, overdue findings and items, certificate counts, and a plain-language attention list in this order: critical findings, overdue findings, overdue items, expired certificates, certificates expiring soon. Organizations that need attention come first. Suspended or archived organizations are listed without figures. At most 200 organizations.

## Screens
`/org/:id/analytics` (sidebar "Analytics") and `/analytics` (sidebar "Portfolio overview"). Charts are plain bars with the number beside them, so they read in any browser and for screen readers.
