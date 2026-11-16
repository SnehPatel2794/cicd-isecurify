#!/usr/bin/env bash
# Installs the schedule: nightly backup, nightly log bundle, WEEKLY automatic restore drill, health probe. Run as root (or with sudo) once; safe to re-run (it replaces the file).
#   deploy/install-cron.sh [--user deploy] [--dry-run]
# CRON_FILE can point elsewhere for a trial run. Times are server time.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; USER_NAME="deploy"; DRY=0; FILE="${CRON_FILE:-/etc/cron.d/isecurify}"; LOGDIR="${LOG_DIR:-/var/log}"
while [ $# -gt 0 ]; do case "$1" in --user) USER_NAME="${2:?--user needs a name}"; shift 2;; --dry-run) DRY=1; shift;; *) echo "unknown option $1" >&2; exit 2;; esac; done
[[ "$USER_NAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "invalid user name" >&2; exit 2; }
TEXT="# Installed by deploy/install-cron.sh. Edit that script, not this file.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# nightly backup (and the off-server copy when configured)
15 2 * * *  $USER_NAME  $DIR/backup.sh >> $LOGDIR/isecurify-backup.log 2>&1
# nightly log bundle (and the off-server copy when LOG_SHIP is configured)
45 2 * * *  $USER_NAME  $DIR/ship-logs.sh >> $LOGDIR/isecurify-logs.log 2>&1
# weekly restore drill: restores the newest backup into a throwaway database and checks it
30 3 * * 0  $USER_NAME  $DIR/restore-drill.sh >> $LOGDIR/isecurify-drill.log 2>&1
# health probe every 10 minutes (prints only when something needs attention)
*/10 * * * * $USER_NAME  $DIR/monitor.sh >> $LOGDIR/isecurify-monitor.log 2>&1 || true
"
if [ "$DRY" = 1 ]; then printf '%s' "$TEXT"; exit 0; fi
[ -w "$(dirname "$FILE")" ] || { echo "cannot write $FILE: run as root" >&2; exit 1; }
printf '%s' "$TEXT" > "$FILE"; chmod 644 "$FILE"; echo "installed $FILE"
