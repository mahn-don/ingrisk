# SilentEnglish — Architecture & Build Roadmap

**Revision 3 (web + VPS).** Supersedes the earlier Flutter/mobile design. The learning methodology carries over unchanged; the technical design and roadmap are rewritten for a web app on a VPS.

**What it is:** a personal, single-user, non-commercial web app that teaches English **reading, writing, vocabulary and grammar** to a Vietnamese speaker. No audio of any kind, no microphone. Sessions fit a 5–10 minute gap and are used on a phone as an installed PWA. The UI is entirely in Vietnamese; code, comments, docs and commit messages are in English.

**How to use this document (for Claude Code):** this is the single source of truth for the project. Part I is the learning design, Part II the technical architecture, Part III the phased build plan with the prompt for each phase. When working on a phase, read Part II and that phase's section in Part III; consult Part I when the phase references it. Do not build anything outside the current phase's scope.

---

## Part 0 — What changed from the mobile design

| | Mobile (Flutter, superseded) | Web + VPS (current) |
|---|---|---|
| Runs on | The user's phone | A VPS in Singapore |
| API keys | On the device, not truly hideable | In `.env` on the server; the client never sees them |
| Offline | Fully offline | Tolerates flaky connections; not fully offline |
| Exercise prefetch | Job runs when on Wi-Fi | Cron at 03:00, content always ready |
| FSRS | Hand-ported | `ts-fsrs` library |
| Dev loop | Rebuild and reinstall on device | Edit, refresh the browser |
| Claude Code can test it itself | No (needs an emulator) | Yes (curl, Playwright) |
| Cost | Free | ~US$5–6/month |

**New risk:** the app is on the public internet. Without a login gate, anyone who finds the domain can use it, which means spending the owner's LLM credits. **Authentication is mandatory**, and it lands in Phase 6, before the first deploy.

**What is lost:** true offline use. It is compensated for by sending the whole session's content to the client when the session starts, running the session entirely client-side, and submitting results once at the end. Losing signal mid-session is fine; a whole flight is not.

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

**Part A — adaptive yes/no vocabulary (3–4 min).** Real words sampled from NGSL bands, interleaved with pseudo-words. Score = hits − false alarms (corrects for guessing). Step the band up or down based on performance.

Pseudo-words are **not** generated by the LLM at runtime: LLMs produce either rare real words (which silently penalize strong learners) or obviously non-English strings (free points). Ship a fixed, human-checked list of ~120 pseudo-words that follow English phonotactics (e.g. `plurthy`, `dispone`, `fantule`).

**Part B — cloze / C-test passages (3–4 min).** Two or three short graded passages with gaps, drawn from validated cached items, never generated live during the test.

**Part C — writing sample (2–3 min).** One prompt (e.g. "Viết 3–4 câu về cuối tuần của bạn"), scored by the LLM against a fixed rubric mapped to CEFR descriptors: range, accuracy, coherence. If grading fails or times out, the test still completes with a vocabulary + cloze estimate, and the estimate is refined once grading succeeds.

**Ability estimation:** full IRT needs a calibrated item bank, which this project does not have. Use an **Elo-style update**: each item has a difficulty rating, the learner an ability rating, and after each response both move by `K × (actual − expected)`. Map the final rating to CEFR with cut-scores tuned over time. Store overall theta, sub-scores (vocabulary, grammar, reading, writing) and the full item log, so a retake can be compared with the previous result.

### 8. Session structure — time-budget driven

Every session: warm-up (3–4 due cloze items) → review block (due cards, rated Again/Hard/Good/Easy through FSRS) → **at most one** anchor segment:

| Shape (UI name) | Length | Anchor |
|---|---|---|
| Quick (**Nhanh**) | ~5 min | None, review only (~15 items) |
| Read (**Đọc**) | ~8 min | One graded passage + 2 comprehension questions |
| Write (**Viết**) | ~8 min | One short writing task or a VI→EN translation |

Read and Write alternate across days. If a graded writing submission has unseen feedback, show it at the start of the session and prefer Read that day.

