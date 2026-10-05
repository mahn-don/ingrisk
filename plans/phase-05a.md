# Phase 5a — Content import and the cloze pipeline

Goal: import the Phase 1 content into the database and build a validated pool of cloze items from
real Tatoeba sentences: deterministic candidates, LLM distractors, deterministic rules and a blind
LLM critic. Passages, error drills, writing feedback and the prefetch endpoint are Phase 5b.
Tests use a mocked LLM only. Design: `docs/architecture.md` Part II §5.

## Modules

| File | Purpose |
|---|---|
| `generation/import.ts` | `importLexemes`, `importSentences` (idempotent upserts, blocklist flags, `--reblock`) |
| `generation/content-files.ts` | Reads `ngsl.json`, `tatoeba-en-vi.json`, `blocklist.txt` with `fs` (tools only) |
| `generation/blocklist.ts` | `parseBlocklist`, `blocklistMatcher` (word, lemma via the form map, or `prefix*`) |
| `generation/forms.ts` | `buildFormIndex`: form → lemma (lowest band wins), headword → forms |
| `generation/tokens.ts` | `tokenize`, `withGap`, `fillGap` (`—` removes the word, recapitalizes) |
| `generation/random.ts` | FNV-1a, mulberry32, `seededShuffle`, `seededPick`, `sha256` |
| `generation/cloze/candidates.ts` | Eligibility, the four gap types, SVA/TNS, seeded selection |
| `generation/cloze/stoplist.ts` | Function words never used as lexical gaps |
| `generation/cloze/prepositions.ts` | The preposition confusion table |
| `generation/cloze/rules.ts` | `checkRules` → first failing rule code |
| `generation/cloze/distractors.ts`, `critic.ts` | Batched LLM calls (10 items), `judge()` |
| `generation/cloze/batch.ts` | `runBatches`: per-batch failure isolation, call budget |
| `generation/cloze/build.ts` | `buildCloze`: the pipeline, cost guards, summary |
| `generation/cloze/canned-llm.ts` | Fake OpenAI-compatible fetch for `--dry-run` and tests |
| `generation/cloze/eval.ts` | The evaluation sheet |
| `llm/prompts/cloze-distractors.ts`, `cloze-critic.ts` | System prompt, payload builder, Zod schema, `PROMPT_VERSION` |

Database: migration `0003_cloze_pool` adds `sentences.blocked / blocked_reason / has_stock_names`
(+ index `(blocked, level_band)`), the `cloze_items` table, `cards.cloze_item_id` (FK restrict,
partial unique index when not null; the ON DELETE clause was added by hand because drizzle-kit
omitted it) and `generated_cache.prompt_version`. No table rebuilds. Repositories: `lexemesRepo`,
`sentencesRepo`, `clozeItemsRepo`; `llmCallsRepo` gains `maxId`, `countAfterId`, `usageAfterId`.

Commands: `npm run content:import [-- --reblock]`, `npm run cloze:build -- [--bands 1-3]
[--types lexical,article,preposition,verb_form] [--limit 200] [--provider name] [--max-calls 50]
[--dry-run]`, `npm run eval:cloze [-- --n 30]` (writes `tmp/eval/`, gitignored).
Environment: `LLM_DAILY_CALL_CAP` (default 500) in `.env.example`.

## Decisions

- **Prompts are JSON payloads.** Both prompts send `Items (JSON): {"items":[{"n":1,…}]}` and get
  back `{"items":[{"n":1,…}]}`; items are matched by `n`, so an item the model leaves out is
  detected. All schema fields are required. Array sizes (`.length(3)`, `.length(4)`) live in Zod;
  the sanitizer keeps them out of the Anthropic and OpenAI-strict wire schemas (Phase 4).
- **The critic is blind.** It sees the four filled sentences labelled A–D in display order and is
  never told the answer, and it gets no translation (the Vietnamese sentence would hint at the
  answer). Each version is judged on grammatical / natural / meaning_ok; acceptable = all three.
  Accepted iff exactly one version is acceptable and it is the answer. A verdict list that does
  not cover A–D exactly once is treated as a malformed answer, not a judgement.
