#!/usr/bin/env bash
# One-time setup, run by hand with sudo from the repository checkout:
#
#   sudo deploy/install.sh            (or: sudo NODE_BIN="$(command -v node)" deploy/install.sh)
#
# Installs the systemd unit and a sudoers drop-in that lets the deploy user restart the service
# and read its status and journal without a password (nothing else). Idempotent: run it again
# after changing the unit. It never touches the firewall or any other service, and it does not
# start the app while something else (the old manual `node build`) holds the port.
#
# DRY_RUN=1 prints the rendered files and the commands instead (no root needed); REPO_DIR,
# DEPLOY_USER and NODE_BIN override what is detected.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="$(repo_dir)"
ENV_FILE="$REPO/.env"
UNIT_TEMPLATE="$REPO/deploy/silentenglish.service"
UNIT_PATH="/etc/systemd/system/$SERVICE.service"
SUDOERS_PATH="/etc/sudoers.d/$SERVICE"
REQUIRED_NODE_MAJOR="$(tr -dc '0-9' <"$REPO/.nvmrc")"

step "Checks"
if ! is_dry_run && [[ "$(id -u)" -ne 0 ]]; then
	die "run me with sudo: sudo deploy/install.sh"
fi
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-}}"
[[ -n "$DEPLOY_USER" && "$DEPLOY_USER" != root ]] || die "cannot tell the deploy user: run with sudo from that user's shell, or set DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "no such user: $DEPLOY_USER"
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
info "deploy user: $DEPLOY_USER ($DEPLOY_GROUP), repository: $REPO"

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing: create it from .env.example (plans/phase-07.md, step 3)"
ENV_MODE="$(stat -c %a "$ENV_FILE")"
[[ "$ENV_MODE" == 600 ]] || die "$ENV_FILE has mode $ENV_MODE; it must be 600: chmod 600 $ENV_FILE"
ENV_OWNER="$(stat -c %U "$ENV_FILE")"
[[ "$ENV_OWNER" == "$DEPLOY_USER" ]] || die "$ENV_FILE is owned by $ENV_OWNER; it must belong to $DEPLOY_USER: chown $DEPLOY_USER $ENV_FILE"
info ".env: present, mode 600, owned by $DEPLOY_USER"

DB_PATH="$(env_value DATABASE_PATH "$ENV_FILE")"
case "$DB_PATH" in
"$REPO"/data/*) info "DATABASE_PATH is under $REPO/data (writable by the service)" ;;
*) die "DATABASE_PATH in .env must be an absolute path under $REPO/data/ (the only writable directory), e.g. $REPO/data/app.db" ;;
esac
PORT="$(env_value PORT "$ENV_FILE")"
PORT="${PORT:-3000}"

if [[ -z "${NODE_BIN:-}" ]]; then
	NODE_BIN="$(sudo -u "$DEPLOY_USER" -H bash -lc 'command -v node' 2>/dev/null || true)"
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die "node not found for $DEPLOY_USER: run as sudo NODE_BIN=\"\$(command -v node)\" deploy/install.sh"
NODE_MAJOR="$(node_major "$NODE_BIN")"
((NODE_MAJOR >= REQUIRED_NODE_MAJOR)) || die "$NODE_BIN is Node $NODE_MAJOR; Node $REQUIRED_NODE_MAJOR LTS or newer is required (.nvmrc)"
NODE_DIR="$(dirname "$NODE_BIN")"
info "node: $NODE_BIN (major $NODE_MAJOR)"

[[ -f "$REPO/build/index.js" ]] || die "no build yet: as $DEPLOY_USER run: ORIGIN=... npm ci && npm run build (plans/phase-07.md, step 4)"

SYSTEMCTL="$(command -v systemctl || echo /usr/bin/systemctl)"
JOURNALCTL="$(command -v journalctl || echo /usr/bin/journalctl)"

step "Data directories (owned by $DEPLOY_USER; the only writable paths for the service)"
for dir in "$REPO/data" "$REPO/data/backups" "$REPO/data/logs"; do
	run install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 750 "$dir"
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step "systemd unit -> $UNIT_PATH"
sed -e "s|@USER@|$DEPLOY_USER|g" -e "s|@GROUP@|$DEPLOY_GROUP|g" -e "s|@REPO@|$REPO|g" -e "s|@NODE_DIR@|$NODE_DIR|g" \
	"$UNIT_TEMPLATE" >"$TMP/unit"
if grep -q '@[A-Z_]*@' "$TMP/unit"; then die "unit template has an unfilled placeholder"; fi
if is_dry_run; then
	sed 's/^/    | /' "$TMP/unit"
fi
run install -m 644 "$TMP/unit" "$UNIT_PATH"
run "$SYSTEMCTL" daemon-reload
run "$SYSTEMCTL" enable "$SERVICE"

step "sudoers drop-in -> $SUDOERS_PATH (validated with visudo before it is installed)"
# Exact commands only, no wildcards. systemd >= 247 runs its pager in secure mode under sudo, and
# deploy.sh always passes --no-pager.
cat >"$TMP/sudoers" <<SUDOERS
# Installed by deploy/install.sh: $DEPLOY_USER may restart SilentEnglish and read its status and
# journal without a password, and nothing else.
$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $SERVICE, \\
	$SYSTEMCTL status $SERVICE, $SYSTEMCTL status $SERVICE --no-pager, \\
	$JOURNALCTL -u $SERVICE, $JOURNALCTL -u $SERVICE -f, $JOURNALCTL -u $SERVICE -n 50 --no-pager
SUDOERS
if is_dry_run; then
	sed 's/^/    | /' "$TMP/sudoers"
fi
if command -v visudo >/dev/null 2>&1; then
	visudo -cf "$TMP/sudoers" >/dev/null || die "the sudoers drop-in did not validate; nothing installed"
	info "visudo -cf: ok"
elif is_dry_run; then
	info "visudo not found: validation skipped (dry run)"
else
	die "visudo not found: cannot validate the sudoers drop-in"
fi
run install -m 440 -o root -g root "$TMP/sudoers" "$SUDOERS_PATH"

step "Start"
if is_dry_run; then
	info "[dry-run] would start $SERVICE unless it is running or port $PORT is taken"
	exit 0
fi
if "$SYSTEMCTL" is-active --quiet "$SERVICE"; then
	info "$SERVICE is already running; deploy/deploy.sh restarts it with the new build"
	exit 0
fi
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
	cat >&2 <<HINT
Port $PORT is already in use, so $SERVICE was NOT started (the unit and sudoers are installed).
Probably the old manual 'node build' is still running. Find and stop it:
    ss -ltnp 'sport = :$PORT'            # the pid holding the port (sudo shows other users' processes)
    ps -o pid,user,cmd -C node           # or list node processes
    kill <pid>                           # as its owner; then wait a second
Then run: sudo systemctl start $SERVICE   (or re-run this script)
HINT
	exit 1
fi
"$SYSTEMCTL" start "$SERVICE"
if ! wait_healthy "http://127.0.0.1:$PORT/healthz" 30; then
	"$JOURNALCTL" -u "$SERVICE" -n 50 --no-pager || true
	die "$SERVICE did not become healthy"
fi
step "Done: $SERVICE is enabled and running. Deploy updates with deploy/deploy.sh (no sudo password)."