**Error mining:** every error the LLM identifies becomes a candidate card tagged with its taxonomy code, so the review pool gradually targets the learner's real weaknesses.

**Later modes** (behind settings, not in v1): pure cloze sprint; text-chat tutor with inline correction; dedicated error-correction drills.

### 9. Motivation — deliberately gentle

Rigid daily streaks cause anxiety and abandonment after one missed day. Duolingo's own analysis found that separating streaks from daily goals and adding freezes increased learners on 7+ day streaks by over 40%.

**Build:** a flexible streak with auto-freeze (2 banked, one earned per 5 sessions, consumed automatically on a missed day); a **weekly** goal (default 5 of 7 days) as the headline metric; a calendar heat-map; a cumulative "words strengthened" count.
**Do not build:** hearts or lives, leagues, leaderboards, loss-framed messaging, daily-only streaks.

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
| Web server | **Caddy** | Automatic TLS, five-line config |
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
deploy/                  # Caddyfile, systemd unit, Litestream config
docs/                    # this document
plans/                   # per-phase plans and roadmap status
```

Nothing in `lib/server/` may be imported from client code; SvelteKit enforces this at build time.

All Vietnamese UI strings live in `lib/messages/vi.ts`. No i18n library is needed, but strings must not be scattered across components.

### 3. Data model

Implemented in `src/lib/server/db/schema.ts` (Drizzle), with migrations in `src/lib/server/db/migrations/`.

**Conventions:** timestamps are `integer` Unix milliseconds; JSON columns are `text`; booleans are `integer` 0/1; enumerations are `text` with a CHECK on the allowed values; every foreign key states its `ON DELETE`. Column names are snake_case (TypeScript properties are camelCase).

```sql
settings(id = 1, desired_retention, weekly_goal_days, default_session_budget,
         feedback_mode, active_provider_id → llm_providers ON DELETE SET NULL)
-- single row, CHECK (id = 1); seeded: 0.9, 5, 8, 'direct', NULL.
-- CHECKs: desired_retention 0.70–0.97, weekly_goal_days 1–7, default_session_budget 1–60.

llm_providers(id, name UNIQUE, base_url, model, wire_format, env_key_name,
              enabled, is_fallback)
-- env_key_name names an environment variable, e.g. 'OPENAI_API_KEY'; a CHECK allows only
-- [A-Z0-9_], 1–64 chars. At most one row has is_fallback = 1 (partial unique index).
-- NO COLUMN EVER HOLDS A KEY.

user_profile(id = 1, theta, cefr_estimate, vstep_estimate, ielts_estimate,
             toeic_estimate, vocab_theta, grammar_theta, reading_theta,
             writing_theta, known_band_ceiling, updated_at)
-- single row, CHECK (id = 1); seeded with null estimates and known_band_ceiling = 1.

placement_results(id, taken_at, theta, cefr, subscores_json, item_log_json,
                  writing_status)

lexemes(id, headword UNIQUE, pos, ngsl_rank, freq_band, forms, supplementary,
        vi_gloss, en_def, source, license_tag)
-- forms: JSON array of every inflected form; supplementary: NGSL days/months/number words.
collocations(id, lexeme_id → lexemes ON DELETE CASCADE, chunk, example_en, example_vi)
sentences(id, en_text, vi_text, source, tatoeba_id_en UNIQUE, tatoeba_id_vi,
          ngsl_band_max, off_list_count, license_tag, level_band)
-- tatoeba_id_en is NULL for LLM-generated sentences.

cards(id, kind, lexeme_id → lexemes, sentence_id → sentences,
      grammar_topic_id → grammar_topics,          -- all ON DELETE RESTRICT
      prompt_mode,
      due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
      reps, lapses, state, last_review)           -- every field of ts-fsrs Card
-- UNIQUE (kind, lexeme_id, sentence_id, grammar_topic_id), NULLs counted as 0.
review_logs(id, card_id → cards ON DELETE RESTRICT,
            rating, state, due, stability, difficulty, elapsed_days,
            last_elapsed_days, scheduled_days, learning_steps, review,
                                                  -- every field of ts-fsrs ReviewLog
            old_s, new_s, old_d, new_d)
