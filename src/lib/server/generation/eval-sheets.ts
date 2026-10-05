// Human evaluation sheets (markdown) for drills and reading passages.
import type { CacheItem } from '../db/repositories/cache.ts';
import type { DrillPayload } from './drills/rules.ts';
import { seededShuffle } from './random.ts';
import type { ReadingPayload } from './reading/build.ts';

export const REJECTED_SAMPLE = 10;

export interface SheetOptions {
	n: number;
	seed: string;
	generatedAt: Date;
}

const cell = (text: string | null | undefined) => (text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The reason stored in validation_notes (JSON {reason, ...} or plain text). */
export function notesReason(notes: string | null): string {
	if (notes === null) return '';
	try {
		return String((JSON.parse(notes) as { reason?: unknown }).reason ?? '');
	} catch {
		return notes;
	}
}

export function drillsMarkdown(accepted: readonly CacheItem[], rejected: readonly CacheItem[], options: SheetOptions): string {
	const sample = seededShuffle(accepted, `eval|drills|${options.seed}`).slice(0, options.n);
	const rejectedSample = seededShuffle(rejected, `eval|drills-rejected|${options.seed}`).slice(0, REJECTED_SAMPLE);
	const drill = (item: CacheItem) => item.payloadJson as DrillPayload;
	const lines = [
		'# Error-correction drill evaluation',
		'',
		`Generated ${options.generatedAt.toISOString()} (seed \`${options.seed}\`). Pool: ${accepted.length} accepted, ${rejected.length} rejected.`,
		'',
		'Mark a drill bad in **Bad?** if the sentence has no error, has more than one, the correction is wrong or unnatural, the code is wrong, or the explanation misleads.',
		'',
		`## Accepted drills (${sample.length})`,
		'',
		'| # | Code | Band | Source | Sentence with error | Corrected | Span | Explanation | Bad? |',
		'|---|---|---|---|---|---|---|---|---|'
	];
	sample.forEach((item, i) => {
		const d = drill(item);
		lines.push(
			`| ${i + 1} | ${d.topic_code} | ${item.levelBand} | ${d.source} | ${cell(d.sentence_with_error)} | ${cell(d.corrected)} | ${cell(d.original_span)} → ${cell(d.corrected_span)} | ${cell(d.explanation_vi)} | |`
		);
	});
	lines.push('', `## Rejected drills (${rejectedSample.length} of ${rejected.length})`, '');
	lines.push('| # | Code | Band | Sentence with error | Corrected | Reason |', '|---|---|---|---|---|---|');
	rejectedSample.forEach((item, i) => {
		const d = drill(item);
		lines.push(`| ${i + 1} | ${d.topic_code} | ${item.levelBand} | ${cell(d.sentence_with_error)} | ${cell(d.corrected)} | ${cell(notesReason(item.validationNotes))} |`);
	});
	return `${lines.join('\n')}\n`;
}

export function readingMarkdown(accepted: readonly CacheItem[], rejected: readonly CacheItem[], options: SheetOptions): string {
	const sample = seededShuffle(accepted, `eval|reading|${options.seed}`).slice(0, options.n);
	const lines = [
		'# Reading passage evaluation',
		'',
		`Generated ${options.generatedAt.toISOString()} (seed \`${options.seed}\`). Pool: ${accepted.length} accepted, ${rejected.length} rejected.`,
		'',
		'For each passage check: level and length right for the band, natural English, both questions answerable from the text with exactly one correct option, glossary useful and correct.'
	];
	sample.forEach((item, i) => {
		const p = item.payloadJson as ReadingPayload;
		lines.push('', `## ${i + 1}. ${p.title_en}`, '', `Band ${item.levelBand} · topic ${p.topic} · ${p.word_count} words · coverage ${(p.coverage * 100).toFixed(1)}%`, '', p.passage_en, '');
		p.questions.forEach((q, k) => {
			lines.push(`**Q${k + 1}. ${q.question_en}**`, '');
			q.options.forEach((o, j) => lines.push(`- ${'ABCD'[j]}. ${o}${j === q.answer_index ? ' ✅' : ''}`));
			lines.push('', `_${q.explanation_vi}_`, '');
		});
		lines.push(p.glossary.length === 0 ? 'Glossary: none' : `Glossary: ${p.glossary.map((g) => `**${g.word}**: ${g.vi}`).join('; ')}`);
	});
	if (rejected.length > 0) {
		lines.push('', `## Rejected passages (${Math.min(REJECTED_SAMPLE, rejected.length)} of ${rejected.length})`, '');
		for (const item of seededShuffle(rejected, `eval|reading-rejected|${options.seed}`).slice(0, REJECTED_SAMPLE)) {
			const p = item.payloadJson as ReadingPayload;
			lines.push(`- band ${item.levelBand}, ${p.topic}, "${p.title_en}": ${notesReason(item.validationNotes)}`);
		}
	}
	return `${lines.join('\n')}\n`;
}
