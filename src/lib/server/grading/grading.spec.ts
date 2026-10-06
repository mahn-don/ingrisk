import { describe, expect, it } from 'vitest';
import { MAX_RETURNED_ERRORS, WritingFeedback, selectShownErrors } from '../llm/prompts/feedback.ts';
import * as translationPrompt from '../llm/prompts/grade-translation.ts';
import { toProviderSchema } from '../llm/schema.ts';
import { openaiContent, openaiProvider, scriptedFetch, setupProviders, testDeps } from '../llm/test-helpers.ts';
import { readGradingFixtures } from './eval.ts';
import { gradeTranslation, gradeWriting, guardErrors, toDisplay } from './grading.ts';

const error = (original: string, correction: string, topic_code = 'SVA') => ({ original, correction, topic_code, explanation_vi: 'Sau "she" động từ thêm -s.' });
const base = (errors: object[] = [error('go', 'goes')], extra: object = {}) => ({
	corrected_text: 'She goes to work.',
	errors,
	cefr_estimate: 'A2',
	scores: { range: 2, accuracy: 3, coherence: 4 },
	...extra
});
/** Writing feedback (with the task-relevance fields). */
const feedback = (errors?: object[], extra: object = {}) => base(errors, { on_topic: true, task_note_vi: '', ...extra });

describe('WritingFeedback schema', () => {
	it('parses the Part II §5 shape', () => {
		expect(WritingFeedback.parse(feedback()).errors[0].topic_code).toBe('SVA');
	});

	it('keeps every returned error (up to 10) so all of them can be mined', () => {
		const four = [error('a', 'b'), error('c', 'd'), error('e', 'f'), error('g', 'h')];
		expect(WritingFeedback.parse(feedback(four)).errors.map((e) => e.original)).toEqual(['a', 'c', 'e', 'g']);
		const twelve = Array.from({ length: 12 }, (_, i) => error(`w${i}`, `x${i}`));
		expect(WritingFeedback.parse(feedback(twelve)).errors).toHaveLength(MAX_RETURNED_ERRORS);
	});

	it('rejects unknown codes, scores out of range and extra fields', () => {
		expect(WritingFeedback.safeParse(feedback([error('go', 'goes', 'GRAMMAR')])).success).toBe(false);
		expect(WritingFeedback.safeParse(feedback(undefined, { scores: { range: 6, accuracy: 3, coherence: 3 } })).success).toBe(false);
		expect(WritingFeedback.safeParse(feedback(undefined, { tips: 'x' })).success).toBe(false);
	});

	it('requires the task-relevance verdict and note', () => {
		expect(WritingFeedback.safeParse(base()).success).toBe(false);
		expect(WritingFeedback.parse(feedback(undefined, { on_topic: false, task_note_vi: 'Đề hỏi về bữa ăn.' }))).toMatchObject({ on_topic: false });
	});

	it('sends no array-size or numeric constraints to Anthropic', () => {
		const wire = JSON.stringify(toProviderSchema(WritingFeedback, 'anthropic'));
		expect(wire).not.toMatch(/"(minItems|maxItems|minimum|maximum)":/);
	});
});

describe('toDisplay', () => {
	const fb = WritingFeedback.parse(feedback());
	it('hides corrected_text in indirect mode only', () => {
		expect(toDisplay(fb, 'indirect')).not.toHaveProperty('corrected_text');
		expect(toDisplay(fb, 'indirect').errors).toEqual(fb.errors);
		expect(toDisplay(fb, 'direct')).toEqual(fb);
	});
});

describe('guardErrors', () => {
	it('drops errors quoting text the learner never wrote, or changing nothing', () => {
		const fb = WritingFeedback.parse(feedback([error('go', 'goes'), error('went', 'go'), error('work', 'work')]));
		const guarded = guardErrors(fb, 'She go to work.');
		expect(guarded.dropped).toBe(2);
		expect(guarded.feedback.errors.map((e) => e.original)).toEqual(['go']);
	});
});

