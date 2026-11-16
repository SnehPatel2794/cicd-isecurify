#!/usr/bin/env bash
# Builds a patch: only the files that differ between two releases, plus a plan the server checks before touching anything.
# Usage: make-patch.sh <OLD release: folder or .zip or .tar.gz> <NEW release: same> [output-folder]
# Output: isecurify-grc-patch-<old>-to-<new>.tar.gz   (upload it to the server and run deploy/apply-patch.sh on it)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; OLD_IN="${1:?old release}"; NEW_IN="${2:?new release}"; OUTDIR="${3:-.}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
prep() { # $1 input, $2 label -> prints the project folder
  local in="$1" d="$TMP/$2"; mkdir -p "$d"
  if [ -d "$in" ]; then cp -a "$in/." "$d/"; elif [[ "$in" == *.zip ]]; then unzip -q "$in" -d "$d"; else tar -xzf "$in" -C "$d"; fi
  local n; n=$(find "$d" -mindepth 1 -maxdepth 1 | wc -l); if [ "$n" = 1 ] && [ -d "$(find "$d" -mindepth 1 -maxdepth 1)" ]; then echo "$(find "$d" -mindepth 1 -maxdepth 1)"; else echo "$d"; fi
}
OLD="$(prep "$OLD_IN" old)"; NEW="$(prep "$NEW_IN" new)"
for p in "$OLD" "$NEW"; do [ -f "$p/VERSION" ] || { echo "$p has no VERSION file (run deploy/make-manifest.sh <dir> <version> on the release first)" >&2; exit 2; }; done
bash "$HERE/make-manifest.sh" "$OLD" >/dev/null; bash "$HERE/make-manifest.sh" "$NEW" >/dev/null
FROM="$(cat "$OLD/VERSION")"; TO="$(cat "$NEW/VERSION")"; [ "$FROM" != "$TO" ] || { echo "both releases are version $FROM" >&2; exit 2; }
PK="$TMP/pkg"; mkdir -p "$PK/files"
# plan lines: <A|M|D> <old-sha|-> <new-sha|-> <path>
awk 'NR==FNR{o[$2]=$1;next} {n[$2]=$1; if(!($2 in o)) print "A - " $1 " " $2; else if(o[$2]!=$1) print "M " o[$2] " " $1 " " $2} END{for(p in o) if(!(p in n)) print "D " o[p] " - " p}' "$OLD/MANIFEST.sha256" "$NEW/MANIFEST.sha256" | grep -v ' VERSION$' | LC_ALL=C sort -k4 > "$PK/plan.txt"
[ -s "$PK/plan.txt" ] || { echo "the two releases are identical" >&2; exit 2; }
while read -r op _ _ path; do [ "$op" = D ] && continue; mkdir -p "$PK/files/$(dirname "$path")"; cp -p "$NEW/$path" "$PK/files/$path"; done < "$PK/plan.txt"
touched() { awk -v re="$1" '$4 ~ re' "$PK/plan.txt" | wc -l; }
# tests and docs never change what runs, so they do not trigger a rebuild
live() { awk -v re="$1" '$4 ~ re && $4 !~ /(^|\/)test\// && $4 !~ /[.]test[.]tsx?$/' "$PK/plan.txt" | wc -l; }
BUILD=""; [ "$(live '^(api|worker|shared|migrations)/')" -gt 0 ] && BUILD="init api worker"; [ "$(live '^web/')" -gt 0 ] && BUILD="$BUILD web"
[ "$(touched '^docker-compose[.]yml$')" -gt 0 ] && COMPOSE=yes || COMPOSE=no; [ "$(touched '^migrations/')" -gt 0 ] && MIG=yes || MIG=no
keys() { grep -oE '^#?[[:space:]]*[A-Z][A-Z0-9_]+=' "$1/.env.example" 2>/dev/null | tr -d '# =' | sort -u; }
NEWENV="$(comm -13 <(keys "$OLD") <(keys "$NEW") | tr '\n' ' ')"
{ echo "PATCH_FORMAT=1"; echo "FROM_VERSION=$FROM"; echo "TO_VERSION=$TO"; echo "CREATED=$(date -u +%FT%TZ)"; echo "ADDED=$(grep -c '^A' "$PK/plan.txt" || true)"; echo "CHANGED=$(grep -c '^M' "$PK/plan.txt" || true)"; echo "DELETED=$(grep -c '^D' "$PK/plan.txt" || true)"
  echo "REBUILD=${BUILD# }"; echo "MIGRATIONS=$MIG"; echo "COMPOSE_CHANGED=$COMPOSE"; echo "NEW_ENV=${NEWENV% }"; } > "$PK/PATCH.meta"
cp "$NEW/docker-compose.yml" "$PK/new-compose.yml"; cp "$NEW/MANIFEST.sha256" "$PK/new-manifest.sha256"
mkdir -p "$OUTDIR"; OUT="$(cd "$OUTDIR" && pwd)/isecurify-grc-patch-$FROM-to-$TO.tar.gz"; tar -C "$PK" -czf "$OUT" PATCH.meta plan.txt new-compose.yml new-manifest.sha256 files
echo "patch: $OUT ($(du -h "$OUT" | cut -f1))"; sed 's/^/  /' "$PK/PATCH.meta"; echo "  sha256: $(sha256sum "$OUT" | cut -d' ' -f1)"
