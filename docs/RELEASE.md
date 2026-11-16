# Release process (Phase 11F)

Every release ships as a **full zip** (new servers, staging from scratch) and a **patch** (existing servers). Versions are tagged in `VERSION` (for example `11F`); the running version is shown by `GET /api/environment`.

1. **Build** (developer): `bash deploy/make-manifest.sh . <version>`, zip the project, then `bash deploy/make-patch.sh old.zip new.zip ./out`.
2. **Staging first**: copy the patch to the staging server, `deploy/apply-patch.sh <patch> --dry-run`, then apply it. Run `deploy/smoke.sh https://staging.example.com --insecure --expect-env staging --expect-version <version>` and click through the changed screens.
3. **Production**: copy the same patch file (check its sha256 matches), `--dry-run`, then apply. The script takes a backup first and rolls back by itself if the new version does not become ready.
4. **Verify**: `deploy/smoke.sh https://grc.example.com --expect-env production --expect-version <version>`. When `docker-compose.yml` changed, also `deploy/verify-readonly.sh`.
5. **If something is wrong later**: `deploy/apply-patch.sh --rollback` (code only; a database migration is not undone: restore from the pre-patch backup with `deploy/restore.sh` when a migration must be reverted).

## Read-only containers
The API, worker, web, bootstrap and init containers run with a read-only filesystem, no Linux capabilities (web keeps only the one it needs to open ports 80/443), `no-new-privileges`, and a 64 MB in-memory `/tmp`. Only the named volumes are writable: `evidence_data` (API and worker), `caddy_data` and `caddy_config` (web), and the database volume. `deploy/verify-readonly.sh` proves it on the running server. The database and the optional malware scanner are not read-only: their images write to several system folders.

## Logs
Containers log to Docker's rotating JSON files (10 MB x 5 per service). `deploy/ship-logs.sh` runs nightly (installed by `deploy/install-cron.sh`), writes one compressed bundle per service (api, worker, web, mysql) with a checksum file into `$BACKUP_DIR/logs`, encrypts them when `BACKUP_GPG_RECIPIENT` is set, optionally copies them off the server (`LOG_SHIP=rsync|rclone|command`, `LOG_SHIP_TARGET=...`, verified like backups) and removes local bundles older than `LOG_KEEP_DAYS` (30). Use a different off-server path from the backups and set retention there with the storage's own lifecycle rule. Logs hold email addresses and IP addresses but no passwords, tokens or cookies.
