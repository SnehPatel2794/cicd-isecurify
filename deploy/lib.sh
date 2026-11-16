# Shared helpers for the deploy scripts. Sourced, never run directly.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[ -f .env ] || { echo "no .env in $ROOT" >&2; exit 2; }
set -a; . ./.env; set +a
OUT="${BACKUP_DIR:-/var/backups/isecurify}"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
# Append one row to backup_log (kind, ok 0/1, db_bytes, evidence_bytes, encrypted 0/1, note). Never fails the caller.
record() {
  local note; note="$(printf '%s' "${6:-}" | tr -d "'\\\\" | cut -c1-250)"
  docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" grc' <<SQL >/dev/null 2>&1 || log "WARNING: could not write backup_log"
INSERT INTO backup_log (kind, ok, db_bytes, evidence_bytes, encrypted, note) VALUES ('$1', $2, ${3:-NULL}, ${4:-NULL}, ${5:-0}, '$note');
SQL
}
