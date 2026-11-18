#!/usr/bin/env bash
# Writes VERSION and MANIFEST.sha256 (a checksum of every project file) into a project folder.
# Used when a release is packaged, and by make-patch.sh. Usage: make-manifest.sh <project-dir> [version]
set -euo pipefail
DIR="${1:?usage: make-manifest.sh <project-dir> [version]}"; VER="${2:-}"; cd "$DIR"
[ -n "$VER" ] && printf '%s\n' "$VER" > VERSION
[ -f VERSION ] || { echo "no VERSION file and none given" >&2; exit 2; }
# Not part of a release: dependencies, builds, secrets, local data, test output, previous patch state.
find . \( -name node_modules -o -name dist -o -name coverage -o -name .patches -o -name test-results -o -name playwright-report -o -name .run \) -prune -o \
  -type f ! -name .env ! -name '.env.*.local' ! -name MANIFEST.sha256 ! -name 'seed-sample.ts' -print | sed 's#^\./##' | LC_ALL=C sort > /tmp/.manifest-list.$$
if grep -n '[[:space:]]' /tmp/.manifest-list.$$ >/dev/null; then echo "a file name contains a space or odd character; rename it:" >&2; grep '[[:space:]]' /tmp/.manifest-list.$$ >&2; rm -f /tmp/.manifest-list.$$; exit 3; fi
xargs -a /tmp/.manifest-list.$$ -d '\n' sha256sum > MANIFEST.sha256; rm -f /tmp/.manifest-list.$$
echo "MANIFEST.sha256: $(wc -l < MANIFEST.sha256) files, version $(cat VERSION)"
