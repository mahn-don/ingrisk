# CLAUDE.md

## Project

SilentEnglish is a personal, single-user, non-commercial web app that teaches English reading,
writing, vocabulary and grammar to a Vietnamese speaker. There is no audio of any kind. Sessions
last 5–10 minutes and are used on a phone as an installed PWA. The entire UI is in Vietnamese. It
runs on a small VPS behind Caddy, with SQLite as the only datastore.

**Source of truth: `docs/architecture.md`.** Part I is the learning design, Part II the technical
architecture, Part III the phased build plan. `plans/roadmap.md` tracks phase status.

## Stack

- SvelteKit (TypeScript strict) with `@sveltejs/adapter-node`; config lives in `vite.config.ts`
- Tailwind CSS (v4, via `@tailwindcss/vite`; entry `src/routes/layout.css`)
- Vitest (unit) + Playwright (e2e)
- SQLite via `better-sqlite3`, Drizzle ORM + `drizzle-kit`
- `ts-fsrs` (scheduling), `zod` (validation), `@node-rs/argon2` (password hashing)
- npm, Node 22 LTS (>= 22.18: `tool/` scripts run as TypeScript via Node's type stripping, so
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
      generation/        content import; exercise generation + validation (cloze/: the cloze pool)
      content/           generated JSON assets (NGSL, Tatoeba pairs, pseudo-words); built by
                         `npm run content:prepare`, never edited by hand. Exception:
                         blocklist.txt (hand-maintained; used by `content:import`)
    components/          shared Svelte components
    messages/vi.ts       every user-facing string (export `t`), grouped by screen
  routes/
    (app)/               login-protected route group
    login/
    api/
scripts/                 repo tooling (check-strings.mjs)
tool/                    data preparation scripts (`lib/` pure + tested), `raw/` inputs
data/                    SQLite database files (never committed)
deploy/                  Caddyfile, systemd unit, Litestream config
.githooks/pre-commit     blocks .env / *.db files and runs gitleaks
```

Unit tests sit next to the code as `*.spec.ts` (in `src/` and `tool/`); e2e tests as `*.e2e.ts`.

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
| `npm run db:generate` | Generate a SQL migration from `src/lib/server/db/schema.ts` (commit it) |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_PATH` (default `data/app.db`) |
| `npm run db:studio` | Browse the database with Drizzle Studio |
| `npm run srs:walkthrough` | Print one card's FSRS intervals through a fixed rating sequence |
| `npm run llm:provider:add -- ...` | Add/update an LLM provider row (stores the env var *name*, never a key) |
| `npm run llm:smoke -- --provider <name>` | One live structured call to a provider (manual; never in CI) |
| `npm run verify` | `check` → `lint:strings` → `test` → `build`, stops at first failure |

## Hard rules

1. **Never commit secrets, `.env` files or database files. Never bypass the pre-commit hook**
   (no `--no-verify`, no changing `core.hooksPath`). If the hook blocks a commit, fix the cause.
2. **No user-facing string literals in `.svelte` files.** Every one goes through
   `src/lib/messages/vi.ts`. `npm run lint:strings` catches Vietnamese text; English UI text is
   equally forbidden even though the heuristic cannot see it.
3. **Client code must never import anything from `src/lib/server/`.**
4. **API keys are read only from `process.env`.** Never store them in the database, log them, or
   include them in error messages. The database stores only the env variable *name*.
5. **Use existing libraries for solved problems:** `ts-fsrs` for scheduling, `zod` for validation.
   Do not reimplement them.
6. **Workflow for every phase:** read that phase's section in `docs/architecture.md` and any
   `plans/phase-XX.md`; stay within its scope; finish with `npm run verify` passing; then commit
   (one commit per phase) and tick the phase in `plans/roadmap.md`.
7. **Language:** code, comments and commit messages are in English. UI strings are in Vietnamese.

## Database

- Change the schema in `schema.ts`, then `npm run db:generate` and commit the new migration.
  Never edit an applied migration. Migrations run automatically at server start.
- Repositories take the db as a parameter; tests use `createTestDb()` (in-memory, migrated).

## Spaced repetition

- `src/lib/server/srs/` never reads the clock (no `Date.now()`, no `new Date()` without arguments):
  every function takes `now`. A test enforces this.

## LLM

- All LLM output is validated with Zod locally; provider-side schema enforcement is never trusted alone.
- Tests and `--dry-run` use a fake `fetch` (`llm/test-helpers.ts`, `generation/cloze/canned-llm.ts`),
  never a live endpoint. `cloze:build` is capped by `--max-calls` and `LLM_DAILY_CALL_CAP`.

## Environment

Variables are listed in `.env.example`. Copy it to `.env` locally; on the server they live in
`/etc/silentenglish/.env` (mode 600). Never create or edit a committed env file.
