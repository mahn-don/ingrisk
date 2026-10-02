import { describe, expect, it } from 'vitest';
import { t } from './vi';

function leaves(node: unknown, path: string): [string, unknown][] {
	if (node !== null && typeof node === 'object') {
		return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
	}
	return [[path, node]];
}

describe('vi messages', () => {
	it('has no empty strings', () => {
		const entries = leaves(t, '');
		expect(entries.length).toBeGreaterThan(0);
		for (const [path, value] of entries) {
			expect(typeof value, path).toBe('string');
			expect((value as string).trim(), path).not.toBe('');
		}
	});
});
