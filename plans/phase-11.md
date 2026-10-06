# Phase 11 — Hardening and quality fixes

One branch, one PR. Prompt changes bump their `PROMPT_VERSION`:
- `grade-writing@3`
- `grade-translation@2`
- `reading-passage@2`
- `cloze-critic@2`

## 1. Settings: a stale provider id
- **The bug:** "Dùng nhà cung cấp này", "Đặt làm dự phòng", "Xóa" or "Kiểm tra kết nối" on a provider deleted elsewhere failed silently (404).
- **The fix:**
  - the actions now answer 404 `{ toast, stale: true }`;
  - the page shows a Vietnamese toast (`Toast.svelte`, `role="alert"`) and reloads the list (`invalidateAll`);
  - "Kiểm tra kết nối" checks that the provider exists before calling it.
- **e2e:** a provider is deleted in the database behind the open page; "set active", then "test connection", show the toast, and the card disappears.

## 2. Grading: 3 shown, distinct codes first
- **What the model returns:**
  - every real error, one entry per occurrence, up to 10 (`MAX_RETURNED_ERRORS`; the old schema cut at 3);
  - the prompt says repeats are grouped, and another code must never be dropped to make room for a repeat.
- **What the learner sees:** `selectShownErrors()` picks the first error of each distinct code in the model's order, then fills with repeats. The feedback card shows "lặp lại N lần" and "Bài còn N lỗi khác".
- **Mining:** every returned error is mined (`MAX_MINED_PER_SUBMISSION = 10`), not only the 3 shown. The weakness profile and stats now count every error.
- **Tests:**
  - unit: SVA, SVA, ART, COP shows SVA (×2), ART and COP, and mines 4;
  - the eval adds `expected_shown_codes` and 2 fixtures (`sva-sva-art-cop`, `tns-plu-pre`).

## 3. Reading coverage
- **(a) An everyday-word allowlist** (`reading/everyday.ts`, about 190 lemmas: food, family, home, school, time, weather, tech basics). These words count as known for bands ≤ 4, plurals and -ed/-ing forms included.
- **(b) The band's allowed words in the prompt:** NGSL lemmas of band ≤ band + 1, function words left out, most frequent first, capped at 1,500, plus the allowlist for bands ≤ 4.
- **(c) One rewrite on a coverage failure:** the words above the level are sent back once (`buildRewriteUser`), then the rewrite passes or is rejected. A retry is counted as `reading:coverage_retry`.
- **Tests:** the coverage maths with the allowlist (band 2 vs band 5), the prompt list, the retry passing, and the retry failing.

## 4. Cloze articles and content safety
- **Article gaps only where a rule fixes the answer** (`articleRule`):
  - `the` before a superlative (most/best/…, or an -est form of an adjective), an ordinal or a unique reference (first, last, same, only, next; sun, moon, world, internet …);
  - `a/an` after "there is/was", after such/what/quite/half, in "a lot/bit/couple of", and in "once/twice/N times a week".
  - Everything else (the "a dog" / "the dog" cases, generic plurals, mass nouns) gets no gap.
- **The critic prompt (`cloze-critic@2`):**
  - articles are judged in this sentence's context: a version is accepted when the other options are clearly wrong here;
  - a new item-level `another_could_be_correct`: if true, the item is rejected as `critic:another_could_be_correct`.
- **The content filter** is the existing `blocklist.txt`, applied by the import and by the cloze, drill and reading rules:
  - it now matches phrases word by word on lemmas, so "make love" also matches "made love";
  - new terms for death, drinking, self-harm phrases and more violence: die, dead, death, drunk, "cut herself", "hang himself", choke, blood …
  - Run `npm run content:import -- --reblock` on the server once, so existing sentences are re-checked.
- **Tests:** the article rules on positive and negative sentences; phrase matching; the real list on the prompt's examples, plus everyday sentences that must pass.

## 5. Hardening
- **Rate limit** (`llm/route-limit.ts`): 60 LLM-backed requests per sliding hour, in memory.
  - Applied to `POST /api/session/anchor`, `POST /api/placement/writing` (not a skip), "Kiểm tra kết nối" and "Tạo thêm bài tập".
  - The API answers 429 `{ error: 'rate_limited', message }` with `Retry-After`; the form actions answer `fail(429)`. The pages show the Vietnamese message.
  - The cron prefetch is not counted: it has its own secret, lock and daily cap.
- **Error and empty states:**
  - **No active provider:** Home shows a notice linking to the providers page.
  - **The LLM is down:** a queued writing now says why (`reason`: `no_provider`, `llm_error`, `timeout`, `pending`), and the page words each case.
  - **No cards due, empty review book, empty stats:** these already had their empty states (Phase 9a/10); they are unchanged.
- **Migration test** (`db/migrations.spec.ts`):
  - a fresh database, plus a database stopped after each of the 9 earlier migrations, is migrated to the latest;
  - `foreign_key_check` must be empty and `integrity_check` must be ok;
  - the final schema (`sqlite_master`) must equal the fresh one.

## Not done / judgement calls
- **The rate limit counts requests, not LLM calls.** A grading with its repair round is one request. Per-call limits stay with `LLM_DAILY_CALL_CAP`.
- **Toast:** an identical message shown twice in a row does not reappear until the page changes; this is acceptable for a rare error.
- **The review subagent pass** from the original Phase 11 text was not run separately: the prompt's own list was the scope.
