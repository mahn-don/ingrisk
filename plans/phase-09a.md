# Phase 9a — Session engine and the cloze review loop

Goal: the session engine and the daily cloze review loop. After 9a the app is usable every day
with the **Nhanh** shape. Phase 9b adds the anchors (reading, writing, translation, drills),
Đọc/Viết rotation, unseen feedback and error mining (`docs/architecture.md`, Phase 9). The rules
as built are in Part I §8. Where the owner's 9a prompt differs from the doc, the prompt wins.

## Modules

| File | Purpose |
|---|---|
| `server/session/compose.ts` | Pure rules (`itemCount`, `promptMode`, `interleave`, `arrange`, `capStockNames`, `pickNewItems`, `newItemsWanted`) and `composeSession()`, which reads the queue and creates the new cards |
| `server/session/engine.ts` | `startSession` (abandons the session in progress, stores the served items) and `finishSession` (validates, then applies everything in one transaction; idempotent) |
| `server/session/counts.ts` | `homeCounts`: due cards, new cards available today (uncarded cloze items included), and cards in learning |
| `server/session/http.ts` | Zod bodies and error mapping for `POST /api/session/start` and `/finish` |
| `lib/session/check.ts` | Answer checking (normalization, the one-typo rule, the hint), with no server imports |
| `lib/session/rating.ts`, `interval.ts` | `ratingFromOutcome` and `describeInterval`, moved here from `srs/` (which re-exports them) so the page shows the same rating and interval as the server |
| `lib/session/types.ts`, `client-id.ts` | API shapes; the client's random session id |
| `routes/(app)/session` | The full-screen session: items, the feedback panel, the exit sheet and the end screen |
| `routes/(app)/(tabs)/+page.*` | Home: "Bắt đầu học" is enabled, with 5 / 8 / 10-minute chips |

Database: migration `0007_session_engine` adds four columns to `sessions`:
- `status`, with a CHECK and a partial unique index allowing one `in_progress` session;
- `served_json`;
- `finished_at`;
- `summary_json`.

Repositories gain:
- **`sessionsRepo`:** `start`, `byId`, `byClientSessionId`, `inProgress`, `abandonInProgress`, `markFinished`, `finishedSince`.
- **`cardsRepo`:** `byIds`, `earliestIntroducedDue`, `lexemeIdsWithCards`, `setPromptMode`.
- **`clozeItemsRepo`:** `forSession`, `newCardCandidates`, `countNewCardCandidates`, `hasValidated`.

## Decisions and judgement calls (deviations marked)

### Data and the migration
- **The migration is hand-written** as `ADD COLUMN`s, the CHECK included. To add the CHECK, drizzle-kit rebuilt `sessions`. Inside the migration transaction `PRAGMA foreign_keys=OFF` does nothing, so the `DROP TABLE` would have nulled `writing_submissions.session_id` through its ON DELETE SET NULL. Its `INSERT … SELECT` also copied columns that did not exist yet. A test upgrades a 0006 database with a linked submission and checks the link survives. Old rows read as `finished`.
- **Deviation: `summary_json` column.** A repeated finish must return *the stored summary*, and "today's study minutes" sums earlier sessions, so the summary is stored with the session.
- **Deviation: `client_session_id` at start.** The column is NOT NULL and unique, and the start request carries no client id. Start therefore stores a placeholder (`pending:<uuid>`), and finish replaces it with the client's id. A finish whose client id belongs to another session gets 409. The client makes its id with `crypto.getRandomValues`, because `crypto.randomUUID` exists only in secure contexts and the app runs over HTTP.
- **Abandoning.** Starting abandons the session in progress; "Bỏ phiên này" just leaves, and the next start abandons it. Reloading `/session` starts a new session.

### Composition
- **Taking new cards in the interleave.**
  - The queue gives up to *count* due cards and the day's remaining new-card allowance.
  - The session is the first *count* items of "3 reviews, 1 new". With many due cards about a quarter of the items are new; with none, all are.
  - Only as many new cards as fit are created. Cards left New by an abandoned session are reused first, so restarting creates no extra cards.
- **New-card candidates.**
  - Validated items with no card, `level_band ≤ known_band_ceiling + 1`, never from blocked sentences.
  - Lowest band first (frequency order), in a seeded order per learning day.
  - Lexical items whose lexeme has no card come first, without reusing a sentence or a lexeme within a session.
  - Types alternate lexical / grammar, the grammar rotating article → preposition → verb form; when a type runs out, the others fill in.
  - A candidate that collides with the cards unique index (the same lexeme or grammar topic in the same sentence as an existing card) is skipped.
