// Capture the main screens at 390×844 in light and dark: starts a dev server (so /dev/components
// exists) with a throwaway password and database under tmp/screens/, logs in, saves PNGs there.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { type Algorithm, hash } from '@node-rs/argon2';
import { chromium } from '@playwright/test';
import { parseCli, positiveInt } from './lib/cli.ts';

const args = parseCli({
	command: 'npm run screenshots --',
	summary: 'Screenshot Login, Home, Stats, Settings and /dev/components (390×844, light and dark) into tmp/screens/.',
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

const server = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], {
	detached: true,
	stdio: 'ignore',
	env: {
		...process.env,
		APP_PASSWORD_HASH: await hash(PASSWORD, { algorithm: 2 as Algorithm.Argon2id }),
		ORIGIN: origin,
		COOKIE_SECURE: 'false',
		DATABASE_PATH: `${OUT}/app.db`
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

await waitForServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const files: string[] = [];
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
	await context.close();
}
await browser.close();
stop();
for (const file of files) console.log(file);
