# Staging (Phase 11F)

A second copy of the application where every release is tried before it reaches production.

## What it is
- Its own folder, its own `.env`, its own containers and volumes (Compose project `isecurify-grc-staging`), so nothing is shared with production.
- Best on a separate small server. On the same server as production, give it other ports (`HTTP_PORT=8080`, `HTTPS_PORT=8443`, `APP_ORIGIN_OVERRIDE=https://staging.example.com:8443`).
- A certificate from Caddy's own CA (`web/Caddyfile.staging`), so browsers warn once. Search engines are told not to index it. The app shows an amber **STAGING** bar.
- **Never sends email and never calls webhooks**: `SMTP_HOST` and `WEBHOOK_ENC_KEY` stay out of its `.env`, and `deploy/staging.sh` refuses to run if either is set or `APP_ENV=staging` is missing.

## Set up
1. Unpack the same release zip into a new folder (for example `/srv/isecurify-staging`).
2. `cp .env.staging.example .env` and fill in **new** secrets (`openssl rand -base64 32`). Never reuse a production secret.
3. `deploy/staging.sh up`, then `deploy/smoke.sh https://staging.example.com --insecure --expect-env staging`.

## Using real-looking data
`deploy/staging.sh refresh /var/backups/isecurify` loads the newest production **database** backup into staging (checksum checked first, decrypted with your GPG key if needed) and scrubs it with `deploy/staging-scrub.sql`:
- every user's email becomes `user-<id>@staging.invalid`, names are replaced, passwords made unusable, sessions, two-step secrets, invitations and reset links deleted;
- queued jobs, the outbox and the sent-mail log are cleared; API keys are revoked; webhooks are switched off and pointed at nothing; IP addresses are removed;
- the append-only protection on the audit, mail and deletion logs is lifted for the scrub only and put back unchanged.

Evidence **files are never copied**, so downloads of old evidence will not work on staging. Organization names, engagements, findings and other business content are kept: treat staging as confidential and limit who can reach it. After the scrub the script prints a one-time sign-in link for the first Super Admin (two-step verification reset); everyone else is reached through that account.

## Applying a release to staging
Use the same patch you will use in production: `deploy/apply-patch.sh isecurify-grc-patch-<from>-to-<to>.tar.gz`, then the smoke test. See `docs/RELEASE.md`.
