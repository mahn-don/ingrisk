# SilentEnglish

A personal, single-user web app for learning English reading, writing, vocabulary and grammar,
with a Vietnamese UI and no audio. Built with SvelteKit and SQLite; designed to be installed as a
PWA on a phone and run on a small VPS. The design lives in [`docs/architecture.md`](docs/architecture.md).

## Prerequisites

- Node.js 22 LTS (with npm)
- [gitleaks](https://github.com/gitleaks/gitleaks) on your `PATH` (the pre-commit hook refuses to
  commit without it), e.g. `brew install gitleaks` or
  `go install github.com/zricethezav/gitleaks/v8@latest`

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
| `npm run verify` | `check`, `lint:strings`, `test` and `build`, stopping at the first failure |
