import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './lib/cli.ts';

const run = promisify(execFile);

/** Every npm script that runs a TypeScript file with node: all the repo's CLIs. */
const scripts = Object.entries(JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>)
	.map(([name, command]) => [name, /node (?:--\S+ )*(\S+\.ts)/.exec(command)?.[1]] as const)
	.filter((entry): entry is readonly [string, string] => entry[1] !== undefined);

async function exitCode(file: string, args: string[]): Promise<{ code: number; out: string }> {
	try {
		const { stdout } = await run(process.execPath, [file, ...args], { env: { ...process.env, DATABASE_PATH: ':memory:' } });
		return { code: 0, out: stdout };
	} catch (error) {
		const e = error as { code: number; stderr: string };
		return { code: e.code, out: e.stderr };
	}
}

describe('CLIs', () => {
	it('finds the CLIs', () => {
		expect(scripts.map(([name]) => name)).toEqual(
			expect.arrayContaining(['llm:provider:add', 'llm:smoke', 'llm:usage', 'cloze:build', 'prefetch', 'eval:cloze', 'eval:drills', 'eval:reading', 'eval:grading', 'content:import', 'db:migrate'])
		);
	});

	for (const [name, file] of scripts) {
		it(`${name}: --help exits 0 with usage and an example; an unknown flag exits non-zero`, async () => {
			const [help, unknown] = await Promise.all([exitCode(file, ['--help']), exitCode(file, ['--no-such-flag'])]);
			expect(help.code).toBe(0);
			expect(help.out).toMatch(/Usage: npm run /);
			expect(help.out).toMatch(/Example:/);
			expect(unknown.code).not.toBe(0);
			expect(unknown.out).toMatch(/Unknown option '--no-such-flag'/);
		}, 20_000);
	}
});

describe('parseCliArgs', () => {
	const spec = { command: 'npm run x --', summary: 'X.', usage: ['--n N   A number'], example: '--n 3', options: { n: { type: 'string' as const, default: '1' } } };
	it('parses values, help and errors without exiting', () => {
		expect(parseCliArgs(spec, ['--n', '5'])).toEqual({ kind: 'values', values: { n: '5' } });
		expect(parseCliArgs(spec, ['-h'])).toMatchObject({ kind: 'help' });
		expect(parseCliArgs(spec, ['stray'])).toMatchObject({ kind: 'error' });
	});
});