-- A card with reviews cannot be deleted, so the review history is never lost.

sessions(id, client_session_id UNIQUE, started_at, ended_at, budget_min, shape,
         items_done, streak_after)

generated_cache(id, kind, params_hash, content_hash UNIQUE, level_band,
                payload_json, model, created_at, validated, validation_notes,
                served_at)

writing_submissions(id, session_id → sessions ON DELETE SET NULL, prompt,
                    user_text, corrected_text, errors_json, cefr_estimate, status,
                    submitted_at, scored_at, feedback_seen_at)

grammar_topics(id, code UNIQUE, name_vi, name_en, l1_interference)
-- seeded with the 10 codes of Part I §6.
```

Indexes: `cards(due)`, `review_logs(card_id, review)`, `collocations(lexeme_id)`, `generated_cache(kind, params_hash)`, `generated_cache(kind, validated, served_at)`, `writing_submissions(status)`, plus the unique indexes above.

Enumerations: `kind` ∈ cloze | translate | grammar | reading | error (cards and generated_cache); `status` ∈ queued | scored | failed; `wire_format` ∈ openai | anthropic; `shape` ∈ quick | read | write; `writing_status` ∈ none | queued | scored; `feedback_mode` ∈ direct | indirect; `prompt_mode` ∈ choice | typing; `state` ∈ New | Learning | Review | Relearning and `rating` ∈ Manual | Again | Hard | Good | Easy (ts-fsrs `State` and `Rating` names); CEFR columns ∈ A1 … C2; `code` ∈ the taxonomy codes.

Connection (`src/lib/server/db/client.ts`): `DATABASE_PATH` (default `data/app.db`), pragmas `journal_mode = WAL` (required by Litestream), `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. Migrations run at server start from the SvelteKit `init` hook; a failed migration stops the server.

### 4. LLM layer

One interface, two adapters, both normalized to `LlmResponse { text, parsedJson, usage, model, finishReason }`.

**OpenAI-compatible adapter** — covers OpenAI, OpenRouter, DeepSeek, Gemini's compatible endpoint, Ollama:
- `POST {base_url}/chat/completions`
- System prompt is a message with `role: "system"`
- Structured output via `response_format: { type: "json_schema" }`
- Tool arguments arrive as a **JSON string** needing a parse step
- Usage: `usage.prompt_tokens` / `usage.completion_tokens`

**Anthropic adapter:**
- `POST {base_url}/v1/messages`, with an `anthropic-version` header
- System prompt is a **top-level `system` parameter**, not a message
- `max_tokens` is **required**
- Tool use via `stop_reason: "tool_use"`; the content block's `input` is **already parsed JSON**
- Usage: `usage.input_tokens` / `usage.output_tokens`

These four divergences (system placement, tool-argument shape, usage field names, streaming event shapes) are the whole reason the abstraction exists. Each needs its own test.

API keys are read from `process.env`, never written to the database, never logged, never included in an error message. A test asserts that an adapter error's string form does not contain the key.

Retry with exponential backoff on 429 and 5xx; fall back to the provider flagged `is_fallback`; surface a clear Vietnamese error if all fail. Do not hard-code prices: model tiers and rates change often.

### 5. Generation and the validation pipeline

Generation is batch and ahead of time, never during a session. A cron job at 03:00 (Asia/Ho_Chi_Minh) calls `/api/cron/prefetch` (guarded by a secret), filling `generated_cache` to N items per kind based on `known_band_ceiling`.

Every generated item passes:
1. **Schema validation** with Zod.
2. **Rule checks:** the gap word occurs in the sentence; exactly one option is correct; distractors differ from each other and from the answer; content words are within the target band ceiling; the Vietnamese translation is non-empty and differs from the English.
3. **Critic pass** (optional): a second cheap call asking "is this item unambiguous and correctly keyed?" Enable it for any kind with a high rejection rate.
4. Store with `validated = true` only if all checks pass; otherwise store with notes for inspection and regenerate.

Threshold: over 95% pass rate per kind before relying on it.

