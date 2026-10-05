// Capture the main screens at 390×844 in light and dark: starts a dev server (so /dev/components
// exists) with a throwaway password and a seeded database under tmp/screens/ (canned LLM), logs
// in, walks through the placement test, saves PNGs there.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { type Algorithm, hash } from '@node-rs/argon2';
import { type Page, chromium } from '@playwright/test';
import { parseCli, positiveInt } from './lib/cli.ts';
import { seedTestDatabase } from './lib/test-content.ts';

const args = parseCli({
	command: 'npm run screenshots --',
	summary: 'Screenshot Login, Home, Stats, Settings, /dev/components and the placement test (390×844, light and dark) into tmp/screens/.',
	usage: ['--port N           Port for the temporary dev server (default 5199); CHROMIUM_PATH picks a Chromium binary'],
	example: '--port 5199',
	options: { port: { type: 'string', default: '5199' } }
});

const OUT = 'tmp/screens';
const PASSWORD = 'screenshots-only-password';
const port = positiveInt('port', args.port);
const origin = `http://localhost:${port}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await seedTestDatabase(`${OUT}/app.db`, { clozePerBand: 30 });

const server = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], {
	detached: true,
	stdio: 'ignore',
	env: {
		...process.env,
		APP_PASSWORD_HASH: await hash(PASSWORD, { algorithm: 2 as Algorithm.Argon2id }),
		ORIGIN: origin,
		COOKIE_SECURE: 'false',
		DATABASE_PATH: `${OUT}/app.db`,
		LLM_CANNED: '1'
	}
});
const stop = () => {
	try {
		process.kill(-server.pid!, 'SIGTERM');
	} catch {
		// already gone
	}
};
process.on('exit', stop);

async function waitForServer(): Promise<void> {
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${origin}/login`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`the dev server did not start on ${origin}`);
}

// Part A answers: pseudo-words "Không biết"; real words "Biết" up to NGSL band 4.
const bandOf = new Map(
	(JSON.parse(readFileSync('src/lib/server/content/ngsl.json', 'utf8')) as { items: { headword: string; band: number }[] }).items.map((i) => [i.headword, i.band])
);

/** Answer the item on screen and wait for the next one (or the end of the part). */
async function answer(page: Page, testid: string, click: () => Promise<void>) {
	const ref = await page.getByTestId(testid).getAttribute('data-ref');
	await click();
	await page.waitForFunction(([id, old]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-ref') !== old, [testid, ref] as const);
}

async function placement(page: Page, shot: (name: string, fullPage?: boolean) => Promise<void>, restart: boolean) {
	await page.goto(`${origin}/placement${restart ? '?restart' : ''}`);
	await page.waitForLoadState('networkidle'); // hydrated: the buttons work
	await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
	await page.getByTestId('placement-intro').waitFor();
	await shot('placement-intro');
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	for (let i = 0; i < 2; i++) {
		const word = (await page.getByTestId('part-a-word').textContent())!.trim();
		await answer(page, 'part-a', () => page.getByRole('button', { name: (bandOf.get(word) ?? 9) <= 4 ? 'Biết' : 'Không biết', exact: true }).click());
	}
	await shot('placement-a');
	while (await page.getByTestId('part-a').isVisible()) {
		const word = (await page.getByTestId('part-a-word').textContent())!.trim();
		await answer(page, 'part-a', () => page.getByRole('button', { name: (bandOf.get(word) ?? 9) <= 4 ? 'Biết' : 'Không biết', exact: true }).click());
	}
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	let n = 0;
	while (await page.getByTestId('part-b').isVisible()) {
		if (n === 1) await shot('placement-b');
		await answer(page, 'part-b', () => page.getByTestId('part-b').getByRole('button').nth(n++ % 3).click());
	}
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	await page.getByLabel('Bài viết của bạn (bằng tiếng Anh)').fill('Last weekend I visited my grandmother in the countryside. We cooked lunch together and talked about my school.');
	await shot('placement-c');
	await page.getByRole('button', { name: 'Nộp bài' }).click();
	await page.waitForURL(/\/placement\/result\/\d+$/);
	await shot('placement-result', true);
}

await waitForServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const files: string[] = [];
const contexts = [];
for (const theme of ['light', 'dark'] as const) {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
	await context.addCookies([{ name: 'theme', value: theme, url: origin }]);
	const page = await context.newPage();
	const shot = async (name: string, fullPage = false) => {
		await page.evaluate(() => document.fonts.ready);
		const file = `${OUT}/${name}-${theme}.png`;
		await page.screenshot({ path: file, fullPage });
		files.push(file);
	};
	await page.goto(`${origin}/login`);
	await shot('login');
	await page.getByLabel('Mật khẩu').fill(PASSWORD);
	await page.getByRole('button', { name: 'Đăng nhập' }).click();
	await page.waitForURL(`${origin}/`);
	await shot('home');
	for (const path of ['stats', 'settings']) {
		await page.goto(`${origin}/${path}`);
		await shot(path);
	}
	await page.goto(`${origin}/dev/components`);
	await shot('components', true);
	contexts.push({ page, shot });
}
// Then the placement test in each theme; the second run's result shows the comparison.
for (const [i, { page, shot }] of contexts.entries()) await placement(page, shot, i > 0);
await browser.close();
stop();
for (const file of files) console.log(file);
