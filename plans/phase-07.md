# Phase 7 — Deployment (runbook)

The app runs on the Ubuntu VPS as a systemd service from the repository checkout: plain HTTP at
`http://103.82.195.48:3000`, Node 24 LTS on `0.0.0.0:3000`, no reverse proxy, no TLS. The VPS
also runs other services (socat, next-server, cloudflared): **nothing here touches the firewall or
any other service.**

Only **three commands need sudo with your password**, all during the first setup. They are marked
🔒. Everything after that (deploys, restarts, status, logs, backups, cron) runs as the deploy user
without a password.

In the examples the deploy user is `deploy` and the checkout is `/home/deploy/ingrisk`; use your own.

## 0. Prerequisites

- Node 24 LTS for the deploy user, e.g. `nvm install 24`. Check with `node --version` (v24.x) and
  `command -v node`.
- The repository cloned at its final place, e.g. `/home/deploy/ingrisk`, with `git pull` working
  (deploy key or token).
- `curl` and `git`. Optional: `sqlite3` (step 9 also shows a Node one-liner).
- Port 3000 open to your phone. It already is: the old manual process uses it. Leave the firewall as it is.

## 1. Files in `deploy/`

| File | Run by | What it does |
|---|---|---|
| `silentenglish.service` | — | systemd unit template (filled in by `install.sh`) |
| `install.sh` | 🔒 sudo, once | installs the unit and a sudoers drop-in, enables and starts the service |
| `deploy.sh` | deploy user | pull, `npm ci`, build (ORIGIN only), snapshot, restart, `/healthz` |
| `backup.sh` | deploy user / cron | `npm run db:snapshot`: `VACUUM INTO data/backups/`, integrity check, newest 14 kept |
| `prefetch.sh` | cron | `POST /api/cron/prefetch` with `CRON_SECRET` from `.env` |
| `cron-run.sh` | cron | runs `prefetch` or `backup`, logging to `data/logs/<job>.log` (rotated at 1 MB) |
| `crontab.example` | — | the deploy user's crontab (03:00 prefetch, 03:30 backup, Vietnam time) |
| `litestream.yml.example` | — | optional offsite replication (not installed) |

All the scripts take `DRY_RUN=1` to print what they would do.

## 2. Stop the old manual `node build`

The service cannot start while something else holds port 3000.

```bash
ss -ltnp 'sport = :3000'        # your own process shows its pid
ps -o pid,user,cmd -C node      # or list the node processes
kill <pid>                      # then check again that the port is free
```

🔒 **sudo 1, only if the process belongs to another user:**
`sudo ss -ltnp 'sport = :3000'`, then `sudo kill <pid>`.

## 3. Create `.env`

```bash
cd /home/deploy/ingrisk
cp .env.example .env
chmod 600 .env                  # install.sh refuses any other mode
npm ci && npm run auth:hash     # prompts twice; paste the printed line, quotes included, as APP_PASSWORD_HASH
openssl rand -hex 32            # paste as CRON_SECRET
nano .env
```

Set at least:
- `ORIGIN=http://103.82.195.48:3000`, exactly as in the phone's address bar;
- `COOKIE_SECURE=false`, `HOST=0.0.0.0`, `PORT=3000`;
- `DATABASE_PATH=/home/deploy/ingrisk/data/app.db`: absolute, and **inside `data/`**, the only directory the service may write;
- `APP_PASSWORD_HASH`, `CRON_SECRET`, `ANTHROPIC_API_KEY`;
- `LLM_DAILY_CALL_CAP=500`.

Leave `LLM_CANNED` empty. Also set a spending limit at the LLM provider.

## 4. Install and build

```bash
npm ci
ORIGIN="$(grep -E '^ORIGIN=' .env | cut -d= -f2- | tr -d "'\"")" npm run build
```

The origin is fixed at build time (SvelteKit 3): build without it and the login fails with 403.
`deploy.sh` does this for you from now on, passing **only** `ORIGIN` from `.env` to the build.

## 5. Install the service

🔒 **sudo 2:**

```bash
sudo NODE_BIN="$(command -v node)" deploy/install.sh
```

It prints every step and is safe to run again. It:
1. refuses to continue if `.env` is missing, is not mode 600, or is not owned by you; if `DATABASE_PATH` is outside `data/`; if `node` is older than 24; or if there is no build;
2. creates `data/`, `data/backups/` and `data/logs/`, owned by you;
3. renders the unit to `/etc/systemd/system/silentenglish.service`, then runs `daemon-reload` and `enable`;
4. writes `/etc/sudoers.d/silentenglish` after checking it with `visudo -cf`. You may then run exactly these without a password:
   - `systemctl restart silentenglish`
   - `systemctl status silentenglish [--no-pager]`
   - `journalctl -u silentenglish`, `journalctl -u silentenglish -f`, `journalctl -u silentenglish -n 50 --no-pager`