**Cloze schema**
```ts
const ClozeItem = z.object({
  sentence_en: z.string(),
  gap_word: z.string(),
  distractors: z.array(z.string()).length(3),
  vi_translation: z.string(),
  target_lexeme: z.string(),
  cefr_band: z.enum(['A1','A2','B1','B2','C1','C2'])
}).strict();
```

**Writing-feedback schema**
```ts
const WritingFeedback = z.object({
  corrected_text: z.string(),
  errors: z.array(z.object({
    original: z.string(),
    correction: z.string(),
    topic_code: z.enum(['ART','TNS','PLU','SVA','COP','PRE','COL','WFM','WOR','OTH']),
    explanation_vi: z.string()
  })).max(3),
  cefr_estimate: z.enum(['A1','A2','B1','B2','C1','C2']),
  scores: z.object({
    range: z.number().int(),
    accuracy: z.number().int(),
    coherence: z.number().int()
  })
}).strict();
```

Constraining `topic_code` to the enum is what makes error mining work: free-text error labels cannot be aggregated into a weakness profile.

### 6. Authentication and safety

The app is on the public internet, so:
- **A single password gate.** Hash with argon2, store the hash in env. Session cookie is `httpOnly`, `secure`, `sameSite=lax`, valid 30 days.
- The guard lives in `+layout.server.ts` of the `(app)` route group, protecting everything in it from one chokepoint. Guarding routes individually means one forgotten route is exposed.
- **Rate-limit** routes that call the LLM. One user does not need more than 60 calls per hour.
- **Set a spending limit at the LLM provider** and enable usage alerts. This is the last line of defence against a runaway loop.
- The cron endpoint compares its secret with a timing-safe comparison, not `===`.
- SSH: key-only, password login disabled, `fail2ban`.

### 7. Deployment

```
Internet → Caddy (443, automatic TLS) → Node (127.0.0.1:3000, systemd)
                                          ↓
                                    data/app.db
                                          ↓
                                    Litestream → R2 / B2
```

- **VPS:** Vultr or DigitalOcean, Singapore region, ~US$5–6/month, 1 vCPU / 1 GB RAM. Ample for one user. (Hetzner is cheaper but has no Asian region; latency from Vietnam would be ~250 ms.)
- **Caddy:** a few lines of config; obtains and renews Let's Encrypt certificates itself.
- **systemd:** `Restart=always`, environment loaded from a `.env` file with mode 600.
- **Litestream:** continuous replication of the SQLite file to object storage.
- **Cron:** `crontab` calls the prefetch endpoint at 03:00 Vietnam time.
- **Deploy:** `git pull && npm ci && npm run build && systemctl restart silentenglish`, wrapped in `deploy/deploy.sh`.

Total cost: VPS ~US$5–6/month, domain ~US$10/year, LLM usage a few cents per month.

### 8. PWA and network resilience

- `manifest.json` and icons so the app installs to the home screen.
- A service worker caches the app shell (HTML, CSS, JS).
- **More important than caching:** when a session starts, the server returns **the entire session's content** in one response. The session runs fully client-side. Results are batched and submitted once at the end; if submission fails, they are kept in `localStorage` and retried on the next load.

### 9. Testing

- **SRS:** integration tests over `ts-fsrs`, asserting intervals grow sensibly across rating sequences.
- **Adapters:** mocked HTTP only; one test per wire-format divergence, plus the key-leak test.
- **Validation pipeline:** fixtures of known-good and known-bad items; assert accept/reject.
- **Database:** in-memory SQLite; migration tests from each earlier schema version.
- **E2E:** Playwright for login, a full session, and the placement test.
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

### 12 phases (0–11)

Dependency order: data and engines first, app shell and deploy in the middle, features last. Deploy sits at Phase 7 so every later phase ends with a real deploy, surfacing infrastructure problems early instead of at the end.

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

