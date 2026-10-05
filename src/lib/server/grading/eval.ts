// The grading evaluation (`npm run eval:grading`): each fixture graded twice.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TOPIC_CODES } from '../db/schema.ts';
import type { LlmDeps } from '../llm/client.ts';
import { LlmError } from '../llm/errors.ts';
import type { WritingFeedback } from '../llm/prompts/feedback.ts';
import { gradeTranslation, gradeWriting } from './grading.ts';

export const GRADING_FIXTURES_PATH = 'test/eval/grading-fixtures.json';

const Base = { id: z.string(), level_band: z.number().int().min(1).max(8), expected_codes: z.array(z.enum(TOPIC_CODES)), note: z.string() };
export const GradingFixture = z.discriminatedUnion('type', [
	z.object({ ...Base, type: z.literal('translation'), vi: z.string(), reference_en: z.string(), user_en: z.string() }),
	z.object({ ...Base, type: z.literal('writing'), prompt_vi: z.string(), user_text: z.string() })
]);
export type GradingFixture = z.infer<typeof GradingFixture>;

export function readGradingFixtures(path = GRADING_FIXTURES_PATH): GradingFixture[] {
	return z.object({ description: z.string(), items: z.array(GradingFixture) }).parse(JSON.parse(readFileSync(path, 'utf8'))).items;
}

export interface GradingRun {
	codes: string[];
	errors: WritingFeedback['errors'];
	cefr: string;
	meaningOk: boolean | null;
	/** Errors the guard dropped (quoted text not in the answer): invented by definition. */
	dropped: number;
	model: string;
}

export interface FixtureResult {
	fixture: GradingFixture;
	runs: (GradingRun | { failed: string })[];
	/** Per run: every expected code was reported. */
	expectedFound: boolean[];
	/** Per run: invented errors (any error on a correct answer, plus errors the guard dropped). */
	invented: number[];
	/** Per run: reported codes that were not expected. */
	extraCodes: string[][];
	cefrAgree: boolean | null;
}

const isRun = (r: GradingRun | { failed: string }): r is GradingRun => !('failed' in r);

export async function gradeFixture(fixture: GradingFixture, runs: number, llm: LlmDeps): Promise<FixtureResult> {
	const results: (GradingRun | { failed: string })[] = [];
	for (let k = 0; k < runs; k++) {
		try {
			const graded =
				fixture.type === 'translation'
					? await gradeTranslation(fixture, llm)
					: await gradeWriting({ prompt_vi: fixture.prompt_vi, user_text: fixture.user_text, level_band: fixture.level_band, feedback_mode: 'direct' }, llm);
			const feedback = graded.feedback;
			results.push({
				codes: feedback.errors.map((e) => e.topic_code),
				errors: feedback.errors,
				cefr: feedback.cefr_estimate,
				meaningOk: 'meaning_ok' in feedback ? (feedback.meaning_ok as boolean) : null,
				dropped: graded.dropped,
				model: graded.model
			});
		} catch (error) {
			results.push({ failed: error instanceof LlmError ? `${error.code}: ${error.message}` : String(error) });
		}
	}
	const ok = results.filter(isRun);
	const correctAnswer = fixture.expected_codes.length === 0 && fixture.type === 'translation';
	return {
		fixture,
		runs: results,
		expectedFound: results.map((r) => isRun(r) && fixture.expected_codes.every((c) => r.codes.includes(c))),
		invented: results.map((r) => (isRun(r) ? (correctAnswer ? r.codes.length : 0) + r.dropped : 0)),
		extraCodes: results.map((r) => (isRun(r) ? r.codes.filter((c) => !fixture.expected_codes.includes(c as never)) : [])),
		cefrAgree: ok.length < 2 ? null : ok.every((r) => r.cefr === ok[0].cefr)
	};
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function gradingSummary(results: readonly FixtureResult[]): string[] {
	const withErrors = results.filter((r) => r.fixture.expected_codes.length > 0);
	const correct = results.filter((r) => r.fixture.expected_codes.length === 0 && r.fixture.type === 'translation');
	const failedRuns = results.reduce((n, r) => n + r.runs.filter((x) => !isRun(x)).length, 0);
	return [
		`expected codes found in every run: ${withErrors.filter((r) => r.expectedFound.every(Boolean)).length}/${withErrors.length} fixtures`,
		`invented errors: ${results.reduce((n, r) => n + r.invented.reduce((a, b) => a + b, 0), 0)} (on correct answers and guard-dropped)`,
		`correct translations with zero errors and meaning_ok in every run: ${
			correct.filter((r) => r.runs.every((x) => isRun(x) && x.codes.length === 0 && x.meaningOk === true)).length
		}/${correct.length}`,
		`cefr_estimate agrees across runs: ${results.filter((r) => r.cefrAgree === true).length}/${results.length}`,
		`failed runs: ${failedRuns}`
	];
}

export function gradingMarkdown(results: readonly FixtureResult[], generatedAt: Date): string {
	const lines = ['# Grading evaluation', '', `Generated ${generatedAt.toISOString()}. Each fixture graded ${results[0]?.runs.length ?? 0} times.`, ''];
	for (const line of gradingSummary(results)) lines.push(`- ${line}`);
	lines.push('', '| Fixture | Expected | Run codes | Expected found | Invented | Extra codes | CEFR | meaning_ok |', '|---|---|---|---|---|---|---|---|');
	for (const r of results) {
		const runs = r.runs.map((x) => (isRun(x) ? x.codes.join(' ') || '—' : 'failed')).join(' / ');
		const cefr = r.runs.map((x) => (isRun(x) ? x.cefr : '?')).join(' / ') + (r.cefrAgree === false ? ' ⚠' : '');
		const meaning = r.runs.map((x) => (isRun(x) && x.meaningOk !== null ? String(x.meaningOk) : '—')).join(' / ');
		lines.push(
			`| ${r.fixture.id} | ${r.fixture.expected_codes.join(' ') || '—'} | ${runs} | ${r.expectedFound.map((b) => (b ? '✓' : '✗')).join(' / ')} | ${r.invented.join(' / ')} | ${r.extraCodes.map((c) => c.join(' ') || '—').join(' / ')} | ${cefr} | ${meaning} |`
		);
	}
	lines.push('', '## Details', '');
	for (const r of results) {
		const answer = r.fixture.type === 'translation' ? r.fixture.user_en : r.fixture.user_text;
		lines.push(`### ${r.fixture.id}`, '', `> ${cell(answer)}`, '', `_${r.fixture.note}_`, '');
		r.runs.forEach((x, k) => {
			if (!isRun(x)) return lines.push(`- run ${k + 1}: failed (${cell(x.failed)})`);
			if (x.errors.length === 0) return lines.push(`- run ${k + 1}: no errors`);
			for (const e of x.errors) lines.push(`- run ${k + 1}: **${e.topic_code}** "${cell(e.original)}" → "${cell(e.correction)}": ${cell(e.explanation_vi)}`);
		});
		lines.push('');
	}
	return `${lines.join('\n')}\n`;
}
