#!/usr/bin/env bash
# Cheap health probe for cron or an uptime monitor. Prints WARN lines and exits 1 if anything needs attention; silent exit 0 when healthy.
. "$(dirname "$0")/lib.sh"; W=0; warn() { echo "WARN: $*"; W=1; }
USE=$(df -P "$ROOT" | awk 'NR==2{gsub("%","",$5);print $5}'); [ "$USE" -lt 85 ] || warn "disk ${USE}% full"
for s in mysql api worker web; do st=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk -v s="$s" '$1==s'); case "$st" in *running*unhealthy*|"") warn "$s is not healthy ($st)";; *running*) ;; *) warn "$s is not running ($st)";; esac; done
curl -fsS -m 10 "https://$DOMAIN/api/ready" >/dev/null 2>&1 || warn "https://$DOMAIN/api/ready failed"
END=$(echo | timeout 10 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
if [ -n "$END" ]; then D=$(( ( $(date -d "$END" +%s) - $(date +%s) ) / 86400 )); [ "$D" -gt 14 ] || warn "TLS certificate expires in $D days"; else warn "could not read the TLS certificate"; fi
LAST=$(ls -1t "$OUT"/manifest-*.sha256 2>/dev/null | head -n1 || true); if [ -z "$LAST" ]; then warn "no backups found"; else AGE=$(( ( $(date +%s) - $(stat -c %Y "$LAST") ) / 3600 )); [ "$AGE" -le 36 ] || warn "newest backup is ${AGE} h old"; fi
. "$(dirname "$0")/offsite.sh"
if [ "$(offsite_mode)" != none ]; then
  OFF=$(docker compose exec -T mysql sh -c 'mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" grc -e "SELECT COALESCE(TIMESTAMPDIFF(HOUR, MAX(taken_at), NOW()), -1) FROM backup_log WHERE kind=\"offsite\" AND ok=1"' 2>/dev/null || echo -1)
  if [ "${OFF:--1}" -lt 0 ]; then warn "no successful off-server copy has been recorded"; elif [ "$OFF" -gt 36 ]; then warn "newest off-server copy is ${OFF} h old"; fi
fi
DEAD=$(docker compose exec -T mysql sh -c 'mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" grc -e "SELECT COUNT(*) FROM jobs WHERE status=\"dead\""' 2>/dev/null || echo 0); [ "${DEAD:-0}" -eq 0 ] || warn "$DEAD dead background jobs"
exit $W