> Implement `src/lib/server/srs/` as a thin wrapper over the `ts-fsrs` package. Do not reimplement the algorithm.
>
> Expose one function: `review(card, rating, now) → { updatedCard, reviewLog }`, mapping our `cards` rows to and from the ts-fsrs card type. Read `desired_retention` from settings. Persist a `review_logs` row on every review.
>
> Write tests stepping a card through realistic rating sequences (Again/Good/Good/Easy, and a lapse after a long interval) and asserting that intervals grow monotonically for successful reviews and collapse on a lapse. Pin the ts-fsrs version in `package.json`.
>
> Also expose `dueCards(limit)` ordered by `due`, and a function returning counts of due/new/learning cards for the home screen.

**Result:** scheduler and tests.
**Check:** run the tests; step one card through Again/Good/Good/Easy and confirm the intervals grow plausibly (roughly minutes → days → weeks).

---

#### Phase 4 — LLM provider layer

> Build `src/lib/server/llm/` with an `LlmClient` interface `generate(request) → LlmResponse` and two adapters.
>
> **OpenAI-compatible adapter** — `POST {base_url}/chat/completions`; system prompt as a `system` role message; structured output via `response_format: { type: "json_schema" }`; tool arguments arrive as a JSON **string** requiring a parse; usage from `usage.prompt_tokens` / `usage.completion_tokens`.
>
> **Anthropic adapter** — `POST {base_url}/v1/messages` with an `anthropic-version` header; system prompt as a **top-level `system` parameter**; `max_tokens` **required**; tool use via `stop_reason: "tool_use"` with content-block `input` already parsed; usage from `usage.input_tokens` / `usage.output_tokens`.
>
> Normalize both to `LlmResponse { text, parsedJson, usage, model, finishReason }`. Read provider config from the `llm_providers` table; read the API key from `process.env[provider.env_key_name]`. **The key must never be written to the database, logged, or included in an error message** — add a test asserting a thrown adapter error's string form does not contain the key.
>
> Add exponential-backoff retry on 429 and 5xx, and fallback to the provider flagged `is_fallback`.
>
> Test with mocked HTTP only, never a live endpoint. Write one explicit test per wire-format divergence: system-prompt placement, tool-argument shape, usage field names, required `max_tokens`.

**Result:** LLM layer with both adapters and divergence tests.
**Check:** `npm test` passes, including the key-leak test.

---

#### Phase 5 — Generation and validation pipeline

> Build `src/lib/server/generation/`.
>
> Import the Phase 1 assets from `src/lib/server/content/` on first run: `ngsl.json` → `lexemes` with `freq_band` and `license_tag`; `tatoeba-en-vi.json` → `sentences` with `source='tatoeba'` and `license_tag`, using its `ngsl_band_max` and `off_list_count` fields to set `level_band`.
>
> Implement generators for: cloze, reading passage plus 2 comprehension questions, VI→EN translation task, error-correction drill targeting a given grammar topic code, and writing feedback. Each gets a prompt template in `src/lib/server/llm/prompts/` and a Zod schema. The cloze and writing-feedback schemas are in Part II §5 of `docs/architecture.md`.
>
> Implement the validation pipeline: Zod parse → rule checks (gap word present in the sentence; exactly one correct option; distractors distinct from each other and from the answer; content words within the target band ceiling; Vietnamese translation present and different from the English) → store in `generated_cache` with `validated` and `validation_notes`.
>
> Implement `prefetch(ceiling, counts)` filling the cache to N validated items per kind, and expose it at `POST /api/cron/prefetch` guarded by a `CRON_SECRET` compared with a timing-safe comparison.
>
> Add `npm run eval:generation` — generates 30 items, runs validation, prints the pass rate per kind.

**Result:** content imported, generators working, validation pipeline, prefetch endpoint.
**Check:** run the eval; the pass rate must exceed 95% per kind. **Read 10 accepted items yourself** — validation catches structure, not teaching quality.

---

#### Phase 6 — App shell and authentication

