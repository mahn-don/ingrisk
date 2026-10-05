import { describe, expect, it } from 'vitest';
import { toProviderSchema } from '../schema.ts';
import * as critic from './cloze-critic.ts';
import * as distractors from './cloze-distractors.ts';

const sizeKeywords = (schema: unknown): string[] =>
	JSON.stringify(schema).match(/"(minItems|maxItems)":\s*\d+/g) ?? [];

describe('cloze prompt modules', () => {
	it('export a version string', () => {
		expect(distractors.PROMPT_VERSION).toMatch(/^cloze-distractors@\d+$/);
		expect(critic.PROMPT_VERSION).toMatch(/^cloze-critic@\d+$/);
	});

	it('send no array-size constraints to Anthropic, while Zod enforces them locally', () => {
		expect(sizeKeywords(toProviderSchema(distractors.Response, 'anthropic'))).toEqual([]);
		expect(sizeKeywords(toProviderSchema(critic.Response, 'anthropic'))).toEqual([]);
		const two = { items: [{ n: 1, distractors: [{ word: 'a', why_wrong: 'x' }, { word: 'b', why_wrong: 'y' }], answer_vi: 'z' }] };
		expect(distractors.Response.safeParse(two).success).toBe(false);
		const three = { items: [{ ...two.items[0], distractors: [...two.items[0].distractors, { word: 'c', why_wrong: 'z' }] }] };
		expect(distractors.Response.safeParse(three).success).toBe(true);
	});

	it('require every field', () => {
		const verdict = { label: 'A', grammatical: true, natural: true, meaning_ok: true };
		expect(critic.Verdict.safeParse(verdict).success).toBe(false);
		expect(critic.Verdict.safeParse({ ...verdict, note: '' }).success).toBe(true);
	});

	it('never reveal the answer to the critic', () => {
		const user = critic.buildUser([{ n: 1, sentences: [{ label: 'A', text: 'I saw a dog.' }, { label: 'B', text: 'I saw the dog.' }, { label: 'C', text: 'I saw dog.' }, { label: 'D', text: 'I saw an dog.' }] }]);
		expect(user).not.toMatch(/answer|correct|intended/i);
	});
});
