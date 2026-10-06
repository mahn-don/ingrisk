// The weakness profile shown on the stats page: per grammar topic, the last 30 days of writing
// errors, drill results and grammar cloze reviews, weakest first.
import type { TopicWeakness } from '../../progress/types.ts';
import type { TopicCode } from '../../session/types.ts';

export interface TopicActivity {
	code: TopicCode;
	nameVi: string;
	writingErrors: number;
	drillsCorrect: number;
	drillsTotal: number;
	cloze: { gapType: string; correct: number; total: number }[];
	practicable: boolean;
}

const share = (correct: number, total: number) => (total === 0 ? 1 : correct / total);

/**
 * Topics with any activity, weakest first: the most errors (writing errors + missed drills + Again
 * on cloze), then the lowest accuracy over drills and cloze together, then the code.
 */
export function rankWeakness(topics: readonly TopicActivity[]): TopicWeakness[] {
	return topics
		.map((t) => {
			const clozeCorrect = t.cloze.reduce((n, c) => n + c.correct, 0);
			const clozeTotal = t.cloze.reduce((n, c) => n + c.total, 0);
			return {
				code: t.code,
				nameVi: t.nameVi,
				writingErrors: t.writingErrors,
				drillsCorrect: t.drillsCorrect,
				drillsTotal: t.drillsTotal,
				clozeCorrect,
				clozeTotal,
				byGapType: t.cloze.filter((c) => c.total > 0),
				score: t.writingErrors + (t.drillsTotal - t.drillsCorrect) + (clozeTotal - clozeCorrect),
				practicable: t.practicable
			};
		})
		.filter((t) => t.writingErrors + t.drillsTotal + t.clozeTotal > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				share(a.drillsCorrect + a.clozeCorrect, a.drillsTotal + a.clozeTotal) - share(b.drillsCorrect + b.clozeCorrect, b.drillsTotal + b.clozeTotal) ||
				a.code.localeCompare(b.code)
		);
}
