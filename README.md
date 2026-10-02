# SilentEnglish

A personal, single-user web app for learning English reading, writing, vocabulary and grammar,
with a Vietnamese UI and no audio. Built with SvelteKit and SQLite; designed to be installed as a
PWA on a phone and run on a small VPS. The design lives in [`docs/architecture.md`](docs/architecture.md).

## Prerequisites

- Node.js 22 LTS, **22.18 or newer** (with npm); the `tool/` scripts run TypeScript directly via Node's type stripping
- [gitleaks](https://github.com/gitleaks/gitleaks) on your `PATH` (the pre-commit hook refuses to
  commit without it), e.g. `brew install gitleaks` or
  `go install github.com/zricethezav/gitleaks/v8@latest`

`better-sqlite3` is pinned to 12.x, which ships prebuilt binaries for Node 22: macOS and Linux
x64/arm64 install without a compiler; only unusual platforms fall back to building from source
(which needs Python and a C++ toolchain).

## First-time setup

```sh
npm ci
git config core.hooksPath .githooks
npx playwright install chromium   # only needed for e2e tests
cp .env.example .env              # then fill in values; never commit .env
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (`build/`, run with `node build`) |
| `npm run preview` | Serve the production build |
| `npm run check` | Type-check with `svelte-check` |
| `npm run lint:strings` | Fail if a `.svelte` file contains Vietnamese text |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run content:prepare` | Rebuild the content assets in `src/lib/server/content/` from `tool/raw/` |
| `npm run content:tatoeba-pairs` | Re-join the Tatoeba exports (see `tool/raw/README.md`) |
| `npm run db:migrate` | Create or migrate the SQLite database at `DATABASE_PATH` (default `data/app.db`) |
| `npm run verify` | `check`, `lint:strings`, `test` and `build`, stopping at the first failure |
