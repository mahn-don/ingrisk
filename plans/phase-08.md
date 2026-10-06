# Phase 8 — Placement test

Goal: a retakeable, resumable placement test in three parts. It covers a yes/no vocabulary
staircase, adaptive cloze and an optional writing sample. Results are reported on CEFR, VSTEP,
IELTS and TOEIC as estimates. The algorithm as built is in `docs/architecture.md` Part I §7. The
owner's Phase 8 prompt refines the doc's Phase 8 section, and where they differ the prompt wins.

**Build order changed:** 8 → 9 → 10 → 7 → 11 (deploy after the features); Phase 9 was later split into 9a and 9b.

## Modules

| File | Purpose |
|---|---|
| `placement/staircase.ts` | Part A, pure: block moves, the staircase (clamping, reversals, stop), the false-alarm-corrected score |
| `placement/elo.ts` | Part B, pure: P, the K schedule (1.0 → 0.3), the θ update, the next band |
| `placement/combine.ts`, `scales.ts` | ability_band, CEFR (with the C1 rule), and the approximate VSTEP/IELTS/TOEIC table |
| `placement/engine.ts` | The flow: start/resume/restart, one item at a time, server-side checks, Part C submit with a 30 s grading window |
| `placement/results.ts` | The result row, refining it when the writing is graded, the profile update, the result view |
| `placement/content.ts` | Part A word lists (from the lexemes) and the pseudo-words; cached per process |
| `placement/app.ts`, `http.ts` | Production wiring (app db, content, live or canned grading, background grading on Home); request parsing for the routes |
| `grading/queued.ts` | `gradeQueuedWritings({ maxCalls })`: prefetch runs it first, and Home runs it in the background |
| `generation/app-llm.ts` | `appLlmDeps()`: the real providers, or canned responses with `LLM_CANNED=1`, which is refused in production |
| `src/lib/placement.ts` | Types and the word counter shared by server and client |
| `src/lib/format.ts` | `fill()` for `{placeholders}` in `vi.ts`, `formatDate()` (Vietnam time) |
| `routes/api/placement/{start,answer,writing,result/[id]}` | Thin JSON endpoints (all behind the session check) |
| `routes/(app)/placement`, `placement/result/[id]` | The full-screen test page and the result page |
| `tool/seed-test-db.ts`, `tool/lib/test-content.ts` | `npm run test:seed`: the e2e and screenshot database |

Database: migration `0006_placement`.
- **New table `placement_attempts`.** At most one row is `in_progress`, enforced by a partial unique index.
- **`placement_results` gains** `vocab_band`, `cloze_theta`, `ability_band`, `writing_submission_id` and `reliability_flags`. drizzle-kit dropped the `ON DELETE SET NULL` from the added foreign key, so it was hand-edited back into the migration.
- **`user_profile` gains** `placement_skipped_at`.

## API

All four endpoints are under `/api/`, so the hooks chokepoint answers 401 without a session (e2e test). Bodies are validated with Zod: 400 `{error:'invalid'}`.

- **`POST /api/placement/start {restart?}`** resumes the attempt in progress, or starts one. `restart: true` abandons the old attempt first.
- **`POST /api/placement/answer {attemptId, itemRef, answer, responseMs}`**
  - Only the item served last is accepted: any other ref gets 409 `stale`.
  - Repeating the last answered ref returns the current state unchanged (idempotent). A second, different answer to it is ignored.
  - A finished attempt gets 409 `finished`.
  - Part A answers are booleans; Part B answers are option indexes 0–3, checked on the server.
  - `responseMs` is clamped to 0–10 min. The server also logs its own `shownAt` and `answeredAt`.
- **`POST /api/placement/writing {attemptId, text} | {attemptId, skip: true}`** returns `{resultId}`. A repeated submit to a completed attempt returns the same `resultId`. The spec's `{skip: true}` also carries the `attemptId`.
- **`GET /api/placement/result/:id`** returns the result view, including the previous result.

## Decisions and judgement calls

### Part A
- **Excluded words.** The ~150 function words of the cloze stoplist are excluded, beyond the spec's filters, because everyone marks "the" or "because" as known, which says nothing about band 1. Blocklisted words are excluded too. Real words per band after filtering: 227 / 325 / 333 / 346 / 342 / 350 / 348 / 343.
- **Clamping.** A move past band 1 or 8 counts as staying. It is neither a move nor a reversal, so a learner who knows everything walks up to band 8 and stays there for the rest of the 7 blocks.
- **f = 1.** When every pseudo-word was marked known, the corrected rate is 0 for every band, so vocab_band is 1 and the result is flagged.
- **One word per request.** Each word is one request, about 40 in all; that is cheap and keeps the server authoritative.

