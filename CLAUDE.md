# CLAUDE.md

## Project

SilentEnglish is a personal, non-commercial web app that teaches English reading, writing,
vocabulary and grammar to a Vietnamese speaker. One app password; behind it, Netflix-style learner
profiles (Phase 12), each with its own placement, cards, history, streak and learning settings. There is no audio of any kind. Sessions
last 5–10 minutes and are used in a phone's browser, always online (no PWA, no offline mode). The
entire UI is in Vietnamese. It runs on a small VPS, served by Node over plain HTTP on the server's IP
for now (HTTPS can be added later via deployment config), with SQLite as the only datastore.

**Source of truth: `docs/architecture.md`.** Part I is the learning design, Part II the technical
architecture, Part III the phased build plan. `plans/roadmap.md` tracks phase status.

## Stack

- SvelteKit (TypeScript strict) with `@sveltejs/adapter-node`; config lives in `vite.config.ts`
- Tailwind CSS (v4, via `@tailwindcss/vite`; entry `src/routes/layout.css`)
- Vitest (unit) + Playwright (e2e)
- SQLite via `better-sqlite3`, Drizzle ORM + `drizzle-kit`
- `ts-fsrs` (scheduling), `zod` (validation), `@node-rs/argon2` (password hashing)
- npm, Node 24 LTS (`.nvmrc`; `tool/` scripts run as TypeScript via Node's type stripping, so
  only erasable syntax there: no `enum`, `namespace` or parameter properties)

Import from `src/lib` with the `#lib` alias and an explicit `.js` extension, e.g.
`import { t } from '#lib/messages/vi.js'`.

## Folder map

```
docs/                    architecture.md, the design document
plans/                   roadmap.md + per-phase plans (phase-XX.md)
src/
  lib/
    server/              server-only code; never imported by client code
      db/                Drizzle schema, migrations/, repositories/ (intent-level functions; callers
                         never build queries), client.ts (connection, pragmas, migrate)
      llm/               provider client: wire formats, structured modes, retry/fallback, call log;
                         prompts/ (each module exports PROMPT_VERSION)
      srs/               ts-fsrs wrapper: scheduler, review, auto-rating, queue (never reads the clock)
      generation/        content import; generators + validation (cloze/, drills/, reading/), prefetch
      grading/           live writing and translation grading (no cache)
      cron/              cron endpoint logic (secret check, single-run lock)
      placement/         placement test: staircase, Elo, combination (pure), engine, results
      session/           session composition (pure rules + card creation), focus sessions, start/finish,
                         Home counts
      progress/          streak, weekly goal, heat-map, forecast, weakness (pure; recomputed on read)
      review-book/       the review book: hard / learned lists, card detail, Ôn ngay, Tạm ẩn
      settings/          settings forms (Zod), providers, stock, AI usage, backup, credits
      auth/              sessions (with the picked profile), cookie rules, login limiter, the public-path
                         allowlist, profileIdOf(locals)
      profiles/          the /profiles picker: create, rename, archive, the grid (level, streak)
      content/           generated JSON assets (NGSL, Tatoeba pairs, pseudo-words); built by
                         `npm run content:prepare`, never edited by hand. Exception:
                         blocklist.txt (hand-maintained; used by `content:import`)
    components/          shared Svelte components (gallery: /dev/components, dev only)
    styles/              colour tokens (WCAG-checked by a test) and self-hosted font faces
    messages/vi.ts       every user-facing string (export `t`), grouped by screen
    session/             shared by server and client: answer check, auto-rating, API types
  routes/
    (app)/               login-protected route group
    login/
    api/
scripts/                 repo tooling (check-strings.mjs)
tool/                    data preparation scripts (`lib/` pure + tested), `raw/` inputs
data/                    SQLite database files (never committed)
deploy/                  systemd unit template, install.sh (sudo, once), deploy.sh, backup.sh,
                         prefetch.sh + cron-run.sh, crontab and Litestream examples
.githooks/pre-commit     blocks .env / *.db files and runs gitleaks
```

