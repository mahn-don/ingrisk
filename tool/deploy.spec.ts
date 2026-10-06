// The deploy/ shell scripts, run for real in a throwaway checkout: DRY_RUN=1 for everything that
// would touch git, npm, systemd or sudo; prefetch.sh and cron-run.sh against a local HTTP stub.
import { type SpawnSyncReturns, execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, chownSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'cron-secret-for-tests-only-3f9a';
const HASH = "'$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'";
const root = mkdtempSync(join(tmpdir(), 'se-deploy-test-'));
const repo = join(root, 'repo');
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
// install.sh refuses root as the deploy user: when the tests run as root, use "nobody".
const deployUser = userInfo().uid === 0 ? 'nobody' : userInfo().username;

function writeEnv(lines: Record<string, string>) {
	const path = join(repo, '.env');
	writeFileSync(path, `${Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
	chmodSync(path, 0o600);
	if (userInfo().uid === 0) chownSync(path, Number(execFileSync('id', ['-u', deployUser]).toString()), -1);
}

const baseEnv = (port = 3000) => ({
	ORIGIN: "'http://203.0.113.5:3000'",
	PORT: String(port),
	HOST: '0.0.0.0',
	COOKIE_SECURE: 'false',
	DATABASE_PATH: join(repo, 'data', 'app.db'),
	APP_PASSWORD_HASH: HASH,
	CRON_SECRET: SECRET
});

function sh(script: string, env: Record<string, string> = {}, args: string[] = []): SpawnSyncReturns<string> {
	return spawnSync('bash', [join(repo, 'deploy', script), ...args], {
		cwd: repo,
		encoding: 'utf8',
		env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, REPO_DIR: repo, ...env }
	});
}
const out = (r: Pick<SpawnSyncReturns<string>, 'stdout' | 'stderr'>) => `${r.stdout}${r.stderr}`;

type Ran = { status: number | null; stdout: string; stderr: string };
/** Like sh(), without blocking the event loop (the HTTP stub below runs in this process). */
function shAsync(script: string, env: Record<string, string> = {}, args: string[] = []): Promise<Ran> {
	return new Promise((resolve) => {
		const child = spawn('bash', [join(repo, 'deploy', script), ...args], {
			cwd: repo,
			env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, REPO_DIR: repo, ...env }
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (c) => (stdout += c));
		child.stderr.on('data', (c) => (stderr += c));
		child.on('close', (status) => resolve({ status, stdout, stderr }));
	});
}

beforeAll(() => {
	mkdirSync(join(repo, 'build'), { recursive: true });
	cpSync('deploy', join(repo, 'deploy'), { recursive: true });
	cpSync('.nvmrc', join(repo, '.nvmrc'));
	writeFileSync(join(repo, 'build', 'index.js'), '');
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
	execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: repo });
	writeEnv(baseEnv());
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('shellcheck', () => {
	it.skipIf(!has('shellcheck'))('passes on every deploy script', () => {
		const files = readdirSync('deploy').filter((f) => f.endsWith('.sh')).map((f) => `deploy/${f}`);
		const result = spawnSync('shellcheck', ['-x', ...files], { encoding: 'utf8' });
		expect(out(result)).toBe('');
		expect(result.status).toBe(0);
	});
});

describe('deploy.sh (DRY_RUN=1)', () => {
	it('pulls, installs, builds with ORIGIN only, snapshots, restarts, then polls /healthz', () => {
		const result = sh('deploy.sh', { DRY_RUN: '1' });
		expect(result.status, out(result)).toBe(0);
		const lines = result.stdout.split('\n').filter((l) => l.includes('[dry-run]')).map((l) => l.trim());
		expect(lines).toEqual([
			'[dry-run] git pull --ff-only',
			'[dry-run] npm ci --include=dev',
			'[dry-run] env ORIGIN=http://203.0.113.5:3000 npm run build',
			'[dry-run] npm run -s db:snapshot -- --label predeploy',
			'[dry-run] sudo -n systemctl restart silentenglish',
			'[dry-run] would poll http://127.0.0.1:3000/healthz'
		]);
		// No other .env value reaches the output (or the build command).
		expect(out(result)).not.toContain(SECRET);
		expect(out(result)).not.toContain('argon2id');
	});

	it('a rollback (detached HEAD) builds without pulling', () => {
		execFileSync('git', ['checkout', '-q', '--detach'], { cwd: repo });
		try {
			const result = sh('deploy.sh', { DRY_RUN: '1' });
			expect(result.status, out(result)).toBe(0);
			expect(result.stdout).toContain('Detached HEAD (a rollback)');
			expect(result.stdout).not.toContain('git pull');
		} finally {
			execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
		}
	});

	it('fails loudly without .env or without ORIGIN', () => {
		writeEnv({ ...baseEnv(), ORIGIN: '' });
		const noOrigin = sh('deploy.sh', { DRY_RUN: '1' });
		expect(noOrigin.status).toBe(1);
		expect(noOrigin.stderr).toContain('ORIGIN is not set');
		rmSync(join(repo, '.env'));
		const noEnv = sh('deploy.sh', { DRY_RUN: '1' });
		expect(noEnv.status).toBe(1);
		expect(noEnv.stderr).toContain('.env is missing');
		writeEnv(baseEnv());
	});
});

describe('install.sh (DRY_RUN=1)', () => {
	const fakeNode = (version: string) => {
		const path = join(root, `node-${version}`);
		writeFileSync(path, `#!/bin/sh\necho ${version}\n`);
		chmodSync(path, 0o755);
		return path;
	};
	const install = (env: Record<string, string> = {}) => sh('install.sh', { DRY_RUN: '1', DEPLOY_USER: deployUser, NODE_BIN: fakeNode('v24.11.1'), ...env });

	it('renders the unit and a validated sudoers drop-in with only restart, status and journal', () => {
		const result = install();
		expect(result.status, out(result)).toBe(0);
		const unit = result.stdout.split('\n').filter((l) => l.startsWith('    | ')).map((l) => l.slice(6));
		expect(unit.join('\n')).not.toMatch(/@[A-Z_]+@/);
		for (const line of [
			`User=${deployUser}`,
			`WorkingDirectory=${repo}`,
			`EnvironmentFile=${repo}/.env`,
			'ExecStart=/usr/bin/env node build/index.js',
			'Restart=always',
			'RestartSec=3',
			'NoNewPrivileges=yes',
			'PrivateTmp=yes',
			'ProtectSystem=full',
			'ProtectHome=read-only',
			`ReadWritePaths=${repo}/data`,
			`Environment=PATH=${root}:/usr/local/bin:/usr/bin:/bin`
		]) {
			expect(unit, line).toContain(line);
		}
		const sudoers = unit.filter((l) => l.includes('NOPASSWD') || l.startsWith('\t')).join(' ');
		expect(sudoers).toMatch(/systemctl restart silentenglish/);
		expect(sudoers).not.toMatch(/\*|ALL$|systemctl (start|stop|edit)/);
		if (has('visudo')) expect(result.stdout).toContain('visudo -cf: ok');
		expect(out(result)).not.toContain(SECRET);
	});

	it('refuses .env with another mode, a database outside data/, an old Node, and root', () => {
		chmodSync(join(repo, '.env'), 0o644);
		expect(out(install())).toContain('must be 600');
		writeEnv({ ...baseEnv(), DATABASE_PATH: '/var/lib/app.db' });
		expect(out(install())).toContain('DATABASE_PATH in .env must be an absolute path under');
		writeEnv(baseEnv());
		const old = install({ NODE_BIN: fakeNode('v22.18.0') });
		expect(old.status).toBe(1);
		expect(old.stderr).toContain('Node 24 LTS or newer is required');
		expect(out(install({ DEPLOY_USER: 'root' }))).toContain('cannot tell the deploy user');
		rmSync(join(repo, 'build', 'index.js'));
		expect(out(install())).toContain('no build yet');
		writeFileSync(join(repo, 'build', 'index.js'), '');
	});
});

