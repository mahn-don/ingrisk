#!/usr/bin/env bash
# Shared helpers for the deploy/ scripts (sourced, never run). Bash only.
#
# DRY_RUN=1 makes `run` print commands instead of running them; REPO_DIR overrides the checkout
# (tests). Nothing here ever prints a value read from .env.

# shellcheck disable=SC2034 # used by the scripts that source this file
SERVICE=silentenglish

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

is_dry_run() { [[ "${DRY_RUN:-0}" == 1 ]]; }

# Run a command, or print it under DRY_RUN=1.
run() {
	if is_dry_run; then
		printf '    [dry-run] %s\n' "$*"
	else
		"$@"
	fi
}

# The repository checkout (the parent of deploy/), or REPO_DIR.
repo_dir() {
	if [[ -n "${REPO_DIR:-}" ]]; then
		(cd "$REPO_DIR" && pwd)
	else
		(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
	fi
}

# The value of KEY in an env file (last assignment wins; one pair of surrounding quotes removed).
# Prints nothing when the key is absent. Never `source`s the file.
env_value() {
	local key="$1" file="$2" line value
	line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
	[[ -n "$line" ]] || return 0
	value="${line#*=}"
	value="${value%$'\r'}"
	if [[ "$value" =~ ^\'(.*)\'$ ]] || [[ "$value" =~ ^\"(.*)\"$ ]]; then
		value="${BASH_REMATCH[1]}"
	fi
	printf '%s' "$value"
}

# The major version of a node binary (e.g. 24).
node_major() {
	"$1" --version | sed -E 's/^v([0-9]+).*/\1/'
}

# Poll the health endpoint for up to $2 seconds; prints the answer. Returns non-zero on timeout.
wait_healthy() {
	local url="$1" seconds="$2" body i
	for ((i = 1; i <= seconds; i++)); do
		if body="$(curl -fsS --max-time 2 "$url" 2>/dev/null)"; then
			info "healthy after ${i}s: $body"
			return 0
		fi
		sleep 1
	done
	info "no healthy answer from $url within ${seconds}s"
	return 1
}

# Move LOG to LOG.1 once it grows past MAX bytes (one old file kept; trivial on purpose).
rotate_log() {
	local log="$1" max="$2"
	if [[ -f "$log" ]] && (($(stat -c %s "$log") > max)); then
		mv -f "$log" "$log.1"
	fi
}
