# Roadmap

Phase details and prompts live in Part III of `docs/architecture.md`. One phase per session, one
commit per phase, `npm run verify` green before committing.

**Build order after Phase 6 (the owner's decision): 8 → 9a → 9b → 10 → 7 → 11 → 12.** The deploy moves
after the features; the list below is in that order. Phase 9 is split in two (9a, 9b).

- [x] **Phase 0 — Scaffold and guardrails:** a clean, verified skeleton showing a Vietnamese string from `messages/vi.ts`, with a hook that blocks committing secrets.
- [x] **Phase 1 — Content data preparation:** a re-runnable `tool/` script producing the NGSL, Tatoeba EN–VI and pseudo-word assets in `src/lib/server/content/` (no app code). Pseudo-words reviewed by hand.
- [x] **Phase 2 — Data layer:** Drizzle schema per Part II §3, migrations, intent-level repositories and in-memory SQLite tests.
- [x] **Phase 3 — Spaced-repetition engine:** a thin `ts-fsrs` wrapper with `review()`, review logging, due-card queries and interval tests.
- [x] **Phase 4 — LLM provider layer:** an `LlmClient` with OpenAI-compatible and Anthropic adapters, retry/fallback, and divergence + key-leak tests.
- [x] **Phase 5a — Content import and the cloze pipeline:** idempotent content import with a blocklist, and a validated cloze pool (deterministic candidates, LLM distractors, rules, blind critic) with cost guards and a human eval sheet.
- [x] **Phase 5b — Passages, error drills, grading and prefetch:** injected and LLM-written error drills and graded passages behind blind critics, live writing/translation grading, a static writing-prompt bank, and the locked, secret-guarded prefetch job.
- [x] **Phase 6 — App shell and authentication:** hooks-level auth with server-side sessions and a login limiter, the tabbed shell with real card counts, a WCAG-checked light/dark theme with self-hosted fonts and shared components. Browser-only over HTTP: no PWA (amendment).
- [x] **Phase 8 — Placement test:** the retakeable, resumable three-part placement (yes/no vocabulary staircase, adaptive Elo cloze, writing graded live or later) reported on CEFR/VSTEP/IELTS/TOEIC as estimates.
- [x] **Phase 9a — Session engine and the cloze review loop:** composition (due cards, interleaved new cards, ordering and stock-name rules, per-card choice/typing), a one-request start and a transactional, idempotent finish, and the `/session` screen. The app is usable daily with the Nhanh shape.
- [x] **Phase 9b — Anchors, error mining and feedback:** the Đọc/Viết anchors (passage, writing, VI→EN translation) and drills, Đọc/Viết rotation, unseen feedback at session start, error mining (one `sentences` row per error card), and an `on_topic` criterion in writing grading.
- [x] **Phase 10 — Progress, review book, settings and providers:** the gentle motivation layer recomputed from history (streak with auto-freeze, weekly goal, heat-map, forecast, weakness profile), the review book with focus sessions and card suspension, full settings (learning, content stock and prefetch, AI usage, backup, credits) and provider management that never handles a key.
- [x] **Phase 7 — Deploy to the VPS:** a hardened systemd unit run from the checkout (Node 24 on `0.0.0.0:3000`, plain HTTP), a one-time `sudo deploy/install.sh` with a minimal sudoers drop-in, a passwordless `deploy.sh` (ORIGIN-only build, pre-deploy snapshot, `/healthz` check), nightly verified snapshots and prefetch from the user's crontab, optional Litestream, and the runbook in `plans/phase-07.md`.
- [x] **Phase 11 — Hardening:** stale-provider toasts, grading that shows 3 distinct error codes (all errors mined), reading coverage (everyday words, the band's word list, one rewrite), rule-based article gaps with a stricter critic, a phrase-aware content filter, a 60/hour limit on LLM routes, error states, an all-versions migration test and new eval fixtures (`plans/phase-11.md`).
- [x] **Phase 12 — Learner profiles:** Netflix-style profiles behind the one password (`/profiles`: pick, create, rename, archive), each with its own placement, cards, history, streak and learning settings; migration 0010 gives every existing row to "Hồ sơ 1"; every per-learner query takes `profileId`, checked by a leakage test; one shared content stock for all profiles (`plans/phase-12.md`).
