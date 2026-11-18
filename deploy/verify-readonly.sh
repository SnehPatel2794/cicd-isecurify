#!/usr/bin/env bash
# Checks that the running containers really are read-only: writing to the container's own filesystem must fail, while /tmp and the evidence volume must work.
# Run after every deploy that touches docker-compose.yml. Exit 0 = all good.
. "$(dirname "$0")/lib.sh"; bad=0; fail() { echo "FAIL: $*"; bad=1; }
for s in api worker web; do
  if docker compose exec -T "$s" sh -c 'touch /etc/.rw-probe 2>/dev/null && rm -f /etc/.rw-probe'; then fail "$s can write to its own filesystem (read_only is not in effect)"; else echo "ok:   $s filesystem is read-only"; fi
  docker compose exec -T "$s" sh -c 'touch /tmp/.w-probe && rm -f /tmp/.w-probe' >/dev/null 2>&1 || fail "$s cannot write to /tmp (it needs the tmpfs)"
done
for s in api worker; do docker compose exec -T "$s" sh -c 'touch /data/evidence/.w-probe && rm -f /data/evidence/.w-probe' >/dev/null 2>&1 && echo "ok:   $s can write evidence" || fail "$s cannot write to /data/evidence"; done
docker compose exec -T web sh -c 'touch /data/.w-probe && rm -f /data/.w-probe && touch /config/.w-probe && rm -f /config/.w-probe' >/dev/null 2>&1 && echo "ok:   web can write its certificate storage" || fail "web cannot write to /data or /config (certificates would fail)"
exit $bad
