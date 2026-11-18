#!/usr/bin/env bash
# Off-server copy of one backup, with a verify step. Sourced by backup.sh (needs OUT and the stamp); no secrets live here.
# BACKUP_OFFSITE   none (default: backups stay on this server) | rclone | rsync | command
# BACKUP_OFFSITE_TARGET  rclone: "remote:bucket/path"   rsync: "user@host:/path" or a local directory (an external disk)
# BACKUP_RSYNC_SSH       rsync over ssh options, e.g. "ssh -i /home/deploy/.ssh/backup_key -p 2222"
# BACKUP_PUSH_CMD        command mode (and kept for older setups): runs with BACKUP_OUT and BACKUP_STAMP set; cannot be verified here
# BACKUP_OFFSITE_KEEP_DAYS  rclone only: remote files older than this are removed (default 30)
# Everything copied is already checksummed and, when BACKUP_GPG_RECIPIENT is set, encrypted before it leaves this server.
offsite_mode() { local m="${BACKUP_OFFSITE:-}"; if [ -z "$m" ]; then if [ -n "${BACKUP_PUSH_CMD:-}" ]; then m=command; else m=none; fi; fi; printf '%s' "$m"; }
# offsite_push <dir> <stamp>: copy that stamp's files, then verify. Returns 0 ok, 1 failed. Prints one line explaining the result.
offsite_push() {
  local dir="$1" stamp="$2" mode; mode="$(offsite_mode)"
  case "$mode" in
    none) echo "off-server copy is not configured"; return 0;;
    rclone)
      [ -n "${BACKUP_OFFSITE_TARGET:-}" ] || { echo "BACKUP_OFFSITE_TARGET is not set"; return 1; }
      command -v rclone >/dev/null || { echo "rclone is not installed"; return 1; }
      rclone copy "$dir" "$BACKUP_OFFSITE_TARGET" --include "*-$stamp.*" --checksum >/dev/null || { echo "rclone copy failed"; return 1; }
      rclone check "$dir" "$BACKUP_OFFSITE_TARGET" --include "*-$stamp.*" --one-way >/dev/null 2>&1 || { echo "rclone verify failed: the copy does not match"; return 1; }
      rclone delete "$BACKUP_OFFSITE_TARGET" --min-age "${BACKUP_OFFSITE_KEEP_DAYS:-30}d" --include "db-*" --include "evidence-*" --include "manifest-*" >/dev/null 2>&1 || true
      echo "copied and verified with rclone";;
    rsync)
      [ -n "${BACKUP_OFFSITE_TARGET:-}" ] || { echo "BACKUP_OFFSITE_TARGET is not set"; return 1; }
      command -v rsync >/dev/null || { echo "rsync is not installed"; return 1; }
      local -a ssh=(); [ -n "${BACKUP_RSYNC_SSH:-}" ] && ssh=(-e "$BACKUP_RSYNC_SSH")
      local -a inc=(--include="*-$stamp.*" --exclude='*')
      rsync -a --checksum "${ssh[@]}" "${inc[@]}" "$dir/" "$BACKUP_OFFSITE_TARGET/" || { echo "rsync copy failed"; return 1; }
      local diff; diff="$(rsync -a --checksum --dry-run --itemize-changes "${ssh[@]}" "${inc[@]}" "$dir/" "$BACKUP_OFFSITE_TARGET/" 2>&1)" || { echo "rsync verify could not run"; return 1; }
      [ -z "$diff" ] || { echo "rsync verify failed: the copy does not match"; return 1; }
      echo "copied and verified with rsync";;
    command)
      [ -n "${BACKUP_PUSH_CMD:-}" ] || { echo "BACKUP_PUSH_CMD is not set"; return 1; }
      BACKUP_OUT="$dir" BACKUP_STAMP="$stamp" bash -c "$BACKUP_PUSH_CMD" >/dev/null || { echo "the copy command failed"; return 1; }
      echo "copy command finished (not verified by this script)";;
    *) echo "BACKUP_OFFSITE must be none, rclone, rsync or command"; return 1;;
  esac
}