- **Option order** is `seededShuffle(options, 'options|' + content_hash)`, fixed before the critic
  sees it, so the stored order is the order the critic judged.
- **What is stored.** Rule failures (`rule_ok = 0`, `critic_ok` NULL) and critic rejections
  (`critic_ok = 0`) are stored with `validated = 0` and a `rejection_reason`. Items whose LLM call
  failed (schema error after the repair round, refusal, exhausted retries, an item missing from the
  answer) are not stored, so a rerun retries them. `critic_notes` holds the critic's verdicts as JSON.
- **`prompt_version`** joins the prompt versions used, e.g. `cloze-distractors@1+cloze-critic@1`;
  grammar items judged by the critic carry `cloze-critic@1`; a grammar item rejected by the rules
  before any LLM call carries `rules-only`. `model` joins the distinct models used.
- **Real words.** NGSL's form lists contain ~950 nonstandard forms ("makeing", "knowed", "gunna"),
  so membership in the form map does not prove a word is real. "Real word" means: in the
  `word-list` package or an NGSL headword. Verb-form options must also occur in the sentence corpus
  and are never informal spellings (`gonna`, `gotta`, …).
- **Grammar candidate heuristics** (no POS tagger): no verb_form gap on modals or right after a
  determiner (a noun use: "broke the rules"); the infinitive "to" (before a verb's base form) is
  not a preposition gap; no gap inside a hyphenated compound or on a word that occurs twice in the
  sentence. SVA = present simple (is/are/am/has/have/does/do, a 3rd-person -s form, or a base form
  after a subject) after a subject other than I/you/we, looking back past adverbs; else TNS.
- **Cost guards.** `--max-calls` counts `llm_calls` rows (HTTP attempts) written after the run's
  starting `maxId()`, checked before each batch; a single batch's retries and repair can overshoot
  by a few attempts. The daily cap refuses to start when the last 24 h already hold
  `LLM_DAILY_CALL_CAP` rows (at or over the cap), and the run also stops before it would reach it.
- **`--provider`** pins that provider and disables fallback; without it the active provider is
  used with fallback.
- **`--dry-run`** migrates an in-memory database, imports the content, registers a keyless
  OpenAI-compatible provider and answers every call from `canned-llm.ts` (distractors: common
  NGSL words of the same suffix shape; critic: a version is acceptable iff it is an original
  corpus sentence). Nothing touches the network or `data/app.db`.

## Deviations from the brief

- The option shuffle seed is derived from `content_hash` rather than the item id, because the
  critic must see the final order before the row (and its id) exists. The hash identifies the
  item just as stably.
- "Real word" excludes forms that are only in the NGSL form map (see above).

## Numbers (real content, fresh database)

- Import: 2,859 lexemes (supplementary `march`, `may` skipped), 19,198 sentences, 168 blocked.
  Second run: 0 inserted, 0 updated.
- Eligible sentences: 18,899. Candidates (one lexical + one grammar per sentence at most): 28,778.

| Type | b1 | b2 | b3 | b4 | b5 | b6 | b7 | b8 |
|---|---|---|---|---|---|---|---|---|
| lexical | 3,772 | 2,860 | 2,206 | 1,989 | 1,337 | 1,082 | 933 | 760 |
| verb_form | 2,161 | 1,438 | 1,088 | 1,016 | 617 | 548 | 436 | 365 |
| preposition | 954 | 635 | 454 | 397 | 302 | 215 | 214 | 146 |
| article | 608 | 469 | 473 | 390 | 288 | 225 | 211 | 189 |

Grammar topics: TNS 4,970, SVA 2,699, PRE 3,317, ART 2,853.

## Expected weak spots

Article gaps are often legitimately ambiguous ("I have *a/the* dog"), and so are some preposition
gaps; the critic is expected to reject many of them. That is the critic doing its job, but it lowers
the yield of those types; watch the per-type rejection counts in the build summary.

## Check

`npm run verify` passes; `content:import` is a no-op the second time; `cloze:build -- --dry-run`
runs end to end. Hard gate: in `eval:cloze`, a human finds at most 1 bad item among 30.
