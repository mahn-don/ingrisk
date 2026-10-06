# Roadmap

Phase details and prompts live in Part III of `docs/architecture.md`. One phase per session, one
commit per phase, `npm run verify` green before committing.

**Build order after Phase 6 (the owner's decision): 8 → 9a → 9b → 10 → 7 → 11.** The deploy moves
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
- [ ] **Phase 10 — Settings, stats, motivation:** provider management, settings, stats, and the gentle streak/weekly-goal motivation layer.
- [ ] **Phase 7 — Deploy to the VPS:** systemd (Node on `0.0.0.0:3000`, plain HTTP), Litestream backup, cron, the deploy script and a runbook, with a proven backup restore.
- [ ] **Phase 11 — Hardening:** eval fixtures, error/empty/offline states, migration tests, rate limiting and a bounded review pass.
