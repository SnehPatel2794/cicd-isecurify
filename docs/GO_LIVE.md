# Go-live checklist

Tick each line with the date and initials. Items marked **(proof)** need a screenshot, command output or file kept in the go-live folder.

## 1. Server and network
- [ ] Ubuntu LTS server, updates applied, SSH keys only, root login disabled, firewall allows 22 (restricted), 80, 443 only (`deploy/server-setup.sh`).
- [ ] DNS for the production domain points at the server. Port 80 reachable (for the certificate).
- [ ] Disk: evidence volume and backup folder have room for at least six months of growth. Time zone and NTP correct.

## 2. Configuration (`.env`)
- [ ] Created from `.env.example` with **new** random secrets (`openssl rand -base64 32`); the file is mode 600 and not in any repository.
- [ ] `APP_ORIGIN` is https; `DOMAIN` set; the API starts (it refuses unsafe production settings).
- [ ] SMTP (GSuite) set; **test email received (proof)**. SPF, DKIM and DMARC on the sending domain.
- [ ] The API connects as its own limited database account, not root (System status > database accounts).

## 3. First start
- [ ] `docker compose up -d`; `docker compose ps` shows all healthy.
- [ ] `deploy/smoke.sh https://<domain> --expect-env production --expect-version <version>` passes **(proof)**.
- [ ] `deploy/verify-readonly.sh` passes **(proof)**.
- [ ] First Super Admin signed in; password and two-step verification set; recovery codes stored in the company password manager.
- [ ] Branding set; one test client created and then removed.

## 4. Backups and recovery
- [ ] `deploy/install-cron.sh --user deploy` run: nightly backup, log shipping, weekly drill, health probe.
- [ ] GPG key created; **private key stored off the server**; `BACKUP_GPG_RECIPIENT` set.
- [ ] Off-server copy configured and a test copy verified (System status shows ok), or the decision to stay on-server is written down and signed.
- [ ] First backup taken; **restore drill passed (proof)**.
- [ ] **A real restore rehearsed on staging from the production backup**, signed by a second person (see `docs/RESTORE_EVIDENCE.md` for the format) **(proof)**.
- [ ] RPO (24 h) and RTO (about 1 h) accepted by management.

## 5. Security review
- [ ] Penetration test of production or staging done by someone other than the builder; high and critical findings fixed.
- [ ] Two-step verification enforced for all platform users (default).
- [ ] Admin list reviewed: only the people who need it.
- [ ] Security headers verified by the smoke test; certificate valid; HSTS on.
- [ ] Log shipping location reviewed for access and retention.
- [ ] Incident contact list written (who decides, who tells clients).

## 6. Content
- [ ] Frameworks imported, reviewed and published; questionnaires loaded; milestone templates reviewed.
- [ ] Evidence templates reviewed. Terms of use and privacy notice agreed with legal.

## 7. People
- [ ] Administrators trained with `docs/ADMIN_GUIDE.md`; at least two can restore and recover an admin.
- [ ] Client guide (`docs/CLIENT_GUIDE.md`) sent with the first client invitation.
- [ ] Support contact and response times told to clients.

## 8. Cut-over
- [ ] Staging is on the same version as production.
- [ ] Rollback plan understood (`docs/RELEASE.md` step 5); backup taken immediately before go-live.
- [ ] Go / no-go meeting held; decision and names recorded.
- [ ] After go-live, day 1, day 7 and day 30: System status green, backups ok, drill ok, mail delivery ok, disk growth as expected.
