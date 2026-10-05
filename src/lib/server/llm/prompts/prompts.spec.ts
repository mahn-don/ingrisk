import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { toProviderSchema } from '../schema.ts';
import * as clozeCritic from './cloze-critic.ts';
import * as clozeDistractors from './cloze-distractors.ts';
import * as drillCritic from './drill-critic.ts';
import * as drillExplain from './drill-explain.ts';
import * as drillGenerate from './drill-generate.ts';
import * as gradeTranslation from './grade-translation.ts';
import * as gradeWriting from './grade-writing.ts';
import { describeBand } from './levels.ts';
import * as readingCritic from './reading-critic.ts';
import * as readingPassage from './reading-passage.ts';

const MODULES: [string, { PROMPT_VERSION: string; PURPOSE?: string; Response: ZodType }][] = [
	['cloze-distractors', clozeDistractors],
	['cloze-critic', clozeCritic],
	['drill-explain', drillExplain],
	['drill-generate', drillGenerate],
	['drill-critic', drillCritic],
	['reading-passage', readingPassage],
	['reading-critic', readingCritic],
	['grade-writing', gradeWriting],
	['grade-translation', gradeTranslation]
];

const constraintKeywords = (schema: unknown): string[] =>
	JSON.stringify(schema).match(/"(minItems|maxItems|minimum|maximum|minLength|maxLength|multipleOf)":\s*\d+/g) ?? [];

describe('prompt modules', () => {
	for (const [name, module] of MODULES) {
		it(`${name}: exports a version string and sends no size or numeric constraints to Anthropic`, () => {
			expect(module.PROMPT_VERSION).toMatch(new RegExp(`^${name}@\\d+$`));
			expect(constraintKeywords(toProviderSchema(module.Response, 'anthropic'))).toEqual([]);
			expect(constraintKeywords(toProviderSchema(module.Response, 'openai-strict'))).toEqual([]);
		});
	}

	it('cloze: Zod still enforces the array sizes locally', () => {
		const two = { items: [{ n: 1, distractors: [{ word: 'a', why_wrong: 'x' }, { word: 'b', why_wrong: 'y' }], answer_vi: 'z' }] };
		expect(clozeDistractors.Response.safeParse(two).success).toBe(false);
		const three = { items: [{ ...two.items[0], distractors: [...two.items[0].distractors, { word: 'c', why_wrong: 'z' }] }] };
		expect(clozeDistractors.Response.safeParse(three).success).toBe(true);
	});

	it('reading: exactly 2 questions of 4 options, answer_index 0-3, glossary at most 5', () => {
		const q = { question_en: 'Q?', options: ['a', 'b', 'c', 'd'], answer_index: 1, explanation_vi: 'x' };
		const ok = { title_en: 't', passage_en: 'p', questions: [q, q], glossary: [] };
		expect(readingPassage.Response.safeParse(ok).success).toBe(true);
		expect(readingPassage.Response.safeParse({ ...ok, questions: [q] }).success).toBe(false);
		expect(readingPassage.Response.safeParse({ ...ok, questions: [q, { ...q, answer_index: 4 }] }).success).toBe(false);
		expect(readingPassage.Response.safeParse({ ...ok, glossary: Array.from({ length: 6 }, () => ({ word: 'w', vi: 'v' })) }).success).toBe(false);
	});

	it('require every field', () => {
		const verdict = { label: 'A', grammatical: true, natural: true, meaning_ok: true };
		expect(clozeCritic.Verdict.safeParse(verdict).success).toBe(false);
		expect(clozeCritic.Verdict.safeParse({ ...verdict, note: '' }).success).toBe(true);
		expect(drillCritic.Response.safeParse({ items: [{ n: 1, fixes: [] }] }).success).toBe(false);
	});

	it('critics never see the answer', () => {
		const cloze = clozeCritic.buildUser([{ n: 1, sentences: [{ label: 'A', text: 'I saw a dog.' }, { label: 'B', text: 'I saw the dog.' }, { label: 'C', text: 'I saw dog.' }, { label: 'D', text: 'I saw an dog.' }] }]);
		expect(cloze).not.toMatch(/answer|correct|intended/i);
		expect(drillCritic.buildUser([{ n: 1, sentence: 'She go to work.' }])).toBe('Items (JSON):\n{"items":[{"n":1,"sentence":"She go to work."}]}');
		const reading = readingCritic.buildUser([{ n: 1, passage: 'P.', questions: [{ q: 1, question: 'Q?', options: { A: 'a', B: 'b', C: 'c', D: 'd' } }] }]);
		expect(reading).not.toMatch(/answer_index|correct|intended/i);
	});

	it('describes bands for the model', () => {
		expect(describeBand(1)).toBe('band 1 of 8 (about CEFR A1): use mostly the 704 most common English words');
		expect(describeBand(8)).toContain('2,816');
	});
});
