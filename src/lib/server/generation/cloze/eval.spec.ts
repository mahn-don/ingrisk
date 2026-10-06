import { describe, expect, it } from 'vitest';
import type { ClozeItemWithSentence } from '../../db/repositories/cloze-items.ts';
import { evalMarkdown } from './eval.ts';

const item = (id: number, validated: boolean): ClozeItemWithSentence => ({
	id,
	sentenceId: id,
	gapType: 'lexical',
	tokenIndex: 3,
	tokenCount: 1,
	typingOnly: false,
	answer: 'big',
	options: ['small', 'big', 'loud', 'purple'],
	answerVi: 'to',
	lexemeId: null,
	grammarTopicId: null,
	levelBand: 2,
	ruleOk: true,
	criticOk: validated,
	validated,
	rejectionReason: validated ? null : 'critic:several_acceptable (A, B)',
	criticNotes: null,
	promptVersion: 'cloze-distractors@1+cloze-critic@1',
	model: 'm',
	contentHash: `h${id}`,
	createdAt: new Date(0),
	enText: 'The dog is big | heavy.',
	viText: 'Con chó to.'
});

describe('evalMarkdown', () => {
	const validated = Array.from({ length: 40 }, (_, i) => item(i + 1, true));
	const rejected = Array.from({ length: 15 }, (_, i) => item(100 + i, false));
	const md = evalMarkdown(validated, rejected, { n: 30, seed: 'fixed', generatedAt: new Date('2026-10-05T00:00:00Z') });

	it('samples n validated items and 10 rejected ones with reasons', () => {
		expect(md).toContain('## Validated items (30)');
		expect(md).toContain('## Rejected items (10 of 15)');
		expect(md.match(/critic:several_acceptable/g)).toHaveLength(10);
		expect(md).toContain('The dog is ___ \\| heavy.');
		expect(md).toContain('small / big / loud / purple');
	});

	it('is deterministic for a seed', () => {
		expect(evalMarkdown(validated, rejected, { n: 30, seed: 'fixed', generatedAt: new Date('2026-10-05T00:00:00Z') })).toBe(md);
	});
});