- **Stock-name cap (30%).**
  - Due cards from stock-name sentences beyond the cap wait for a later session; new candidates from them are skipped.
  - When a session comes out short, the 30% is re-applied to its final length. That can cascade: 3 stock items out of 7 is 43%, so items drop until the share holds.
- **Ordering repair.** It is greedy: at each position it takes the first planned item that breaks neither rule. If none fits, the sentence rule wins, and if nothing fits at all, the planned order. The repair may move a new card by a position.
- **Mode, as the prompt says.**
  - `choice` for New/Learning or stability < 7 days, `typing` after; articles always `choice`.
  - A Relearning card with stability ≥ 7 would be typed.
  - The chosen mode is also saved to `cards.prompt_mode`.
- **Retrievability** comes from ts-fsrs `get_retrievability`.
- **Empty session.**
  - Nothing is stored; the response's `reason` is `no_content` (no due cards and no validated items) or `all_done` (content exists, but nothing is due and no new card is allowed).
  - The page explains each reason in Vietnamese.
- **Item fields.** Items carry a few more fields than the prompt lists: `isNew`, `before`/`after` (to draw the gap) and `filled` (the "—" answer removes the gap).

### Finish
- **Offsets.** An offset must be ≥ 0 and ≤ (now − started_at) + 5 s. Duplicate cards are already rejected, so each card has one result. "Non-decreasing per card" is therefore checked across the results in submission order.
- **Validation.** The result's mode must match the served mode. `responseMs` is clamped to 0–10 min.
- **Deviation: the server does not re-check answers.** The result shape carries `correct`, not the typed text, so the server trusts `correct` (the prompt calls cheating irrelevant). The check lives in `src/lib/session/check.ts`, with no server imports, so either side can use it; today only the page does.
- **Rejected reviews.** A review that ts-fsrs refuses (e.g. a time before the card's last review) rolls the whole finish back: 409 `review_rejected`.
- **Summary.**
  - **Words strengthened** counts reviewed cards whose stability rose, *excluding first reviews*: a new card goes from 0 to something even when the answer is wrong.
  - **The next due time** is the earliest due date among introduced cards, because a New card's `due` is its creation time.
  - **Today's minutes** is the sum of `responseMs` over the finished sessions of this learning day (from 04:00 ICT), rounded.

### UI
- **Starting.** The page POSTs `start` once on mount and the session runs in memory. Offsets count from the start response's arrival, with `performance.now()`, never the device clock.
- **Feedback panel.** It slides up, with no motion under reduced motion. It shows:
  - correct or wrong (icon and text), and for a typo the right spelling;
  - the sentence with the answer highlighted;
  - the translation and `answerVi`;
  - "Ôn lại sau: …" for the auto-rating, or for the override chosen under the collapsed "Chấm lại";
  - a big "Tiếp".
- **Typing.** The input is focused automatically. "Gợi ý" shows the first letter in the gap and sets `hintUsed`.
- **Exit sheet.** An in-page `alertdialog` with "Kết thúc sớm và lưu" (finishes with the answered items, including one answered but not yet moved past), "Tiếp tục học" and "Bỏ phiên này".
- **Home.**
  - The new-card count includes the cloze items a session would turn into cards. Before, it counted only existing New cards, which are now created at composition.
  - "Bắt đầu học" is always enabled; an empty session explains itself.
  - The budget chips are 5 / 8 / 10, plus the settings default when it is another value.

### Tests
- **E2E server.** A fifth preview server (port 4177, seeded with `npm run test:seed`, no LLM).
- **E2E helpers.** `test/e2e/support.ts` inserts due cards with plain SQL, including one strong lexical card that is served in typing mode, sets `new_cards_per_day`, and counts today's introductions.
- **Screenshots** add due cards the same way, through the repositories, before each theme's session.

## Check

`npm run verify`; `npm run test:e2e` (the session e2e covers a full session with one start and one
finish, ending early, the second-session new-card limit, and the empty state on the content-less
main server); `npm run screenshots` (a choice item, a typing item, the correct and incorrect
panels, the exit sheet and the end screen, in light and dark).
