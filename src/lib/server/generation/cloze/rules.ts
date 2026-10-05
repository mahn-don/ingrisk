// Deterministic checks every cloze item must pass before the critic sees it.
import type { BlocklistMatcher } from '../blocklist.ts';
import type { FormIndex } from '../forms.ts';
import { NO_WORD, capitalize, tokenize } from '../tokens.ts';
import type { GapType } from './candidates.ts';

export interface RuleInput {
	enText: string;
	gapType: GapType;
	tokenIndex: number;
	answer: string;
	options: readonly string[];
	/** The gap is the sentence's first word. */
	initial: boolean;
}

export interface RuleDeps {
	forms: FormIndex;
	/**
	 * Is this a real English word? (The word list, or an NGSL headword. NGSL form lists also hold
	 * nonstandard forms such as "makeing" or "knowed", so a form alone does not count.)
	 */
	isWord: (word: string) => boolean;
	blocklist: Pick<BlocklistMatcher, 'isBlocked'>;
}

export type RuleCode =
	| 'option_count'
	| 'duplicate_options'
	| 'answer_count'
	| 'multi_token'
	| 'casing'
	| 'answer_position'
	| 'same_lemma'
	| 'not_a_word'
	| 'blocklisted';

export type RuleResult = { ok: true } | { ok: false; code: RuleCode; detail: string };

const fail = (code: RuleCode, detail: string): RuleResult => ({ ok: false, code, detail });

/** `rule:<code> (<detail>)`, the stored rejection reason. */
export const ruleReason = (result: Extract<RuleResult, { ok: false }>) => `rule:${result.code} (${result.detail})`;

function isSingleToken(option: string): boolean {
	if (option === NO_WORD) return true;
	const tokens = tokenize(option);
	return tokens.length === 1 && tokens[0].kind === 'word' && tokens[0].text === option;
}

function hasExpectedCase(option: string, initial: boolean): boolean {
	if (option === NO_WORD) return true;
	return initial ? option === capitalize(option.toLowerCase()) : option === option.toLowerCase();
}

/** The first rule the item breaks, or ok. Checks run in a fixed order. */
export function checkRules(item: RuleInput, deps: RuleDeps): RuleResult {
	const { options, answer } = item;
	if (options.length !== 4) return fail('option_count', `${options.length} options`);
	const lowered = options.map((o) => o.toLowerCase());
	const duplicate = lowered.find((o, i) => lowered.indexOf(o) !== i);
	if (duplicate !== undefined) return fail('duplicate_options', duplicate);
	const answers = options.filter((o) => o === answer).length;
	if (answers !== 1) return fail('answer_count', `answer appears ${answers} times`);
	const multi = options.find((o) => !isSingleToken(o));
	if (multi !== undefined) return fail('multi_token', multi);
	const badCase = options.find((o) => !hasExpectedCase(o, item.initial));
	if (badCase !== undefined) return fail('casing', `${badCase}${item.initial ? ' (sentence-initial)' : ''}`);
	const token = tokenize(item.enText)[item.tokenIndex];
	if (token === undefined || token.text !== answer) {
		return fail('answer_position', `token ${item.tokenIndex} is ${JSON.stringify(token?.text ?? null)}`);
	}
	if (item.gapType === 'lexical') {
		const distractors = options.filter((o) => o !== answer).map((o) => o.toLowerCase());
		const answerLemma = deps.forms.lemmaOf.get(answer.toLowerCase())?.headword ?? answer.toLowerCase();
		const answerForms = new Set(deps.forms.formsOf.get(answerLemma) ?? [answerLemma]);
		const sameLemma = distractors.find(
			(d) => answerForms.has(d) || deps.forms.lemmaOf.get(d)?.headword === answerLemma
		);
		if (sameLemma !== undefined) return fail('same_lemma', `${sameLemma} is a form of ${answerLemma}`);
		const unknown = distractors.find((d) => !deps.isWord(d));
		if (unknown !== undefined) return fail('not_a_word', unknown);
		const blocked = distractors.find((d) => deps.blocklist.isBlocked(d));
		if (blocked !== undefined) return fail('blocklisted', blocked);
	}
	return { ok: true };
}
