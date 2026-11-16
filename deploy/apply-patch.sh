#!/usr/bin/env bash
# Applies a patch built by make-patch.sh to THIS installation. Run on the server, in the project folder, as the deploy user:
#   deploy/apply-patch.sh /path/to/isecurify-grc-patch-A-to-B.tar.gz [--dry-run] [--force] [--skip-backup]
#   deploy/apply-patch.sh --rollback                      (undo the last patch)
# What it does, in order: checks the patch is for the installed version and untampered, checks nobody edited the files it will replace,
# checks .env has every new required setting, takes a backup, replaces files, rebuilds only what changed, restarts, waits for the app to be
# ready, and puts the old files back by itself if it does not come up. It never touches .env, the database files or uploaded evidence.
set -euo pipefail
# Replacing this very script while bash is reading it would break the run: work from a copy.
if [ -z "${APPLY_PATCH_COPY:-}" ]; then SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; T="$(mktemp)"; cp "${BASH_SOURCE[0]}" "$T"; APPLY_PATCH_COPY=1 APPLY_PATCH_ROOT="$SELF" exec bash "$T" "$@"; fi
ROOT="$APPLY_PATCH_ROOT"; cd "$ROOT"; STATE=".patches"; mkdir -p "$STATE"; chmod 700 "$STATE"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$STATE/history.log"; }; die() { log "STOPPED: $*"; exit 1; }
DRY=0; FORCE=0; SKIPBK=0; ROLLBACK=0; PATCH=""
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --force) FORCE=1;; --skip-backup) SKIPBK=1;; --rollback) ROLLBACK=1;; -*) die "unknown option $a";; *) PATCH="$a";; esac; done
exec 9>"$STATE/.lock"; flock -n 9 || die "another patch run is in progress"
DC() { docker compose "$@"; }
wait_ready() { local i; for i in $(seq 1 "${PATCH_WAIT_TRIES:-40}"); do DC exec -T api node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && return 0; sleep "${PATCH_WAIT_SLEEP:-4}"; done; return 1; }
restart_stack() { # $1 services to rebuild (may be empty)
  [ -n "$1" ] && DC build $1 || true; DC up -d --remove-orphans; }
restore_from() { # $1 rollback dir
  local rb="$1"; while read -r op _ _ path; do case "$op" in A) rm -f "$path";; M|D) mkdir -p "$(dirname "$path")"; cp -p "$rb/files/$path" "$path";; esac; done < "$rb/plan.txt"
  cp -p "$rb/VERSION" VERSION; cp -p "$rb/MANIFEST.sha256" MANIFEST.sha256; }
if [ "$ROLLBACK" = 1 ]; then
  [ -f "$STATE/last" ] || die "no patch to roll back"; RB="$STATE/$(cat "$STATE/last")/rollback"; [ -d "$RB" ] || die "rollback data missing"
  log "rolling back to $(cat "$RB/VERSION")"; restore_from "$RB"; restart_stack "$(cat "$RB/rebuild")"; wait_ready || die "rolled back files, but the app is not ready: check 'docker compose logs api'"
  rm -f "$STATE/last"; log "rolled back; running version $(cat VERSION). Database changes made by migrations are not undone (restore the backup if needed)."; exit 0
fi
[ -n "$PATCH" ] && [ -f "$PATCH" ] || die "usage: apply-patch.sh <patch.tar.gz> [--dry-run] [--force] [--skip-backup]"
[ -f .env ] || die "no .env here: run this in the project folder"; [ -f VERSION ] || die "no VERSION file: this install was not made from a numbered release"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; tar -xzf "$PATCH" -C "$W" || die "cannot read the patch file"
[ -f "$W/PATCH.meta" ] && [ -f "$W/plan.txt" ] || die "not a valid patch"; # PATCH.meta is read as plain data (never executed) and only simple characters are accepted
meta() { local v; v="$(grep -E "^$1=" "$W/PATCH.meta" | head -1 | cut -d= -f2- || true)"; [[ "$v" =~ ^[A-Za-z0-9._\ :-]*$ ]] || die "PATCH.meta has an unexpected value for $1"; printf '%s' "$v"; }
PATCH_FORMAT="$(meta PATCH_FORMAT)"; FROM_VERSION="$(meta FROM_VERSION)"; TO_VERSION="$(meta TO_VERSION)"; ADDED="$(meta ADDED)"; CHANGED="$(meta CHANGED)"; DELETED="$(meta DELETED)"; REBUILD="$(meta REBUILD)"; MIGRATIONS="$(meta MIGRATIONS)"; COMPOSE_CHANGED="$(meta COMPOSE_CHANGED)"; NEW_ENV="$(meta NEW_ENV)"
[ "$PATCH_FORMAT" = 1 ] || die "unsupported patch format"; [ -n "$FROM_VERSION" ] && [ -n "$TO_VERSION" ] || die "patch has no version"
CUR="$(cat VERSION)"; log "installed $CUR, patch $FROM_VERSION -> $TO_VERSION ($ADDED added, $CHANGED changed, $DELETED removed; rebuild: ${REBUILD:-nothing}; migrations: $MIGRATIONS)"
[ "$CUR" = "$FROM_VERSION" ] || { [ "$FORCE" = 1 ] && log "WARNING: --force: patch is for $FROM_VERSION" || die "this patch is for version $FROM_VERSION but $CUR is installed"; }
while read -r op _ _ path; do [[ "$op" =~ ^[AMD]$ ]] && [[ "$path" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$path" != /* ]] && [[ "$path" != *..* ]] || die "the patch plan contains an unsafe path: $path"; case "$path" in .env|*/.env|.env.*.local|.patches/*) die "a patch may not touch $path";; esac; done < "$W/plan.txt"
# 1. the patch itself is intact
while read -r op _ new path; do [ "$op" = D ] && continue; [ "$(sha256sum "$W/files/$path" | cut -d' ' -f1)" = "$new" ] || die "damaged patch: $path does not match its checksum (upload it again)"; done < "$W/plan.txt"
# 2. nobody edited what we are about to replace
BAD=0; while read -r op old _ path; do case "$op" in
  M|D) if [ ! -f "$path" ] || [ "$(sha256sum "$path" | cut -d' ' -f1)" != "$old" ]; then log "locally changed or missing: $path"; BAD=1; fi;;
  A) if [ -f "$path" ]; then log "already exists: $path"; BAD=1; fi;; esac; done < "$W/plan.txt"
