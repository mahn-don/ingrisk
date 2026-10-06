# Phase 9b — Anchors, error mining and feedback

Goal: the rest of Phase 9 on top of the 9a loop. It adds the Đọc and Viết shapes with their anchors (a graded passage, a writing task or a VI→EN translation), error drills, and the rotation between shapes. Graded errors become cards, and graded feedback is surfaced at session start. The rules as built are in `docs/architecture.md` Part I §8. Where the owner's 9b prompt differs from the doc, the prompt wins.

## Modules

| File | Purpose |
|---|---|
| `lib/session/shape.ts` | The rotation rules, pure and shared: Home shows the shape the budget chips give |
| `server/session/shape.ts` | `shapeContext()`: the database reads behind the rules |
| `server/session/drills.ts` | `weaknessProfile`, `chooseDrillCodes`, `takeDrills` (2 per Đọc/Viết session) |
| `server/session/anchors.ts` | The passage (with addable glossary words), the writing prompt, the translation sentence, and the writing/translation alternation |
| `server/session/mining.ts` | `locateCorrection`, `minedOptions`, `mineErrors` |
| `server/session/feedback.ts` | Feedback cards (unseen at start, or the anchor's own) |
| `server/session/engine.ts` | Start (shape, cards, drills, anchor, feedback), `submitAnchor`, `addGlossaryCard`, `markFeedbackSeen`, and finish with anchor and drill results |
| `server/grading/apply.ts` | `applyWritingGrade`: scored, placement refined (unless off topic), errors mined |
| `server/grading/queued.ts` | `gradeSubmission` (writing or translation), used by `gradeQueuedWritings` and the anchor |
| `lib/session/diff.ts`, `glossary.ts`, `check.ts` | The highlighted changes, the underlined glossary words, and `checkDrill` |
| `routes/(app)/session/*.svelte` | `CardStep`, `DrillStep`, `ReadingStep`, `WritingStep`, `FeedbackView`, and the page that sequences them |
| `routes/api/session/{anchor,glossary,feedback}` | The Viết submission, "Thêm vào ôn tập", and dismissing a feedback card |

### Database (migration 0008)
- **`cloze_items` is rebuilt** for the new `user_error` gap type in its CHECK, with two new columns: `token_count` and `typing_only`.
- **`writing_submissions` gains** `task_kind`, `prompt_id`, `sentence_id`, `reference_en`, `on_topic`, `task_note_vi`, `meaning_ok`, `mined_at` and `mined_count`.
- **New `drill_results` table.**
- **`sessions.served_json`** becomes `{cards, drills, anchor}`; 9a rows (a bare array) still read through `servedOf()`.

## Decisions and judgement calls (deviations marked)

### Migrations
- **Deviation (infrastructure): foreign keys are off while migrations run.** Changing a CHECK in SQLite needs a table rebuild, and `cloze_items` is referenced by `cards` with ON DELETE RESTRICT. drizzle's migrator runs every migration inside one transaction, where `PRAGMA foreign_keys=OFF` does nothing, so the `DROP TABLE` failed. Even under `legacy_alter_table`, a renamed table drags the references with it, and RESTRICT applies immediately even when checks are deferred.
  - `migrate()` now turns foreign keys off around the run, back on afterwards, then requires `foreign_key_check` to be empty (else it throws and the server does not start).
  - Tests: the 0007 → 0008 upgrade with an existing card, its submission link kept and RESTRICT still enforced; a deliberately broken migration is refused.
  - drizzle-kit's `INSERT … SELECT` again copied columns that did not exist; the rebuild was hand-fixed.
  - The `writing_submissions` columns are plain `ADD COLUMN`s, no rebuild.
- **Deviation: `sentences.vi_text` stays NOT NULL.** The prompt allows null when no Vietnamese is available, but making the column nullable means rebuilding `sentences`, which `cards` and `cloze_items` reference. Every mined error has a Vietnamese prompt or source sentence anyway (placement included), so the case does not arise. '' would mean "none", and the UI hides an empty cue.
- **`user_error` sentences are kept out of cloze and drill generation**: `forCloze` excludes `source = 'user_error'`.

### Rotation and composition
- **"At the right band"** means a passage within one band of `known_band_ceiling`. The nearest one is served (ties: the lower band).
- **Writing available** means `llmConfigured()`: an active provider, or `LLM_CANNED`. A 5-minute budget means ≤ 5.
- **Shape override.** The override is accepted whenever that shape is available, even with a 5-minute budget (2 minutes of cards, then the anchor). Home passes the shown shape explicitly, so the label and the server agree.
- **Item budget.** Đọc and Viết have `round((budget − 3) × 3)` items, at least 1. Drills are not counted in the time.
- **Mined cards.** They are taken first (all of them, up to the item count) and placed right after the 3-card opening. Their first review does not count as "introduced today" (`countIntroducedBetween` and `newCards` skip `user_error` cards), so they never use up the daily limit.
- **Glossary cards** ("Thêm vào ôn tập") are created New immediately and wait in the ordinary new-card queue. They count toward the daily limit when first reviewed, unlike mined cards. The add is refused (409) when the word had no item at session start, or when it has a card already. The item is found through the NGSL form index (word → lemma → a validated lexical item with no card).
- **The weakness profile** counts three things over the last 30 days: graded writing errors per code, Again ratings on cards with a grammar topic (mined cards included), and missed drills. Codes with errors come first; the rest follow in a seeded random order; a code alone in stock is used twice.
- **Translation sentences** are Tatoeba sentences of 5–14 words at band ceiling − 1 … ceiling, falling back to any band ≤ ceiling. "Not used before" means never submitted; a sentence served in an abandoned session can come again.
- **Alternation.** Writing and translation alternate by the anchor type of the last *finished* Viết session; writing comes first.
- **Writing prompt choice.** Prompts not used in the last 14 days, using `pickPrompt` from placement (the nearest band range). If every prompt was used, any prompt.

### Viết submission and grading
- **One submission per session.** A repeated submit returns what the first one produced: the feedback, or `{queued: true}`.
- **The text is stored before grading.** The page shows feedback that arrives in time and marks it seen, so it is not shown again at the next start.
- **Late grades** go through the same `applyWritingGrade`: they are mined, and their feedback waits for the next start.
- **Off-topic writing.** Its CEFR is stored on the submission, but a placement result gets the flag `writing_off_topic` instead of the writing sub-score, and the profile is untouched.
- **Mining scope.** Mining runs for every graded submission, placement writing included (the prompt says "every graded error").
- **Indirect feedback mode** hides the corrected text in the feedback cards. The errors, with their corrections, are still shown, as in 5b.
- **Canned grader (tests only).**
  - It "finds" a few known errors (`buyed → bought`, `goed → went`, `childs → children`, `depend of → depend on`, `she go → she goes`).
  - It grades a text containing `OFFTOPIC` as off topic.
  - It fails the first grading of a text containing `GRADELATER`, both the reply and the repair, so that text is queued.

### Mining
- **Sentence split and match.** Sentences are split after `. ! ? …`. The correction is matched as whole tokens, ignoring case, across all sentences. It must occur exactly once, else it is skipped (missing / ambiguous); it is also skipped when empty or longer than 4 tokens.
- **Gap and answer.** The gap is the correction's token span, and the answer is that span exactly as it appears in the sentence.
- **Options.**
  - Only for single-word corrections with an ART, PRE, SVA, TNS or PLU code.
  - The learner's own form is always included; the rest are drawn from the 5a tables (articles + "no word", preposition confusions, the lemma's NGSL forms), shuffled with a seed.
  - Fewer than 3 distractors (the learner's form included), another code, or a multi-word correction makes the item typing-only.
- **Stored on the item.** `answer_vi` holds the error's `explanation_vi`; the feedback panel labels it "Vì sao".
- **Dedupe.** The content hash is the normalized sentence plus the span.

### Finish
- **Validation.** Drill results must have been served, and at most once each. The anchor result must match the served anchor: same type, the same passage, and no more answers than questions.
- **Reading score.** It is computed on the server from the stored passage.
- **Drill results** are stored (`answered_at` = the finish time) in the finish transaction, so a repeated finish stores nothing again.
- **Study time** in the summary includes the drills' response time.

### UI
- **Layout.** The page is split into step components. The progress bar counts cards, drills and the anchor; feedback cards come before it.
- **The choice-mode meaning button** is shown only when the item has a Vietnamese sentence; using it sets `hintUsed`.
- **The glossary popover** is an in-page dialog under the passage; "Thêm vào ôn tập" lives in it.

## Tests

- **Vitest:**
  - shape rules (every priority and fallback, the override);
  - item budget per shape;
  - drill choice and the weakness profile;
  - reading: glossary addability, the add path and its limit, result validation and scoring;
  - writing: in time, timeout then late grading with mining and surfacing, no provider, refusals;
  - off-topic exclusion;
  - mining: location, options vs typing-only, dedupe, the limit exemption and the next session;
  - feedback surfacing once, and the indirect mode;
  - drills at finish and idempotency;
  - translation grading of queued submissions;
  - the 0007 → 0008 upgrade, and a refused bad migration.
- **Playwright** (session server: seeded passages and drills, canned LLM, cron secret):
  - the typing cue and the hint;
  - Home's shape label;
  - a Đọc session end to end;
  - a Viết writing session with mining;
  - the mined card in a later session;
  - a translation accepted with different words;
  - a queued writing graded by the cron prefetch and shown at the next start, then not again.
- **Screenshots:** the typing cue, the reading passage with the glossary popover, a reading question, writing and translation feedback, a drill, a feedback card at session start, the new end screen, and Home with the shape label.
