# Phase 3 — Spaced-repetition engine

Goal: `src/lib/server/srs/`, a thin, deterministic layer over ts-fsrs (pinned to **5.4.2**) plus
the queue policy around it. No UI, routes or LLM.

## Modules

| File | Exports |
|---|---|
| `scheduler.ts` | `createScheduler(settings, { fuzz })`, `LEARNING_STEPS`, `RELEARNING_STEPS`, `MAXIMUM_INTERVAL_DAYS` |
| `mapping.ts` | `toFsrsCard`, `fromFsrsCard`, `toFsrsReviewLog`, `fromFsrsReviewLog`, `newCardFields(now)`, state/rating name helpers |
| `review.ts` | `review(dbOrTx, cardId, rating, reviewedAt, serverNow, { fuzz })`, `reviewBatch(...)`, `MAX_FUTURE_SKEW_MS` |
| `errors.ts` | `SrsError`, `CardNotFoundError`, `InvalidRatingError`, `ReviewTimeError` (`problem`: `before_last_review` / `in_future`) |
| `rating.ts` | `ratingFromOutcome(outcome)`, `SLOW_THRESHOLD_MS`, `EASY_THRESHOLD_MS` |
| `preview.ts` | `previewIntervals(card, now, scheduler)`, `describeInterval(ms)` |
| `queue.ts` | `buildQueue(db, now, limits)`, `counts(db, now, newLimit?)`, `learningDayStart(now)` |

Repository additions: `cards.newCards(limit)`, `reviewLogs.countIntroducedBetween(from, to)`;
every repository now accepts a db **or** a transaction (`DbOrTx`). Migration
`0001_new_cards_per_day` adds `settings.new_cards_per_day` (default 10, CHECK 0–50).

## ts-fsrs API used

`fsrs()`, `generatorParameters()`, `FSRS.next(card, now, grade)` (reviews),
`FSRS.repeat(card, now)` (previews), `createEmptyCard(now)` (new cards), and the `Rating`,
`State`, `Grade`, `Card` and `ReviewLog` types.

## Walkthrough (`npm run srs:walkthrough`, retention 0.9, fuzz off)

| step | rating | reviewed at (ICT) | state after | next interval | stability | difficulty |
|------|--------|-------------------|-------------|---------------|-----------|------------|
| 1    | Good   | 2026-10-05 09:00  | Learning    | 10 minutes    | 2.31      | 2.12       |
| 2    | Good   | 2026-10-05 09:10  | Review      | 2 days        | 2.31      | 2.11       |
| 3    | Good   | 2026-10-07 09:10  | Review      | 11 days       | 10.97     | 2.10       |
| 4    | Good   | 2026-10-18 09:10  | Review      | 1.5 months    | 46.32     | 2.10       |
| 5    | Again  | 2026-12-03 09:10  | Relearning  | 10 minutes    | 2.93      | 7.39       |
| 6    | Good   | 2026-12-03 09:20  | Review      | 3 days        | 2.93      | 7.38       |
| 7    | Good   | 2026-12-06 09:20  | Review      | 8 days        | 7.80      | 7.36       |

## ts-fsrs behaviour worth knowing

1. **The review log describes the card before the review.** `log.stability`,
   `log.difficulty`, `log.state` and `log.due` are the pre-review values (`log.due` is the
   *previous* due date). So `old_s`/`old_d` equal the log's values and `new_s`/`new_d` come from
   the returned card. "Introduced today" relies on `log.state = 'New'`.
2. **Good on a New card skips the 1-minute step** and goes straight to the 10-minute step; the
   1-minute step only follows Again. A second Good graduates to Review (2 days).
3. **One relearning step means one Good after a lapse returns the card to Review** (3 days).
4. **A lapse is expensive for difficulty:** 2.10 → 7.39 in one Again, and it decays slowly
   afterwards (7.36 two reviews later). This is FSRS-6's default weights, not a bug here.
5. **Fuzz is deterministic.** ts-fsrs seeds its fuzz from the review time, reps and the card's
   memory state, so the same inputs give the same interval. The engine never needs the clock.
6. `elapsed_days` / `last_elapsed_days` are deprecated in 5.x (removed in 6.0). They are still
   stored because the installed version has them; pinning 5.4.2 avoids a silent change.
7. ts-fsrs ships with fuzz **off** by default; the app turns it on (`createScheduler` default).

## Decisions and judgement calls

1. **`review()` takes `serverNow` as a fifth argument** (the prompt lists four parameters plus a
   `serverNow` argument for the future check), and an optional `{ fuzz }` for tests.
2. **`previewIntervals(card, now, scheduler)`** takes the scheduler as a third argument instead
   of reading settings, so it stays pure; callers build it with `createScheduler(settings)`.
3. **Equal timestamps are allowed:** a review at exactly `last_review` passes; only strictly
   earlier times are rejected. Exactly 5 minutes ahead of `serverNow` is accepted, 1 ms more is not.
4. **Ratings:** `review()` accepts ts-fsrs `Grade` (Again 1 … Easy 4); `Manual` or anything else
   throws `InvalidRatingError`. Stored as names (`'Good'`), as decided in Phase 2.
5. **Auto-rating thresholds are strict inequalities:** exactly 8 s (choice) / 15 s (typing) is
   Good, not Hard; exactly 5 s typed is Good, not Easy.
6. **Interval units** (`describeInterval`): minutes under 1 h, hours under 1 day, days under
   30 days, then months (30 days, one decimal) under 365 days, then years (365 days, one decimal).
7. **Learning day:** Vietnam has no daylight saving time, so the boundary is a fixed 21:00 UTC
   (04:00 UTC+7). `learningDayStart` uses that fixed offset instead of a time-zone database.
8. **"Introduced today"** counts distinct cards with a review log in `[dayStart, dayStart + 24h)`
   whose pre-review state was New. A card reviewed again later the same day counts once.
9. **`buildQueue` returns** `{ cards, dueCount, newCount, introducedToday }`, with due cards
   (all non-New cards due by `now`, Learning included) first. New cards come in creation order.
   `counts()` reads `settings.new_cards_per_day` unless a limit is passed.
10. **Migration 0001 was hand-corrected.** drizzle-kit rebuilt `settings` (needed for the CHECK)
    but its `INSERT … SELECT` copied `new_cards_per_day` from the old table, which lacks it. The
    fixed migration was tested upgrading a 0000 database with custom settings (kept, new column
    10, integrity and foreign-key checks clean); a Vitest test covers the same upgrade.
11. **Imports outside `src/lib/server/`:** only `tool/srs-walkthrough.ts`, the developer
    script this phase asks for. No route, component or client code imports `srs/`.
12. `src/lib/server/srs/test-helpers.ts` is test-only (fixtures); nothing in the app imports it.
