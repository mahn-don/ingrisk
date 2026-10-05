// The blind reading critic's acceptance logic.
import { LABELS, type Label } from '../../llm/prompts/reading-critic.ts';

export interface ReadingJudgement {
	ok: boolean;
	reason: string | null;
	notes: string;
}

/**
 * Accept only if, for every question, the critic chose the intended option and reports exactly one
 * defensible option (that same one). `answers` are indexes 0-3 per question.
 */
export function judgeReading(answers: readonly number[], critic: readonly { q: number; chosen: Label; defensible: Label[] }[]): ReadingJudgement {
	let reason: string | null = null;
	for (const [i, answer] of answers.entries()) {
		const expected = LABELS[answer];
		const verdict = critic.find((c) => c.q === i + 1);
		const defensible = [...new Set(verdict?.defensible ?? [])];
		if (verdict === undefined) reason = `critic:missing_answer (q${i + 1})`;
		else if (verdict.chosen !== expected) reason = `critic:wrong_answer (q${i + 1}: ${verdict.chosen}, intended ${expected})`;
		else if (defensible.length !== 1 || defensible[0] !== expected) {
			reason = `critic:ambiguous (q${i + 1}: ${defensible.join(', ') || 'none'} defensible)`;
		}
		if (reason !== null) break;
	}
	return { ok: reason === null, reason, notes: JSON.stringify({ reason, critic }) };
}
