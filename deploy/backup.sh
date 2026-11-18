#!/usr/bin/env bash
# Nightly backup: database dump + evidence files, checksummed, optionally GPG-encrypted, recorded in backup_log.
# Run from cron as the deploy user (deploy/install-cron.sh sets that up). By default backups stay on this server; to ALSO copy them off the server
# set BACKUP_OFFSITE (rclone, rsync or command) and BACKUP_OFFSITE_TARGET: see deploy/offsite.sh. The off-server copy is verified and logged on its own.
. "$(dirname "$0")/lib.sh"; . "$(dirname "$0")/offsite.sh"
MIN_KEEP="${BACKUP_MIN_KEEP:-7}"; KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"; NEED_MB="${BACKUP_MIN_FREE_MB:-2048}"
mkdir -p "$OUT"; chmod 700 "$OUT"
exec 9>"$OUT/.lock"; flock -n 9 || { log "another backup is running"; exit 3; }
TS=$(date +%F-%H%M); STEP="start"; ENC=0
fail() { local rc=$?; log "backup FAILED during: $STEP"; rm -f "$OUT"/*-"$TS".*.partial 2>/dev/null || true; record backup 0 NULL NULL 0 "failed during $STEP"; exit "$rc"; }
trap fail ERR
STEP="free-space check"; FREE=$(df -Pm "$OUT" | awk 'NR==2{print $4}'); [ "$FREE" -ge "$NEED_MB" ] || { log "only ${FREE} MB free, need ${NEED_MB}"; false; }
STEP="database dump"; docker compose exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases grc' | gzip > "$OUT/db-$TS.sql.gz.partial"
gzip -t "$OUT/db-$TS.sql.gz.partial"; mv "$OUT/db-$TS.sql.gz.partial" "$OUT/db-$TS.sql.gz"
STEP="evidence archive"; docker compose exec -T api tar -C /data -czf - evidence > "$OUT/evidence-$TS.tar.gz.partial"
gzip -t "$OUT/evidence-$TS.tar.gz.partial"; mv "$OUT/evidence-$TS.tar.gz.partial" "$OUT/evidence-$TS.tar.gz"
DB_BYTES=$(stat -c %s "$OUT/db-$TS.sql.gz"); EV_BYTES=$(stat -c %s "$OUT/evidence-$TS.tar.gz")
STEP="checksums"; (cd "$OUT" && sha256sum "db-$TS.sql.gz" "evidence-$TS.tar.gz" > "manifest-$TS.sha256")
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  STEP="encryption"; for f in "db-$TS.sql.gz" "evidence-$TS.tar.gz"; do gpg --batch --yes -r "$BACKUP_GPG_RECIPIENT" -e "$OUT/$f" && rm "$OUT/$f"; done; ENC=1
  # the manifest still names the plain files; keep a checksum of what is actually stored
  (cd "$OUT" && sha256sum "db-$TS.sql.gz.gpg" "evidence-$TS.tar.gz.gpg" > "manifest-$TS.sha256")
else log "WARNING: BACKUP_GPG_RECIPIENT is not set; this backup is NOT encrypted"; fi
STEP="retention"; COUNT=$(ls "$OUT"/manifest-*.sha256 | wc -l)
if [ "$COUNT" -gt "$MIN_KEEP" ]; then
  ls -1t "$OUT"/manifest-*.sha256 | tail -n +"$((MIN_KEEP + 1))" | while read -r m; do
    s=${m##*manifest-}; s=${s%.sha256}; if [ -n "$(find "$m" -mtime +"$KEEP_DAYS")" ]; then rm -f "$OUT"/*"-$s".* ; fi
  done
fi
trap - ERR; record backup 1 "$DB_BYTES" "$EV_BYTES" "$ENC" "ok"; log "backup ok: $OUT ($TS) db=${DB_BYTES}B evidence=${EV_BYTES}B encrypted=$ENC"
# The local backup is complete and recorded. The off-server copy has its own result, so a failed copy never hides a good local backup (exit code 10 tells cron).
if [ "$(offsite_mode)" != none ]; then
  if MSG="$(offsite_push "$OUT" "$TS")"; then record offsite 1 "$DB_BYTES" "$EV_BYTES" "$ENC" "$MSG"; log "off-server copy ok: $MSG"
  else record offsite 0 NULL NULL "$ENC" "$MSG"; log "off-server copy FAILED: $MSG"; exit 10; fi
fi