[ "$BAD" = 0 ] || { [ "$FORCE" = 1 ] && log "WARNING: --force: continuing over local changes (old copies are kept for rollback)" || die "files on this server differ from release $FROM_VERSION (listed above). Keep your change in a copy, or use --force to overwrite"; }
# 3. .env has what the new version requires
for k in ${NEW_ENV:-}; do if grep -qE "\\$\\{$k:\\?" "$W/new-compose.yml"; then v="$(grep -E "^$k=" .env | tail -1 | cut -d= -f2- || true)"; [ -n "$v" ] || die "add $k to .env first (the new version requires it; see .env.example)"; else log "note: optional new setting $k (see .env.example)"; fi; done
FREE=$(df -Pm . | awk 'NR==2{print $4}'); [ "$FREE" -ge "${PATCH_MIN_FREE_MB:-1000}" ] || die "only ${FREE} MB free"
if [ "$DRY" = 1 ]; then log "dry run: nothing changed. The plan:"; sed 's/^/   /' "$W/plan.txt"; exit 0; fi
# 4. backup, then keep the old files for rollback
[ "$SKIPBK" = 1 ] && log "WARNING: backup skipped" || { log "taking a backup first"; bash deploy/backup.sh >>"$STATE/history.log" 2>&1 || die "the backup failed, so nothing was changed"; }
RB="$STATE/$TO_VERSION/rollback"; rm -rf "$STATE/$TO_VERSION"; mkdir -p "$RB/files"; cp "$W/plan.txt" "$RB/plan.txt"; cp -p VERSION MANIFEST.sha256 "$RB/"; printf '%s' "${REBUILD:-}" > "$RB/rebuild"
while read -r op _ _ path; do [ "$op" = A ] && continue; [ -f "$path" ] && { mkdir -p "$RB/files/$(dirname "$path")"; cp -p "$path" "$RB/files/$path"; }; done < "$W/plan.txt"
# 5. replace files (each one written aside then renamed, so a file is never half-written)
while read -r op _ _ path; do case "$op" in D) rm -f "$path";; A|M) mkdir -p "$(dirname "$path")"; cp -p "$W/files/$path" "$path.patchtmp"; mv -f "$path.patchtmp" "$path";; esac; done < "$W/plan.txt"
printf '%s\n' "$TO_VERSION" > VERSION; cp "$W/new-manifest.sha256" MANIFEST.sha256; echo "$TO_VERSION" > "$STATE/last"; log "files replaced"
# 6. rebuild only what changed, restart, wait
if [ -z "${REBUILD:-}" ] && [ "$COMPOSE_CHANGED" = no ]; then log "documentation-only patch: nothing to restart"; log "patched to $TO_VERSION"; exit 0; fi
if restart_stack "${REBUILD:-}" >>"$STATE/history.log" 2>&1 && wait_ready; then log "patched to $TO_VERSION: the app is ready"; exit 0; fi
log "the app did not become ready: putting version $FROM_VERSION back"; restore_from "$RB"; restart_stack "${REBUILD:-}" >>"$STATE/history.log" 2>&1 || true; rm -f "$STATE/last"
if wait_ready; then die "rolled back to $FROM_VERSION and it is running again. If this patch had migrations ($MIGRATIONS) and the database looks wrong, restore the backup taken above (deploy/restore.sh)"; else die "rolled back the files but the app is still not ready: run 'docker compose logs api init' and restore the backup if the database changed"; fi
