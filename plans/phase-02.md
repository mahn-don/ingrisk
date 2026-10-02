# Phase 2 — Data layer

Goal: SQLite connection, Drizzle schema, migrations, intent-level repositories and tests.
No content import (Phase 5), no scheduling (Phase 3), no LLM, no UI routes.

## What exists

| Path | Purpose |
|---|---|
| `src/lib/server/db/schema.ts` | All 13 tables (Part II §3) |
| `src/lib/server/db/migrations/` | `0000_init.sql` (generated DDL + hand-written seeds), drizzle-kit metadata |
| `src/lib/server/db/client.ts` | `createDb(path)`, `migrate(db)`, lazy `getDb()` singleton, pragmas |
| `src/lib/server/db/migrate-cli.ts` | `npm run db:migrate` |
| `src/lib/server/db/repositories/` | One module per area + `createRepositories(db)` / `repos()` |
| `src/lib/server/startup.ts`, `src/hooks.server.ts` | Migrations at server start (`init` hook) |
| `drizzle.config.ts` | drizzle-kit config (`npm run db:generate`, `db:studio`) |

After `npm run db:migrate` on a fresh file: 10 `grammar_topics`, 1 `settings`, 1 `user_profile`,
1 `__drizzle_migrations` row, every other table empty; `PRAGMA journal_mode` is `wal`.

## ts-fsrs mapping (ts-fsrs 5.4.2)

- `Card` → `cards`: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`,
  `learning_steps`, `reps`, `lapses`, `state`, `last_review` (same names as the ts-fsrs fields).
- `ReviewLog` → `review_logs`: `rating`, `state`, `due`, `stability`, `difficulty`,
  `elapsed_days`, `last_elapsed_days`, `scheduled_days`, `learning_steps`, `review`,
  plus `old_s`, `new_s`, `old_d`, `new_d`.
- `state` and `rating` are stored as the ts-fsrs enum **names** (`'Review'`, `'Good'`), not the
  numbers: readable in sqlite3, CHECK-constrained, and `State[name]` / `State[value]` convert
  losslessly. Phase 3 writes the mapper.
- `elapsed_days` and `last_elapsed_days` are deprecated in ts-fsrs 5 (removed in 6) but stored,
  because the installed version still has them.

## Decisions and judgement calls

1. **Column names follow ts-fsrs** (`due`, `last_review`, `review`) instead of the doc's
   `due_at`, `last_review_at`, `reviewed_at`, so the mapping is one-to-one. The doc is updated.
2. **`review_logs.card_id` is `ON DELETE RESTRICT`**: a card with reviews cannot be deleted.
   Part I §2 requires every review to be kept for re-optimizing FSRS parameters; cascade would
   silently drop history and SET NULL would lose which card a review belonged to. Retiring a
   card later should be a flag, not a delete.
3. **Other foreign keys:** `cards.*_id` RESTRICT (content in use cannot vanish);
   `collocations.lexeme_id` CASCADE; `settings.active_provider_id` and
   `writing_submissions.session_id` SET NULL.
4. **Unique card index with NULLs.** SQLite treats NULLs as distinct in unique indexes, so
   `(kind, lexeme_id, sentence_id, grammar_topic_id)` alone would allow duplicates of cards that
   reference only one item. The index maps NULL to 0 with `CASE WHEN … IS NULL THEN 0 ELSE … END`.
   (`coalesce(x, 0)` was the obvious choice, but drizzle-kit 0.31 splits index expressions on
   commas and emitted invalid SQL.)
5. **Enumerations get CHECK constraints** in addition to Drizzle's TypeScript-only `enum`, so bad
   values are rejected by the database too. Settings also have range CHECKs (retention 0.70–0.97,
   weekly goal 1–7 days, budget 1–60 minutes).
6. **`env_key_name` CHECK:** only `[A-Z0-9_]`, 1–64 characters. An API key pasted into the field
   by mistake (`sk-…`) is rejected by the database. A test also fails if any column name contains
   `key`, `secret`, `token` or `password` (except `env_key_name`).
7. **One fallback provider:** partial unique index on `is_fallback` where it is 1. Provider
   `name` is unique; `providers.upsert()` matches on it.
8. **Seeds** are hand-written SQL appended to the generated `0000_init.sql`. Defaults: retention
   0.9, weekly goal 5, session budget **8 minutes** (the Đọc/Viết length; Part I gives no single
   default), feedback `direct`; profile estimates NULL until placement, `known_band_ceiling` 1.
   Grammar topic Vietnamese names are mine (Mạo từ, Thì và thể, …); review them.
9. **`writing_submissions.session_id` is nullable.** Phase 9 queues writing before the session
   is recorded (`sessions` rows are written once, at the end), and placement writing has no
   session. Phase 9 can link the row afterwards or leave it NULL.
10. **`generated_cache.kind`** reuses the card kinds. `insertValidated()` always stores
    `validated = true`; rejected items (Phase 5) will need a separate insert.
11. **`takeUnserved`** runs in an IMMEDIATE transaction (select ids, then
    `UPDATE … WHERE served_at IS NULL RETURNING`), so two callers cannot get the same item.
12. **`counts(now)`**: `due` = introduced cards (not New) due at or before `now`; `new` = New;
    `learning` = Learning or Relearning, due or not (so `learning` overlaps `due`).
    `dueCards()` excludes New cards; introducing new cards is the session engine's job.
13. **Migrations folder at runtime** is resolved from the working directory
    (`src/lib/server/db/migrations`, override with `MIGRATIONS_DIR`): the production server
    runs from the repository root (Phase 7). Checked: `node build/index.js` migrates a fresh
    database at startup, and a broken migration makes it exit with code 1.
14. **Server startup:** SvelteKit 3 still has the `init` hook (`ServerInit`, now exported from
    `@sveltejs/kit/hooks`). adapter-node awaits it at startup, so a migration error stops the
    process. `hooks.server.ts` goes through `src/lib/server/startup.ts` so nothing outside
    `src/lib/server/` imports `src/lib/server/db/`.
15. **`db:migrate`** runs `node --env-file-if-exists=.env src/lib/server/db/migrate-cli.ts`
    (Node type stripping; the db modules use `.ts` import extensions for that reason).

## Dependencies

- `better-sqlite3` pinned to `^12.11.1` (13 dropped prebuilt binaries). Installed 12.11.1 with
  its **prebuilt** linux-x64 binary (prebuild-install; no compilation). `@types/better-sqlite3`
  9.6.0 is still the latest types package and matches the 12.x API.
- `npm audit`: still 4 moderate advisories, all from `drizzle-kit` → `@esbuild-kit/esm-loader`
  → old `esbuild` (dev server request issue; drizzle-kit is a dev-only CLI). drizzle-kit 0.31.11
  is the newest stable release; the only offered fix is a breaking downgrade (`--force`), and the
  fixed 1.0 line is still a release candidate. Left as is.
