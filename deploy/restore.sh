#!/usr/bin/env bash
# REAL restore onto this server. DESTRUCTIVE: replaces the live database and evidence files. Usage: deploy/restore.sh <stamp>   (e.g. 2026-10-26-0200)
. "$(dirname "$0")/lib.sh"
STAMP="${1:?usage: restore.sh <stamp>, one of: $(ls "$OUT" 2>/dev/null | sed -n 's/^db-\(.*\)\.sql\.gz.*/\1/p' | sort -r | head -5 | tr '\n' ' ')}"
DB=$(ls "$OUT"/db-"$STAMP".sql.gz* | head -n1); EV=$(ls "$OUT"/evidence-"$STAMP".tar.gz* | head -n1)
(cd "$OUT" && sha256sum -c "manifest-$STAMP.sha256") || { echo "checksum mismatch, refusing" >&2; exit 5; }
echo "This REPLACES the live database and evidence files with backup $STAMP."; read -r -p "Type the domain ($DOMAIN) to continue: " A; [ "$A" = "$DOMAIN" ] || { echo "aborted"; exit 1; }
WORK=$(mktemp -d); chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
case "$DB" in *.gpg) gpg --batch --yes -d "$DB" > "$WORK/db.sql.gz"; gpg --batch --yes -d "$EV" > "$WORK/ev.tar.gz";; *) cp "$DB" "$WORK/db.sql.gz"; cp "$EV" "$WORK/ev.tar.gz";; esac
gzip -t "$WORK/db.sql.gz"; gzip -t "$WORK/ev.tar.gz"
log "taking a safety backup first"; "$ROOT/deploy/backup.sh"
log "stopping application"; docker compose stop web api worker
docker compose up -d mysql; for i in $(seq 1 30); do docker compose exec -T mysql sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1 && break; sleep 2; done
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS grc"'
gunzip -c "$WORK/db.sql.gz" | docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
log "restoring evidence files"; docker compose run --rm --no-deps -T -u root --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER -v "$WORK:/restore:ro" --entrypoint sh api -c 'rm -rf /data/evidence/* && tar -xzf /restore/ev.tar.gz -C /data && chown -R node:node /data/evidence'
log "re-applying migrations and database accounts"; docker compose run --rm init
log "verifying"; docker compose run --rm --no-deps -T -e DATABASE_URL="mysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/grc" api npx tsx scripts/verify-restore.ts
docker compose up -d; log "restore complete. Check https://$DOMAIN, sign in, and open Administration > System status."
