# Security controls (overview)

- **Tenant isolation**: every tenant table has `tenant_id`, composite foreign keys, and access only through data-layer modules (a lint test enforces this). A caller without access gets 404.
- **Database accounts**: the API and worker run as least-privilege accounts, never `root` (enforced at startup in production). Audit and log tables are append-only through triggers and grants.
- **Authentication**: sessions with CSRF protection; two-step verification (secrets encrypted with `MFA_ENC_KEY`); platform administrators must use it unless explicitly switched off, which production refuses.
- **API response headers** (`api/src/platform/headers.ts`): `Cache-Control: no-store`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, strict `Referrer-Policy`, `Cross-Origin-Opener-Policy`/`Resource-Policy`, a deny-all CSP for API responses, `Permissions-Policy`, HSTS in production, and an `X-Request-Id` (an inbound id is kept only if it is 8 to 64 safe characters).
- **Web headers** (`web/Caddyfile`): CSP limited to same origin, HSTS, frame denial, long-lived caching only for hashed assets, and server timeouts against slow clients.
- **Containers**: `no-new-privileges`, all Linux capabilities dropped (web keeps only the one needed to bind port 80/443), init process for clean shutdown, memory limits, rotated logs.
- **Evidence files**: stored by content hash, verified by SHA-256, optional malware scan.
- **Recoverability**: encrypted nightly backups, append-only backup log, monthly restore drills with integrity checks (see RUNBOOK.md).
- **Supply chain**: CI runs typecheck, tests, `npm audit`, CodeQL, deploy-file linting; Dependabot proposes updates weekly.
- **Threat-model tests (10I)**: injection probes on every route, mass-assignment sweep, session and export checks, browser end-to-end run, Trivy and gitleaks in CI. See THREAT_MODEL.md and E2E.md.
- **Not done here**: read-only container filesystems, a WAF, external log shipping. Add them if your hosting policy requires.
