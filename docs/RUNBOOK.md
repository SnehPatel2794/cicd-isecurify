# Runbook

Single server, Docker Compose, project name `isecurify-grc`. Run everything from the project directory as the deploy user.

## Recovery targets
- **RPO** (data you can lose): up to 24 hours with the nightly backup. Shorten by running backup.sh more often.
- **RTO** (time to be back): about 1 hour on a prepared server, dominated by copying the backup back and the restore.
- A backup is only counted as good once a **restore drill** has passed. Administration > System status shows both.

## Deploy and update
1. `git pull`, review `.env.example` for new settings, then `docker compose up -d --build`.
2. The `init` service applies migrations and the database accounts before api and worker start. It is safe to re-run.
3. Check Administration > System status, and `docker compose ps` (api shows healthy).
4. The API refuses to start in production with an unsafe configuration (non-https `APP_ORIGIN`, short or placeholder `CSRF_KEY`, weak `MFA_ENC_KEY`, MFA for administrators switched off, database user `root`). The error names the problem.

## Roll back
Migrations only move forward. To roll back a release: take a backup, `git checkout <previous tag>`, `docker compose up -d --build`. If the release added a migration the old code cannot run against, restore the pre-update backup instead (see Restore).

## Backups
- Backups are kept **on this server** by default (`BACKUP_DIR`, `/var/backups/isecurify`): `deploy/backup.sh` writes a database dump plus the evidence files, a sha256 manifest, GPG encryption when `BACKUP_GPG_RECIPIENT` is set, and a free-space check. Retention keeps at least `BACKUP_MIN_KEEP` (7) and removes older ones after `BACKUP_KEEP_DAYS` (14).
- **Schedule:** run `sudo deploy/install-cron.sh --user deploy` once. It installs the nightly backup (02:15), a **weekly automatic restore drill** (Sunday 03:30) and the health probe (every 10 minutes). Re-running it is safe.
- **Off-server copy (switch on when you are ready).** Set in `.env`: `BACKUP_OFFSITE=rclone` with `BACKUP_OFFSITE_TARGET=remote:bucket/path` (any S3-compatible bucket or cloud supported by rclone), or `BACKUP_OFFSITE=rsync` with `BACKUP_OFFSITE_TARGET=user@host:/path` (a second server; optional `BACKUP_RSYNC_SSH="ssh -i /home/deploy/.ssh/backup_key -p 2222"`) or a mounted external disk path, or `BACKUP_OFFSITE=command` with `BACKUP_PUSH_CMD` for anything else. The copy runs after the local backup is recorded, is **verified** (rclone check, or an rsync checksum comparison), and gets its own line in the log. A failed copy ends the script with exit code 10 and never hides a good local backup. rclone also removes remote copies older than `BACKUP_OFFSITE_KEEP_DAYS` (30). Files are encrypted before they leave the server when GPG is set.
- Keep the GPG **private key** somewhere other than this server. Without it the backups cannot be opened.
- **Alerts.** The worker emails every administrator (once a day per problem) when: no backup in 36 hours or the last attempt failed, the off-server copy (once used) is older than 36 hours or failed, no restore drill passed in 10 days or the last one failed, the evidence disk has less than 2 GB free (`ALERT_MIN_FREE_MB`), or an organization with a storage limit has used 90%. The same items show on Administration > System status.
- Cron lines installed by the script, for reference:
```
15 2 * * *   deploy  /opt/isecurify/deploy/backup.sh >> /var/log/isecurify-backup.log 2>&1
30 3 * * 0   deploy  /opt/isecurify/deploy/restore-drill.sh >> /var/log/isecurify-drill.log 2>&1
*/10 * * * * deploy  /opt/isecurify/deploy/monitor.sh >> /var/log/isecurify-monitor.log 2>&1 || true
```

## Restore drill (weekly, automatic)
`deploy/restore-drill.sh` restores the newest backup into a temporary MySQL container and runs `api/scripts/verify-restore.ts` against it. It checks that every migration is recorded, all tables and protective triggers exist, all foreign keys have no orphan rows, at least one active super admin exists, a sample of evidence files matches its stored size and SHA-256, and prints row counts. It never changes live data; the only live write is one drill row in `backup_log`. Treat a failed drill as an incident.

## Restore (real)
`deploy/restore.sh <stamp>` after you have decided to replace live data. It verifies the checksum, asks you to type the domain, takes a safety backup, stops the app, rebuilds the database, restores evidence, re-applies migrations and accounts, verifies, then starts everything. Afterwards sign in, open System status, and confirm the latest data is present.