describe('backup.sh, prefetch.sh and cron-run.sh', () => {
	let port = 0;
	const seen: { auth?: string; type?: string; body: string; method?: string }[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ auth: req.headers.authorization, type: req.headers['content-type'], body, method: req.method });
			res.setHeader('content-type', 'application/json');
			res.end(req.url === '/api/cron/prefetch' ? '{"steps":[]}' : '{}');
		});
	});
	beforeAll(async () => {
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as AddressInfo).port;
	});
	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

	it('backup.sh runs the snapshot CLI', () => {
		const result = sh('backup.sh', { DRY_RUN: '1' });
		expect(result.status, out(result)).toBe(0);
		expect(result.stdout).toContain('[dry-run] npm run -s db:snapshot');
	});

	it('prefetch.sh sends the secret as a header from stdin; it never appears in the output', async () => {
		writeEnv(baseEnv(port));
		const result = await shAsync('prefetch.sh');
		expect(result.status, out(result)).toBe(0);
		expect(seen.at(-1)).toEqual({ auth: `Bearer ${SECRET}`, type: 'application/json', body: '{}', method: 'POST' });
		expect(out(result)).not.toContain(SECRET);
		expect(out(sh('prefetch.sh', { DRY_RUN: '1' }))).not.toContain(SECRET);
	});

	it('cron-run.sh appends to data/logs/<job>.log and rotates it past the size limit', async () => {
		writeEnv(baseEnv(port));
		const logs = join(repo, 'data', 'logs');
		mkdirSync(logs, { recursive: true });
		writeFileSync(join(logs, 'prefetch.log'), 'x'.repeat(2000));
		const result = await shAsync('cron-run.sh', { LOG_MAX_BYTES: '1000' }, ['prefetch']);
		expect(result.status, out(result)).toBe(0);
		expect(readFileSync(join(logs, 'prefetch.log.1'), 'utf8')).toBe('x'.repeat(2000));
		const log = readFileSync(join(logs, 'prefetch.log'), 'utf8');
		expect(log).toContain('{"steps":[]}');
		expect(log).toMatch(/prefetch exit 0/);
		expect(log).not.toContain(SECRET);
		expect(sh('cron-run.sh', {}, ['rm-rf']).status).toBe(1);
		// A failing job is logged with its exit code, and cron-run.sh fails too.
		writeEnv({ ...baseEnv(port), CRON_SECRET: '' });
		const failed = await shAsync('cron-run.sh', {}, ['prefetch']);
		expect(failed.status).toBe(1);
		expect(readFileSync(join(logs, 'prefetch.log'), 'utf8')).toMatch(/CRON_SECRET is not set[\s\S]*prefetch exit 1/);
		writeEnv(baseEnv());
	});
});
