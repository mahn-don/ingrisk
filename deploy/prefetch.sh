#!/usr/bin/env bash
# Nightly prefetch (deploy/crontab.example, 03:00): POST /api/cron/prefetch with CRON_SECRET read
# from .env. The secret goes to curl on stdin (-H @-), never on a command line, in the crontab
# or in a log. No sudo. DRY_RUN=1 prints the request without the secret.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="$(repo_dir)"
ENV_FILE="$REPO/.env"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing"
SECRET="$(env_value CRON_SECRET "$ENV_FILE")"
[[ -n "$SECRET" ]] || die "CRON_SECRET is not set in $ENV_FILE"
PORT="$(env_value PORT "$ENV_FILE")"
URL="http://127.0.0.1:${PORT:-3000}/api/cron/prefetch"

step "POST $URL"
if is_dry_run; then
	info "[dry-run] curl -fsS -X POST -H @- (Authorization: Bearer <CRON_SECRET>) -H 'Content-Type: application/json' -d '{}' $URL"
	exit 0
fi
printf 'Authorization: Bearer %s\n' "$SECRET" |
	curl -fsS --max-time 1800 -X POST -H @- -H 'Content-Type: application/json' -d '{}' "$URL"
echo
