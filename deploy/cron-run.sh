#!/usr/bin/env bash
# The crontab entry point: run deploy/<job>.sh with its output appended to data/logs/<job>.log,
# rotated to <job>.log.1 past 1 MB (one old file kept). Jobs: prefetch, backup.
#
#   deploy/cron-run.sh prefetch
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JOB="${1:-}"
case "$JOB" in
prefetch | backup) ;;
*) die "usage: deploy/cron-run.sh prefetch|backup" ;;
esac
REPO="$(repo_dir)"
LOG_DIR="$REPO/data/logs"
LOG="$LOG_DIR/$JOB.log"
mkdir -p "$LOG_DIR"
rotate_log "$LOG" "${LOG_MAX_BYTES:-1048576}"
{
	printf '\n[%s] %s\n' "$(date -Is)" "$JOB"
	status=0
	"$REPO/deploy/$JOB.sh" || status=$?
	printf '[%s] %s exit %s\n' "$(date -Is)" "$JOB" "$status"
} >>"$LOG" 2>&1
exit "${status:-0}"
