#!/usr/bin/env bash
# Restore drill: restores the NEWEST backup into a throwaway MySQL container and runs the integrity checks against it.
# Never touches live data (the only live write is one appended row in backup_log). Run monthly. Encrypted backups need the private key on this host.
. "$(dirname "$0")/lib.sh"
NET="${COMPOSE_PROJECT_NAME:-isecurify-grc}_default"; NAME="grc-drill-$$"; WORK=$(mktemp -d); chmod 700 "$WORK"; ENC=0; NOTE="failed"; OK=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; record drill "$OK" NULL NULL "$ENC" "$NOTE"; }
trap cleanup EXIT
DB=$(ls -1t "$OUT"/db-*.sql.gz* 2>/dev/null | grep -v partial | head -n1 || true); [ -n "$DB" ] || { NOTE="no backup found"; log "$NOTE"; exit 4; }
STAMP=${DB##*/db-}; STAMP=${STAMP%%.sql.gz*}; EV=$(ls "$OUT"/evidence-"$STAMP".tar.gz* | head -n1)
log "drilling backup $STAMP"
(cd "$OUT" && sha256sum -c "manifest-$STAMP.sha256" >/dev/null) || { NOTE="checksum mismatch for $STAMP"; log "$NOTE"; exit 5; }
case "$DB" in *.gpg) ENC=1; gpg --batch --yes -d "$DB" > "$WORK/db.sql.gz"; gpg --batch --yes -d "$EV" > "$WORK/ev.tar.gz";; *) cp "$DB" "$WORK/db.sql.gz"; cp "$EV" "$WORK/ev.tar.gz";; esac
mkdir -p "$WORK/files"; tar -xzf "$WORK/ev.tar.gz" -C "$WORK/files"; chmod -R a+rX "$WORK/files"
PW=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
docker run -d --name "$NAME" --network "$NET" -e MYSQL_ROOT_PASSWORD="$PW" --tmpfs /var/lib/mysql mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00 >/dev/null
for i in $(seq 1 60); do docker exec "$NAME" mysqladmin ping -h 127.0.0.1 -uroot -p"$PW" --silent >/dev/null 2>&1 && break; sleep 2; [ "$i" -lt 60 ] || { NOTE="scratch database did not start"; exit 6; }; done
gunzip -c "$WORK/db.sql.gz" | docker exec -i "$NAME" mysql -uroot -p"$PW" || { NOTE="restore of the dump failed"; exit 7; }
if docker compose run --rm --no-deps -T -e DATABASE_URL="mysql://root:$PW@$NAME:3306/grc" -e EVIDENCE_DIR=/drill/evidence -v "$WORK/files:/drill:ro" api npx tsx scripts/verify-restore.ts --sample=25; then OK=1; NOTE="restored $STAMP and verified"; log "DRILL PASSED ($STAMP)"; else NOTE="integrity checks failed for $STAMP"; log "DRILL FAILED ($STAMP)"; exit 8; fi
