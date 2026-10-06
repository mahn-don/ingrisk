#!/usr/bin/env bash
# Deploy the checked-out branch: pull, install, build, snapshot the database, restart, check.
# Run as the deploy user from anywhere; needs no sudo password (deploy/install.sh allows exactly
# the restart and the journal). Fails loudly at the first error.
#
#   deploy/deploy.sh            normal deploy (git pull --ff-only first)
#   git checkout <commit> && deploy/deploy.sh
#                               roll back: on a detached HEAD the pull is skipped
#   DRY_RUN=1 deploy/deploy.sh  print the commands instead of running them
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="$(repo_dir)"
cd "$REPO"
ENV_FILE="$REPO/.env"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing (plans/phase-07.md, step 3)"

# Only ORIGIN goes into the build environment; the rest of .env (secrets) never does.
ORIGIN_VALUE="$(env_value ORIGIN "$ENV_FILE")"
[[ -n "$ORIGIN_VALUE" ]] || die "ORIGIN is not set in $ENV_FILE: the build needs it (SvelteKit fixes the origin at build time)"
PORT="$(env_value PORT "$ENV_FILE")"
PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:$PORT/healthz"

REQUIRED_NODE_MAJOR="$(tr -dc '0-9' <"$REPO/.nvmrc")"
NODE_MAJOR="$(node_major node)"
if ((NODE_MAJOR < REQUIRED_NODE_MAJOR)); then
	if is_dry_run; then
		info "warning: node is $NODE_MAJOR, the server needs $REQUIRED_NODE_MAJOR (.nvmrc)"
	else
		die "node is $NODE_MAJOR; Node $REQUIRED_NODE_MAJOR LTS is required (.nvmrc)"
	fi
fi

step "Deploying $REPO (origin $ORIGIN_VALUE)"
if git symbolic-ref -q HEAD >/dev/null; then
	step "git pull --ff-only"
	run git pull --ff-only
else
	step "Detached HEAD (a rollback): building $(git rev-parse --short HEAD) without pulling"
fi
info "commit: $(git log -1 --format='%h %s')"

step "npm ci (dev dependencies included: the build needs them)"
run npm ci --include=dev

step "npm run build (ORIGIN only)"
run env ORIGIN="$ORIGIN_VALUE" npm run build

step "Database snapshot before the restart (data/backups/)"
run npm run -s db:snapshot -- --label predeploy

step "Restart"
run sudo -n systemctl restart "$SERVICE"

step "Health check: $HEALTH_URL (up to 30 s)"
if is_dry_run; then
	info "[dry-run] would poll $HEALTH_URL"
	exit 0
fi
if ! wait_healthy "$HEALTH_URL" 30; then
	step "Last 50 journal lines"
	sudo -n journalctl -u "$SERVICE" -n 50 --no-pager || true
	die "deploy failed: $SERVICE is not healthy (roll back: git checkout <previous commit> && deploy/deploy.sh)"
fi
step "Deployed $(git rev-parse --short HEAD)"
