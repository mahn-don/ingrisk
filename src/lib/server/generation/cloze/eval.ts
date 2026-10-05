// The human evaluation sheet (`npm run eval:cloze`): a sample of validated items to grade, and a
// sample of rejected items with their reasons. The Phase 5 gate: at most 1 bad item in 30.
import type { ClozeItemWithSentence } from '../../db/repositories/cloze-items.ts';
import { seededShuffle } from '../random.ts';
import { tokenize, withGap } from '../tokens.ts';

export const REJECTED_SAMPLE = 10;

const cell = (text: string | null | undefined) => (text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const gapped = (item: ClozeItemWithSentence) => withGap(item.enText, tokenize(item.enText), item.tokenIndex);

export interface EvalOptions {
	n: number;
	seed: string;
	generatedAt: Date;
}

export function evalMarkdown(validated: readonly ClozeItemWithSentence[], rejected: readonly ClozeItemWithSentence[], options: EvalOptions): string {
	const sample = seededShuffle(validated, `eval|validated|${options.seed}`).slice(0, options.n);
	const rejectedSample = seededShuffle(rejected, `eval|rejected|${options.seed}`).slice(0, REJECTED_SAMPLE);
	const lines = [
		'# Cloze evaluation',
		'',
		`Generated ${options.generatedAt.toISOString()} (seed \`${options.seed}\`). Pool: ${validated.length} validated, ${rejected.length} rejected.`,
		'',
		`Mark every bad item in the **Bad?** column (wrong answer, a second correct option, unnatural sentence, misleading gloss).`,
		`Phase 5 gate: at most 1 bad item among ${options.n} validated items.`,
		'',
		`## Validated items (${sample.length})`,
		'',
		'| # | Sentence | Options | Answer | answer_vi | Type | Band | Bad? |',
		'|---|---|---|---|---|---|---|---|'
	];
	sample.forEach((item, i) => {
		lines.push(
			`| ${i + 1} | ${cell(gapped(item))}<br>_${cell(item.viText)}_ | ${cell(item.options.join(' / '))} | **${cell(item.answer)}** | ${cell(item.answerVi)} | ${item.gapType} | ${item.levelBand} | |`
		);
	});
	lines.push('', `## Rejected items (${rejectedSample.length} of ${rejected.length})`, '');
	lines.push('| # | Sentence | Options | Answer | Type | Band | Reason |', '|---|---|---|---|---|---|---|');
	rejectedSample.forEach((item, i) => {
		lines.push(
			`| ${i + 1} | ${cell(gapped(item))} | ${cell(item.options.join(' / '))} | **${cell(item.answer)}** | ${item.gapType} | ${item.levelBand} | ${cell(item.rejectionReason)} |`
		);
	});
	return `${lines.join('\n')}\n`;
}
