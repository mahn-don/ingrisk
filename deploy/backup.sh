#!/usr/bin/env bash
# Nightly database snapshot (deploy/crontab.example, 03:30): VACUUM INTO
# data/backups/app-YYYYMMDD-HHMM.db, verified with PRAGMA integrity_check, newest 14 kept.
# No sudo. DRY_RUN=1 prints the command.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cd "$(repo_dir)"
step "Snapshot (npm run db:snapshot)"
run npm run -s db:snapshot
