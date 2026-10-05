// A canned OpenAI-compatible endpoint for `cloze:build --dry-run` and the tests: a fake fetch
// that answers the cloze prompts deterministically and never touches the network.
import type { BlocklistMatcher } from '../blocklist.ts';
import type { FormIndex } from '../forms.ts';
import { seededShuffle } from '../random.ts';
import { FUNCTION_WORDS } from './stoplist.ts';

export const CANNED_MODEL = 'canned-dry-run';

export interface CannedOptions {
	forms: FormIndex;
	blocklist: Pick<BlocklistMatcher, 'isBlocked'>;
	isWord: (word: string) => boolean;
	/** The critic accepts a filled sentence only if it is one of these (the original sentences). */
	knownSentences: { has(text: string): boolean };
	/** Called with the items of every request, repair rounds included (tests use it to fail batches). */
	onRequest?: (payload: { items: unknown[] }) => 'ok' | 'invalid';
}

const suffix = (word: string) => /ing$|ed$|s$/.exec(word)?.[0] ?? '';

function distractorsFor(answer: string, opts: CannedOptions, pool: string[]): string[] {
	const lower = answer.toLowerCase();
	const lemma = opts.forms.lemmaOf.get(lower)?.headword ?? lower;
	const ownForms = new Set(opts.forms.formsOf.get(lemma) ?? [lemma]);
	const sameShape = pool.filter((w) => suffix(w) === suffix(lower) && !ownForms.has(w));
	const candidates = sameShape.length >= 3 ? sameShape : pool.filter((w) => !ownForms.has(w));
	return seededShuffle(candidates, `canned|${lower}`).slice(0, 3);
}

function reply(content: unknown) {
	return new Response(
		JSON.stringify({
			id: 'canned',
			model: CANNED_MODEL,
			choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

export function cannedFetch(opts: CannedOptions): typeof globalThis.fetch {
	// Band 1-2 content words as the distractor pool: real, common and not function words.
	const pool = [...opts.forms.lemmaOf.entries()]
		.filter(([form, info]) => info.band <= 2 && /^[a-z]+$/.test(form) && opts.isWord(form) && !FUNCTION_WORDS.has(info.headword) && !opts.blocklist.isBlocked(form))
		.map(([form]) => form)
		.sort();
	return (async (_input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
		// The first user message holds the items (a repair round appends more messages after it).
		const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
		const payload = JSON.parse(user.slice(user.indexOf('{'))) as { items: Record<string, unknown>[] };
		if (opts.onRequest?.(payload) === 'invalid') return reply({ items: 'not an array' });
		const items = payload.items.map((item) => {
			if (Array.isArray(item.sentences)) {
				const sentences = item.sentences as { label: string; text: string }[];
				return {
					n: item.n,
					sentences: sentences.map((s) => {
						const known = opts.knownSentences.has(s.text);
						return { label: s.label, grammatical: known, natural: known, meaning_ok: known, note: known ? 'original sentence' : 'not the original' };
					})
				};
			}
			const answer = String(item.answer);
			return {
				n: item.n,
				distractors: distractorsFor(answer, opts, pool).map((word) => ({ word, why_wrong: 'canned distractor' })),
				answer_vi: `(${answer})`
			};
		});
		return reply({ items });
	}) as typeof globalThis.fetch;
}
