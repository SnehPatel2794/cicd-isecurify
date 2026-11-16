#!/usr/bin/env bash
# Post-deploy smoke test against a running site. No login needed. Exit 0 = healthy.
#   deploy/smoke.sh https://grc.example.com [--insecure] [--expect-env staging] [--expect-version 11F]
set -uo pipefail
BASE=""; INSECURE=(); EXPECT_ENV=""; EXPECT_VER=""
while [ $# -gt 0 ]; do case "$1" in --insecure) INSECURE=(-k); shift;; --expect-env) EXPECT_ENV="${2:?}"; shift 2;; --expect-version) EXPECT_VER="${2:?}"; shift 2;; -*) echo "unknown option $1" >&2; exit 2;; *) BASE="${1%/}"; shift;; esac; done
[[ "$BASE" =~ ^https?://[A-Za-z0-9.:_-]+$ ]] || { echo "usage: smoke.sh https://host[:port] [--insecure] [--expect-env staging|production] [--expect-version V]" >&2; exit 2; }
bad=0; ok() { echo "ok:   $*"; }; fail() { echo "FAIL: $*"; bad=1; }
get() { curl -sS "${INSECURE[@]}" -m 15 "$@"; }
[ "$(get -o /dev/null -w '%{http_code}' "$BASE/api/ready")" = 200 ] && ok "API and database are ready" || fail "/api/ready did not answer 200"
[ "$(get -o /dev/null -w '%{http_code}' "$BASE/")" = 200 ] && ok "the web app is served" || fail "the home page did not answer 200"
H="$(get -I "$BASE/" 2>/dev/null | tr -d '\r')"
for h in strict-transport-security x-content-type-options x-frame-options content-security-policy; do echo "$H" | grep -qi "^$h:" && ok "header $h is set" || fail "header $h is missing"; done
echo "$H" | grep -qi '^server:' && fail "the Server header is exposed" || ok "no Server header"
[ "$(get -o /dev/null -w '%{http_code}' "$BASE/api/me")" = 401 ] && ok "private endpoints refuse anonymous requests" || fail "/api/me did not answer 401 without a session"
E="$(get "$BASE/api/environment" | sed -n 's/.*"environment":"\([a-z]*\)".*/\1/p')"; [ -n "$E" ] && ok "environment: $E" || fail "could not read /api/environment"
[ -z "$EXPECT_ENV" ] || { [ "$E" = "$EXPECT_ENV" ] && ok "environment is $EXPECT_ENV as expected" || fail "environment is '$E', expected '$EXPECT_ENV'"; }
V="$(get "$BASE/api/environment" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"; [ -n "$V" ] && ok "running version: $V"
[ -z "$EXPECT_VER" ] || { [ "$V" = "$EXPECT_VER" ] && ok "version is $EXPECT_VER as expected" || fail "running version is '$V', expected '$EXPECT_VER'"; }
exit $bad