## Database accounts
Three accounts, none of them root at deploy time: `grc_migrator` (changes this database's structure and grants the other two their rights; nothing outside the `grc` database), `grc_app` and `grc_worker` (least privilege, per table). The one-shot `bootstrap` service is the only step that uses the root password: it creates or refreshes `grc_migrator` from `MIGRATOR_DB_PASSWORD`. Then `init` runs migrations and grants as the migrator. Backups and restores still use root inside the MySQL container (they run on the server, by the operator).

## Locked-out administrator
Someone with shell access to the server can recover an administrator who is locked out or lost their password (it never works over the web):
```
docker compose run --rm api npx tsx scripts/recover-admin.ts --email admin@your-domain.com
```
It unlocks the account, ends its sessions and prints a one-time password-reset link (valid 30 minutes, works once; give it only to that person). Add `--reset-mfa` only when the authenticator device **and** the recovery codes are lost: it removes their two-step verification and they enrol again at the next sign-in. Only active administrator accounts can be recovered this way. Every use is written to the audit log as `auth.admin_recovery`. If the only super admin is affected, this is the way back in.

## Rotating secrets
- `MIGRATOR_DB_PASSWORD`, `APP_DB_PASSWORD`, `WORKER_DB_PASSWORD`: change in `.env`, then `docker compose up -d` (bootstrap and init reset the account passwords).
- `CSRF_KEY`: change and restart api; everyone is signed out.
- `MFA_ENC_KEY` (encrypts stored authenticator secrets): rotate with the tool, which re-encrypts every secret or changes nothing. Stop the api (`docker compose stop api`), then run
  `docker compose run --rm -e OLD_MFA_ENC_KEY=<old> -e NEW_MFA_ENC_KEY=$(openssl rand -base64 32) api npx tsx scripts/rotate-mfa-key.ts` (a dry run), repeat with `--apply`, put the new key in `.env` and `docker compose up -d`. Keep the new key: it is not recoverable. Without the tool, changing the key would make every authenticator unreadable.
- `SMTP_PASSWORD` (the Google App Password): create a new one in the Google account, change in `.env`, restart worker, send a test message, then delete the old App Password.
- GPG backup key: create a new key pair, set `BACKUP_GPG_RECIPIENT` to the new key, keep the OLD private key until the last backup made with it has expired from retention.
- `MYSQL_ROOT_PASSWORD`: change inside MySQL first, then in `.env`.

## Problems
- **Disk full**: `docker system df`, remove old backups in the backup folder, `docker image prune`. Evidence files and the database volume are never deleted by pruning images. Check `df -h` first.
- **MySQL down**: `docker compose logs mysql`, `docker compose restart mysql`. If the data volume is damaged, restore.
- **Worker stuck / jobs piling up** (System status shows an old waiting job): `docker compose logs worker`, `docker compose restart worker`. Jobs that failed permanently are listed as given up; fix the cause, they are not retried automatically.
- **Email failing**: Administration > Email delivery shows the error per message; check SMTP settings and send a test message.
- **Evidence integrity doubt**: run the verify step of a restore drill, or `docker compose run --rm --no-deps api npx tsx scripts/verify-restore.ts --sample=0` against the live database (read only).
- **Suspected compromise**: take a backup now, keep the logs (`docker compose logs > incident.log`), rotate `CSRF_KEY` and all passwords, review Administration > Audit log, reset two-step verification for affected users, and restore from a backup taken before the event if data may have been altered.

## Monitoring
`deploy/monitor.sh` prints a WARN line and exits 1 for: disk over 85%, an unhealthy container, `/api/ready` failing, a TLS certificate under 14 days, a backup older than 36 hours, an off-server copy older than 36 hours (when configured), dead background jobs. Wire it to cron mail or your uptime tool.

## Routine calendar
Daily: backup (automatic), glance at System status. Weekly: review Dependabot pull requests. Weekly (automatic): restore drill, check that System status shows no warnings. Monthly: apply OS updates. Quarterly: rotate database passwords, review administrator accounts and the audit log. Yearly: practise a real restore on a spare server.

## After a very large import
If you import tens of thousands of rows in one go (checklist items, findings), the database may take a few minutes to refresh its statistics, and screens can be slow meanwhile. To do it immediately, run `ANALYZE TABLE checklist_items, findings, evidence_requests, checklist_item_controls, soa_entries;` in the database. See `docs/PERFORMANCE.md`.
