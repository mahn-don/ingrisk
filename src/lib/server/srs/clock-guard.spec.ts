import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRS_DIR = 'src/lib/server/srs';

describe('srs never reads the clock', () => {
	it('has no Date.now() or argument-less new Date() outside spec files', () => {
		const offenders = readdirSync(SRS_DIR)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
			.flatMap((file) =>
				readFileSync(join(SRS_DIR, file), 'utf8')
					.split('\n')
					.map((line, i) => ({ where: `${file}:${i + 1}`, line }))
					.filter(({ line }) => /Date\.now\s*\(|new\s+Date\s*\(\s*\)/.test(line))
					.map(({ where, line }) => `${where}: ${line.trim()}`)
			);
		expect(offenders).toEqual([]);
	});
});