### Part B
- **Choosing items.** The order of preference is the nearest band to `round(θ)`, then the wanted gap type, then a seeded order. When the wanted type is missing, it takes another grammar type before falling back to lexical (or the reverse).
- **"The needed bands"** means vocab_band ± 2 (the 30-item check).
- **Theta can drift.** θ can wander past those bands; items then come from the nearest band that has any.
- **No feedback during the test.** The tapped option shows as selected while the request is in flight.

### Part C
- **The attempt completes on submit,** with the writing `queued`, before grading starts. A double submit or a closed tab during the 30 s wait therefore cannot create a second result.
- **Late grades.** A grade that arrives after the timeout is still applied. `applyWritingGrade` only acts on a `queued` submission, so it never applies twice.
- **Grading failures** leave the writing queued; there is no failure counter. `gradeQueuedWritings` stops at its first LLM failure, so a provider that is down is not hammered. The run on Home is throttled: at most one every 10 minutes, at most 3 calls, and only when something is queued. It uses the active provider with fallback.
- **Grading level.** A placement writing is graded at the attempt's estimated band. Any other queued writing uses `known_band_ceiling`.
- **The writing's CEFR changes the overall estimate only through the C1 rule,** so a weak sample never lowers it. It is stored as a sub-score and shown as "Bài viết: trình độ X".
- **Phase 9 overlap.** Placement writings are ordinary `writing_submissions` rows with no session. Phase 9's "unseen feedback at session start" will also find them, which seems useful.

### Results and the profile
- `theta` is the unrounded ability `0.4·vocab + 0.6·cloze_theta`, or vocab_band when Part B was skipped.
- The profile holds one number per scale, so `user_profile` stores the lower end of the IELTS and TOEIC ranges.
- `vocab_theta` is vocab_band, `grammar_theta` is cloze_theta, and `writing_theta` is the writing's CEFR rank (A1 = 1 … C2 = 6).
- `reading_theta` is not set, because the test has no reading part.
- Only the latest result updates the profile. Refining an older result's writing leaves the profile alone.

### UI
- **Intros.** An intro screen shows whenever a part has no answers yet. Resuming mid-part goes straight to the item.
- **Starting.** `/placement` without an attempt shows a start screen. Settings links to `/placement?restart`, which shows the start screen even with an attempt in progress; starting there abandons that attempt.
- **Home.** The onboarding card shows until a result exists or the learner chose "Bỏ qua, bắt đầu từ cơ bản" (`placement_skipped_at`, ceiling 1). While an attempt is in progress, Home shows "Tiếp tục bài kiểm tra" instead. After a result, Home shows the estimated level.
- **Exit.** The exit opens an in-page `alertdialog` (never `confirm()`); "Thoát" goes Home and leaves the attempt resumable.

### Canned LLM
- **`LLM_CANNED=1`** makes `appLlmDeps()` answer with `cannedFetch`. It also makes a keyless "canned" provider row active in that database, which is always a test one.
- **Production.** `startServer()` throws when the flag is set with `NODE_ENV=production`. The e2e placement server sets `NODE_ENV=test`, because `vite preview` would default it to production.

### Tests
- **E2E server.** A fourth preview server (port 4176) gets a database seeded by `npm run test:seed`: the real content plus a canned cloze pool of 40 per band, about 15 s.
- **Screenshots** seed their database the same way and run the placement once per theme. The dark run is a retake, so its result page shows the comparison.

## Approximate scales (`placement/scales.ts`)

| CEFR | VSTEP | IELTS | TOEIC L&R |
|---|---|---|---|
| A1 | 1 | — | — |
| A2 | 2 | 3.0–3.5 | 225–545 |
| B1 | 3 | 4.0–5.0 | 550–780 |
| B2 | 4 | 5.5–6.5 | 785–940 |
| C1 | 5 | 7.0–8.0 | 945+ |

These are rough public alignments, not official conversions. The app tests only reading and writing,
and the result page says that this is not a certified score.

## Check

- `npm run verify`, `npm run test:e2e` (6 placement tests) and `npm run screenshots` (the placement intro, a Part A item, a Part B item, Part C and the result, in light and dark).
- The doc's manual check is still owed with a real provider: take the test, cut the network during Part C, confirm it finishes "queued", then restore and see the estimate refined.