describe('grading services', () => {
	it('gradeWriting returns the full feedback and the UI shape for the mode', async () => {
		const { db } = setupProviders(openaiProvider);
		const { fetch, requests } = scriptedFetch([openaiContent(JSON.stringify(feedback()))]);
		const result = await gradeWriting({ prompt_vi: 'Viết về công việc.', user_text: 'She go to work.', level_band: 2, feedback_mode: 'indirect' }, testDeps(db, fetch).deps);
		expect(result.feedback.corrected_text).toBe('She goes to work.');
		expect(result.display).not.toHaveProperty('corrected_text');
		expect(result.promptVersion).toBe('grade-writing@3');
		expect(JSON.parse((requests[0].body.messages as { content: string }[])[1].content.split('\n')[1]).learner_text).toBe('She go to work.');
	});

	it('gradeTranslation accepts meaning_ok and a correct answer with no errors', async () => {
		const { db } = setupProviders(openaiProvider);
		const answer = base([], { corrected_text: 'I usually take the bus to work.', meaning_ok: true });
		const { fetch } = scriptedFetch([openaiContent(JSON.stringify(answer))]);
		const result = await gradeTranslation(
			{ vi: 'Tôi thường đi làm bằng xe buýt.', reference_en: 'I usually go to work by bus.', user_en: 'I usually take the bus to work.', level_band: 2 },
			testDeps(db, fetch).deps
		);
		expect(result.feedback).toMatchObject({ meaning_ok: true, errors: [] });
	});

	it('gradeTranslation needs meaning_ok', async () => {
		const { db } = setupProviders(openaiProvider);
		const { fetch } = scriptedFetch([openaiContent(JSON.stringify(feedback())), openaiContent(JSON.stringify(feedback()))]);
		await expect(
			gradeTranslation({ vi: 'x', reference_en: 'y', user_en: 'She go to work.', level_band: 2 }, testDeps(db, fetch).deps)
		).rejects.toMatchObject({ code: 'schema' });
	});

	it('the translation prompt says the reference is one valid translation of many', () => {
		expect(translationPrompt.system).toContain('only ONE valid translation');
		expect(translationPrompt.system).toMatch(/NO errors and meaning_ok is true/);
	});
});

describe('selectShownErrors', () => {
	it('SVA, SVA, ART, COP: shows 3 distinct codes, COP included, with the SVA repeat counted', () => {
		const errors = [error('he go', 'he goes', 'SVA'), error('she like', 'she likes', 'SVA'), error('go to market', 'go to the market', 'ART'), error('she very tired', 'she is very tired', 'COP')];
		const shown = selectShownErrors(errors);
		expect(shown.map((s) => s.error.topic_code)).toEqual(['SVA', 'ART', 'COP']);
		expect(shown.map((s) => s.repeats)).toEqual([2, 1, 1]);
		expect(shown[0].error.original).toBe('he go'); // the most important of its code
	});

	it('fills with repeats when there are fewer than 3 codes, keeping the model order', () => {
		const errors = [error('a', 'b', 'TNS'), error('c', 'd', 'TNS'), error('e', 'f', 'TNS'), error('g', 'h', 'ART')];
		expect(selectShownErrors(errors).map((s) => [s.error.original, s.repeats])).toEqual([
			['a', 3],
			['g', 1],
			['c', 3]
		]);
		expect(selectShownErrors([])).toEqual([]);
	});
});

describe('grading eval fixtures', () => {
	it('parse, and include the repeated-code cases with expected shown codes', () => {
		const fixtures = readGradingFixtures();
		const repeated = fixtures.find((f) => f.id === 'sva-sva-art-cop');
		expect(repeated?.expected_shown_codes).toEqual(['SVA', 'ART', 'COP']);
		expect(fixtures.filter((f) => f.expected_shown_codes !== undefined)).toHaveLength(2);
	});
});
