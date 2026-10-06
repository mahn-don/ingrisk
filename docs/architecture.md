# SilentEnglish — Architecture & Build Roadmap

**Revision 3 (web + VPS).** Supersedes the earlier Flutter/mobile design. The learning methodology carries over unchanged; the technical design and roadmap are rewritten for a web app on a VPS.

**What it is:** a personal, single-user, non-commercial web app that teaches English **reading, writing, vocabulary and grammar** to a Vietnamese speaker. No audio of any kind, no microphone. Sessions fit a 5–10 minute gap and are used in a phone's browser, always online. The UI is entirely in Vietnamese; code, comments, docs and commit messages are in English.

**How to use this document (for Claude Code):** this is the single source of truth for the project. Part I is the learning design, Part II the technical architecture, Part III the phased build plan with the prompt for each phase. When working on a phase, read Part II and that phase's section in Part III; consult Part I when the phase references it. Do not build anything outside the current phase's scope.

---

## Part 0 — What changed from the mobile design

| | Mobile (Flutter, superseded) | Web + VPS (current) |
|---|---|---|
| Runs on | The user's phone | A VPS in Singapore |
| API keys | On the device, not truly hideable | In `.env` on the server; the client never sees them |
| Offline | Fully offline | No offline mode: browser only, always online |
| Exercise prefetch | Job runs when on Wi-Fi | Cron at 03:00, content always ready |
| FSRS | Hand-ported | `ts-fsrs` library |
| Dev loop | Rebuild and reinstall on device | Edit, refresh the browser |
| Claude Code can test it itself | No (needs an emulator) | Yes (curl, Playwright) |
| Cost | Free | ~US$5–6/month |

**New risk:** the app is on the public internet. Without a login gate, anyone who finds the domain can use it, which means spending the owner's LLM credits. **Authentication is mandatory**, and it lands in Phase 6, before the first deploy.

**What is lost:** offline use. There is **no offline mode** and no installable app (PWA): the app is used in a mobile browser and assumes a connection. A session still starts with one request that returns its whole content and ends with one request that submits the results, so a session is cheap on the network.

### Decisions

- **Browser-only, always online, HTTP on the server's IP** (Phase 6 amendment, the owner's explicit decision). The app runs at `http://<server IP>:3000` with `COOKIE_SECURE=false`; the PWA (manifest, service worker, icons) and offline resilience are dropped. HTTPS can be added later through deployment configuration only (e.g. Tailscale or a Cloudflare Tunnel in front, then `ORIGIN=https://…` and `COOKIE_SECURE=true`), with no code changes.

---

## Part I — Learning design

### 1. Scope

**In scope:** sentence-context cloze, vocabulary with Vietnamese glosses and collocations, graded reading passages with comprehension questions, VI↔EN translation, error-correction drills targeting Vietnamese L1 interference, short guided writing with AI feedback, and spaced repetition over all of it.

**Non-goals:** audio, pronunciation, multiple users, accounts beyond the single owner, monetization, app-store distribution.

### 2. Spaced repetition — FSRS-6 via `ts-fsrs`

| System | Verdict |
|---|---|
| Leitner boxes | Too coarse |
| SM-2 | Works, but suffers "ease hell" |
| **FSRS-6** | **Use this.** Models forgetting directly; roughly 20–30% fewer reviews than SM-2 for the same retention |

**Use the `ts-fsrs` library. Do not reimplement the algorithm.**

Defaults: desired retention 0.9 (user-adjustable 0.70–0.97), learning steps 1m and 10m, relearning step 10m, maximum interval 36,500 days, fuzz on. Card states: New → Learning → Review, with Relearning after a lapse.

**Version trap:** much material online still describes FSRS-4.5/5, which has 19 parameters and a *fixed* `DECAY = −0.5`, `FACTOR = 19/81`. FSRS-6 has 21 parameters with a trainable decay `−w[20]`. Trust the library's release notes over blog posts.

**Learning day:** a day for spaced repetition starts at **04:00 Asia/Ho_Chi_Minh** (UTC+7, no daylight saving), not at midnight, so late-night study (after midnight, before 4 a.m.) counts toward the evening before. The daily new-card limit (`new_cards_per_day`, default 10) is counted per learning day: a card counts as introduced on the day of its first review.

**Auto-rating:** sessions are short, so the app infers the FSRS rating from the answer instead of asking for it (the UI may still let the learner override):

| Outcome | Rating |
|---|---|
| Wrong | Again |
| Correct, but with a hint, or slower than 8 s (multiple choice) / 15 s (typing) | Hard |
| Correct, typed, faster than 5 s, no hint | Easy |
| Any other correct answer (including every correct multiple-choice answer) | Good |

Multiple choice never yields Easy: recognising an answer is easier than recalling it.

**Review-log discipline:** persist every review (card id, timestamp, rating, elapsed days, stability and difficulty before and after). Without this log the parameters can never be re-optimized on the user's own history.

### 3. Principles to encode

- **Retrieval practice:** every item requires recall or recognition, never passive reading.
- **Interleaving:** mix vocabulary, grammar and reading within a session instead of blocking by type.
- **Desirable difficulty:** multiple choice while a card is weak, free typing once its stability is high. Promote per card, not globally.
- **Comprehensible input (i+1):** generated passages are capped at the learner's known vocabulary band plus a small margin.

### 4. Vocabulary

- **Ordering:** the NGSL (2,801 headwords, over 92% coverage of general English text) defines frequency bands.
- **Coverage thresholds:** about 4,000–5,000 word families give 95% coverage (minimal comprehension); 8,000–9,000 give 98% (unassisted reading). These are the long-run targets.
- **Depth, not just breadth:** store collocations and chunks per lexeme, not bare word–gloss pairs.
- **Glossing:** Vietnamese gloss by default for speed; English definition revealed on tap, becoming primary as the learner's level rises.

### 5. Grammar and written corrective feedback

Research supports explicit focus-on-form. For lower-proficiency learners, **direct correction plus a short metalinguistic explanation** works better than indirect flagging, because they often cannot self-correct. Stronger learners benefit from indirect prompts. Offer both as a setting, defaulting to direct + metalinguistic.

Keep feedback **short and ranked**: the corrected text plus the top 2–3 errors, each with a one-line explanation in Vietnamese. Long AI feedback adds cognitive load that cancels its benefit.

### 6. Vietnamese L1 interference taxonomy

These predictable, high-frequency error classes drive placement diagnostics, drill generation and error tagging. The LLM must return one of these codes for every error it reports.

| Code | Area | Why it happens | Typical error |
|---|---|---|---|
| `ART` | Articles | Vietnamese has no article system | "a interesting movie" |
| `TNS` | Tense / aspect | Time is marked by particles, not inflection | "We live here since 1975" |
| `PLU` | Plural morphology | No morphological plural | "two childs" |
| `SVA` | Subject–verb agreement | No verb inflection | "She go to work" |
| `COP` | Missing copula | Vietnamese adjectives act as verbs | "He very tired" |
| `PRE` | Prepositions | No one-to-one mapping | "depend of" |
| `COL` | Collocation | Largest single error class in Vietnamese learner writing (~33%) | "do a mistake" |
| `WFM` | Word form | ~18% of errors | "He is success" |
| `WOR` | Word order | Vietnamese modifiers follow the head | "the book red" |
| `OTH` | Other | — | — |

### 7. Placement test (~10 minutes, retakeable)

