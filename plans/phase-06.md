# Phase 6 — App shell and authentication

Goal: authentication, the navigable shell, the theme and shared components. No learning features;
Home shows real card counts to prove the data path. Design: `docs/architecture.md` Part II §6.

## Amendment: browser-only, always online, plain HTTP (the owner's decision)

The app is used only in a mobile browser, always online, at `http://103.82.195.48:3000`. So:
- **No PWA:** no manifest, no service worker, no offline page, no icon pipeline; a plain
  `static/favicon.svg` (the same open-book mark) is the only icon. The PWA paths left the public
  allowlist.
- **`COOKIE_SECURE=false` is allowed for any `ORIGIN`.** With false and a non-local origin, the
  server logs a startup warning and the login page shows a small, non-blocking notice ("Kết nối
  không mã hóa"). `.env.example` documents exactly this mode (`ORIGIN=http://103.82.195.48:3000`,
  `COOKIE_SECURE=false`, `HOST=0.0.0.0`, `PORT=3000`).
- **Unchanged, and more important without TLS:** the hooks chokepoint, the rate limit and the
  constant failure delay.
- The docs say so: a Decisions entry in Part 0, §8 "PWA out of scope", Phase 7 without Caddy or
  TLS, and Phase 9 without the `localStorage` retry. HTTPS can be added later via Tailscale or a
  Cloudflare Tunnel with no code change (`plans/backlog.md`).

What the removed PWA did, for whoever restores it: `static/manifest.webmanifest` (`lang: vi`,
standalone); icons at 192 and 512, a maskable 512 and a 180 px apple-touch-icon, rendered from the
SVG mark with Playwright's Chromium. `src/service-worker/index.ts` had its own tsconfig extending
`$app/tsconfig/service-worker` and used SvelteKit 3's `$app/manifest`, `$app/env` and
`$app/service-worker`. It precached `immutable`, `assets` and the prerendered `/offline` page;
navigations went network-first with the offline page as fallback; it never cached HTML or
`/api/*`. Two traps it hit:
- **Prerender crawling** must be off (`prerender: { crawl: false }`). Otherwise the offline page's
  link to `/` is prerendered as a redirect and served statically to everyone.
- **`context.setOffline`** does not reach a service worker's fetches in Chromium. Its e2e test
  failed the request through `context.route` with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`.

## Modules

| File | Purpose |
|---|---|
| `src/hooks.server.ts` | **The** auth chokepoint (`handle`), theme on `<html>`, startup (`init`, skipped while building) |
| `src/lib/server/auth/guard.ts` | The public-path allowlist and `accessFor()` |
| `src/lib/server/auth/sessions.ts` | Create / resolve (slide, expire) / delete sessions; token hashing |
| `src/lib/server/auth/config.ts`, `index.ts` | `APP_PASSWORD_HASH`, `COOKIE_SECURE` + `ORIGIN` (HTTP notice), warnings logged once |
| `src/lib/server/auth/next.ts`, `rate-limit.ts`, `cookies.ts` | `next` sanitizer, login limiter, cookie writers |
| `src/lib/server/db/repositories/auth-sessions.ts` | Repository for `auth_sessions` (migration 0005) |
| `src/routes/login`, `src/routes/(app)/…` | Login (form action), Home / Stats / Settings with the tab bar, full-screen `/session` |
| `src/lib/components/` | Button, Card, ProgressBar, OptionButton, TextAnswer, EmptyState, ErrorState, LoadingState, TabBar, Icon |
| `src/lib/styles/tokens.css`, `fonts.css` | Colour tokens (checked by `tokens.spec.ts`), self-hosted font faces |
| `tool/auth-hash.ts`, `tool/screenshots.ts` | `auth:hash`, `screenshots` |

## The public-path allowlist (exactly as implemented)

Exact: `/login`, `/favicon.svg`, `/robots.txt`, `/_app/version.json`, `/_app/env.js`.
Prefixes: `/api/cron/`, `/_app/immutable/`.

Not all of `/_app/`: SvelteKit 3 serves remote functions under `/_app/remote/`, which is server
code and must stay behind the session check. Static files are normally served by adapter-node
before `handle` runs; the allowlist is what holds if they ever reach it.

## Design decisions

- **Fonts.** UI: **Be Vietnam Pro**, a sans designed in Vietnam for Vietnamese, whose stacked
  diacritics (ễ, ặ, ỗ) stay legible at small sizes. English reading text: **Literata** rather than
  Source Serif 4. Literata was designed for long-form reading on screens, it has generous spacing,
  and its variable build is one file per subset for every weight (52 KB latin + 11 KB vietnamese).
  It also contrasts clearly with the UI sans, so "what you read" looks different from "the app".
  Both are self-hosted from `@fontsource` (no third-party requests). Only the latin and
  vietnamese subsets are used, as woff2 only: 10 files, about 200 KB in all. The `@font-face`
  rules are written by hand, because the per-subset CSS files in `@fontsource/be-vietnam-pro`
  carry no `unicode-range`. Loading two of them together would make the last one win for every
  character. Verified: `ệ ữ ặ ỗ ẫ ỹ` render correctly in both fonts at 13 px, the smallest size
  used (see `/dev/components` in the screenshots).
- **Sizes.** Body 17 px (line-height 1.55), reading passages 19 px (line-height 1.65), smallest
  UI text 13 px (tab labels, hints), as Tailwind theme tokens (`text-base`, `text-reading`,
  `text-xs`).
- **Palette.** The app is used at night, one-handed, in short bursts. So:
  - **Light:** warm "paper" (`#f5f2ec` background, `#fffdf9` surfaces) instead of pure white, to cut glare.
  - **Dark:** soft charcoal (`#111618`) instead of pure black, with off-white text (`#e7e3da`) to avoid halation.
  - **Primary:** a deep jade (`#1d6b62`; `#74c7b8` in dark). It is calm, reads as "study / focus", and stays clear of the generic indigo SaaS look. Amber appears only in the icon's bookmark and as the warning colour.
  - **States:** correct is green, incorrect is a brick red, warning is amber; each has a soft background.

  `tokens.spec.ts` computes WCAG contrast for every text/background pair the components use. All
  pass AA (4.5:1); the lowest is 5.13:1, jade on its soft tint in light. Control borders reach
  3:1 (WCAG 1.4.11). The test also checks that the light and dark blocks define the same tokens,
  and that the two copies of the dark tokens (chosen, and following the system) are identical.
