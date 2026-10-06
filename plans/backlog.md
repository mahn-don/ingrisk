# Backlog

Carry-overs that belong to a later phase, so they are not lost. Move an item into its phase plan
when that phase starts; delete it when done.

- **TNS drills (generation):** add an LLM-written TNS fallback for bands 6–8, where Tatoeba has only
  3–5 injectable sentences (`plans/phase-05b.md`, "Expected weak spots").
- **HTTPS / PWA — optional later via Tailscale or Cloudflare Tunnel.** The app is browser-only over
  plain HTTP on `http://103.82.195.48:3000` by decision (Phase 6 amendment). Putting a tunnel in
  front needs no code change: set `ORIGIN=https://…` and `COOKIE_SECURE=true`. A PWA (manifest,
  service worker with a network-first offline page, icons) was built during Phase 6 and removed
  before the commit; `plans/phase-06.md` records how it worked, so it is a small job to restore.
- **If a proxy or tunnel is added:** every request then reaches Node from 127.0.0.1, so the per-IP
  login limiter would lock out everyone after 5 failures. Set adapter-node's
  `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1` so `getClientAddress()` sees the real client.
