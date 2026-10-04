# Roadmap

Phase details and prompts live in Part III of `docs/architecture.md`. One phase per session, one
commit per phase, `npm run verify` green before committing.

- [x] **Phase 0 — Scaffold and guardrails:** a clean, verified skeleton showing a Vietnamese string from `messages/vi.ts`, with a hook that blocks committing secrets.
- [x] **Phase 1 — Content data preparation:** a re-runnable `tool/` script producing the NGSL, Tatoeba EN–VI and pseudo-word assets in `src/lib/server/content/` (no app code). Pseudo-words reviewed by hand.
- [x] **Phase 2 — Data layer:** Drizzle schema per Part II §3, migrations, intent-level repositories and in-memory SQLite tests.
- [x] **Phase 3 — Spaced-repetition engine:** a thin `ts-fsrs` wrapper with `review()`, review logging, due-card queries and interval tests.
- [x] **Phase 4 — LLM provider layer:** an `LlmClient` with OpenAI-compatible and Anthropic adapters, retry/fallback, and divergence + key-leak tests.
- [ ] **Phase 5 — Generation and validation pipeline:** content import, generators, Zod + rule validation, and the secret-guarded prefetch endpoint.
- [ ] **Phase 6 — App shell and authentication:** single-password login gate, app shell with navigation and theme, installable PWA.
- [ ] **Phase 7 — Deploy to the VPS:** Caddy, systemd, Litestream, deploy script, cron and a runbook, with a proven backup restore.
- [ ] **Phase 8 — Placement test:** the retakeable three-part placement flow with Elo-style estimation reported on CEFR/VSTEP/IELTS/TOEIC.
- [ ] **Phase 9 — Session loop:** the time-budgeted daily session (Nhanh/Đọc/Viết) running client-side from cached content, with error mining.
- [ ] **Phase 10 — Settings, stats, motivation:** provider management, settings, stats, and the gentle streak/weekly-goal motivation layer.
- [ ] **Phase 11 — Hardening:** eval fixtures, error/empty/offline states, migration tests, rate limiting and a bounded review pass.
