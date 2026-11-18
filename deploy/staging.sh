#!/usr/bin/env bash
# Staging environment helper. Run from the STAGING directory (its own copy of the release and its own .env; see docs/STAGING.md).
#   deploy/staging.sh up                       build and start staging
#   deploy/staging.sh down                     stop it (data kept)
#   deploy/staging.sh refresh <backup-dir> [stamp]
#        load a production database backup into staging and scrub it (emails, names, passwords, sessions, queued mail, API keys, webhooks).
#        Evidence FILES are never copied. Prints a one-time sign-in link for the first Super Admin.
#   deploy/staging.sh check                    safety checks only
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[ -f .env ] || { echo "no .env in $ROOT" >&2; exit 2; }
val() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
safety() {
  [ "$(val APP_ENV)" = staging ] || { echo "REFUSING: APP_ENV=staging is not set in $ROOT/.env, so this does not look like a staging directory" >&2; return 1; }
  [ -z "$(val SMTP_HOST)" ] || { echo "REFUSING: SMTP_HOST is set. Staging must not send email" >&2; return 1; }
  [ -z "$(val WEBHOOK_ENC_KEY)" ] || { echo "REFUSING: WEBHOOK_ENC_KEY is set. Webhooks must stay off on staging" >&2; return 1; }
  [ -f docker-compose.staging.yml ] || { echo "REFUSING: docker-compose.staging.yml is missing" >&2; return 1; }
  return 0
}
C=(docker compose -f docker-compose.yml -f docker-compose.staging.yml)
cmd="${1:-}"; shift || true
case "$cmd" in
  check) safety && echo "staging safety checks passed";;
  up) safety; "${C[@]}" up -d --build; log "staging is starting: https://$(val DOMAIN)${HTTPS_PORT:+:$HTTPS_PORT}";;
  down) safety; "${C[@]}" down;;
  refresh)
    safety; OUT="${1:?usage: staging.sh refresh <backup-dir> [stamp]}"; STAMP="${2:-}"
    [ -d "$OUT" ] || { echo "$OUT is not a folder" >&2; exit 2; }
    if [ -z "$STAMP" ]; then DB="$(ls -1t "$OUT"/db-*.sql.gz* 2>/dev/null | grep -v partial | head -n1 || true)"; [ -n "$DB" ] || { echo "no database backup in $OUT" >&2; exit 4; }; STAMP="${DB##*/db-}"; STAMP="${STAMP%%.sql.gz*}"; else DB="$(ls "$OUT"/db-"$STAMP".sql.gz* | head -n1)"; fi
    (cd "$OUT" && grep -E "db-$STAMP\." "manifest-$STAMP.sha256" | sha256sum -c --quiet) || { echo "checksum mismatch for backup $STAMP, refusing" >&2; exit 5; }
    WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
    case "$DB" in *.gpg) gpg --batch --yes -d "$DB" > "$WORK/db.sql.gz";; *) cp "$DB" "$WORK/db.sql.gz";; esac; gzip -t "$WORK/db.sql.gz"
    log "loading backup $STAMP into STAGING (this replaces the staging database)"; "${C[@]}" stop web api worker >/dev/null 2>&1 || true; "${C[@]}" up -d mysql
    for i in $(seq 1 30); do "${C[@]}" exec -T mysql sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1 && break; sleep 2; done
    "${C[@]}" exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS grc"'
    gunzip -c "$WORK/db.sql.gz" | "${C[@]}" exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
    log "scrubbing personal data"; "${C[@]}" exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" grc' < deploy/staging-scrub.sql
    "${C[@]}" run --rm init; "${C[@]}" up -d
    ADMIN="$("${C[@]}" exec -T mysql sh -c 'mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" grc -e "SELECT email FROM users WHERE platform_role=\"super_admin\" AND deleted_at IS NULL ORDER BY created_at LIMIT 1"' | tr -d '\r')"
    if [ -n "$ADMIN" ]; then log "one-time sign-in link for the first Super Admin ($ADMIN):"; "${C[@]}" run --rm --no-deps -T -e DATABASE_URL="mysql://grc_app:$(val APP_DB_PASSWORD)@mysql:3306/grc" api npx tsx scripts/recover-admin.ts --email "$ADMIN" --reset-mfa; fi
    log "staging now holds a scrubbed copy of backup $STAMP. No evidence files were copied.";;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2;;
esac
