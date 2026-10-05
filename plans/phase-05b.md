# Phase 5b — Passages, error drills, grading and prefetch

Goal: the remaining generators (error drills, graded reading passages), the live grading
services, a static writing-prompt bank, and the prefetch job with its cron endpoint. No UI.
Every generated item passes deterministic rules and a blind critic, on a call budget. Tests use
a mocked LLM only. Design: `docs/architecture.md` Part II §5.

## Modules

| File | Purpose |
|---|---|
| `generation/drills/word-classes.ts` | Countable nouns, adjectives, simple pasts inferred from forms + corpus (NGSL has no POS) |
| `generation/drills/inject.ts` | The six deterministic injections (ART PLU SVA COP TNS PRE) |
| `generation/drills/diff.ts` | The change region between two sentences (prefix/suffix), spans |
| `generation/drills/rules.ts`, `critic.ts`, `build.ts` | Drill rules, blind-critic acceptance, the pipeline |
| `generation/reading/topics.ts` | The 20 everyday topics (also used by the writing prompts) |
| `generation/reading/coverage.ts`, `rules.ts`, `critic.ts`, `build.ts` | Coverage, passage rules, critic acceptance, the pipeline |
| `grading/grading.ts`, `grading/eval.ts` | `gradeWriting`, `gradeTranslation`, `toDisplay`, the error guard; the fixture eval |
| `generation/prefetch.ts`, `stock.ts` | Shortfall, cheapest-first ordering, the run; stock targets and lock settings |
| `generation/budget.ts` | One call budget (`--max-calls` + `LLM_DAILY_CALL_CAP`) shared across pipelines |
| `generation/batch.ts`, `summary.ts` | Batched calls with per-batch failure isolation; the shared run summary |
| `generation/context.ts`, `dry-run.ts` | Form map, blocklist, word classes, `isWord`; the `--dry-run` world (CLI only) |
| `generation/canned-llm.ts` | Fake OpenAI-compatible fetch answering every purpose (dry runs and tests) |
| `generation/writing-prompts.ts` + `content/writing-prompts.json` | The static prompt bank (40 prompts) |
| `cron/auth.ts`, `cron/prefetch-endpoint.ts`, `cron/prefetch-run.ts` | Bearer check, lock + status codes, production wiring |
| `routes/api/cron/prefetch/+server.ts` | The route (thin) |
| `llm/prompts/drill-{explain,generate,critic}.ts`, `reading-{passage,critic}.ts`, `grade-{writing,translation}.ts`, `feedback.ts`, `levels.ts` | Prompt modules, each with `PROMPT_VERSION` |
| `tool/lib/cli.ts`, `tool/lib/world.ts` | Shared CLI parsing (`--help`, strict flags); live vs dry-run world, eval file writer |

Database: migration `0004_job_locks` adds `job_locks(name PK, holder, acquired_at)`. Repositories:
`jobLocksRepo` (`acquire`, `release`, `get`); `cacheRepo` gains `insert` (validated or rejected),
`existingHashes`, `countByParams`, `byKind`; `clozeItemsRepo.availableByBand` (validated, no card);
`llmCallsRepo.usageByDay`.

Commands: `prefetch`, `llm:usage`, `eval:drills`, `eval:reading`, `eval:grading`. Every CLI
(including `db:migrate` and the Phase 1 tools) now uses `tool/lib/cli.ts`: strict `parseArgs`,
`--help`/`-h` with usage and an example (exit 0), an unknown flag prints the error and usage
(exit 2). `tool/cli.spec.ts` checks every npm script that runs a `.ts` file.

## Decisions and judgement calls