5. starts the service and waits for `/healthz`, **unless port 3000 is taken**. In that case it says how to find the old process (step 2) and exits without starting.

`NODE_BIN` tells it which Node to use: with nvm, Node is in your home directory and `sudo` does not see it on its PATH.

## 6. Start

`install.sh` starts the service when the port is free.

🔒 **sudo 3, only if it reported the port as taken** (after step 2):

```bash
sudo systemctl start silentenglish
```

## 7. Verify

```bash
curl -s http://127.0.0.1:3000/healthz      # {"ok":true,"db":"ok","migrations":10}
sudo systemctl status silentenglish --no-pager
```

Then, from the phone, over 4G as well as Wi-Fi:
1. open `http://103.82.195.48:3000` and log in;
2. check the small "Kết nối không mã hóa" notice on the login page (expected over HTTP);
3. start and finish a short session.

`/healthz` is public. It answers only `ok`, `db` and the migration count, or 503.

## 8. Install the crontab

```bash
cp deploy/crontab.example /tmp/crontab.se && nano /tmp/crontab.se   # set REPO, and PATH to $(dirname "$(command -v node)")
crontab -l 2>/dev/null; cat /tmp/crontab.se                         # merge by hand if you already have a crontab
crontab /tmp/crontab.se && crontab -l
```

- **03:00 (Vietnam):** prefetch. It grades queued writing, tops up exercises, and deletes expired login sessions.
- **03:30:** backup.
- **Logs:** `data/logs/prefetch.log` and `data/logs/backup.log`. Past 1 MB a log becomes `.log.1` (one old file kept).
- **The secret** never appears in the crontab or the logs: `prefetch.sh` reads `CRON_SECRET` from `.env` and hands it to curl on stdin.
- **Time zone.** The crontab uses `CRON_TZ=Asia/Ho_Chi_Minh`. If `man 5 crontab | grep -A3 CRON_TZ` shows nothing, this cron ignores it: write the times in the system time zone instead (`timedatectl`; on UTC, use `0 20` and `30 20`).
- **Test both jobs now:**
  ```bash
  deploy/cron-run.sh prefetch; tail data/logs/prefetch.log
  deploy/cron-run.sh backup; tail data/logs/backup.log
  ```

## 9. Back up once and restore the snapshot (the hard gate)

A backup that has never been restored is not a backup.

```bash
deploy/backup.sh
ls -l data/backups/                                    # app-YYYYMMDD-HHMM.db, mode 600
SNAP="$(ls -1 data/backups/app-*.db | tail -n 1)"
cp "$SNAP" /tmp/restore-test.db                        # a scratch copy: never the live file
sqlite3 /tmp/restore-test.db 'pragma integrity_check; select count(*) from cards; select count(*) from sessions; select count(*) from review_logs;'
# without sqlite3:
node -e "const D=require('better-sqlite3');const d=new D('/tmp/restore-test.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}),d.prepare('select (select count(*) from cards) cards,(select count(*) from sessions) sessions').get())"
rm /tmp/restore-test.db
```

Expect `ok` and the same counts the app shows (Tiến độ → Tổng kết). Record the date you did this
in the PR or this file.

**A real restore** (rare; needs your password, since stop/start are not in the sudoers drop-in):

```bash
sudo systemctl stop silentenglish
cp data/app.db data/app.db.broken                      # keep what was there
cp data/backups/app-YYYYMMDD-HHMM.db data/app.db
rm -f data/app.db-wal data/app.db-shm
sudo systemctl start silentenglish
curl -s http://127.0.0.1:3000/healthz
```

The settings page's **Tải bản sao lưu** downloads the same kind of file to the phone.

## 10. Deploy updates

```bash
cd /home/deploy/ingrisk && deploy/deploy.sh
```

It stops at the first failure. In order, it:
1. runs `git pull --ff-only`;
2. runs `npm ci --include=dev`;
3. builds with `ORIGIN` from `.env` (nothing else from `.env` reaches the build);
4. takes a database snapshot `app-…-predeploy.db`;
5. runs `sudo systemctl restart silentenglish` (no password);
6. polls `http://127.0.0.1:3000/healthz` for up to 30 s and prints the answer;
7. if the app is not healthy, prints the last 50 journal lines and exits non-zero.

Migrations run automatically when the server starts. `DRY_RUN=1 deploy/deploy.sh` prints the
steps without running them.

## 11. Roll back

```bash
git log --oneline -10
git checkout <previous commit>      # a detached HEAD: deploy.sh skips the pull
deploy/deploy.sh
```

When the fix is on `main`, return with `git checkout main && deploy/deploy.sh`.

Migrations are not reversed. If the bad deploy added one and the old code fails against the newer
schema, restore the `predeploy` snapshot taken just before it (step 9, "A real restore").

## 12. Logs

