# Backlog

Carry-overs that belong to a later phase, so they are not lost. Move an item into its phase plan
when that phase starts; delete it when done.

- **TNS drills (generation):** add an LLM-written TNS fallback for bands 6–8, where Tatoeba has only
  3–5 injectable sentences (`plans/phase-05b.md`, "Expected weak spots").
- **Node version:** align `.nvmrc` and `package.json` `engines` with Node 24 LTS, which is what the
  VPS runs (the repo currently says 22).
- **HTTPS / PWA — optional later via Tailscale or Cloudflare Tunnel.** The app is browser-only over
  plain HTTP on `http://103.82.195.48:3000` by decision (Phase 6 amendment). Putting a tunnel in
  front needs no code change: set `ORIGIN=https://…` and `COOKIE_SECURE=true`. A PWA (manifest,
  service worker with a network-first offline page, icons) was built during Phase 6 and removed
  before the commit; `plans/phase-06.md` records how it worked, so it is a small job to restore.
- **If a proxy or tunnel is added:** every request then reaches Node from 127.0.0.1, so the per-IP
  login limiter would lock out everyone after 5 failures. Set adapter-node's
  `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1` so `getClientAddress()` sees the real client.
- **Phase 7:** the deploy must include `src/lib/server/content/` (the blocklist and the writing-prompt
  bank are read at runtime, relative to the working directory) and the migrations directory.
- **Phase 7:** `deploy.sh` must build with `ORIGIN` exported (`set -a; . /etc/silentenglish/.env;
  set +a; npm run build`): SvelteKit 3 / adapter-node 6 bake the origin into the build
  (`vite.config.ts` `paths.origin`); without it the server assumes https and rejects the login POST.
- **Phase 7:** `/etc/silentenglish/.env` uses the `.env.example` HTTP mode (`ORIGIN` exactly as in
  the address bar, `COOKIE_SECURE=false`, `HOST=0.0.0.0`, `PORT=3000`); ufw opens only SSH and 3000;
  the cron call needs `Content-Type: application/json`.
- **Phase 7:** add a nightly `authSessionsRepo.deleteExpired()` sweep (expired rows are already
  deleted when presented; this only tidies sessions that are never used again).
- **Phase 9:** error-mined cards must each create their own `sentences` row
  (`source = 'user_error'`); otherwise the cards unique index
  `(kind, lexeme_id, sentence_id, grammar_topic_id)` collapses every error card of the same topic
  into one.