Unit tests sit next to the code as `*.spec.ts` (in `src/` and `tool/`); e2e tests as `*.e2e.ts`
(Playwright starts six preview servers: main, no password hash, an isolated rate-limit one,
placement, session and progress, the last three with a seeded database and `LLM_CANNED=1`).
SvelteKit 3 renamed `$app/environment` to `$app/env`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build into `build/` |
| `npm run preview` | Serve the production build |
| `npm run check` | `svelte-check` (types) |
| `npm run lint:strings` | Fail on Vietnamese text inside any `.svelte` file |
| `npm test` | Vitest, single run |
| `npm run test:e2e` | Playwright (builds and previews the app first) |
| `npm run content:prepare` | Rebuild `src/lib/server/content/*.json` from `tool/raw/` (deterministic) |
| `npm run content:tatoeba-pairs` | Re-join the Tatoeba exports into `tool/raw/tatoeba-eng-vie.tsv` |
| `npm run content:import` | Upsert the content JSON into the database (idempotent; `-- --reblock` re-applies the blocklist) |
| `npm run cloze:build -- ...` | Build the cloze pool (`--bands 1-3 --types ... --limit --provider --max-calls --dry-run`) |
| `npm run eval:cloze -- --n 30` | Write a cloze evaluation sheet to `tmp/eval/` for a human to grade |
| `npm run eval:drills -- --n 20` / `eval:reading -- --n 4` | Drill / passage sheets to `tmp/eval/` (`--generate` builds first, `--dry-run` canned) |
| `npm run eval:grading` | Grade `test/eval/grading-fixtures.json` twice each (live calls; `--dry-run` canned) |
| `npm run prefetch -- [--max-calls N] [--dry-run]` | Top up the stock (cloze, drills, passages), cheapest first; same as the cron endpoint |
| `npm run llm:usage -- --days 7` | LLM calls and tokens per day × purpose × model |
| `npm run auth:hash` | Prompt for the login password twice (hidden) and print `APP_PASSWORD_HASH` |
| `npm run screenshots` | Login, the profile picker, Home, Stats, the review book, Settings (each section, providers, credits), `/dev/components`, the placement test and sessions at 390×844, light + dark, into `tmp/screens/` |
| `npm run test:seed -- --db PATH [--anchors]` | A throwaway test database: content, a cloze pool (and passages, drills) built with the canned LLM |
| `npm run db:generate` | Generate a SQL migration from `src/lib/server/db/schema.ts` (commit it) |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_PATH` (default `data/app.db`) |
| `npm run db:studio` | Browse the database with Drizzle Studio |
| `npm run db:snapshot -- [--label L] [--keep 14]` | `VACUUM INTO data/backups/app-YYYYMMDD-HHMM.db`, `integrity_check`, keep the newest 14 |
| `npm run srs:walkthrough` | Print one card's FSRS intervals through a fixed rating sequence |
| `npm run llm:provider:add -- ...` | Add/update an LLM provider row (stores the env var *name*, never a key) |
| `npm run llm:smoke -- --provider <name>` | One live structured call to a provider (manual; never in CI) |
| `npm run verify` | `check` → `lint:strings` → `test` → `build`, stops at first failure |

Deploy (VPS; runbook `plans/phase-07.md`; scripts take `DRY_RUN=1`): once `sudo NODE_BIN="$(command -v node)"
deploy/install.sh`; then `deploy/deploy.sh` (no password; rollback: `git checkout <commit>` first),
`deploy/backup.sh`, logs `sudo journalctl -u silentenglish -f` and `data/logs/`.

## Hard rules

1. **Never commit secrets, `.env` files or database files. Never bypass the pre-commit hook**
   (no `--no-verify`, no changing `core.hooksPath`). If the hook blocks a commit, fix the cause.
2. **No user-facing string literals in `.svelte` files.** Every one goes through
   `src/lib/messages/vi.ts`. `npm run lint:strings` catches Vietnamese text; English UI text is
   equally forbidden even though the heuristic cannot see it.
3. **Client code must never import anything from `src/lib/server/`.**
4. **API keys are read only from `process.env`.** Never store them in the database, log them, or
   include them in error messages. The database stores only the env variable *name*. The provider
   UI (`/settings/providers`) never handles a key value: it shows the variable name and whether
   it is set (a boolean), and no form field accepts a key.
5. **Use existing libraries for solved problems:** `ts-fsrs` for scheduling, `zod` for validation.
   Do not reimplement them.
6. **Workflow for every phase:** read that phase's section in `docs/architecture.md` and any
   `plans/phase-XX.md`; stay within its scope; finish with `npm run verify` passing; then commit
   (one commit per phase) and tick the phase in `plans/roadmap.md`.
7. **Language:** code, comments and commit messages are in English. UI strings are in Vietnamese.
8. **Auth is enforced in `src/hooks.server.ts`; never rely on a layout for protection.** Every new
   public path must be added deliberately to the allowlist in `src/lib/server/auth/guard.ts`.

## Database

- Change the schema in `schema.ts`, then `npm run db:generate` and commit the new migration.
  Never edit an applied migration. Migrations run automatically at server start, with foreign
  keys off (a rebuild can drop a referenced table) and a `foreign_key_check` afterwards. Review
  drizzle-kit's rebuilds: its `INSERT … SELECT` copies columns the old table lacks.
- Repositories take the db as a parameter; tests use `createTestDb()` (in-memory, migrated) and
  `TEST_PROFILE` (profile 1, which every migrated database has).

## Profiles

- Per-learner data (user_profile, profile_settings, placement, cards, review_logs, sessions,
  writing_submissions, drill_results, mined sentences and cloze items) is scoped by `profileId`.
  Every repository and server function that touches it takes `profileId` explicitly
  (`cardsRepo(db, profileId)`, `startSession(db, profileId, now, …)`); there is no global "current
  profile". Routes get it with `profileIdOf(locals)`; `hooks.server.ts` sets `locals.profile` from
  the login session and sends a request without one to `/profiles` (`/api/*`: 409).
- Shared, unowned: Tatoeba content, `generated_cache`, the cloze pool (`clozeItemsRepo`: rows with
  `profile_id IS NULL`), providers and `settings` (only the active provider). A learner's view of
  the pool is `learnerClozeRepo(db, profileId)`: shared items plus their own mined ones.
- A new per-learner query needs a case in `profiles/leakage.spec.ts`.

## Spaced repetition

- `src/lib/server/srs/` never reads the clock (no `Date.now()`, no `new Date()` without arguments):
  every function takes `now`. A test enforces this.

## LLM

- All LLM output is validated with Zod locally; provider-side schema enforcement is never trusted alone.
- Tests and `--dry-run` use a fake `fetch` (`llm/test-helpers.ts`, `generation/canned-llm.ts`),
  never a live endpoint; e2e and screenshot servers set `LLM_CANNED=1` (refused when
  `NODE_ENV=production`). Every generator runs on a budget (`generation/budget.ts`): `--max-calls`
  and `LLM_DAILY_CALL_CAP`. Every generated item passes rules and a blind critic.
- Every CLI parses arguments with `tool/lib/cli.ts` (`parseArgs` strict, `--help` with an example).
- LLM-backed routes are limited to 60 requests/hour (`llm/route-limit.ts`; wrap new ones with `llmLimited`).
  Graders return every error (all mined); the UI shows 3, distinct codes first (`selectShownErrors`).

## Environment

Variables are listed in `.env.example`. Copy it to `.env` locally; on the server they live in
`<repo>/.env` (mode 600, owned by the deploy user; never sourced whole into a build). Never create or edit a committed env file. `ORIGIN` is read
at build time (`vite.config.ts` `paths.origin`; adapter-node 6 has no runtime `ORIGIN`): build with
it set, or plain-HTTP logins fail CSRF with 403.
