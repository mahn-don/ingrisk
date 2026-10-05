import { describe, expect, it } from 'vitest';
import { TOPICS } from './reading/topics.ts';
import { promptsForBand, readWritingPrompts } from './writing-prompts.ts';

const prompts = readWritingPrompts();

describe('writing prompt bank', () => {
	it('has about 40 valid prompts with unique ids', () => {
		expect(prompts.length).toBeGreaterThanOrEqual(36);
		expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
	});

	it('spreads across every band and every topic', () => {
		for (let band = 1; band <= 8; band++) expect(promptsForBand(prompts, band).length).toBeGreaterThanOrEqual(3);
		const topics = new Set(prompts.map((p) => p.id.replace(/-\d{2}$/, '')));
		expect([...topics].sort()).toEqual(TOPICS.map((t) => t.id).sort());
	});

	it('asks for longer answers at higher bands', () => {
		const low = prompts.filter((p) => p.band_max <= 3);
		const high = prompts.filter((p) => p.band_min >= 6);
		expect(Math.max(...low.map((p) => p.max_words))).toBeLessThan(Math.min(...high.map((p) => p.min_words)) + 30);
	});
});