> Build authentication and the app shell before any feature screens.
>
> **Auth:** a single-user password gate. Hash with `@node-rs/argon2`, store the hash in `APP_PASSWORD_HASH`. `POST /login` verifies and sets an `httpOnly`, `secure`, `sameSite=lax` session cookie valid 30 days. Put the guard in `src/routes/(app)/+layout.server.ts` so every route in the group is protected by one chokepoint — do not guard routes individually. Add a small CLI script that prints the hash for a given password. Add a Playwright test asserting that an unauthenticated request to each `(app)` route redirects to `/login`.
>
> **Shell:** a layout with bottom navigation and four routes — Home (`Hôm nay`), Stats (`Tiến độ`), Settings (`Cài đặt`), plus a full-screen route for an active session. Each renders a placeholder with a real Vietnamese title from `messages/vi.ts` and an empty state.
>
> **Theme:** define colors, spacing and typography in the Tailwind config. Pick a font that renders Vietnamese diacritics correctly at small sizes — verify with `ệ`, `ữ`, `ặ`, `ỗ`. Build shared components: primary/secondary button, card, progress bar, empty state, error state, loading state.
>
> **PWA:** `manifest.json`, icons, and a service worker caching the app shell.
>
> No feature logic in this phase.

**Result:** an app with login, navigation and theme, installable to the home screen.
**Check:** try reaching a route without logging in; inspect Vietnamese diacritics at the smallest text size; install the PWA on a phone.

---

#### Phase 7 — Deploy to the VPS

Deploy early, while the app is nearly empty. Infrastructure problems are much cheaper to find now than after four feature phases.

> Produce the deployment setup in `deploy/` and a runbook in `plans/phase-07.md`. I am deploying to a fresh Ubuntu VPS in Singapore.
>
> 1. `deploy/Caddyfile` — reverse proxy to `127.0.0.1:3000`, automatic TLS for my domain, security headers (HSTS, X-Content-Type-Options, Referrer-Policy).
> 2. `deploy/silentenglish.service` — a systemd unit running `node build/index.js`, `Restart=always`, `EnvironmentFile=/etc/silentenglish/.env`, running as a non-root user.
> 3. `deploy/litestream.yml` — continuous replication of `data/app.db` to S3-compatible storage, with the bucket and credentials read from env.
> 4. `deploy/deploy.sh` — `git pull && npm ci && npm run build && sudo systemctl restart silentenglish`, failing loudly on any step.
> 5. `deploy/crontab` — call the prefetch endpoint at 03:00 Asia/Ho_Chi_Minh with the `CRON_SECRET`.
> 6. A runbook in `plans/phase-07.md` covering, in order: create the non-root user, SSH key-only access with password login disabled, ufw allowing only 22/80/443, fail2ban, install Node and Caddy, create `/etc/silentenglish/.env` with mode 600, first deploy, verify TLS, verify Litestream is replicating, and **restore the database from backup into a scratch directory to prove the backup actually works**.
>
> Do not put any secret in the repository. The `.env` file is created by hand on the server.

**Result:** the app running on your domain with HTTPS and backups.
**Check:** open it on a phone over 4G and log in; `systemctl status` is green; **restore the database from backup once and open it** — a backup that has never been restored is not a backup.

---

#### Phase 8 — Placement test

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

> Implement the session engine per Part I §8 of `docs/architecture.md`.
>
> The engine takes a time budget and composes: warm-up (3–4 due cloze items) → review block (due cards through the Phase 3 scheduler, rated Again/Hard/Good/Easy) → one anchor segment by shape: **Nhanh** (~5 min, no anchor), **Đọc** (~8 min, one graded passage plus 2 comprehension questions), **Viết** (~8 min, a short writing or VI→EN translation task).
>
> Rotate Đọc/Viết on alternating non-Nhanh days. If any `writing_submissions` are `scored` with unseen feedback, show that feedback at session start and prefer Đọc that day.
>
> **All content comes from `generated_cache`.** If the cache is short for a needed kind, degrade to Nhanh and surface a prompt to run prefetch — never block a session on a live LLM call.
>
> **Network resilience:** `GET /api/session/start` returns the entire session payload in one response. The session runs client-side. Results are batched and submitted once at the end via `POST /api/session/finish`; if that request fails, persist the payload to `localStorage` and retry on next load.
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
**Check:** run all three shapes; switch to airplane mode mid-session and confirm you can finish, with results submitted once the network returns; confirm error mining creates tagged cards.

---

#### Phase 10 — Settings, stats, motivation