Report the estimate on four scales, since Vietnamese learners anchor on different ones: **CEFR A1–C2**, **VSTEP levels 1–6** (Vietnam's national framework, mapped to CEFR), and rough **IELTS** and **TOEIC** equivalents. Always present these as estimates, never as certifications.

Pseudo-words are **not** generated by the LLM at runtime: LLMs produce either rare real words (which silently penalize strong learners) or obviously non-English strings (free points). Ship a fixed, human-checked list of ~120 pseudo-words that follow English phonotactics (e.g. `plurthy`, `dispone`, `fantule`).

**As built (Phase 8).** The server holds the whole attempt and serves one item at a time; the code is in `src/lib/server/placement/` (pure scoring modules, a thin engine) and `plans/phase-08.md` has the details.

**Part A — yes/no vocabulary staircase (about 40 items).**
- **Words.** Real words come from NGSL band *b*: no supplementary words, only lowercase letters (no proper nouns), at least 3 letters, no function words, nothing blocklisted. Pseudo-words come from `pseudowords.json`. The buttons are **Biết** / **Không biết**, and the instructions warn that some words are not real.
- **Blocks.** Each block is 6 words: 4 real and 2 pseudo, shuffled. The test starts at band 2 and never repeats a word within an attempt.
- **Moving between bands.** After each block, move up if the hit rate is ≥ 0.75 with at most 1 false alarm. Move down if the hit rate is < 0.5. Otherwise stay. A move past band 1 or 8 counts as staying.
- **Stopping.** The part stops after 7 blocks or 3 reversals. A reversal is a move opposite to the last nonzero move.
- **Scoring.**
  - *h_b* is the hit rate at each visited band; *f* is the overall false-alarm rate.
  - The corrected rate is `(h_b − f)/(1 − f)`, clamped to 0–1 (0 when f = 1).
  - **vocab_band** is the highest visited band with a corrected rate ≥ 0.7 (minimum 1).
  - If f > 0.4, the result is flagged ("bạn chọn Biết cho nhiều từ không có thật") and vocab_band is capped at 2.

**Part B — adaptive cloze (12 items).**
- **Items.** Validated `cloze_items` (single sentences, not passages), alternating lexical and grammar gaps; the grammar items rotate article → preposition → verb form.
- **Elo.**
  - θ starts at vocab_band, and an item's difficulty d is its `level_band`.
  - `P = 1/(1+e^−(θ−d))`, then `θ += K(correct − P)`.
  - K falls linearly from 1.0 to 0.3 over the 12 items.
- **Choosing items.** The next band is `round(θ)` clamped to 1–8. The nearest band wins, then the wanted gap type; no item repeats. Answers are option indexes, checked on the server, and the learner gets no feedback during the test.
- **Fallback.** If fewer than 30 validated items exist within vocab_band ± 2, Part B is skipped and the learner sees "chưa đủ câu hỏi".

**Part C — writing (skippable).**
- **Prompt and submit.** A prompt from `writing-prompts.json` for the estimated band, with a live word counter showing the target range. On submit the text is always stored in `writing_submissions` (no session, `queued`) and the attempt is completed. Grading then gets up to 30 s.
- **When grading succeeds** (in time or later), the writing's CEFR becomes a sub-score and the result is recomputed.
- **When it fails** (an error, a timeout or no provider), the result says the writing will be graded later. `gradeQueuedWritings` (prefetch, and a throttled background run on Home) grades it afterwards and refines the result and the profile.

**Combining the parts.**
- `ability_band = round(0.4·vocab_band + 0.6·cloze_theta)` if Part B ran; otherwise `vocab_band`.
- `known_band_ceiling = vocab_band`.
- CEFR from the band: 1 → A1, 2–3 → A2, 4–5 → B1, 6–8 → B2. **C1** only when the graded writing is ≥ C1 and ability_band ≥ 7. The writing never lowers the estimate.
- The other scales (approximate public alignments; the app tests reading and writing only):

| CEFR | VSTEP | IELTS | TOEIC L&R |
|---|---|---|---|
| A1 | 1 | — | — |
| A2 | 2 | 3.0–3.5 | 225–545 |
| B1 | 3 | 4.0–5.0 | 550–780 |
| B2 | 4 | 5.5–6.5 | 785–940 |
| C1 | 5 | 7.0–8.0 | 945+ |

**Stored.** Every result keeps:
- the full item log;
- vocab_band, cloze_theta, ability_band and the sub-scores (vocabulary, lexical, grammar per type, writing);
- the writing status and any reliability flags.

Retakes add rows and never overwrite. The profile follows the latest result, and the result page compares it with the previous one.

### 8. Session structure — time-budget driven

Every session: warm-up (3–4 due cloze items) → review block (due cards, rated Again/Hard/Good/Easy through FSRS) → **at most one** anchor segment:

| Shape (UI name) | Length | Anchor |
|---|---|---|
| Quick (**Nhanh**) | ~5 min | None, review only (~15 items) |
| Read (**Đọc**) | ~8 min | One graded passage + 2 comprehension questions |
| Write (**Viết**) | ~8 min | One short writing task or a VI→EN translation |

Read and Write alternate across days. If a graded writing submission has unseen feedback, show it at the start of the session and prefer Read that day.

**Composition as built (Phases 9a and 9b; `src/lib/server/session/`).**
- **Shape** (`src/lib/session/shape.ts`), in priority order:
  1. A 5-minute budget is Nhanh.
  2. Otherwise Đọc and Viết alternate after the most recent finished non-quick session (Đọc first).
  3. Unseen graded feedback prefers Đọc.
  4. Fallbacks: no cached passage within one band of `known_band_ceiling` → Viết; no LLM provider → Đọc; neither → Nhanh.

  Home shows today's shape ("Hôm nay: Đọc"); it follows the budget chips, and the learner may switch to another available shape. The start request carries the shape, and an unavailable one is refused.
- **Size.** Review items = `round(minutes × 60 / 20)`, about 20 s per item, capped at 30. The minutes are the budget for Nhanh, and the budget minus 3 (the anchor) for Đọc and Viết. The budget is 5, 8 or 10 minutes, chosen on Home; the default comes from settings.
- **Reviews.** Due cloze cards from the Phase 3 queue, up to the item count.
- **New cards.**
  - **Allowance.** At most `new_cards_per_day` per learning day, minus the cards already introduced that day. Cards left New by an abandoned session are served first.
  - **Making new cards.** Further new cards come from validated `cloze_items` without a card, at `level_band ≤ known_band_ceiling + 1`, lowest band first. About half are lexical items (lexemes without a card first); articles, prepositions and verb forms share the rest. The cards are created when the session is composed.
- **Order.**
  1. The 3 due cards with the highest retrievability open the session (an easy start).
  2. Then the other due cards, most overdue first.
  3. One new card after every 3 reviews.
  4. The order is then repaired so that no two items from one sentence are adjacent and no gap type appears more than 3 times in a row.
- **Mined errors** (cards on the learner's own mistakes) are new cards outside the daily limit: they come right after the opening and are tagged "Lỗi của bạn".
- **Stock names.** At most 30% of items come from sentences with stock names (Tom, Mary).
- **Mode.**
  - `choice` while the card is New or Learning, or its stability is under 7 days; `typing` after that, decided per card.
  - **Meaning cue:** typing items always show the Vietnamese sentence above the gap (recall needs context); choice items keep it behind "Xem nghĩa câu", which counts as a hint (Hard).
  - Article gaps are always `choice`.
  - Typing accepts one typo (Levenshtein distance 1) in answers of 5+ letters, but rates it Hard and shows the spelling. The hint reveals the first letter and also gives Hard.
- **Rating.** Auto-rating as in §2. The feedback panel shows the next interval for that rating and lets the learner change it (Quên / Khó / Được / Dễ).
- **One request in, one request out.**
  - **Start** returns every item, with the answer and the four rating intervals, and stores the served items.
  - **Finish** applies all reviews and records the session in one transaction. Each review time is the session start plus the answer's offset, never the device clock. A repeated finish with the same client id returns the stored summary.
- **Order of a session.** Unseen graded feedback first (placement and late-graded session writing; each marked seen when dismissed), then the cards, then 2 error drills (Đọc and Viết only), then the anchor.
- **Error drills** (one-off practice from the 5b stock, not cards): the topic codes come from the weakness profile, i.e. the most errors over 30 days in graded writing, lapses on grammar cloze cards and missed drills; with no errors, random codes. The learner edits the prefilled sentence; it is right when it normalizes to the correction (final punctuation ignored). Results go to `drill_results`.
- **Đọc anchor.** One cached passage nearest `known_band_ceiling` (within one band), marked served. Glossary words are underlined and show their Vietnamese meaning; "Thêm vào ôn tập" creates a New card when a validated lexical cloze item exists for the word's lexeme (it is introduced within the daily limit). Then the 2 questions, each with feedback and its explanation.
- **Viết anchor.** Writing and translation alternate across Viết sessions. Writing: a prompt for the band not used in the last 14 days. Translation: a Tatoeba sentence at or below the band, without stock names, never served before; the feedback says plainly whether the meaning came across and shows the reference as one valid answer. The submission is stored (queued) and graded for up to 30 s; in time, the feedback is shown inline (corrected text with the changes highlighted in direct mode; up to 3 errors with their code's Vietnamese name; the task note when off topic); otherwise the session goes on and the feedback comes at the next start.
- **Error mining** (`session/mining.ts`). Every graded error (at most 3 per submission) whose correction is found exactly once in the corrected text, and is at most 4 tokens long, becomes a `user_error` cloze item on that corrected sentence (its own `sentences` row, Vietnamese from the prompt or source) with a New card made at once. Options: the learner's own wrong form plus distractors from the 5a tables (ART, PRE, SVA, TNS, PLU); other codes, or fewer than 3 distractors, are typing-only. An identical sentence and span is never mined twice.
- **End screen.** Items answered, accuracy, words strengthened (reviewed cards whose stability rose; first reviews excluded), new cards, the next review time and today's study minutes; plus the anchor's outcome (reading score, or writing graded / later / skipped), drills right, and "Lỗi mới được thêm vào ôn tập: N". Streaks and the weekly goal live on the stats page and Home's "today" card (Phase 10).

**Error mining:** every error the LLM identifies becomes a candidate card tagged with its taxonomy code, so the review pool gradually targets the learner's real weaknesses.

**Later modes** (behind settings, not in v1): pure cloze sprint; text-chat tutor with inline correction; dedicated error-correction drills.

### 9. Motivation — deliberately gentle

Rigid daily streaks cause anxiety and abandonment after one missed day. Duolingo's own analysis found that separating streaks from daily goals and adding freezes increased learners on 7+ day streaks by over 40%.

**Build:** a flexible streak with auto-freeze (2 banked, one earned per 5 sessions, consumed automatically on a missed day); a **weekly** goal (default 5 of 7 days) as the headline metric; a calendar heat-map; a cumulative "words strengthened" count.
**Do not build:** hearts or lives, leagues, leaderboards, loss-framed messaging, daily-only streaks.

**As built (Phase 10, `src/lib/server/progress/`).** Everything is recomputed from the history on each read; no streak state is stored.
- **Studied day:** a learning day (from 04:00 Asia/Ho_Chi_Minh) with at least one finished session in which at least 5 items were answered.
- **Streak:** the days are replayed from the first session. A studied day adds one. A missed day spends a banked freeze when the streak is running, else resets it to 0. Today, not yet studied, never breaks it. Every 5th finished session (of any size) earns a freeze after that day is evaluated; at most 2 are banked. The stats page shows the number with "ngày liên tiếp" (no flame), the freezes with a one-line explanation, and the days a freeze covered.
- **Weekly goal:** `settings.weekly_goal_days` (default 5) studied days per Monday-start week of learning days; this week's progress plus hit or miss for each of the 8 weeks before (weeks before the first session are "not started", not misses).
- **Heat-map:** the last 12 Monday-start weeks; minutes are the sum of the answers' response times (`summary_json.studyMs`), in 4 buckets (none, under 5, 5–9, 10+). Cells grow in size as well as colour, and a hidden table carries the same data for screen readers.
- **Forecast:** cards due on each of the next 7 learning days (today includes the overdue), drawn as bars with their values.
- **Totals:** words learned (lexical cards in Review), cards in learning, minutes, sessions, mined errors added and mined errors in Review. The "words strengthened" count stays on each session's end screen.
- **Weakness profile:** per grammar topic over 30 days: graded-writing errors, drill accuracy and grammar cloze accuracy per gap type; weakest first (most errors, then the lowest accuracy). Each topic offers **Luyện chủ đề này**: a Nhanh session of that topic's introduced cards plus up to 2 of its cached drills.
- **Level history:** every completed placement result (CEFR, ability band).
- Home shows a compact "today" card: the streak and freezes, this week's goal, the next review time and the mined errors waiting.

---

## Part II — Technical architecture

### 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **SvelteKit** + `adapter-node` | Little boilerplate, clear server/client boundary, fast builds |
| Language | TypeScript (strict) | Catches errors early; agents work better with types |
| Database | **SQLite** via `better-sqlite3` | One file, no separate service, far more than fast enough |
| ORM | **Drizzle** | Type-safe, migrations in real SQL, nothing hidden |
| SRS | **ts-fsrs** | Best-maintained FSRS implementation outside Anki |
| Validation | **Zod** | Validates LLM output; derives JSON Schema |
| Password hashing | **@node-rs/argon2** | Prebuilt binaries, no native build step |
| UI | Tailwind + a few hand-written components | No heavy UI library needed |
| Tests | Vitest + Playwright | Claude Code can run both itself |
| Web server | Node (`adapter-node`) on `0.0.0.0:3000` | Plain HTTP on the IP for now (see Part 0, Decisions); HTTPS later via deployment config |
| Process manager | systemd | Restarts on failure, logs via journalctl |
| Backup | **Litestream** → Cloudflare R2 or Backblaze B2 | Continuous SQLite replication |

**Not used:** Docker (an extra layer for a one-user app), Postgres (overkill), an i18n library (only one UI language), any ORM that hides SQL.

### 2. Folder structure

```
src/
  lib/
    server/              # server-only; never imported by client code
      db/                # Drizzle schema, migrations, repositories
      llm/               # provider adapters, prompts, Zod schemas
      srs/               # ts-fsrs wrapper
      generation/        # exercise generation + validation pipeline
      auth.ts
    components/          # shared Svelte components
    messages/vi.ts       # EVERY user-facing string, in one place
  routes/
    (app)/               # login-protected group
      +layout.server.ts  # the single auth chokepoint
      session/
      placement/
      stats/
      settings/
    login/
    api/
      cron/prefetch/     # called by cron, guarded by a secret
tool/                    # one-off data preparation scripts
data/                    # app.db (never committed)
deploy/                  # systemd unit, Litestream config, deploy script, crontab
docs/                    # this document
plans/                   # per-phase plans and roadmap status
```

Nothing in `lib/server/` may be imported from client code; SvelteKit enforces this at build time.

All Vietnamese UI strings live in `lib/messages/vi.ts`. No i18n library is needed, but strings must not be scattered across components.

### 3. Data model

Implemented in `src/lib/server/db/schema.ts` (Drizzle), with migrations in `src/lib/server/db/migrations/`.

**Conventions:** timestamps are `integer` Unix milliseconds; JSON columns are `text`; booleans are `integer` 0/1; enumerations are `text` with a CHECK on the allowed values; every foreign key states its `ON DELETE`. Column names are snake_case (TypeScript properties are camelCase).

```sql
settings(id = 1, desired_retention, weekly_goal_days, default_session_budget, new_cards_per_day,
         feedback_mode, active_provider_id → llm_providers ON DELETE SET NULL)
-- single row, CHECK (id = 1); seeded: 0.9, 5, 8, 10, 'direct', NULL.
-- CHECKs: desired_retention 0.70–0.97, weekly_goal_days 1–7, default_session_budget 1–60,
-- new_cards_per_day 0–50 (added by migration 0001).

llm_providers(id, name UNIQUE, base_url, model, wire_format, structured_mode,
              env_key_name, enabled, is_fallback)
-- env_key_name names an environment variable, e.g. 'OPENAI_API_KEY'; NULL for a provider
-- without a key (local Ollama); otherwise a CHECK allows only [A-Z0-9_], 1–64 chars.
-- structured_mode defaults to 'json_schema'. At most one row has is_fallback = 1.
-- NO COLUMN EVER HOLDS A KEY. (structured_mode and nullable env_key_name: migration 0002.)

llm_calls(id, created_at, provider_id, model, purpose, mode, attempt, ok, http_status,
          error_code, input_tokens, output_tokens, latency_ms)
-- one row per HTTP attempt; never prompt/response text or keys. provider_id is not a
-- foreign key, so the log survives provider deletion. (migration 0002)

user_profile(id = 1, theta, cefr_estimate, vstep_estimate, ielts_estimate,
             toeic_estimate, vocab_theta, grammar_theta, reading_theta,
             writing_theta, known_band_ceiling, updated_at)
-- single row, CHECK (id = 1); seeded with null estimates and known_band_ceiling = 1.

user_profile.placement_skipped_at  -- "Bỏ qua, bắt đầu từ cơ bản" chosen (migration 0006)

placement_results(id, taken_at, theta, cefr, subscores_json, item_log_json,
                  writing_status, vocab_band, cloze_theta, ability_band,
                  writing_submission_id → writing_submissions ON DELETE SET NULL,
                  reliability_flags)
-- (last five: migration 0006) theta: the unrounded ability; cloze_theta NULL when Part B was
-- skipped; reliability_flags: JSON array of many_false_alarms | cloze_skipped. Never updated
-- except to fold in a writing graded later. item_log_json entries:
-- {part, item (word or cloze item id), band, shownAt, answeredAt, responseMs, answer, correct}.
placement_attempts(id, started_at, finished_at, status, part, state_json,
                   result_id → placement_results ON DELETE SET NULL)
-- (migration 0006) status ∈ in_progress | completed | abandoned, at most one in_progress
-- (partial unique index); part ∈ A | B | C | done; state_json: the engine's whole state, so a
-- closed tab or a server restart resumes on the same item.

lexemes(id, headword UNIQUE, pos, ngsl_rank, freq_band, forms, supplementary,
        vi_gloss, en_def, source, license_tag)
-- forms: JSON array of every inflected form; supplementary: NGSL days/months/number words.
collocations(id, lexeme_id → lexemes ON DELETE CASCADE, chunk, example_en, example_vi)
sentences(id, en_text, vi_text, source, tatoeba_id_en UNIQUE, tatoeba_id_vi,
          ngsl_band_max, off_list_count, license_tag, level_band,
          blocked, blocked_reason, has_stock_names)
-- tatoeba_id_en is NULL for LLM-generated sentences. level_band = max(1, ngsl_band_max ?? 1).
-- blocked: matched the content blocklist (kept, never deleted; blocked_reason names the term);
-- has_stock_names: the English contains Tom or Mary. (last three: migration 0003)

cloze_items(id, sentence_id → sentences, gap_type, token_index, token_count, typing_only, answer, options,
            answer_vi, lexeme_id → lexemes, grammar_topic_id → grammar_topics,
            level_band, rule_ok, critic_ok, validated, rejection_reason, critic_notes,
            prompt_version, model, content_hash UNIQUE, created_at)
-- The validated cloze pool (Part II §5; migration 0003). All references ON DELETE RESTRICT.
-- token_index: the gap's index in the sentence's token list; options: JSON array of 4 strings
-- in display order ('—' = no word); critic_ok is NULL when the rules already failed.
-- Rejected items are kept (validated = 0) for inspection.
-- Phase 9b (migration 0008, a rebuild for the CHECK): gap_type gains user_error (a mined learner
-- error: its own sentences row with source = 'user_error', the gap on the correction span of up to
-- 4 tokens = token_count, prompt_version 'user_error', critic_ok NULL); typing_only items have no
-- options (a code without a distractor table, or fewer than 3 distractors).

cards(id, kind, lexeme_id → lexemes, sentence_id → sentences,
      grammar_topic_id → grammar_topics,
      cloze_item_id → cloze_items,                -- all ON DELETE RESTRICT
      prompt_mode,
      due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
      reps, lapses, state, last_review,           -- every field of ts-fsrs Card
      suspended)                                  -- 0009: hidden by the learner (review book)
-- UNIQUE (kind, lexeme_id, sentence_id, grammar_topic_id), NULLs counted as 0.
-- cloze_item_id (migration 0003) is UNIQUE when not NULL: a pool item becomes at most one card.
-- suspended (migration 0009, default 0): "Tạm ẩn" in the review book. A suspended card is out of
-- every queue (due, new, mined, focus sessions), every count and the forecast; its review_logs stay.
review_logs(id, card_id → cards ON DELETE RESTRICT,
            rating, state, due, stability, difficulty, elapsed_days,
            last_elapsed_days, scheduled_days, learning_steps, review,
                                                  -- every field of ts-fsrs ReviewLog
            old_s, new_s, old_d, new_d)
-- A card with reviews cannot be deleted, so the review history is never lost.

sessions(id, client_session_id UNIQUE, started_at, ended_at, budget_min, shape,
         items_done, streak_after, status, served_json, finished_at, summary_json)
-- (last four: migration 0007) status ∈ in_progress | finished | abandoned, at most one
-- in_progress (partial unique index; a new start abandons it). served_json: what was served,
-- which finish checks results against: from 9b {cards: [{cardId, mode, isNew}], drills:
-- [{cacheId, topicCode}], anchor: reading {cacheId, questions, glossary word → cloze item id} |
-- writing {promptId} | translation {sentenceId} | null}; 9a rows hold the bare cards array. summary_json: the finish summary,
-- returned again on a repeated finish. client_session_id holds a server placeholder
-- ("pending:<uuid>") until the client's id arrives with the results. Rows from before 0007 read
-- as finished. 0007 is hand-written (ADD COLUMN with a column CHECK): drizzle-kit's table rebuild
-- would have fired ON DELETE SET NULL on writing_submissions.session_id.

generated_cache(id, kind, params_hash, content_hash UNIQUE, level_band,
                payload_json, model, created_at, validated, validation_notes,
                served_at, prompt_version)
-- prompt_version (migration 0003): the version string(s) of the prompt modules that produced it.
-- params_hash: sha256 of the generation parameters that define a stock, e.g. kind 'error' +
-- {topic_code}, kind 'reading' + {topic}. Rejected items are stored too (validated = 0, with
-- validation_notes JSON {reason, ...}), so reruns skip their content_hash.

job_locks(name PK, holder, acquired_at)
-- One row while a job runs (name 'prefetch'); holder is the run's random token and only it
-- releases the row. A row older than 30 minutes counts as free (a crashed run). (migration 0004)

writing_submissions(id, session_id → sessions ON DELETE SET NULL, prompt,
                    user_text, corrected_text, errors_json, cefr_estimate, status,
                    submitted_at, scored_at, feedback_seen_at,
                    task_kind, prompt_id, sentence_id → sentences ON DELETE SET NULL,
                    reference_en, on_topic, task_note_vi, meaning_ok, mined_at, mined_count)
-- (last nine: migration 0008, ADD COLUMNs) task_kind ∈ writing | translation; prompt holds the
-- Vietnamese prompt or source sentence; prompt_id (writing-prompts.json) keeps prompts from
-- repeating within 14 days; sentence_id (translation) is never served again; on_topic false keeps
-- the CEFR out of every estimate; mined_count = cards made from its errors.

drill_results(id, session_id → sessions ON DELETE CASCADE,
              cache_id → generated_cache ON DELETE RESTRICT, topic_code, correct, answered_at)
-- (migration 0008) One answered error drill: one-off practice, not a card. The weakness profile
-- counts the missed ones.

grammar_topics(id, code UNIQUE, name_vi, name_en, l1_interference)
-- seeded with the 10 codes of Part I §6.
```

Indexes: `cards(due)`, `drill_results(answered_at)`, `sessions(finished_at)`, `sessions(status) WHERE status = 'in_progress'` (unique), `placement_attempts(status) WHERE status = 'in_progress'` (unique), `review_logs(card_id, review)`, `sentences(blocked, level_band)`, `cloze_items(validated, gap_type, level_band)`, `cloze_items(sentence_id)`, `llm_calls(created_at)`, `collocations(lexeme_id)`, `generated_cache(kind, params_hash)`, `generated_cache(kind, validated, served_at)`, `writing_submissions(status)`, plus the unique indexes above.

Enumerations: `kind` ∈ cloze | translate | grammar | reading | error (cards and generated_cache); `status` ∈ queued | scored | failed; `wire_format` ∈ openai | anthropic; `structured_mode` ∈ json_schema | tool | json_prompt; `shape` ∈ quick | read | write; `writing_status` ∈ none | queued | scored; `feedback_mode` ∈ direct | indirect; `prompt_mode` ∈ choice | typing; `state` ∈ New | Learning | Review | Relearning and `rating` ∈ Manual | Again | Hard | Good | Easy (ts-fsrs `State` and `Rating` names); CEFR columns ∈ A1 … C2; `code` ∈ the taxonomy codes; `gap_type` ∈ lexical | article | preposition | verb_form.

Connection (`src/lib/server/db/client.ts`): `DATABASE_PATH` (default `data/app.db`), pragmas `journal_mode = WAL` (required by Litestream), `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. Migrations run at server start from the SvelteKit `init` hook; a failed migration stops the server.

**Foreign keys are off while migrations run** (from Phase 9b). drizzle's migrator wraps all pending migrations in one transaction, where `PRAGMA foreign_keys=OFF` is a no-op, so a table rebuild (the only way to change a CHECK in SQLite) could not drop a table that others reference: ON DELETE RESTRICT fails and SET NULL silently clears the links. `migrate()` therefore turns foreign keys off around the run, back on afterwards, and then requires `PRAGMA foreign_key_check` to come back empty, or it throws and the server refuses to start. Earlier hand-written workarounds (0002, 0007) stay as they are.

### 4. LLM layer

`src/lib/server/llm/`: a provider-agnostic client that turns a request plus a **Zod schema** into a validated object. Zod is the single source of truth; JSON Schema is derived from it (Zod 4 `toJSONSchema`).

```ts
generateStructured({ purpose, system, user, schema, maxTokens = 2000, temperature?, providerId?, fallback = true })
  → { data, usage: { inputTokens, outputTokens }, model, providerId, attempts }
generateText({ purpose, system, user, ... }) → { text, usage, model, providerId, attempts }
```

**Wire formats.**
- Anthropic: `POST {base_url}/v1/messages`, headers `x-api-key` and `anthropic-version: 2023-06-01`; `system` is a top-level parameter; `max_tokens` is required. `temperature` is only sent when the caller sets it, because models after Claude Opus 4.6 reject any value other than 1.0. Usage: `usage.input_tokens` / `usage.output_tokens`.
- OpenAI-compatible: `POST {base_url}/chat/completions`, `Authorization: Bearer`; the system prompt is a `role: "system"` message; `max_completion_tokens` for api.openai.com, `max_tokens` for other compatible servers; default temperature 0.4. Usage: `usage.prompt_tokens` / `usage.completion_tokens`.

**Structured-output modes** (`llm_providers.structured_mode`):

| Mode | Anthropic | OpenAI-compatible |
|---|---|---|
| `json_schema` (default) | `output_config: { format: { type: "json_schema", schema } }` (GA; the beta `output_format` is deprecated) | `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` |
| `tool` | one tool + `tool_choice: { type: "tool", name }`; `tool_use.input` is already an object (forced tool use is rejected by the newest Claude models) | one function + `tool_choice: { type: "function", ... }`; `arguments` is a JSON string |
| `json_prompt` | the schema in the system prompt; JSON extracted from the text | same |

**Schema sanitizer.** `toProviderSchema(schema, target)` strips the keywords a target rejects and appends them to the field's `description` as a hint: OpenAI strict (`minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `pattern`, …; plus `additionalProperties: false` and every property in `required`), Anthropic (`minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `maxItems`, and `minItems` other than 0/1; `additionalProperties: false`). Stripped constraints are still enforced, because **every response is validated locally with the original Zod schema**.

**Pipeline.** Call in the provider's mode → extract the JSON (native output, tool input, or text with code fences and prose stripped) → normalize string enums case-insensitively (`"art"` → `"ART"`; providers don't guarantee enum casing) → validate with Zod → on failure, **one repair attempt** (the previous output and the Zod issues are sent back), then `LlmSchemaError` (raw output and issues, redacted). A refusal (Anthropic `stop_reason: "refusal"`, OpenAI `message.refusal` or `finish_reason: "content_filter"`) throws `LlmRefusalError`, never retried.

**Transport, retry, fallback.** Global `fetch` (injected for tests), 60 s timeout per attempt. Network errors, timeouts and HTTP 429/500/502/503/504/529 are retried up to 3 attempts with exponential backoff and jitter, honouring `Retry-After`; other 4xx fail at once. The provider flagged `is_fallback` is used after retries are exhausted, on 401/403, or when the key's env var is missing — never on a schema error or a refusal. `base_url` must be `https://`, except `http://localhost` / `http://127.0.0.1` (Ollama).

**Call log.** `llm_calls` gets one row per HTTP attempt: provider, model, purpose, mode, attempt, ok, HTTP status, error code, token counts, latency. **Never prompt or response text, never a key.** `countSince(ts)` feeds rate limiting (Phase 11); `usageSince(ts)` gives token totals per provider and model.

**Secrets.** The key is read from `process.env[provider.env_key_name]` at call time, never cached, never logged. Every thrown error passes through `redact()`, which removes the keys, `Authorization` / `x-api-key` header values and `sk-…` tokens, and errors carry no `cause` chain.

Surface a clear Vietnamese error in the UI if all providers fail. Do not hard-code prices: model tiers and rates change often.

**Provider management UI (Phase 10, `/settings/providers`).** Lists each provider's name, base URL, model, wire format, structured mode, the env variable **name**, and whether that variable is set on the server now (a boolean: `Boolean(process.env[name]?.trim())`). Add, edit and delete; make one active; make one the fallback (setting a new fallback clears the old one in one transaction). The form is validated with Zod: the Phase 4 base-URL rule and the env-name rule `^[A-Z][A-Z0-9_]{0,63}$` (Anthropic needs one). **The UI never handles a key value**: no field accepts one, no response carries one, and a note says keys live in the server's `.env`. **Kiểm tra kết nối** runs the shared smoke call (`llm/smoke.ts`, also behind `npm run llm:smoke`) on that provider without fallback and shows OK with the latency, or the error code and the redacted message. Settings also shows LLM calls and tokens per day for the last 7 days, by purpose.

### 5. Generation and the validation pipeline

Generation is batch and ahead of time, never during a session. Every prompt module in `src/lib/server/llm/prompts/` exports a `PROMPT_VERSION` string, stored with every item it produces (`cloze_items.prompt_version`, `generated_cache.prompt_version`), so a changed prompt can be traced and its items rebuilt.

**Content import** (`npm run content:import`, Phase 5a). Reads the Phase 1 JSON with `fs` (never bundled into app code) and upserts idempotently: `ngsl.json` → `lexemes` by headword (supplementary words that are also ranked headwords, `may` and `march`, are skipped; glosses added later are never overwritten); `tatoeba-en-vi.json` → `sentences` by `tatoeba_id_en`. A second run changes nothing. Sentences matching `src/lib/server/content/blocklist.txt` (one term per line, `prefix*` allowed, matched on lemmas via the NGSL form map, so "killed" matches `kill`) are imported with `blocked = 1` and never deleted; `--reblock` re-applies the current list to every row. The import reports the blocked count and the top 20 matching terms.

**The cloze pool** (`npm run cloze:build`, Phase 5a). Cloze items are not generated sentences: they are gaps in real Tatoeba sentences, stored in `cloze_items`.

1. **Candidates** (`generation/cloze/candidates.ts`, deterministic). Eligible sentences: not blocked, 4–15 words, `off_list_count` ≤ 2. At most one lexical and one grammar candidate per sentence.
   - *lexical*: a content word whose lemma is in NGSL and not in the function-word stoplist (`stoplist.ts`); never a capitalized word mid-sentence, never part of a hyphenated compound; the highest band ≤ sentence band + 1 wins. Item band = max(sentence band, lemma band); `lexeme_id` is linked.
   - *article* (ART): options `a, an, the, —`, only where a rule fixes the answer (Phase 11: `the` + superlative/ordinal/unique noun; `a/an` after "there is", such/what, "a lot of", "twice a week").
   - *preposition* (PRE): distractors from a fixed confusion table (`prepositions.ts`); the infinitive "to" is not a preposition.
   - *verb_form*: a lemma with at least four real forms (one in -ing); options are other forms of the same lemma that occur in the sentence corpus and are real words (NGSL form lists include nonstandard forms such as "makeing"). No modals, no noun uses after a determiner. Topic SVA when the gap is present simple after a third-person subject, else TNS.
   - Selection is seeded and stable: candidates are bucketed by (gap type, band), each bucket ordered by content hash, and taken round-robin, so a run spreads across types and bands.
2. **Distractors** (lexical gaps only; prompt `llm/prompts/cloze-distractors.ts`). 10 items per call; each gives the sentence with `___`, the answer and the Vietnamese sentence, and asks for 3 distractors (same part of speech and inflection, similar frequency, plausible but clearly wrong) with a one-line reason each, plus `answer_vi`. All schema fields are required; the array size is not sent to Anthropic (Part II §4) and Zod enforces exactly 3 locally.
3. **Rules** (`generation/cloze/rules.ts`, deterministic): 4 options, distinct case-insensitively, exactly one equal to the answer; each a single token or `—`; lowercase unless the gap is sentence-initial, then all four capitalized; the answer is exactly at `token_index`; for lexical gaps, no distractor is a form of the answer's lemma, every distractor is a real word (the word list or an NGSL headword) and none is on the blocklist. A failure stores `rule_ok = 0` with `rejection_reason = rule:<code> (...)`.
4. **Blind critic** (prompt `llm/prompts/cloze-critic.ts`; `generation/cloze/critic.ts`). The sentence is shown filled with each of the four options, labelled A–D in display order, never saying which is intended (no translation either). For each version: grammatical? natural? meaning plausible? An item is accepted only if exactly one version is acceptable on all three and it is the answer. 10 items per call.
5. **Store.** Options are shuffled with a seed derived from the item's content hash. Rule and critic failures are stored with `validated = 0`; items whose LLM call failed (schema error after repair, refusal, exhausted retries, an item missing from the answer) are not stored, so the next run retries them. Existing `content_hash` values are skipped.

**Cost guards.** `--max-calls` (default 50) stops the run once it has made that many HTTP attempts (`llm_calls` rows; checked before each batch, so one batch's retries may overshoot slightly). The run refuses to start when `llm_calls` already holds `LLM_DAILY_CALL_CAP` (env, default 500) rows in the last 24 h, and stops if it would reach the cap. `--dry-run` runs the whole pipeline on an in-memory copy of the content with a canned LLM (no network, no writes).

**Evaluation** (`npm run eval:cloze -- --n 30`) writes `tmp/eval/cloze-<timestamp>.md`: a table of `n` random validated items (sentence with gap, options, answer, `answer_vi`, gap type, band, a column to mark bad items) and 10 random rejected items with their reasons. Phase 5's hard gate is a human finding at most 1 bad item among 30.

**Error-correction drills** (Phase 5b; `generation/drills/`, kind `error` in `generated_cache`). Payload `{ sentence_with_error, corrected, original_span, corrected_span, topic_code, explanation_vi, source: 'tatoeba' | 'llm', sentence_id? }`.

1. **Drafts.** For ART PLU SVA COP TNS PRE, a correct Tatoeba sentence (not blocked, 4–15 words, `off_list_count` ≤ 2, the requested band) gets one deterministic, L1-typical error (`drills/inject.ts`):

   | Code | Injection |
   |---|---|
   | `ART` | delete `a`/`an`/`the` before a singular countable noun (preferred), or swap `a` ↔ `an` |
   | `PLU` | a plural noun right after a number or quantifier becomes singular (form map; irregular plurals listed) |
   | `SVA` | a third-person present verb (`-s` form, `has`, `does`) after a third-person singular subject becomes its base form |
   | `COP` | delete `is`/`are`/`am` before an adjective (optionally after `very`, `not`, …) that closes the predicate |
   | `TNS` | a simple past next to a time marker (`yesterday`, `… ago`, `last week`) becomes its base form |
   | `PRE` | a preposition is swapped using the Phase 5a confusion table (never the infinitive `to`) |

   NGSL 1.2 has no part-of-speech tags, so word classes (countable nouns, adjectives, simple pasts) are inferred from the form map and corpus evidence (`drills/word-classes.ts`). For COL WFM WOR the LLM writes the drill (prompt `drill-generate`, 10 per call) including its explanation.
2. **Rules** (`drills/rules.ts`): corrected ≠ erroneous; the changed region (between the common token prefix and suffix, so a word-order swap is one region) holds at most 3 tokens; the spans describe that change (replacing `original_span` by `corrected_span` yields the corrected sentence, and they cover the minimal diff; the stored spans are the minimal diff); the topic code is the requested one; nothing on the blocklist.
3. **Explanation** (prompt `drill-explain`, 10 per call): `explanation_vi`, at most 2 short sentences, checked by rule.
4. **Blind critic** (prompt `drill-critic`, 10 per call): the model sees only `sentence_with_error` and must find and fix all errors. Accepted only if it reports exactly one fix and its corrected sentence normalizes (case, quotes, spacing) to `corrected`.

**Graded reading passages** (`generation/reading/`, kind `reading`). Input: a band and one of 20 everyday topics (`reading/topics.ts`; the least used topic for the band first). One passage per call (prompt `reading-passage`): `{ title_en, passage_en, questions: [{ question_en, options[4], answer_index, explanation_vi }] (2), glossary: [{ word, vi }] (≤ 5) }`, stored with `topic`, `word_count` and `coverage`. Options are shuffled by a seed from the passage. Rules: words within the band range (1–2: 60–90, 3–4: 90–130, 5–6: 130–170, 7–8: 170–220); **coverage ≥ 95%** of word tokens are function words, stock names (the prompt allows only listed names and places) or have a lemma band ≤ `level_band + 1`; every glossary word (or a form of its lemma) appears in the passage; options distinct; nothing on the blocklist. Blind critic (prompt `reading-critic`, 5 passages per call): it answers each question without the key and lists every defensible option; accepted only if it picks the intended option and reports exactly that one as defensible.

**Grading services** (`src/lib/server/grading/`; live at answer time, never cached; the active provider with fallback). `gradeWriting({ prompt_vi, user_text, level_band, feedback_mode })` and `gradeTranslation({ vi, reference_en, user_en, level_band })` return the WritingFeedback schema below (translation adds `meaning_ok`). `gradeWriting` also returns `display`: in `indirect` mode this UI-facing shape omits `corrected_text`. The prompts forbid invented errors, rank errors by importance and ask for plain Vietnamese at the learner's level; the translation prompt states that the reference is one valid translation of many. A guard drops any error whose `original` is not in the learner's text or whose correction changes nothing.

**Writing prompts** are a static, hand-written bank (`src/lib/server/content/writing-prompts.json`: 40 prompts `{ id, band_min, band_max, prompt_vi, hint_en, min_words, max_words }` across the bands and the 20 topics); no LLM at runtime. VI→EN translation tasks use Tatoeba pairs directly.

**Prefetch** (`generation/prefetch.ts`). Stock targets (`generation/stock.ts`) for bands 1 … `known_band_ceiling + 1`: 60 validated cloze items no card uses yet per band; 4 unserved reading passages per band; 8 unserved drills per topic code and band. `prefetch({ maxCalls })` computes the shortfall and fills it cheapest first on one call budget: cloze (the Phase 5a pipeline) → injected drills → LLM-written drills → passages. Cloze and drills ask for 1.5× the shortfall, because the critics reject a share. It returns the items added per kind and band, rejections by reason, LLM calls and tokens.

`POST /api/cron/prefetch` is called with `Content-Type: application/json` and a body of `{}` or `{ "maxCalls": N }` (SvelteKit's CSRF guard answers 403 to a cross-site POST without a JSON content type). `Authorization: Bearer <CRON_SECRET>` is compared with `crypto.timingSafeEqual` over SHA-256 digests (401 otherwise; 503 if `CRON_SECRET` is unset). One run at a time through the `job_locks` row (409 while held; released in `finally`; a lock older than 30 minutes is reclaimed). `LLM_DAILY_CALL_CAP` applies (429 when reached). It runs synchronously and returns the summary; before the stock, it grades the queued writing submissions on the same budget (`gradeQueuedWritings`, Phase 8). `npm run prefetch -- [--max-calls N] [--dry-run]` runs the same function under the same lock. At runtime prefetch reads `src/lib/server/content/blocklist.txt` relative to the working directory and needs the `word-list` package (now a runtime dependency); the placement test also reads `pseudowords.json` and `writing-prompts.json` from there. Phase 7 must deploy them.

**Cost guards everywhere.** Every generator runs on a budget (`generation/budget.ts`): `--max-calls` / `maxCalls` counts HTTP attempts, and a run refuses to start when the last 24 h already hold `LLM_DAILY_CALL_CAP` calls. Items whose LLM call failed are not stored, so the next run retries them. `npm run llm:usage -- --days 7` prints calls and tokens per day (ICT) × purpose × model.

**Writing-feedback schema** (`llm/prompts/feedback.ts`)
```ts
const BaseFeedback = z.object({
  corrected_text: z.string(),
  errors: z.array(z.object({
    original: z.string(),
    correction: z.string(),
    topic_code: z.enum(['ART','TNS','PLU','SVA','COP','PRE','COL','WFM','WOR','OTH']),
    explanation_vi: z.string()
  }).strict()).transform((errors) => errors.slice(0, 3)),  // ranked; at most 3 kept
  cefr_estimate: z.enum(['A1','A2','B1','B2','C1','C2']),
  scores: z.object({
    range: z.number().int().min(1).max(5),
    accuracy: z.number().int().min(1).max(5),
    coherence: z.number().int().min(1).max(5)
  }).strict()
}).strict();
// Phase 9b: writing is checked for task relevance (grade-writing@2).
const WritingFeedback = BaseFeedback.extend({ on_topic: z.boolean(), task_note_vi: z.string() });
const TranslationFeedback = BaseFeedback.extend({ meaning_ok: z.boolean() });
```

**Task relevance (Phase 9b).** `on_topic` says whether the text answers the task; `task_note_vi`, when it does not, says in one kind Vietnamese sentence what the task asked (else empty). The English is graded the same way either way. An off-topic submission's CEFR estimate is stored on the submission but never used: not in a placement result (the result gets the reliability flag `writing_off_topic` instead) and not in the profile. The grading eval has an off-topic fixture (`expected_on_topic: false`).

**Grades are applied in one place** (`grading/apply.ts`), whether they arrive live (placement, a Viết session) or later (`gradeQueuedWritings`, which grades translations with `gradeTranslation` against the stored reference). It marks the submission scored, refines a linked placement result (unless off topic), and mines the errors into cards (Part I §8).

Anthropic rejects array-size and numeric constraints in the provider schema (Part II §4), so the wire schema carries none and Zod enforces them locally. A list of more than 3 errors is cut to the 3 most important, instead of failing a live grading call and paying for a repair round.

Constraining `topic_code` to the enum is what makes error mining work: free-text error labels cannot be aggregated into a weakness profile.

### 6. Authentication and safety

The app is on the public internet, so:
- **A single password gate.** The password's argon2id hash (`npm run auth:hash`, which prompts twice with hidden input) lives in `APP_PASSWORD_HASH`. Unset or not an argon2id hash means nobody can log in and every page stays closed: it fails closed.
- **The chokepoint is `handle` in `src/hooks.server.ts`**, not a layout: layout loads do not run for `+server.ts` endpoints, so a layout guard would leave `/api/*` open. Every request (pages, form actions, data requests, endpoints) resolves the session into `event.locals.session` and passes `accessFor()` (`src/lib/server/auth/guard.ts`). Only an explicit allowlist is public (the backup download `/api/backup` is not on it): `/login`, `/healthz` (Phase 7: `{ok, db, migrations}` only, for the deploy scripts), `/api/cron/*` (own secret), `/favicon.svg`, `/robots.txt`, `/_app/immutable/*`, `/_app/version.json`, `/_app/env.js` (not all of `/_app/`: `/_app/remote/*` would be server code). Anything else without a session: pages get 303 to `/login?next=<path>`, `/api/*` gets 401 JSON (503 JSON when login is not configured). `next` must be a same-origin relative path (never `//evil.com`, absolute URLs or backslash tricks), else `/`. `(app)/+layout.server.ts` only exposes session info; it is not a security boundary.
- **Sessions are server-side** (`auth_sessions(id, created_at, expires_at, last_seen_at)`, migration 0005). The cookie `se_session` holds 32 random bytes (base64url); the table stores only their SHA-256, so a copy of the database cannot log anyone in. 30 days, sliding: on use, `last_seen_at` and the expiry move forward at most once an hour. Logout (a POST action) deletes the row and the cookie; an expired row is deleted when presented.
- **Cookies:** `httpOnly`, `sameSite=lax`, `path=/`; `secure` from `COOKIE_SECURE` (default true). `false` is allowed for any `ORIGIN`, because the app is served over plain HTTP on an IP (Part 0, Decisions). With `false` and a non-local origin, the server logs a startup warning and the login page shows a small, non-blocking notice: "Kết nối không mã hóa". The theme preference (`system`/`light`/`dark`) is a cookie too, so the server renders `data-theme` on `<html>` and the first paint is right.
- **`ORIGIN`** must equal the URL in the browser exactly (now `http://103.82.195.48:3000`; `http://localhost:3000` through an SSH tunnel); otherwise SvelteKit's CSRF check rejects the login form with 403. **It is read at build time** (`vite.config.ts` → `paths.origin`): adapter-node 6 (SvelteKit 3) has no runtime `ORIGIN` variable and, without `paths.origin`, assumes `https://<host>`, which over plain HTTP rejects every form POST. Build with `ORIGIN` set and rebuild after changing it.
- **Login rate limit:** at most 5 failed attempts per IP per 10 minutes, then 429 with a Vietnamese message (in memory: one process). Every failure waits a constant 300 ms. Without TLS these matter more, and they stay. If a proxy or tunnel is put in front later, adapter-node must read the client address from `X-Forwarded-For` (`ADDRESS_HEADER`, `XFF_DEPTH`), or all requests share one IP.
- **Rate-limit** routes that call the LLM. One user does not need more than 60 calls per hour.
- **Set a spending limit at the LLM provider** and enable usage alerts. This is the last line of defence against a runaway loop.
- The cron endpoint compares its secret with a timing-safe comparison, not `===`.
- SSH: key-only, password login disabled, `fail2ban`.

### 7. Deployment

```
Phone browser → http://103.82.195.48:3000 → Node 24 (0.0.0.0:3000, systemd, from the checkout)
                                              ↓
                                        <repo>/data/app.db  →  data/backups/ (nightly + pre-deploy)
                                                            ⇢  Litestream → R2 / B2 (optional)
```

As built in Phase 7 (`deploy/`, runbook `plans/phase-07.md`):
- **VPS:** Ubuntu, Node 24 LTS, shared with other services (socat, next-server, cloudflared) that the deployment never touches; the firewall is left as it is (port 3000 is open).
- **No reverse proxy, no TLS** (Part 0, Decisions): adapter-node listens on `HOST=0.0.0.0`, `PORT=3000`. HTTPS can be added later in front (Tailscale or a Cloudflare Tunnel) without code changes.
- **Runs from the repository checkout**, because migrations, `src/lib/server/content/` and the blocklist are read relative to the working directory. Configuration is `<repo>/.env`: mode 600 and owned by the deploy user.
- **systemd** (`deploy/silentenglish.service`):
  - `ExecStart=/usr/bin/env node build/index.js` as the deploy user;
  - `Restart=always`, `NODE_ENV=production`;
  - hardening: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome=read-only`, with `ReadWritePaths=<repo>/data` the only writable path, so `DATABASE_PATH` lives there.
- **One-time setup with sudo** (`deploy/install.sh`): installs the unit, and a validated sudoers drop-in that lets the deploy user run only `systemctl restart|status silentenglish` and `journalctl -u silentenglish` without a password. It does not start the app while the port is taken.
- **Deploy** (`deploy/deploy.sh`, no sudo password):
  - `git pull --ff-only` (skipped on a detached HEAD: rollback = `git checkout <commit>` + deploy), then `npm ci`;
  - the build with **only** `ORIGIN` taken from `.env` (SvelteKit 3 fixes it at build time);
  - a pre-deploy snapshot, the restart, then up to 30 s of polling `GET /healthz`; on failure, the last 50 journal lines and a non-zero exit.
- **`/healthz`** (public, on the allowlist): `200 {"ok":true,"db":"ok","migrations":n}` after a trivial query, else 503.
- **Backups:**
  - `npm run db:snapshot` writes `VACUUM INTO data/backups/app-YYYYMMDD-HHMM.db`, checked with `PRAGMA integrity_check`; the newest 14 are kept.
  - `deploy/backup.sh` runs it at 03:30, and `deploy.sh` before each restart.
  - Restoring a snapshot into a scratch file and opening it is the Phase 7 hard gate.
  - Litestream offsite replication is optional (`deploy/litestream.yml.example`).
- **Cron:**
  - the deploy user's own crontab (`deploy/crontab.example`, `CRON_TZ=Asia/Ho_Chi_Minh`): prefetch at 03:00 and backup at 03:30;
  - jobs run through `deploy/cron-run.sh`, which logs to `data/logs/` with size-based rotation;
  - `CRON_SECRET` is read from `.env` and passed to curl on stdin;
  - each prefetch run also deletes expired login sessions.

Total cost: the VPS, plus LLM usage of a few cents per month.

### 8. Network use (no PWA)

- **PWA is out of scope** (Part 0, Decisions): no manifest, no service worker, no offline page. A plain `static/favicon.svg` is the only icon.
- **One request in, one request out:** when a session starts, the server returns **the entire session's content** in one response; the session runs client-side; results are submitted once at the end. There is no `localStorage` retry: the app assumes it is online.
- Fonts are self-hosted (`@fontsource`, latin + vietnamese subsets, woff2 only): no third-party requests.

### 9. Testing

- **SRS:** integration tests over `ts-fsrs`, asserting intervals grow sensibly across rating sequences.
- **Adapters:** mocked HTTP only; one test per wire-format divergence, plus the key-leak test.
- **Validation pipeline:** fixtures of known-good and known-bad items; assert accept/reject.
- **Database:** in-memory SQLite; migration tests from each earlier schema version.
- **E2E:** Playwright for login, a full session, the placement test, and (Phase 10) stats, the review book, settings, providers and the backup.
- **Eval set:** ~30 exercise items and ~10 writing samples reviewed by a human, in `test/eval/`. Re-run after every prompt change: a prompt edit that quietly degrades quality is otherwise invisible.

### 10. Content sources and licensing

| Source | License | Use | Obligation |
|---|---|---|---|
| NGSL | CC BY-SA 4.0 | Frequency ordering, band ceilings | Attribution; ShareAlike on redistributed derivatives |
| Tatoeba EN–VI pairs | CC BY 2.0 FR (some CC0) | Seed sentences | Attribution to tatoeba.org |
| LLM-generated | — | Bulk sentences, passages, distractors, explanations | Quality validation |

Every content row carries a `license_tag`, so the credits page can be generated automatically.

Vietnamese is a small language on Tatoeba: expect a few thousand usable EN–VI pairs, not tens of thousands. That is enough for a placement bank and an early cloze deck, but **LLM generation is the main sentence source** from Phase 5 on.

---

## Part III — Build roadmap for Claude Code

### Working method

- **`CLAUDE.md` under 150 lines.** Stack, structure, commands, conventions and hard rules. Detail lives in `docs/` and `plans/`, not in `CLAUDE.md`.
- **`plans/` is the shared memory.** `plans/roadmap.md` tracks phase status; each phase may add its own `plans/phase-XX.md`. Claude Code keeps no memory between sessions; the plans carry the context.
- **One phase per session.** Start each phase in a fresh session, pointing at this document and the relevant section. This is the main defence against context rot.
- **Plan mode first.** Have Claude Code propose its approach, correct it, then execute. Fixing a plan is cheaper than fixing a diff.
- **Tests first** where the logic is not obvious: SRS, validation, adapters.
- **One commit per phase**, small diffs, secret scanning on.
- **Review subagents** get a bounded question: "Compared with the phase plan, report only correctness defects and unmet requirements. No style comments, no architectural suggestions, no new features."

### 12 phases (0–11; Phases 5 and 9 are each split in two)

Dependency order: data and engines first, app shell in the middle, features last.

**Build order (changed after Phase 6, the owner's decision): 8 → 9a → 9b → 10 → 7 → 11.** The features (placement, session loop, settings) come before the deploy, which now follows Phase 10, and hardening stays last. The phase numbers and sections below are unchanged; `plans/roadmap.md` lists the phases in build order.

---

#### Phase 0 — Scaffold and guardrails

**Manual preparation:** install Node 22 LTS, git and gitleaks. Create an empty `silentenglish` folder and open Claude Code in it, in plan mode. Paste the prompt, and on its last line reference this file wherever it is saved, e.g. `Design document: @~/Downloads/architecture.md`. Claude Code copies it into `docs/` itself, so later phases find it there.

> **Context**
>
> I'm building **SilentEnglish**, a personal (single-user, non-commercial) web app that teaches English reading, writing, vocabulary and grammar to a Vietnamese speaker. No audio of any kind. Sessions last 5–10 minutes and are used on a phone as an installed PWA. The entire UI is in Vietnamese. It will run on a small VPS behind Caddy.
>
> The full design document is referenced at the end of this message. **First step:** copy it unchanged to `docs/architecture.md`; every later phase reads it from there. Then read Part II ("Technical architecture") and the Phase 0 section of Part III. You don't need the rest yet.
>
> This is **Phase 0 of 12** (Phases 0–11). The goal is a clean, verified skeleton with guardrails. **Do not implement any app features.**
>
> **Stack (already decided, do not substitute)**
>
> - SvelteKit + TypeScript (strict mode) + `@sveltejs/adapter-node`
> - Tailwind CSS
> - Vitest (unit tests) + Playwright (e2e tests)
> - SQLite via `better-sqlite3`, with Drizzle ORM + `drizzle-kit`
> - `ts-fsrs`, `zod`, `@node-rs/argon2`
> - npm as the package manager, Node 22 LTS
>
> **Tasks**
>
> 1. **Scaffold** with the official `sv` CLI, non-interactively. Check `npx sv create --help` and `npx sv add --help` for the current flags instead of guessing. Use `sv add` for Tailwind, Vitest and Playwright. By now the directory contains `docs/`, so scaffold in a way that preserves it. Switch the adapter to `adapter-node`. Install the remaining dependencies listed above at their latest stable versions.
>
> 2. **Folder structure.** Create these, with a `.gitkeep` in any that would otherwise be empty: `src/lib/server/{db,llm,srs,generation}`, `src/lib/components`, `src/lib/messages`, `src/routes/(app)`, `src/routes/login`, `src/routes/api`, `tool/`, `data/`, `deploy/`, `plans/`, `scripts/`.
>
> 3. **Vietnamese strings pattern.** Create `src/lib/messages/vi.ts`, exporting one typed `as const` object that will hold every user-facing string, grouped by screen. Add three sample strings: the app name, a home-page greeting and a tagline. Replace the default `+page.svelte` with a minimal page that renders them. This establishes the rule: no `.svelte` file may contain a user-facing string literal.
>
> 4. **Enforce that rule cheaply.** Add `scripts/check-strings.mjs` and an `npm run lint:strings` script. It fails if any `.svelte` file under `src/` contains Vietnamese-specific characters (letters such as ă â đ ê ô ơ ư, and vowels carrying tone marks), printing the file and line of each hit. It is a heuristic, not a parser, so keep it short.
>
> 5. **Environment.** Create `.env.example` listing the variables later phases will need, each with an empty value and a one-line comment: `DATABASE_PATH`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Do not create a `.env` file.
>
> 6. **Git and secret guardrails.**
>    - Initialize git if the directory is not already a repository. The `.gitignore` must exclude `node_modules`, `build`, `.svelte-kit`, `.env` and `.env.*` (but not `.env.example`), `data/*.db*`, `test-results` and `playwright-report`.
>    - Add `.githooks/pre-commit` and run `git config core.hooksPath .githooks`. The hook must (a) reject any staged file named `.env` or `.env.*` (except `.env.example`), and any staged `*.db` file; (b) run gitleaks against the staged changes. Check `gitleaks --help` for the current subcommand, since it changed between versions.
>    - If gitleaks is missing, the hook blocks the commit and prints how to install it. Never use `--no-verify`.
>
> 7. **npm scripts:** `dev`, `build`, `preview`, `check` (svelte-check), `lint:strings`, `test` (vitest run), `test:e2e` (playwright), and `verify`, which runs `check`, `lint:strings`, `test` and `build` in sequence and stops at the first failure. Database scripts come in Phase 2. Do not add them yet.
>
> 8. **Tests.** One Vitest test asserting that no value in `vi.ts` is an empty string. One Playwright test that loads `/` and asserts the Vietnamese greeting is visible.
>
> 9. **CLAUDE.md** (under 150 lines). It covers a one-paragraph project summary, a pointer to `docs/architecture.md` as the source of truth, the stack, a folder map, the commands, and these hard rules:
>    - Never commit secrets, `.env` files or database files. Never bypass the pre-commit hook.
>    - No user-facing string literals in `.svelte` files. All of them go through `src/lib/messages/vi.ts`.
>    - Client code must never import anything from `src/lib/server/`.
>    - API keys are read only from `process.env`. Never store them in the database, log them, or include them in error messages.
>    - Use existing libraries for solved problems (`ts-fsrs` for scheduling, `zod` for validation). Do not reimplement them.
>    - Workflow for every phase: read that phase's section in `docs/architecture.md` and any `plans/phase-XX.md`, stay within its scope, finish with `npm run verify` passing, then commit.
>    - Code, comments and commit messages are in English. UI strings are in Vietnamese.
>
> 10. **`plans/roadmap.md`.** List Phases 0–11 with a one-line goal each (taken from Part III of `docs/architecture.md`) and a status checkbox. Tick Phase 0 at the end.
>
> 11. **README.md**, kept short: what the project is, prerequisites (Node 22, gitleaks), first-time setup (`npm ci`, `git config core.hooksPath .githooks`) and the commands.
>
> **Verification (do all of this yourself before reporting back)**
>
> - `npm run verify` passes.
> - `npm run test:e2e` passes (install the Playwright Chromium browser first if needed).
> - Start `npm run dev`, `curl` the home page and confirm the Vietnamese greeting is in the HTML. Then stop the server.
> - Temporarily add a Vietnamese string literal to a `.svelte` file, confirm `lint:strings` fails, then revert.
> - Temporarily stage a `.env` file and confirm the commit is blocked. Then stage a source file containing a realistic-looking fake API key that gitleaks' default rules detect, and confirm that commit is blocked too. Clean up both afterwards.
>
> **Finish**
>
> Make one commit with the message `chore: phase 0 scaffold and guardrails`. Then give a brief report covering: what was created; the exact installed versions of SvelteKit, Svelte, Tailwind, Drizzle and ts-fsrs; anything that deviated from this prompt, and why; anything I need to do by hand.

**Result:** a running project showing a Vietnamese string from `messages/vi.ts`, with a hook that blocks committing secrets.
**Check:** `git log` shows one new commit with no `.env` or `.db` files; `npm run dev` shows the Vietnamese greeting; read the "deviated from this prompt" part of the report, especially the gitleaks command.

---

#### Phase 1 — Content data preparation

This phase produces asset files with a one-off script in `tool/`. It adds no app code.

> Write `tool/prepare-content.ts` producing three asset files. Do not add any app code in this phase.
>
> 1. **NGSL** — read `tool/raw/NGSL_1.2_stats.csv` (ranks), `tool/raw/NGSL_1.2_lemmatized_for_research.csv` (inflected forms) and `tool/raw/SUP_lemmatized.csv` (supplementary words), emit `src/lib/server/content/ngsl.json` as `[{headword, pos, rank, band, forms}]` plus a `supplementary` array, bucketing rank into 8 bands of roughly 350 words. Include the CC BY-SA 4.0 license string in a header field.
>
> 2. **Tatoeba EN–VI** — from the pairs file `tool/raw/tatoeba-eng-vie.tsv` (joined from the Tatoeba per-language exports by `tool/build-tatoeba-pairs.ts`), normalize, deduplicate, and drop pairs where the English sentence exceeds 15 words or contains characters outside basic Latin and common punctuation. Emit `src/lib/server/content/tatoeba-en-vi.json` as `[{tatoeba_id_en, tatoeba_id_vi, en, vi, word_count, ngsl_band_max, off_list_count}]` with the CC BY 2.0 FR license string in a header. **Print the final pair count** — I expect only a few thousand.
>
> 3. **Pseudo-words** — create `src/lib/server/content/pseudowords.json` with 120 English-phonotactically-plausible non-words for the yes/no vocabulary test (e.g. `plurthy`, `dispone`, `fantule`). Generate candidates, then **filter them against the NGSL list and a standard English word list to guarantee none is a real word.** Output `[{form}]`. Print every rejected candidate so I can review the final list by hand. Words removed by hand go in `tool/pseudowords-exclude.txt`, which every re-run honours.
>
> Make the script idempotent and re-runnable. Document where to download each raw input in `plans/phase-01.md`.

**Result:** three asset files and the Tatoeba pair count.
**Check:** open each file; **read all 120 pseudo-words yourself** (`tool/pseudowords-review.txt`) and remove any that look like real words by adding them to `tool/pseudowords-exclude.txt` and re-running; confirm the license headers are present.

> **Manual gate:** do not skip the pseudo-word review. It takes five minutes, and it is the only place in the app where one bad item silently corrupts a measurement.

---

#### Phase 2 — Data layer

> Implement the Drizzle schema exactly as specified in Part II §3 of `docs/architecture.md`, with the connection in `src/lib/server/db/client.ts` (WAL and the other pragmas). Generate migrations into `src/lib/server/db/migrations/` and apply them at server start. Create repository modules in `src/lib/server/db/repositories/` exposing intent-level functions — e.g. `cards.dueCards(now, limit)`, `writing.queued()`, `providers.active()`, `cache.takeUnserved(kind, levelBand, n)` — not raw queries.
>
> Add the indexes listed in Part II §3.
>
> Seed `grammar_topics` from the L1 interference taxonomy in Part I §6, and the single `settings` and `user_profile` rows, as part of the initial migration.
>
> Add `db:generate`, `db:migrate` and `db:studio` npm scripts and document them in `CLAUDE.md`.
>
> Write Vitest tests against an in-memory SQLite database covering create/read/update for every table, plus one migration test. **No business logic in this phase** — no scheduling, no LLM, no UI.

**Result:** schema, migrations, repositories, passing tests.
**Check:** `npm test`; open `data/app.db` with sqlite3 and confirm `grammar_topics` has 10 rows.

---

#### Phase 3 — Spaced-repetition engine

> Implement `src/lib/server/srs/` as a thin, deterministic layer over the `ts-fsrs` package plus the queue policy around it. Do not reimplement the algorithm. **The engine never reads the clock:** every function takes `now`, so offline reviews can be applied later with the times the client recorded. Every write goes through the repositories and accepts a db or a transaction.
>
> - `scheduler.ts`: `createScheduler(settings, { fuzz })` — `desired_retention`, maximum interval 36,500 days, fuzz on, learning steps 1m/10m, relearning step 10m, default FSRS-6 weights.
> - `mapping.ts`: lossless `toFsrsCard`/`fromFsrsCard` and the same pair for review logs.
> - `review.ts`: `review(dbOrTx, cardId, rating, reviewedAt, serverNow)` in a transaction — typed errors for a missing card, a review earlier than `last_review`, or one more than 5 minutes ahead of `serverNow`; saves the card and appends the log with `old_s`/`new_s`/`old_d`/`new_d`. `reviewBatch` applies a batch in chronological order, all or nothing.
> - `rating.ts`: `ratingFromOutcome({ correct, mode, responseMs, hintUsed })` per the auto-rating table in Part I §2.
> - `preview.ts`: `previewIntervals(card, now, scheduler)` → per rating `{ rating, due, interval: { value, unit } }`.
> - `queue.ts`: `buildQueue(db, now, { reviewLimit, newLimit })` (due cards, most overdue first, then New cards up to the daily limit per learning day), `learningDayStart(now)`, and `counts(db, now)` → `{ due, newAvailableToday, learning }`. Add the `new_cards_per_day` setting (default 10, 0–50) in a migration.
>
> Test interval growth (Again/Good/Good/Easy, and a lapse after a long interval), the retention setting, persistence and batch rollback, timestamp checks, lossless mapping, the auto-rating table with its boundaries, learning-day boundaries, the new-card limit, and a clock guard that fails if `srs/` calls `Date.now()` or `new Date()` without arguments. Pin the ts-fsrs version in `package.json`. Add `tool/srs-walkthrough.ts`, printing one card's intervals for Good ×4, Again, Good ×2.

**Result:** scheduler, queue policy and tests.
**Check:** run `node tool/srs-walkthrough.ts`; intervals should read roughly minutes → days → weeks, then collapse on the lapse.

---

#### Phase 4 — LLM provider layer

> Build `src/lib/server/llm/` (design in Part II §4): a provider-agnostic client that turns a request plus a Zod schema into a validated object. No exercise prompts (Phase 5), no routes, no UI.
>
> - **Modes:** add `structured_mode` (`json_schema` | `tool` | `json_prompt`, default `json_schema`) to `llm_providers` and make `env_key_name` nullable (keyless Ollama), in a migration.
> - **Schemas:** derive JSON Schema from Zod; `toProviderSchema(schema, target)` sanitizes for OpenAI strict and Anthropic, moving stripped constraints into descriptions. Always validate locally with Zod.
> - **Client:** `generateStructured({ purpose, system, user, schema, maxTokens, temperature, providerId })` → call, extract JSON, normalize enum casing, validate, one repair attempt, else `LlmSchemaError`; refusals throw `LlmRefusalError`. Also `generateText`.
> - **Transport:** injected `fetch`, 60 s timeout, retry (3 attempts, backoff with jitter, `Retry-After`) on network errors, timeouts and 429/500/502/503/504/529; fallback to `is_fallback` after exhausted retries, on 401/403 or a missing key env var, never on schema errors or refusals. `base_url` must be https except localhost.
> - **Call log:** `llm_calls` table and repository (`record`, `countSince`, `usageSince`); one row per HTTP attempt; no text, no keys.
> - **Secrets:** key read from `process.env` at call time; every error goes through `redact()`.
> - **Tools:** `npm run llm:provider:add` (insert a provider row) and `npm run llm:smoke -- --provider <name>` (one live structured call; never in CI).
>
> Test with mocked `fetch` only: request shape per wire format and mode, response parsing, JSON extraction, enum normalization, the sanitizer, repair, retry, fallback, refusals, key safety (no key in any error or `llm_calls` row) and config validation.

**Result:** LLM layer with both wire formats, three structured modes, and tests.
**Check:** `npm test` passes, including the key-leak test; `npm run llm:smoke -- --provider <name>` returns a parsed object with your real key.

---

#### Phase 5a — Content import and the cloze pipeline

> Build the content import and the cloze pool (design in Part II §5; plan in `plans/phase-05a.md`).
>
> - **Import:** `npm run content:import` upserts `ngsl.json` → `lexemes` and `tatoeba-en-vi.json` → `sentences` idempotently, with `level_band = max(1, ngsl_band_max ?? 1)`, `has_stock_names`, and the blocklist (`src/lib/server/content/blocklist.txt`, matched on lemmas) marking sentences `blocked` without deleting them; `--reblock` re-applies it.
> - **Data model:** `cloze_items`, `cards.cloze_item_id` (unique when not null), `generated_cache.prompt_version`, sentences `blocked` / `blocked_reason` / `has_stock_names`.
> - **Pipeline:** deterministic candidates (lexical, article, preposition, verb_form) → LLM distractors for lexical gaps (10 per call) → deterministic rules → blind critic (10 per call) → store, failures included. Every prompt module exports a version string.
> - **Commands:** `npm run cloze:build -- [--bands 1-3] [--types ...] [--limit 200] [--provider name] [--max-calls 50] [--dry-run]` with cost guards (`--max-calls`, `LLM_DAILY_CALL_CAP`), and `npm run eval:cloze -- [--n 30]`.
>
> Test with a mocked LLM only: candidates, every rule, the critic's acceptance logic, batching and per-batch failure isolation, cost guards, and the import.

**Result:** content imported, a validated cloze pool spread across gap types and bands.
**Check:** `content:import` is a no-op the second time; `cloze:build -- --dry-run` runs end to end; in `eval:cloze`, a human finds at most 1 bad item among 30 validated items.

---

#### Phase 5b — Passages, error drills, grading and prefetch

> Build the remaining generators, the grading services and the prefetch job (design in Part II §5; plan in `plans/phase-05b.md`). No UI. Reuse the 5a building blocks: form map, detectors, the blind-critic pattern, cost guards, `content_hash` dedupe, prompt versions. Prefer real Tatoeba sentences with deterministic transformations; use the LLM only for human-quality judgement or explanation, and verify every generated item with a blind critic.
>
> - **Error drills** (`kind = 'error'`): deterministic injection into Tatoeba sentences for ART PLU SVA COP TNS PRE; LLM-written for COL WFM WOR; a Vietnamese explanation (≤ 2 sentences, 10 per call); rules (one change region of ≤ 3 tokens, spans, topic, blocklist); a blind critic that sees only the erroneous sentence and must find exactly the one fix.
> - **Reading passages** (`kind = 'reading'`): band + one of 20 topics; length by band; 2 questions; glossary ≤ 5; rules including 95% coverage at band + 1; a blind critic that answers without the key.
> - **Grading** (live, no cache): `gradeWriting` (WritingFeedback; indirect mode hides `corrected_text` in the UI shape) and `gradeTranslation` (+ `meaning_ok`; the reference is one valid translation).
> - **Writing prompt bank**: about 40 static prompts across bands and topics.
> - **Prefetch**: stock targets (cloze per band, passages per band, drills per code × band, for bands 1 … ceiling + 1), cheapest first, `maxCalls`; `POST /api/cron/prefetch` with a timing-safe bearer secret, a single-run DB lock (stale after 30 min) and `LLM_DAILY_CALL_CAP`; `npm run prefetch`.
> - **Tooling**: every CLI on `parseArgs` with `--help` and unknown-flag errors; `npm run llm:usage`; `eval:drills`, `eval:reading`, `eval:grading` (12 fixtures, each graded twice).
>
> Test with a mocked LLM only.

**Result:** drills, passages, grading services, the prefetch job and its endpoint.
**Check:** `npm run verify`; `prefetch -- --dry-run` runs end to end; with a key, read `eval:drills`, `eval:reading` and `eval:grading` yourself — validation catches structure, not teaching quality.

---

#### Phase 6 — App shell and authentication

> Build authentication, the navigable shell, the theme and the shared components (design in Part II §6; plan in `plans/phase-06.md`). No learning features; the one exception: Home shows real card counts from the SRS `counts()`. **No PWA** (Part 0, Decisions).
>
> - **Auth:** single user, argon2id hash in `APP_PASSWORD_HASH` (`npm run auth:hash`, hidden prompt twice), server-side sessions (`auth_sessions`, 30 days sliding), cookie rules from `COOKIE_SECURE` + `ORIGIN` (HTTP allowed, with a warning and a login notice for a non-local origin). The chokepoint is `handle` in `src/hooks.server.ts` with an explicit public allowlist; pages redirect to `/login?next=…` (validated), `/api/*` answers 401. Login: argon2 verify, 5 failures per IP per 10 minutes then 429, a constant 300 ms delay on failure; unconfigured means nothing is reachable. Logout is a POST action.
> - **Shell:** `(app)` group: Home (`Hôm nay`), Stats (`Tiến độ`), Settings (`Cài đặt`) with a bottom tab bar; `/session` full screen with an exit. Every string in `messages/vi.ts`.
> - **Design:** mobile-first (360–430 px), primary actions in the thumb zone, 48 px targets, safe areas; light/dark following the system with a cookie override; self-hosted Be Vietnam Pro (UI) and Literata (English reading); body 17 px, reading 19 px; calm palette tokens meeting WCAG AA in both themes; states readable without colour; reduced motion respected.
> - **Components** (`src/lib/components/`): Button, Card, ProgressBar, OptionButton, TextAnswer, EmptyState, ErrorState, LoadingState, TabBar; a dev-only gallery at `/dev/components` (404 in production).
>
> Tests: Playwright (redirects, 401s, cron secret, wrong password, 429, `next`, logout, expiry, the HTTP notice, unconfigured server) and Vitest (sessions, `next`, rate limiter, cookie rule). `npm run screenshots` captures the screens in both themes.

**Result:** an app with login, navigation and theme, in the phone's browser.
**Check:** `npm run verify` and `npm run test:e2e`; look at `npm run screenshots`; log in from the phone's browser.

---

#### Phase 7 — Deploy to the VPS

Built after Phase 10 (the owner's build order). No reverse proxy and no TLS (Part 0, Decisions): the app is served by Node on `http://103.82.195.48:3000`, on a VPS that also runs other services.

> Produce in `deploy/`:
> - **`silentenglish.service`**, a systemd unit template:
>   - `User=` and `WorkingDirectory=` are filled in by `install.sh`;
>   - `EnvironmentFile=<repo>/.env`, `ExecStart=/usr/bin/env node build/index.js`, `Restart=always`, `RestartSec=3`;
>   - `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome=read-only`, and `ReadWritePaths=<repo>/data`.
> - **`install.sh`**, run once with sudo and idempotent:
>   - it renders, installs and enables the unit;
>   - it adds a sudoers drop-in, validated with `visudo -cf`, allowing only `systemctl restart|status silentenglish` and `journalctl -u silentenglish` without a password;
>   - it refuses a missing `.env` or one that is not mode 600;
>   - it does not start the service while port 3000 is taken.
> - **`deploy.sh`**, no password, `set -euo pipefail`:
>   - `git pull --ff-only`, `npm ci`, then a build with only `ORIGIN` read from `.env`;
>   - a pre-deploy snapshot, then `sudo systemctl restart silentenglish`;
>   - polling `/healthz` for 30 s; on failure, the last 50 journal lines.
> - **`backup.sh`:** `npm run db:snapshot` (VACUUM INTO `data/backups/`, `PRAGMA integrity_check`, the newest 14 kept).
> - **`crontab.example`:** prefetch at 03:00 and backup at 03:30, `CRON_TZ=Asia/Ho_Chi_Minh`, logs in `data/logs/` with size-based rotation.
> - **`litestream.yml.example`:** optional offsite replication.
>
> Add a public **`/healthz`** (allowlisted with a comment): `200 {"ok":true,"db":"ok","migrations":n}` or 503. Move to Node 24 LTS (`.nvmrc`, `engines`). Complete the production block in `.env.example`. Write the runbook in `plans/phase-07.md`.
>
> Do not put any secret in the repository. The `.env` file is created by hand on the server.

**Result:** the app running at `http://103.82.195.48:3000` as a systemd service, deployed with one passwordless command, with nightly verified snapshots.
**Check:** open it on a phone over 4G and log in; `systemctl status` is green; `/healthz` answers; **restore a snapshot into a scratch file once and open it**. A backup that has never been restored is not a backup.

---

#### Phase 8 — Placement test

**As built:** the owner's Phase 8 prompt refined the one below, and the refinements win.
- Part B uses single validated `cloze_items` (12, adaptive), not passages from `generated_cache`.
- Only the learner's rating moves (items keep their level band as difficulty).
- A new `placement_attempts` table makes the test resumable.
- The algorithm is in Part I §7 and the details in `plans/phase-08.md`.


> Implement the placement flow per Part I §7 of `docs/architecture.md`.
>
> **Part A** — adaptive yes/no vocabulary: real words sampled from NGSL bands interleaved with pseudo-words from `src/lib/server/content/pseudowords.json`. Score hits minus false alarms. Step the band up or down on performance. Around 40 items, 3–4 minutes.
>
> **Part B** — 2–3 cloze/C-test passages drawn from validated `generated_cache` items. Never generate live during the test.
>
> **Part C** — one short Vietnamese writing prompt. On submit, always persist to `writing_submissions` with `status='queued'`, then grade. If grading fails or times out, finish the test with a vocabulary-plus-cloze estimate, set `placement_results.writing_status='queued'`, and refine the estimate automatically when grading later succeeds.
>
> Ability estimation: Elo-style update, `rating += K * (actual - expected)` for both item and learner. Map the final rating to CEFR, then to VSTEP, IELTS and TOEIC estimates using a mapping table you add to `plans/phase-08.md`. Store overall theta plus vocab/grammar/reading/writing sub-scores and the full item log; update `user_profile` including `known_band_ceiling`.
>
> Present results as estimates with a clear Vietnamese caveat that this is not a certified score. Make the test retakeable from Settings and show the previous result beside the new one.

**Result:** a complete, retakeable placement flow.
**Check:** take it once; then cut the network during Part C and confirm the test still finishes, then restore the network and see the estimate refined.

---

#### Phase 9 — Session loop

**Split (the owner's decision); both parts are done:**
- **9a (done): the session engine and the daily cloze review loop.**
  - Composition, the start/finish API, the shared answer check, the `/session` screen, and Home's start button with budget chips.
  - Only the **Nhanh** shape is built, so after 9a the app is usable daily for quick reviews.
  - Details are in Part I §8 and `plans/phase-09a.md`.
- **9b (done): the rest of this section**, as built in Part I §8 and `plans/phase-09b.md`:
  - **Anchors:** Đọc (a graded passage + 2 questions), Viết (a writing task or a VI→EN translation) and error-correction drills.
  - **Rotation:** Đọc/Viết on alternating days, and degrading to Nhanh with a prefetch prompt when stock is short.
  - **Unseen feedback:** shown at the start of a session (placement writings included), which makes that day prefer Đọc.
  - **Error mining:** each AI-returned error becomes a card tagged with its `topic_code`. Each error card gets its **own `sentences` row** (`source = 'user_error'`); otherwise the cards unique index would merge every error card of a topic into one (`plans/backlog.md`).
  - **Writing grading:** gains an `on_topic` / task-relevance criterion, because the Phase 8 screenshots showed an off-topic answer graded A2.

> Implement the session engine per Part I §8 of `docs/architecture.md`.
>
> The engine takes a time budget and composes: warm-up (3–4 due cloze items) → review block (due cards through the Phase 3 scheduler, rated Again/Hard/Good/Easy) → one anchor segment by shape: **Nhanh** (~5 min, no anchor), **Đọc** (~8 min, one graded passage plus 2 comprehension questions), **Viết** (~8 min, a short writing or VI→EN translation task).
>
> Rotate Đọc/Viết on alternating non-Nhanh days. If any `writing_submissions` are `scored` with unseen feedback, show that feedback at session start and prefer Đọc that day.
>
> **All content comes from `generated_cache`.** If the cache is short for a needed kind, degrade to Nhanh and surface a prompt to run prefetch — never block a session on a live LLM call.
>
> **One request in, one request out:** `GET /api/session/start` returns the entire session payload in one response. The session runs client-side. Results are batched and submitted once at the end via `POST /api/session/finish`. The app is always online (Part 0, Decisions): no `localStorage` retry.
>
> Writing anchor: persist with `status='queued'` on submit, grade server-side, show feedback inline if it returns in time, otherwise at the start of the next session.
>
> Card presentation: multiple-choice when stability is low, free-typing once it passes a threshold. Promote per card, not globally.
>
> **Error mining:** every AI-returned error creates a candidate card tagged with its `topic_code`.
>
> End screen: items completed, words strengthened, streak state, weekly goal progress.
>
> Add a Playwright test completing a full session end to end.

**Result:** a daily session that works end to end.
**Check:** run all three shapes; confirm a session makes exactly one start and one finish request; confirm error mining creates tagged cards.

---

#### Phase 10 — Progress, review book, settings and providers

> **Motivation** (`src/lib/server/progress/`, recomputed on read): studied days (≥ 5 items, 04:00 boundary), the streak with auto-freeze, the weekly goal, the 12-week heat-map, the 7-day forecast, totals, the weakness profile and the level history, exactly as Part I §9 describes. **Do not implement** hearts or lives, leagues, leaderboards, loss-framed messaging, or a daily-only streak.
>
> **`/stats` ("Tiến độ"):** the streak (a number and "ngày liên tiếp", no flame), freezes with a short explanation, this week's goal; a hand-rolled SVG heat-map and forecast, each with a text alternative and AA contrast in both themes; the weakness list with **Luyện chủ đề này**; totals and level history.
>
> **Review book ("Sổ ôn tập", a tab between Tiến độ and Cài đặt):** "Hay sai" (lapses, then the lowest retrievability; mined errors always in, tagged "Lỗi của bạn") with **Ôn các thẻ hay sai** (a Nhanh session of the 15 hardest unsuspended cards regardless of due); "Đã học" (every non-New card, searchable by English, answer or Vietnamese; the next review in plain words); a detail sheet (the sentence with the answer highlighted, the Vietnamese, `answer_vi`, gap type and topic, source, review history with the interval each review set) with **Ôn ngay** (due = now) and **Tạm ẩn / Bỏ ẩn** (`cards.suspended`, migration 0009). Focus sessions: the start body takes `focus: { kind: 'hard' } | { kind: 'topic', code }`, validated with Zod; they serve existing cards only (no new cards, no anchor).
>
> **Settings:** Học tập (retention 0.70–0.97 with "cao hơn = nhớ chắc hơn nhưng ôn nhiều hơn", new cards per day 0–50, default budget 5/8/10, weekly goal 1–7, feedback mode, retake placement), validated with Zod like the CHECKs and applied from the next session; Giao diện; Nội dung (stock per band and per topic, and **Tạo thêm bài tập**: a background prefetch of at most 30 calls under the prefetch lock and the daily cap, disabled without an active provider); Nhà cung cấp AI (Part II §4); Sử dụng AI (7 days); Dữ liệu (**Tải bản sao lưu**: `VACUUM INTO` a temp file, downloaded behind auth, the file deleted; **Nguồn dữ liệu & giấy phép**, from the `license_tag`s present and the word-list package's metadata); Tài khoản.
>
> **Home:** a compact "today" card replaces the tagline. **Housekeeping:** expired `auth_sessions` are deleted on each successful login and at the start of each prefetch run.

**Result:** progress, the review book, settings and provider management (`plans/phase-10.md`).
**Check:** add one OpenAI-compatible and one Anthropic provider and confirm both work; open `app.db` with sqlite3 and confirm no string resembling an API key is present; download a backup and open it.

---

#### Phase 11 — Hardening

> Final pass: error, empty and offline states on every screen; migration tests from each prior schema version; eval fixtures; a rate limit of 60 requests per hour on every route that calls the LLM; `npm run check`, lint and the full test suite green.

**As built** (`plans/phase-11.md`), together with the quality fixes found in use:
- **Stale providers:** a provider id that no longer exists gives a toast and a reloaded list.
- **Grading:** the model returns every error, all of them are mined, and the learner sees 3 with distinct codes first plus a repeat count.
- **Reading coverage:** an everyday-word allowlist for bands ≤ 4, the band's word list in the prompt, and one rewrite.
- **Cloze:** article gaps only where a rule fixes the answer, and a critic check that no other option could also be correct.
- **Content filter:** the blocklist now matches phrases and covers death, drinking and self-harm.
- **Hardening:** a 60/hour in-memory limit on LLM routes; queued writing says why it is queued; a no-provider notice on Home; a test that migrates a database from every earlier version.

---

### Hard gates

| After phase | Condition |
|---|---|
| 1 | Pseudo-word list reviewed by hand; Tatoeba pair count known |
| 3 | Intervals grow sensibly in a manual walkthrough |
| 5 | In `eval:cloze`, a human finds at most 1 bad item among 30 validated items |
| 7 | A snapshot restored and opened once (`plans/phase-07.md`, step 9) |
| 9 | A full session completes, with one start request and one finish request |

### Three most likely failures

1. **Committing an API key.** Mitigated by the Phase 0 hook, but still the biggest risk.
2. **A missing or bypassed login gate.** A public app anyone can use spends the owner's API credits. Hence one chokepoint in `src/hooks.server.ts`, plus Playwright tests proving it.
3. **Generated content that passes validation but teaches poorly.** That is why Phase 5 requires a human to read items, not just a pass rate.

### Optional early playable

After Phase 3, hard-code 50 Tatoeba cloze items and a bare review page. Throwaway code, but having the review loop in hand shows whether the interaction feels right before investing in Phases 4–9. Delete it in Phase 6.

---

## Part IV — Caveats

- **No offline mode, no PWA** (Part 0, Decisions). The app is used in a browser and assumes a connection. If that changes, a PWA or a Capacitor shell can reuse all the code.
- **Plain HTTP on an IP address.** The password and the session cookie cross the network unencrypted, by the owner's decision; the login page says so. The rate limit, the constant failure delay and server-side sessions limit the damage. HTTPS can be added in front later (Tailscale or a Cloudflare Tunnel) without code changes: set `ORIGIN=https://…` and `COOKIE_SECURE=true`.
- **The app is on the public internet.** Authentication, rate limiting and a provider-side spending cap are three separate layers, not one.
- **LLM output is a draft, not an authority.** Items can be ambiguous and grading can drift between runs. The pipeline catches structural defects, not weak teaching. Keep the eval set and re-read items now and then.
- **Model prices and names change constantly.** This document deliberately quotes no prices. Check current rates before choosing a model.
- **Licensing obligations are real.** NGSL is ShareAlike; Tatoeba requires attribution. The `license_tag` column and credits page make compliance automatic.
- **Placement results are estimates.** An Elo scheme over an uncalibrated item bank is not a psychometric instrument; the UI must say so.
- **Tatoeba EN–VI coverage is thin.** Treat LLM generation as the main sentence source from the start.
- **SvelteKit was chosen to keep the plan moving.** Switching to Next.js would not affect Part I, the data model, the LLM layer or deployment — only routes and components.
