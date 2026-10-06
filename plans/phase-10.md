# Phase 10 — Progress, review book, settings and providers

Goal: the gentle motivation layer, a review book with focus sessions, and full settings with provider management. The rules as built are in `docs/architecture.md` Part I §9, Part II §3–§4 and the Phase 10 section. Where the owner's Phase 10 prompt differs from the doc, the prompt wins (the doc was updated).

## Modules

| File | Purpose |
|---|---|
| `server/progress/days.ts` | Learning days as integers (04:00 Asia/Ho_Chi_Minh), Monday-start weeks |
| `server/progress/streak.ts` | `studiedDays`, `computeStreak` (the replay with auto-freeze) |
| `server/progress/calendar.ts` | `weeklyGoal`, `heatBucket` / `heatMap`, `forecast` |
| `server/progress/weakness.ts` | `rankWeakness` (pure) |
| `server/progress/index.ts` | `loadProgress` (the stats page) and `loadToday` (Home's card): gathers the rows |
| `lib/progress/types.ts`, `lib/review/types.ts` | The shapes the pages receive |
| `server/session/focus.ts` | `byHardness`, `byTopicPriority`, `composeFocus` (the `hard` and `topic` focus sessions) |
| `server/db/repositories/review-book.ts` | Cards joined with item, sentence and topic: often wrong, learned (search), one card, focus candidates |
| `server/review-book/index.ts` | `hardList`, `learnedList`, `cardDetail` (history and intervals), `reviewNow`, `setSuspended` |
| `server/settings/learning.ts` | The "Học tập" form: Zod schema mirroring the CHECKs |
| `server/settings/providers.ts` | The provider form (Zod), views with `keySet` only, save / delete / active / single fallback |
| `server/settings/content.ts`, `usage.ts`, `credits.ts`, `backup.ts` | Stock overview, AI usage for 7 days, credits, `VACUUM INTO` backup |
| `server/llm/smoke.ts` | The one-call smoke test, shared by `npm run llm:smoke` and "Kiểm tra kết nối" |
| `server/cron/prefetch-endpoint.ts` | `startBackgroundPrefetch` (the settings button) and `prefetchRunning` |
| `routes/(app)/(tabs)/stats/` | The page, `HeatMap.svelte`, `Forecast.svelte` (hand-rolled SVG) |
| `routes/(app)/(tabs)/review/` | The review book (tabs, search, the detail sheet as `?card=ID`) |
| `routes/(app)/(tabs)/settings/` | Settings sections; `providers/` and `credits/` sub-pages |
| `routes/api/backup/+server.ts` | The download (behind auth: not on the public allowlist) |

### Database (migration 0009)
- **`cards.suspended`** (boolean, default 0), a plain `ADD COLUMN`. Every queue and count filters it: `dueCards`, `newCards`, `newMinedCards`, `counts`, `earliestIntroducedDue`, the forecast (`introducedDue`), and both focus candidate lists. The review book still lists suspended cards ("Đang tạm ẩn"), and their `review_logs` stay.

## Decisions and judgement calls (deviations marked)

### Progress
- **Session time.** A session belongs to the learning day of its `finished_at` (older rows: `ended_at`, then `started_at`). Minutes are `summary_json.studyMs`, the sum of the clamped response times, as on the end screen.
- **Freeze earning** counts every finished session, short ones included; only studied days need 5 items. A freeze is earned after its day is evaluated, so the 5th session of a day cannot cover that same day's gap.
- **No freeze is spent while the streak is 0** (there is nothing to protect); it stays banked.
- **Weeks before the first session** are shown as "not started", not as misses.
- **Heat-map buckets:** 0 = nothing; 1 = under 5 minutes (any study at all); 2 = 5 to under 10; 3 = 10 or more. A cell's filled square grows with the bucket, so the level does not rely on colour. The SVG is `aria-hidden`; a visually hidden table (wrapped in an `sr-only` div: a table ignores `width: 1px` and widened the page) carries the same values. The legend gives the minute ranges.
- **Weakness line.** "{topic}: N lỗi trong 30 ngày, đúng P% câu điền": N counts writing errors + missed drills + Again on the topic's cloze cards (the ranking score). P is the cloze accuracy; the drill result and the per-gap-type accuracy follow on their own lines. Topics with no activity are left out. **Luyện chủ đề này** shows only when the topic has unsuspended introduced cards or drill stock.
- **Totals.** "Words learned" counts lexical cards in Review, suspended ones included (they were learned). "Cards in learning" excludes suspended ones, like Home.

### Focus sessions
- **Shape:** always Nhanh. A focus with a Đọc/Viết shape is a 400. No anchor and no new cards. Unseen feedback still comes first.
- **`hard`:** the 15 hardest of the unsuspended cards that are introduced (or mined, New included). Hardest = most lapses, then the lowest retrievability (0 for a New card), then the oldest card. Due dates are ignored: an early review is scheduled by FSRS from the real elapsed time.
- **`topic`:** the topic's introduced, unsuspended cards. Due ones come first (most overdue first), then the lowest retrievability, up to the budget's item count. Up to 2 drills of that code come from the cache (none when the code has no drill stock).
- **Empty:** a new reason `focus_empty` with its own message.
- **"Hay sai"** uses the same ordering over the cards with a lapse plus every mined error (suspended included, so they can be un-hidden). It is capped at 100 rows; "Đã học" at 200, sorted by due. Search is a case-insensitive `LIKE` (wildcards escaped) over the English sentence, the answer, the Vietnamese sentence and `answer_vi`.
- **"Ôn ngay"** sets `due = now` and also un-hides the card (asking to review a card means wanting it back). A New card stays New: it is still introduced within the daily limit.
- **Interval in the history:** review *i* set the due that log *i + 1* records as its pre-review `due` (the card's current due for the latest review). The interval is that due minus the review time.

### Settings
- **Default budget** accepts only 5, 8 or 10 (the Home chips), although the CHECK allows 1–60.
- **Deviation: no live retention estimate.** The prompt allows omitting it unless cheap. A workload estimate means simulating every card's next intervals at the new retention, which is not cheap and would be misleading for a small collection. The help line explains the trade-off instead.
- **"Tạo thêm bài tập" runs in the background.** A 30-call run takes minutes, longer than a form post should wait. The action checks the daily cap (`LLM_DAILY_CALL_CAP` over the last 24 h) and takes the prefetch lock (the same one as the cron endpoint), then starts the run and returns; the lock is released when the run ends. The button is disabled while a run holds the lock or no provider is active, and the page says why.
- **Providers.**
  - `/settings/providers` with `?add` / `?edit=ID`; a save redirects to `?saved`.
  - Form actions carry the page query (`?edit=ID&/save`), so the form keeps its state without JavaScript too.
  - Delete asks inline.
  - The env-name rule is `^[A-Z][A-Z0-9_]{0,63}$` (the CLI's); the database CHECK still guards writes.
  - `keySet` is `null` for a provider without a key variable, else whether `process.env[name]` is non-blank.
- **Test connection in canned mode** uses the canned fetch but reads keys from the real environment (`providerTestDeps`), so a provider whose variable is unset fails as it would live. The e2e server sets a fake value for the variable its test provider names. Canned mode still forces the `canned` provider active whenever an LLM call is made (as since 9a); "Dùng nhà cung cấp này" is covered by unit tests.
- **AI usage** groups `usageByDay` (calendar days in Asia/Ho_Chi_Minh, as the CLI) by day and purpose, newest first, every day listed.
- **Backup.**
  - `VACUUM INTO` a uniquely named file in the OS temp directory, read into memory, removed in `finally`. A single-user database is small.
  - Served as `silentenglish-YYYY-MM-DD.db`, `cache-control: no-store`.
  - `/api/backup` is not on the allowlist, so no session gives 401.
- **Credits** come from the distinct `license_tag`s of `lexemes` and `sentences` (NGSL CC BY-SA 4.0, Tatoeba CC BY 2.0 FR with a link to tatoeba.org) and the word-list package's own `package.json`, found next to its `words.txt`. Tags the app does not know are listed by name; the learner's own text (`user`) is not a source.

### Housekeeping
- Expired `auth_sessions` are deleted in `createSession` (every successful login) and at the start of `prefetch()` (cron, CLI and the settings button). The summary reports `expiredSessionsDeleted`. The backlog item is closed: once Phase 7 schedules the cron, the sweep is nightly.

### Home
- The "today" card replaces the tagline: the streak, freezes, this week's goal with a bar, the next review ("ngay bây giờ" or "sau 3 giờ"), and the mined errors waiting.
- The shape and budget chips and the start button stay low, in the thumb zone.

### UI and accessibility
- A fourth tab, **Sổ ôn tập** (an open-book icon), sits between Tiến độ and Cài đặt.
- The detail sheet is a `role="dialog"` bottom sheet driven by the URL (`?card=ID`), so it works with links and the back button. Escape or the scrim closes it, and focus moves to its heading.
- Charts: the forecast prints each value above its bar and has a hidden list. The labels are at least 12 px in SVG units (about 13 px on a phone).
- `Button` with `href` now passes `aria-label` to the link. "Luyện chủ đề này" keeps its visible text inside the accessible name.

## Tests
- **Unit:**
  - **Streak:** a table of cases: consecutive days, a freeze covering a gap, a gap without one, two gaps using both freezes, a third gap breaking the streak, the 2-freeze cap, no freeze spent at 0, 03:30 vs 04:30, today not yet studied, <5 items not counted, short sessions earning freezes.
  - **Weekly goal:** across a week boundary (the Monday 03:00 session counts for Sunday).
  - **Heat-map:** the buckets, and the 12-week grid with future days.
  - **Forecast** and the **weakness ordering**.
  - **`loadProgress`:** a suspended card leaves the forecast.
  - **Focus sessions:** `hard` takes the 15 hardest unsuspended cards; `topic` keeps to the code, adds its drills, and finishes normally; `focus_empty`; invalid focus bodies are rejected and a focus with Đọc is a 400.
  - **Suspension:** out of queues, counts, Home and focus, with history kept.
  - **Review book:** ordering, search, detail and intervals, Ôn ngay, Tạm ẩn / Bỏ ẩn.
  - **Settings:** every bound (just inside and just outside), and changes applied to the next composition.
  - **Providers:**
    - CRUD, name taken, active, a single fallback;
    - lowercase, key-shaped and digit-first env names rejected; Anthropic without a key rejected; a stray key field is never read;
    - `keySet` never carries the value; a failed test never carries the key;
    - test connection in canned mode, with no fallback on a missing key.
  - **Content, usage and credits.**
  - **Backup:** a valid SQLite file with `cards`, the temp directory empty afterwards, `/api/backup` needing a session.
  - **Background prefetch:** lock, cap, failure.
  - **Expired-session cleanup** on login and in prefetch.
- **e2e:** a sixth preview server (`progress`, port 4178), seeded like the session server, plus a history (3 studied days, 4 lapsed preposition cards) and a fake value for `E2E_FAKE_PROVIDER_KEY`.
  - Stats render the history.
  - "Luyện chủ đề này" starts a PRE-only session; a malformed focus gets a 400.
  - Review book: search, detail, Tạm ẩn, then the card is absent from both a hard focus session and a Nhanh session.
  - New cards per day at 0, then 50, change the next session's new cards.
  - Add a provider: a key-shaped name is refused, then the variable shows as set, the canned test connection works and the key is nowhere in the page; then set as fallback.
  - Backup download (SQLite header, `cards`), and 401 without a login.
  - Home's today card.
- **Screenshots:** stats (full page), the review book (both tabs and the detail sheet), each settings section, the providers list and form, credits, and Home's today card, light and dark. The tool seeds a 9-day history first.