```bash
sudo journalctl -u silentenglish -f                    # live (no password)
sudo journalctl -u silentenglish -n 50 --no-pager      # the last 50 lines
sudo systemctl status silentenglish --no-pager
tail -n 50 data/logs/prefetch.log data/logs/backup.log
```

## Optional: offsite replication with Litestream

The nightly snapshots stay on the same disk as the database, so they do not survive losing the VPS.
For an offsite copy, use Litestream (not installed by default). It continuously replicates the WAL
to S3-compatible storage (Cloudflare R2, Backblaze B2):
1. install the Litestream `.deb` (sudo);
2. copy `deploy/litestream.yml.example` to `/etc/litestream.yml` and set the database path;
3. give the service `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID` and `LITESTREAM_SECRET_ACCESS_KEY` through a mode-600 `EnvironmentFile`;
4. run `systemctl enable --now litestream`.

Prove it the same way as step 9: `litestream restore -o /tmp/restore-test.db <db path>`, then open the copy. Alternatively, copy `data/backups/` off the server now and then.

## Decisions and deviations

- **The service runs from the checkout and reads `<repo>/.env`**, not `/etc/silentenglish/.env` as the original Phase 7 section had it (this prompt wins). The file must be mode 600 and owned by the deploy user, who needs to read `ORIGIN` and `CRON_SECRET` from it without sudo.
- **The `data/` boundary.**
  - `DATABASE_PATH` must be under `<repo>/data/`: with `ProtectHome=read-only`, that is the only writable path (`ReadWritePaths`).
  - `install.sh` refuses anything else.
  - **Checked in a mount namespace** (no systemd in the build container): `/home`, `/usr` and `/etc` were bind-mounted read-only, then `data/` read-write, as systemd does. Node 24 started `build/index.js`, migrated a fresh database and created the WAL files in `data/`. `/healthz` answered and a write succeeded, while writing to the repository or `/etc` failed.
  - `systemd-analyze verify` accepts the rendered unit.
- **`PATH` in the unit.** `ExecStart=/usr/bin/env node build/index.js` as asked, plus `Environment=PATH=<node dir>:…`, because an nvm Node is not on systemd's default PATH. `install.sh` takes the directory from `NODE_BIN` (or the deploy user's login shell) and checks for Node ≥ 24.
- **`Environment=NODE_ENV=production`** in the unit, so canned LLM responses are refused at startup.
- **The sudoers drop-in.**
  - It lists exact command lines, no wildcards: restart, status (with and without `--no-pager`), and `journalctl -u silentenglish` plain, `-f`, or `-n 50 --no-pager`.
  - A wildcard after `journalctl` would also allow `--file` or other units.
  - systemd ≥ 247 runs its pager in secure mode under sudo.
- **The crontab calls wrapper scripts**, not the inline `curl`.
  - `prefetch.sh` reads `CRON_SECRET` from `.env` and gives curl the header on stdin (`-H @-`), so the secret never appears in the crontab, a process list or a log.
  - `cron-run.sh` does the size-based log rotation.
- **`npm ci --include=dev`** in `deploy.sh`: the build needs the dev dependencies even if `NODE_ENV=production` is set in the shell.
- **The pre-deploy snapshot** runs after the build and before the restart, as `app-…-predeploy.db`. It counts towards the 14 kept.
- **The build window.** `npm ci` and the build run while the old server is still up. For the few seconds between the new `build/` and the restart, a route the old process has not loaded yet may fail. This is acceptable for a single user; the health check follows the restart.
- **CRON_TZ.** Ubuntu's cron may not support it; step 8 says how to check and what to write instead.

## Tests

- **Unit:**
  - `/healthz`: 200 with the migration count; 503 without details when the database cannot be opened, is closed, or is not migrated.
  - The guard: `/healthz` is public, `/healthz/x` and `/api/backup` are not. The allowlist test lists every public path.
  - `db:snapshot`: names, uniqueness, keeping exactly 14 without touching other files, mode 600, a valid copy taken while the database is open in WAL mode, a missing database skipped, a corrupt file detected.
  - `tool/deploy.spec.ts`:
    - shellcheck on every script;
    - `deploy.sh` with `DRY_RUN=1`: the exact command sequence, only ORIGIN in the build, a rollback on a detached HEAD skips the pull, and it fails without `.env` or `ORIGIN`;
    - `install.sh` with `DRY_RUN=1`: the rendered unit, a `visudo`-validated sudoers drop-in, and refusals (mode, `DATABASE_PATH`, Node 22, root, no build);
    - `prefetch.sh` against a local HTTP stub: the header arrives and the secret is never printed;
    - `cron-run.sh`: logging and rotation, plus a failing job.
- **e2e:**
  - main server: `/healthz` is reachable without a session and answers only `{ok, db, migrations}`; `/healthz/x`, `/review` and `/settings/providers` redirect to login; `/api/backup`, `/api/healthz` and `/api/session/start` answer 401;
  - unconfigured server: `/healthz` still answers.