- **No part-of-speech data.** NGSL 1.2's `pos` is null for all 2,809 headwords, and its form lists
  mix noun and verb forms (`book → booked, bookings`). The injections need "singular countable
  noun", "adjective", "simple past", so `word-classes.ts` infers them: a countable noun is a
  headword with a regular plural that the corpus shows right after `a`/`an` closing its phrase; an
  adjective has -er/-est forms or follows an intensifier at least twice (-ing words four times);
  a simple past is a verb form the corpus shows right after a subject pronoun (modals and `be`
  excluded). Real data: 413 countable nouns, 190 adjectives, 327 pasts. The blind critic is the
  backstop for wrong guesses.
- **Injection details.** ART prefers deleting an article (the Vietnamese-typical error) over the
  a↔an swap; `the` is deleted only before a countable noun that closes its phrase (not "the bus
  stop"); never "a few"/"a little". PLU needs the quantifier directly before the noun; irregular
  plurals come from a short list. SVA needs a third-person singular subject (he/she/it, a name,
  or determiner + singular noun), skipping adverbs. COP needs a pronoun or noun subject, not the
  first word, and an adjective that closes the predicate ("is good food" is skipped). TNS needs a
  time marker *in the sentence* (adjacency would leave almost nothing) and no auxiliary or
  determiner before the verb; `be` is excluded. PRE never touches the infinitive `to`.
- **The change region** is everything between the common token prefix and suffix. An LCS diff
  splits a word-order swap ("bag red" → "red bag") into two blocks and would reject every WOR
  drill; the prefix/suffix region is one contiguous region by construction, and two separate
  changes make it too large (> 3 tokens).
- **Spans.** The stored spans are always the minimal region (widened by one neighbour for a pure
  deletion, so both spans are visible: "dog" → "a dog"). An LLM-written drill may give wider
  spans; the rule accepts them if replacing `original_span` (whole words, any occurrence) by
  `corrected_span` yields the corrected sentence and they cover the minimal region.
- **Explanations.** Injected drills get theirs from `drill-explain` (10 per call). LLM-written
  drills (COL WFM WOR) are asked for theirs in the generation call itself: one call fewer, same
  rule check (≤ 2 sentences, ≤ 320 characters).
- **Drill critic normalization:** case, curly quotes, runs of spaces and spaces before punctuation
  do not count. Reasons: `critic:no_error_found`, `critic:several_errors (n)`,
  `critic:different_fix (wrong -> right)`.
- **Drill stock target is per code × band** ("8 per topic code for the bands in range" read as 8
  per code in each band).
- **Reading.** One passage per call (long output); the critic judges 5 per call. The prompt lists
  the allowed names and places (Tom, Mary, Lan, Minh, …, Vietnam, Hanoi, Tết), which count as
  covered. Coverage ignores numbers; contractions count as their base ("doesn't" → "does"), and
  inflected function verbs (has, did, was) count as function words. A glossary word passes if it
  or a form of its lemma is in the passage. Options are shuffled by a seed from the passage so
  the answer is not always where the model put it. Topics: the least used for the band first.
- **WritingFeedback.** Scores are integers 1–5 (the doc gave no scale). The error list has no size
  limit on the wire (Anthropic rejects one); Zod keeps the first 3 (they are ranked) instead of
  failing a live call into a repair round. A guard drops errors whose `original` is not in the
  learner's text or whose correction changes nothing (invented by definition).
- **Indirect mode** hides only `corrected_text` in the UI shape, as specified; each error's
  `correction` is still there. Phase 9 may want to hide corrections too in indirect mode.
- **Grading** uses the active provider with fallback (a live call should succeed if it can).
- **Prefetch.** One pass per run, cheapest first: cloze per band (the 5a pipeline, one call to
  `buildCloze` per band), injected drills, LLM drills, reading. Cloze and drills ask for 1.5× the
  shortfall (`OVERSAMPLE`) because the critics reject a share; reading asks for exactly the
  shortfall (dear). If the budget runs out between a passage and its critic, that passage is not
  stored (its call is spent). The endpoint runs synchronously and returns the summary; the body
  may set `maxCalls` (1–1000, default 100). A daily-cap refusal is 429; any other failure is 500
  with a generic message (the detail goes to the server log).
- **CSRF.** SvelteKit 3 answers 403 to a cross-site POST without a content type or with a form
  content type, before the route runs. That guard stays (the Phase 6 login form needs it); cron
  must send `Content-Type: application/json` and a JSON body (`{}`). With it, the route returns
  401/503/409/429/200 as designed (checked against the production build).
- **Secret comparison:** both the presented token and `CRON_SECRET` are hashed with SHA-256 and the
  digests compared with `crypto.timingSafeEqual` (equal lengths, no early exit on length).
- **Lock:** `acquire` runs in an immediate write transaction; the holder is a random UUID and
  `release` only deletes its own row, so a stale run finishing late cannot free a newer run's lock.
  The CLI takes the same lock (not in `--dry-run`, which has its own database).
- **Stored rejections:** drills and passages that fail a rule or the critic are stored with
  `validated = 0` and `validation_notes` JSON `{reason, ...}` (the critic's answer included), so
  reruns skip them and the evals can show reasons. A drill rejected before any LLM call has
  `model = 'none'` and `prompt_version = 'rules-only'` (`generated_cache.model` is NOT NULL).
- **Runtime dependencies.** Prefetch runs inside the server, so `word-list` moved from
  devDependencies to dependencies (SvelteKit keeps it external), and `blocklist.txt` is read from
  `src/lib/server/content/` relative to the working directory: Phase 7 must deploy both.
- **Dry runs** no longer open `data/app.db` (5a's `cloze:build --dry-run` did, through
  `defaultLlmDeps()`); `createDryRun()` builds its LLM deps on the in-memory database only.
- **Evals** read the pool from the database; `--generate` builds new items first (drills spread over
  the 9 codes in bands 1–2; passages spread over the bands) and `--dry-run` does so in memory with
  the canned LLM. `eval:grading` counts as invented: any error on the two correct translations,
  plus errors the guard dropped; it also lists codes outside the expected ones.
- **The 40 writing prompts** are two per topic (one easier, one harder), ids `<topic>-NN`, word
  ranges by band (1–2: 20–40 … 7–8: 120–180). Waiting for your review.

## Numbers (real content)

Eligible sentences for injection: 15,685 (not blocked, 4–15 words, off-list ≤ 2). Sentences each
injection applies to:

| Code | Total | b1 | b2 | b3 | b4 | b5 | b6 | b7 | b8 |
|---|---|---|---|---|---|---|---|---|---|
| ART | 3,475 | 729 | 627 | 590 | 463 | 308 | 261 | 284 | 213 |
| PLU | 524 | 150 | 116 | 74 | 73 | 50 | 26 | 15 | 20 |
| SVA | 1,144 | 309 | 218 | 152 | 141 | 113 | 69 | 78 | 64 |
| COP | 408 | 50 | 65 | 56 | 80 | 44 | 53 | 33 | 27 |
| TNS | 163 | 19 | 72 | 24 | 26 | 10 | 3 | 4 | 5 |
| PRE | 6,296 | 1,522 | 1,137 | 939 | 850 | 622 | 462 | 419 | 345 |

## Expected weak spots

- **TNS is scarce:** only 244 eligible sentences carry a time marker, and bands 6–8 have 3–5
  injectable sentences, below the target of 8; prefetch will report that shortfall every night
  without spending calls on it. If TNS drills run short, an LLM-written TNS fallback is the fix.
- **PRE swaps** often give a sentence that is still correct ("on the table" → "at the table"), and
  **ART deletions** sometimes do too (an uncountable reading: "from a surgery" → "from surgery").
  The critic rejects these ("no error found"), so expect a lower yield for PRE and ART.
- "Tom" appears in 15% of the sentences, and newer Tatoeba names (Sami, Layla, Yanni) recur.

## Check

`npm run verify` passes; `npm run prefetch -- --dry-run` runs end to end. With a key: read
`eval:drills -- --n 20 --generate`, `eval:reading -- --n 4 --generate` and `eval:grading`.
