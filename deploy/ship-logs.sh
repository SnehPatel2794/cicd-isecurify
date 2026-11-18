#!/usr/bin/env bash
# Collects the last day of container logs into one compressed bundle per service, optionally encrypts it, copies it off the server and prunes old local bundles.
#   deploy/ship-logs.sh            (the cron job runs this nightly; see install-cron.sh)
# LOG_SHIP          none (default: bundles stay on this server) | rclone | rsync | command
# LOG_SHIP_TARGET   rclone: "remote:bucket/logs"   rsync: "user@host:/path" or a local directory. Use a different path from the backups.
# LOG_SHIP_SSH      rsync over ssh options (defaults to BACKUP_RSYNC_SSH)
# LOG_SHIP_CMD      command mode: runs with BACKUP_OUT (the folder) and BACKUP_STAMP set
# LOG_DIR_OUT       where bundles are kept (default: $BACKUP_DIR/logs)      LOG_KEEP_DAYS  local retention (default 30)      LOG_SINCE  how far back to read (default 25h)
# Application logs already leave out cookies, tokens and passwords. They do contain email addresses and IP addresses, so set BACKUP_GPG_RECIPIENT to encrypt the bundles.
. "$(dirname "$0")/lib.sh"; . "$(dirname "$0")/offsite.sh"
LOGS="${LOG_DIR_OUT:-$OUT/logs}"; STAMP="${LOG_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"; SINCE="${LOG_SINCE:-25h}"; KEEP="${LOG_KEEP_DAYS:-30}"
[[ "$KEEP" =~ ^[0-9]+$ ]] || { echo "LOG_KEEP_DAYS must be a number" >&2; exit 2; }
mkdir -p "$LOGS"; chmod 700 "$LOGS"; made=()
for s in api worker web mysql; do
  f="$LOGS/$s-$STAMP.log.gz"
  if ! docker compose logs --no-color --timestamps --since "$SINCE" "$s" 2>&1 | gzip -9 > "$f"; then log "could not read the $s logs"; rm -f "$f"; continue; fi
  if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then gpg --batch --yes --trust-model always --encrypt -r "$BACKUP_GPG_RECIPIENT" -o "$f.gpg" "$f" && rm -f "$f" && f="$f.gpg" || { log "encryption failed for $s: bundle removed"; rm -f "$f" "$f.gpg"; continue; }; fi
  chmod 600 "$f"; made+=("$f")
done
[ "${#made[@]}" -gt 0 ] || { log "no log bundles were written"; exit 1; }
( cd "$LOGS" && sha256sum "${made[@]##*/}" > "logsum-$STAMP.sha256" ); log "wrote ${#made[@]} log bundle(s) to $LOGS"
rc=0; mode="${LOG_SHIP:-none}"
if [ "$mode" != none ]; then
  msg="$( BACKUP_OFFSITE="$mode" BACKUP_OFFSITE_TARGET="${LOG_SHIP_TARGET:-}" BACKUP_RSYNC_SSH="${LOG_SHIP_SSH:-${BACKUP_RSYNC_SSH:-}}" BACKUP_PUSH_CMD="${LOG_SHIP_CMD:-}" offsite_push "$LOGS" "$STAMP" )" || rc=1
  log "log shipping: $msg"
else log "log shipping is not configured (LOG_SHIP=none)"; fi
find "$LOGS" -type f \( -name '*.log.gz' -o -name '*.log.gz.gpg' -o -name 'logsum-*.sha256' \) -mtime +"$KEEP" -delete 2>/dev/null || true
exit $rc
