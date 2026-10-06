// Answer checking for session items, shared by the session page and the server (no server imports).

/** Trim, lower-case, straight quotes, single spaces. */
export function normalizeAnswer(text: string): string {
	return text
		.replace(/[‘’‚‛′`]/g, "'")
		.replace(/[“”„‟″]/g, '"')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Levenshtein edit distance (insertions, deletions, substitutions). */
export function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		previous = row;
	}
	return previous[b.length];
}

/** Answers with at least this many letters forgive one typo. */
export const TYPO_MIN_LETTERS = 5;

export interface CheckResult {
	correct: boolean;
	/** Accepted with one wrong character: counts as correct, but as if a hint was used (Hard). */
	typo: boolean;
}

/** Choice mode: the chosen option must be the answer, exactly. */
export const checkChoice = (chosen: string, answer: string): CheckResult => ({ correct: chosen === answer, typo: false });

/**
 * Typing mode: equal after normalization; or, for answers of 5+ letters, one edit away (a typo:
 * correct, but it forces hintUsed so the rating becomes Hard, and the feedback shows the spelling).
 */
export function checkTyped(typed: string, answer: string): CheckResult {
	const given = normalizeAnswer(typed);
	const expected = normalizeAnswer(answer);
	if (given === '') return { correct: false, typo: false };
	if (given === expected) return { correct: true, typo: false };
	const letters = expected.replace(/[^a-z]/g, '').length;
	if (letters >= TYPO_MIN_LETTERS && editDistance(given, expected) === 1) return { correct: true, typo: true };
	return { correct: false, typo: false };
}

/** The hint in typing mode: the answer's first letter. */
export const hintFor = (answer: string) => answer.trim().charAt(0);

/** hintUsed as recorded: the hint button, or a typo. */
export const effectiveHintUsed = (hintButton: boolean, result: CheckResult) => hintButton || result.typo;
