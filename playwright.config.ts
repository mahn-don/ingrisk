import { mkdirSync, rmSync } from 'node:fs';
import { type Algorithm, hashSync } from '@node-rs/argon2';
import { defineConfig } from '@playwright/test';

// Keep in sync with test/e2e/support.ts (the config cannot share a module with the tests:
// Playwright compiles the config separately and the shared module loses its named exports).
const E2E_PASSWORD = 'e2e-only-password-not-real';
const E2E_CRON_SECRET = 'e2e-only-cron-value';
const E2E_DIR = 'tmp/e2e';
const SERVERS = {
	main: { port: 4173, db: `${E2E_DIR}/main.db` },
	unconfigured: { port: 4174, db: `${E2E_DIR}/unconfigured.db` },
	rateLimit: { port: 4175, db: `${E2E_DIR}/rate-limit.db` },
	placement: { port: 4176, db: `${E2E_DIR}/placement.db` }
} as const;

// The config is loaded again in every worker: only the main process resets the databases.
const isWorker = process.env.TEST_WORKER_INDEX !== undefined;
if (!isWorker) {
	rmSync(E2E_DIR, { recursive: true, force: true });
	mkdirSync(E2E_DIR, { recursive: true });
}
const passwordHash = isWorker ? '' : hashSync(E2E_PASSWORD, { algorithm: 2 as Algorithm.Argon2id });
const BUILT = `${E2E_DIR}/built`;
const waitForBuild = `until [ -f ${BUILT} ]; do sleep 0.2; done;`;
// The build is shared by four ports, so it must not bake an origin (vite.config.ts paths.origin):
// it is built without ORIGIN, and vite preview takes the origin from each request.

const server = (port: number, db: string, env: Record<string, string>, command: string) => ({
	command,
	port,
	timeout: 240_000,
	reuseExistingServer: false,
	env: { DATABASE_PATH: db, ORIGIN: `http://localhost:${port}`, COOKIE_SECURE: 'false', ...env }
});

export default defineConfig({
	testMatch: '**/*.e2e.{ts,js}',
	workers: 1,
	webServer: [
		server(SERVERS.main.port, SERVERS.main.db, { APP_PASSWORD_HASH: passwordHash, CRON_SECRET: E2E_CRON_SECRET }, `env -u ORIGIN npm run build && touch ${BUILT} && npm run preview -- --port ${SERVERS.main.port} --strictPort`),
		// A non-local ORIGIN with COOKIE_SECURE=false: the login page must show the HTTP notice.
		// (vite preview takes the request origin from the Host header, so CSRF is unaffected.)
		server(SERVERS.unconfigured.port, SERVERS.unconfigured.db, { ORIGIN: 'http://192.0.2.10:3000' }, `sh -c '${waitForBuild} npm run preview -- --port ${SERVERS.unconfigured.port} --strictPort'`),
		server(SERVERS.rateLimit.port, SERVERS.rateLimit.db, { APP_PASSWORD_HASH: passwordHash }, `sh -c '${waitForBuild} npm run preview -- --port ${SERVERS.rateLimit.port} --strictPort'`),
		// Seeded content (a cloze pool built with canned responses) and the canned LLM for grading.
		// NODE_ENV=test: vite preview would default it to production, where LLM_CANNED is refused.
		server(
			SERVERS.placement.port,
			SERVERS.placement.db,
			{ APP_PASSWORD_HASH: passwordHash, LLM_CANNED: '1', NODE_ENV: 'test' },
			`sh -c 'node tool/seed-test-db.ts --db ${SERVERS.placement.db} --per-band 40 && ${waitForBuild} npm run preview -- --port ${SERVERS.placement.port} --strictPort'`
		)
	],
	projects: [
		{ name: 'main', testMatch: /auth\.e2e\.ts$/, use: { baseURL: `http://localhost:${SERVERS.main.port}` } },
		{ name: 'unconfigured', testMatch: /unconfigured\.e2e\.ts$/, use: { baseURL: `http://localhost:${SERVERS.unconfigured.port}` } },
		{ name: 'rate-limit', testMatch: /rate-limit\.e2e\.ts$/, use: { baseURL: `http://localhost:${SERVERS.rateLimit.port}` } },
		{ name: 'placement', testMatch: /placement\.e2e\.ts$/, use: { baseURL: `http://localhost:${SERVERS.placement.port}` } }
	]
});