> Build the Settings and Stats routes.
>
> **Settings:** manage LLM providers (name, base_url, model, wire_format, which env var holds the key, mark one as fallback, a "test connection" button); desired retention slider 0.70–0.97 with a plain-Vietnamese explanation of the trade-off; default session budget; weekly goal days; feedback mode (direct plus metalinguistic, or indirect); retake placement; run prefetch now; a credits page generated from the distinct `license_tag` values in the database.
>
> **Motivation — implement exactly this and nothing more:** a flexible streak with auto-freeze (2 banked, one earned per 5 sessions, consumed automatically on a missed day); a weekly goal defaulting to 5 of 7 days as the headline metric; a calendar heat-map; a cumulative words-strengthened count. **Do not implement** hearts or lives, leagues, leaderboards, loss-framed messaging, or a daily-only streak.
>
> Keep every string in `messages/vi.ts`.

**Result:** settings, stats and a gentle motivation layer.
**Check:** add one OpenAI-compatible and one Anthropic provider and confirm both work; open `app.db` with sqlite3 and confirm no string resembling an API key is present.

---

#### Phase 11 — Hardening

> Final pass. Add the eval fixture set in `test/eval/` (30 items, 10 writing samples) with a harness re-run after any prompt change. Add error, empty and offline states on every screen. Add migration tests from each prior schema version. Ensure the app does not crash when the cache is empty, a provider is misconfigured, or the network fails mid-session.
>
> Add rate limiting on every route that calls the LLM — 60 requests per hour is ample for one user.
>
> Run `npm run check`, `npm run lint` and the full test suite; fix everything.
>
> Then use a review subagent with this bounded question: "Compare the implementation against `docs/architecture.md` and `plans/roadmap.md`. Report only correctness defects and unmet stated requirements. Do not report style preferences, do not suggest architectural changes, and do not propose new features."
>
> Address only confirmed correctness gaps.

**Result:** a stable v1.
**Check:** tests green, a week of real use without errors, and one more backup restore.

---

### Hard gates

| After phase | Condition |
|---|---|
| 1 | Pseudo-word list reviewed by hand; Tatoeba pair count known |
| 3 | Intervals grow sensibly in a manual walkthrough |
| 5 | Validation pass rate over 95% per kind, **and** 10 items read by a human |
| 7 | Database restored from backup successfully once |
| 9 | A full session completes with the network cut mid-way |

### Three most likely failures

1. **Committing an API key.** Mitigated by the Phase 0 hook, but still the biggest risk.
2. **A missing or bypassed login gate.** A public app anyone can use spends the owner's API credits. Hence one chokepoint in the layout, plus a Playwright test proving it.
3. **Generated content that passes validation but teaches poorly.** That is why Phase 5 requires a human to read items, not just a pass rate.

### Optional early playable

After Phase 3, hard-code 50 Tatoeba cloze items and a bare review page. Throwaway code, but having the review loop in hand shows whether the interaction feels right before investing in Phases 4–9. Delete it in Phase 6.

---

## Part IV — Caveats

- **No true offline mode.** Compensated by loading the whole session client-side. Enough for a train, not for a flight. If needed later, wrap the app with Capacitor to get a native shell reusing all the code.
- **The app is on the public internet.** Authentication, rate limiting and a provider-side spending cap are three separate layers, not one.
- **LLM output is a draft, not an authority.** Items can be ambiguous and grading can drift between runs. The pipeline catches structural defects, not weak teaching. Keep the eval set and re-read items now and then.
- **Model prices and names change constantly.** This document deliberately quotes no prices. Check current rates before choosing a model.
- **Licensing obligations are real.** NGSL is ShareAlike; Tatoeba requires attribution. The `license_tag` column and credits page make compliance automatic.
- **Placement results are estimates.** An Elo scheme over an uncalibrated item bank is not a psychometric instrument; the UI must say so.
- **Tatoeba EN–VI coverage is thin.** Treat LLM generation as the main sentence source from the start.
- **SvelteKit was chosen to keep the plan moving.** Switching to Next.js would not affect Part I, the data model, the LLM layer or deployment — only routes and components.