- **Without colour.** OptionButton states differ by:
  - an icon plus a text tag ("Đã chọn" •, "Đúng" ✓, "Sai" ✕);
  - border weight (3 px when not idle);
  - border style (dashed for incorrect);
  - `aria-pressed` for the selected option.

  Errors on the login form use an alert icon and text.
- **Theme.** The `theme` cookie (`system` / `light` / `dark`) is read in `handle` and rendered as
  `data-theme` on `<html>`, so the first paint is correct with no flash. `system` follows
  `prefers-color-scheme` in CSS. Settings changes it with a form action (it works without JS); the
  root layout keeps `<html>` in sync after a client-side change.
- **Layout.** Mobile-first in a `max-w-md` column. The primary action sits at the bottom of Home
  and Login (thumb zone). Tap targets are at least 48 px (tabs 56 px). Safe-area insets are used
  top and bottom (`viewport-fit=cover`). Motion is limited to short transitions and spinners,
  all disabled under `prefers-reduced-motion`.
- **Icon.** An original mark: an open book on deep jade with an amber bookmark ("reading, quietly").
  One SVG, `static/favicon.svg`, also shown on the login page.

## Decisions and judgement calls

- **Session ids are hashed.** The cookie holds the random token; the table's `id` is its SHA-256,
  so a leaked database or backup cannot be replayed as a login. Malformed tokens are rejected
  before any query.
- **Not configured** means pages redirect to `/login`, which says so in Vietnamese, and `/api/*`
  answers 503 JSON. A value in `APP_PASSWORD_HASH` that is not an argon2id hash counts as not
  configured (fail closed).
- **`COOKIE_SECURE=false`** is honoured for any `ORIGIN` (amendment). For a non-local origin it
  logs a warning at startup and sets `insecureRemote`, which shows the login notice.
- **`next`** must start with a single `/`. Backslashes and control characters are refused; it must
  resolve to the same origin; `/login` itself becomes `/`. Percent-encoded text stays encoded, so
  it is harmless in `Location`.
- **Rate limiter.** A blocked IP gets 429 before the password is checked, even if it is right. A
  successful login clears that IP's failures. Passwords over 1,024 characters are refused without
  hashing (no argon2 work for huge inputs).
- **`auth:hash`** reads from a TTY in raw mode (no echo; backspace and Ctrl-C handled). It also
  accepts two piped lines for scripting, and it requires at least 10 characters. It prints
  `APP_PASSWORD_HASH='…'` with single quotes, because the hash contains `$`.
- **`SESSION_SECRET` removed** from `.env.example`: server-side sessions sign nothing.
- **`ORIGIN` is a build-time setting.** adapter-node 6 (SvelteKit 3) dropped its runtime `ORIGIN`
  variable: the origin comes from `kit.paths.origin`, and without it the request origin is taken as
  `https://<Host>`. Over plain HTTP, SvelteKit's CSRF check then rejects every form POST (the login)
  with 403. Found by running the production build at a non-local HTTP origin. `vite.config.ts` now
  sets `paths.origin` from `ORIGIN` at build time. The e2e build is made without it, because three
  preview ports share one build and `vite preview` takes the origin from each request. Checked by
  hand: `ORIGIN=http://127.0.0.2:4178 npm run build`, then `node build` with `COOKIE_SECURE=false`.
  The notice shows; login lands on `next` with an `httpOnly`, non-secure cookie; logout works.
- **SvelteKit 3 specifics.** `$app/environment` is now `$app/env`; `Handle` comes from
  `@sveltejs/kit/hooks`. The `init` hook is skipped while building (`building`), so `vite build`
  never opens or migrates `data/app.db`.
- **E2E.**
  - **Three preview servers:**
    - main;
    - no password hash, with a non-local `ORIGIN` so the HTTP notice shows;
    - rate limit, isolated because the limiter is per IP and would block the other tests.
  - **Test password:** its hash is computed when the config loads, so no hash is committed.
  - **Shared values:** the config and `test/e2e/support.ts` repeat a few constants, because
    Playwright compiles the config separately and a shared module lost its named exports.
  - **Expired session:** the test changes the expiry in the server's database file.
- **Screenshots** run against `vite dev`, because `/dev/components` 404s in production builds.
  They use a throwaway password and database in `tmp/screens/`, at 390×844 CSS px and device
  scale 2.
- The dev gallery's labels are in `vi.ts` too (hard rule 2), under `t.dev`.

## Check

`npm run verify`; `npm run test:e2e`; `npm run screenshots`; the production build (`node build`)
redirects pages to login, answers `/api/*` with 401 and serves `/favicon.svg` publicly.
