// A canned OpenAI-compatible endpoint for --dry-run and the tests: a fake fetch that answers every
// generation and grading prompt deterministically and never touches the network. It dispatches on
// the structured-output schema name (the call's purpose).
import type { BlocklistMatcher } from './blocklist.ts';
import { FUNCTION_WORDS } from './cloze/stoplist.ts';
import { drillDiff } from './drills/diff.ts';
import type { FormIndex } from './forms.ts';
import { seededShuffle } from './random.ts';
import { coverage, wordCount } from './reading/coverage.ts';
import { tokenize } from './tokens.ts';

export const CANNED_MODEL = 'canned-dry-run';

/** A writing containing this is graded off topic by the canned grader (tests only). */
export const OFF_TOPIC_MARKER = 'OFFTOPIC';
/**
 * The first grading of a text containing this fails (both the reply and its repair round are
 * invalid), so the writing is queued; later gradings succeed (tests of "graded later").
 */
export const GRADE_LATER_MARKER = 'GRADELATER';
const GRADE_LATER_FAILURES = 2;

/** Learner errors the canned grader reports: [wrong, correction, topic code]. */
export const CANNED_ERRORS: readonly (readonly [string, string, string])[] = [
	['buyed', 'bought', 'TNS'],
	['goed', 'went', 'TNS'],
	['childs', 'children', 'PLU'],
	['depend of', 'depend on', 'PRE'],
	['she go', 'she goes', 'SVA']
];

export interface CannedOptions {
	forms: FormIndex;
	blocklist: Pick<BlocklistMatcher, 'isBlocked'>;
	isWord: (word: string) => boolean;
	/** English corpus sentences: the critics' notion of "correct", and reading passage material. */
	corpus: readonly string[];
	/** The cloze critic accepts a filled sentence only if it is one of these (default: the corpus). */
	knownSentences?: { has(text: string): boolean };
	/** Called with the payload of every request, repair rounds included (tests use it to fail calls). */
	onRequest?: (payload: { items: unknown[] } & Record<string, unknown>, purpose: string) => 'ok' | 'invalid';
}

type Item = Record<string, unknown>;

const suffix = (word: string) => /ing$|ed$|s$/.exec(word)?.[0] ?? '';

/** Canned COL / WFM / WOR drills: [with error, corrected, wrong, right]. */
const LLM_DRILLS: Record<string, [string, string, string, string][]> = {
	COL: [
		['I did a mistake in my homework.', 'I made a mistake in my homework.', 'did', 'made'],
		['There was strong rain last night.', 'There was heavy rain last night.', 'strong', 'heavy'],
		['Please open the light in the kitchen.', 'Please turn on the light in the kitchen.', 'open', 'turn on'],
		['She makes her homework after dinner.', 'She does her homework after dinner.', 'makes', 'does'],
		['We took a lot of fun at the party.', 'We had a lot of fun at the party.', 'took', 'had'],
		['He said a lie to his boss.', 'He told a lie to his boss.', 'said', 'told']
	],
	WFM: [
		['He is very success in his job.', 'He is very successful in his job.', 'success', 'successful'],
		['I am very interesting in music.', 'I am very interested in music.', 'interesting', 'interested'],
		['She speaks English very good.', 'She speaks English very well.', 'good', 'well'],
		['The film was very bored.', 'The film was very boring.', 'bored', 'boring'],
		['My brother is a very care driver.', 'My brother is a very careful driver.', 'care', 'careful'],
		['It is important to have a healthy life.', 'It is important to live a healthy life.', 'have', 'live']
	],
	WOR: [
		['I bought a bag red at the market.', 'I bought a red bag at the market.', 'bag red', 'red bag'],
		['I like very much football.', 'I like football very much.', 'like very much football', 'like football very much'],
		['She always is late for work.', 'She is always late for work.', 'always is', 'is always'],
		['We go often to the beach.', 'We often go to the beach.', 'go often', 'often go'],
		['He has a house big near the river.', 'He has a big house near the river.', 'house big', 'big house'],
		['Where you are going now?', 'Where are you going now?', 'you are', 'are you']
	]
};
const CANNED_CORRECTIONS = new Map(Object.values(LLM_DRILLS).flatMap((list) => list.map(([e, c]) => [e, c] as const)));

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = row;
	}
	return prev[b.length];
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
	const known = opts.knownSentences ?? new Set(opts.corpus);
	// Band 1-2 content words as the distractor pool: real, common and not function words.
	const pool = [...opts.forms.lemmaOf.entries()]
		.filter(([form, info]) => info.band <= 2 && /^[a-z]+$/.test(form) && opts.isWord(form) && !FUNCTION_WORDS.has(info.headword) && !opts.blocklist.isBlocked(form))
		.map(([form]) => form)
		.sort();
	const byLength = new Map<number, string[]>();
	for (const s of opts.corpus) {
		const n = tokenize(s).length;
		byLength.set(n, [...(byLength.get(n) ?? []), s]);
	}
	const generated = new Map<string, number>();

	const distractors = (answer: string) => {
		const lower = answer.toLowerCase();
		const lemma = opts.forms.lemmaOf.get(lower)?.headword ?? lower;
		const own = new Set(opts.forms.formsOf.get(lemma) ?? [lemma]);
		const same = pool.filter((w) => suffix(w) === suffix(lower) && !own.has(w));
		return seededShuffle(same.length >= 3 ? same : pool.filter((w) => !own.has(w)), `canned|${lower}`).slice(0, 3);
	};

	/** The canned editor: a correct sentence is one from the corpus; fix toward the nearest one. */
	const edit = (sentence: string) => {
		if (known.has(sentence)) return { fixes: [], corrected_sentence: sentence };
		const canned = CANNED_CORRECTIONS.get(sentence);
		const n = tokenize(sentence).length;
		// The nearest corpus sentence (by edit distance) that differs in one small region.
		const target =
			canned ??
			[n - 1, n, n + 1]
				.flatMap((k) => byLength.get(k) ?? [])
				.filter((c) => (drillDiff(sentence, c)?.size ?? Infinity) <= 3)
				.sort((x, y) => editDistance(sentence, x) - editDistance(sentence, y))[0];
		if (target === undefined) return { fixes: [], corrected_sentence: sentence };
		const diff = drillDiff(sentence, target)!;
		return { fixes: [{ wrong: diff.originalSpan, right: diff.correctedSpan }], corrected_sentence: target };
	};

	const passage = (brief: Item) => {
		const band = Number(brief.level_band);
		const [min, max] = brief.word_range as [number, number];
		const usable = seededShuffle(
			opts.corpus.filter((s) => !s.includes('"') && !tokenize(s).some((t) => t.kind === 'word' && opts.blocklist.isBlocked(t.text.toLowerCase())) && coverage(s, band, opts.forms).ratio === 1),
			`passage|${band}|${String(brief.topic)}|${generated.get('reading') ?? 0}`
		);
		generated.set('reading', (generated.get('reading') ?? 0) + 1);
		const chosen: string[] = [];
		// Cycle through the usable sentences (a small test corpus may need repeats) until in range.
		for (let i = 0; usable.length > 0 && i < usable.length * 10 && wordCount(chosen.join(' ')) < min; i++) {
			const s = usable[i % usable.length];
			if (wordCount([...chosen, s].join(' ')) <= max) chosen.push(s);
		}
		const text = chosen.join(' ');
		const others = [
			...usable.filter((s) => !text.includes(s)),
			...Array.from({ length: 6 }, (_, k) => `This sentence is not in the text (${k + 1}).`)
		].slice(0, 6);
		const question = (k: number) => ({
			question_en: 'Which sentence is in the text?',
			options: [chosen[k] ?? chosen[0], others[k * 3], others[k * 3 + 1], others[k * 3 + 2]],
			answer_index: 0,
			explanation_vi: 'Câu này có trong bài đọc.'
		});
		// Two longer words of the passage, glossed (glossary words must appear in the passage).
		const glossary = [...new Set(chosen.join(' ').match(/\b[a-z]{6,}\b/g) ?? [])].slice(0, 2).map((word) => ({ word, vi: `(nghĩa của ${word})` }));
		return { title_en: `About ${String(brief.topic)}`, passage_en: chosen.join(' '), questions: [question(0), question(1)], glossary };
	};

	// Known learner errors the canned grader "finds" (tests mine them into cards).
	const feedback = (learner: string, band: number) => {
		let corrected = learner;
		const errors: Item[] = [];
		for (const [wrong, right, code] of CANNED_ERRORS) {
			const pattern = new RegExp(`\\b${wrong}\\b`, 'i');
			const match = pattern.exec(corrected);
			if (match === null || errors.length >= 3) continue;
			errors.push({ original: match[0], correction: right, topic_code: code, explanation_vi: `Dùng "${right}", không dùng "${match[0]}".` });
			corrected = corrected.replace(pattern, right);
		}
		return {
			corrected_text: corrected,
			errors,
			cefr_estimate: ['A1', 'A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'B2'][Math.min(Math.max(band, 1), 8) - 1],
			scores: { range: 3, accuracy: 3, coherence: 3 }
		};
	};

	const gradeLaterSeen = new Map<string, number>();

	return (async (_input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as {
			messages: { role: string; content: string }[];
			response_format?: { json_schema?: { name?: string } };
		};
		const purpose = body.response_format?.json_schema?.name ?? '';
		// The first user message holds the payload (a repair round appends more messages after it).
		const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
		// The payload JSON follows the instruction line; a reading rewrite adds text after it.
		const json = user.slice(user.indexOf('{'));
		const payload = JSON.parse(json.split('\n\n')[0]) as { items: Item[] } & Item;
		if (opts.onRequest?.(payload, purpose) === 'invalid') return reply({ items: 'not an array' });
		const learnerText = String(payload.learner_text ?? payload.learner_translation ?? '');
		if (learnerText.includes(GRADE_LATER_MARKER)) {
			const seen = gradeLaterSeen.get(learnerText) ?? 0;
			gradeLaterSeen.set(learnerText, seen + 1);
			if (seen < GRADE_LATER_FAILURES) return reply({ items: 'not an array' });
		}
		switch (purpose) {
			case 'cloze_distractors':
				return reply({
					items: payload.items.map((item) => ({
						n: item.n,
						distractors: distractors(String(item.answer)).map((word) => ({ word, why_wrong: 'canned distractor' })),
						answer_vi: `(${String(item.answer)})`
					}))
				});
			case 'cloze_critic':
				return reply({
					items: payload.items.map((item) => {
						const sentences = (item.sentences as { label: string; text: string }[]).map((s) => {
							const ok = known.has(s.text);
							return { label: s.label, grammatical: ok, natural: ok, meaning_ok: ok, note: ok ? 'original sentence' : 'not the original' };
						});
						return { n: item.n, sentences, another_could_be_correct: sentences.filter((s) => s.grammatical).length > 1 };
					})
				});
			case 'drill_explain':
				return reply({
					items: payload.items.map((item) => ({
						n: item.n,
						explanation_vi: `Lỗi ${String(item.topic_code)}: viết "${String(item.corrected_span)}", không viết "${String(item.original_span)}".`
					}))
				});
			case 'drill_generate': {
				const code = /^([A-Z]{3})/.exec(String(payload.error_type))?.[1] ?? 'COL';
				const list = LLM_DRILLS[code] ?? [];
				const start = generated.get(code) ?? 0;
				generated.set(code, start + Number(payload.count));
				const items = Array.from({ length: Math.min(Number(payload.count), list.length) }, (_, k) => list[(start + k) % list.length]).map(
					([sentence_with_error, corrected, original_span, corrected_span]) => ({
						sentence_with_error,
						corrected,
						original_span,
						corrected_span,
						explanation_vi: `Viết "${corrected_span}", không viết "${original_span}".`
					})
				);
				return reply({ items });
			}
			case 'drill_critic':
				return reply({ items: payload.items.map((item) => ({ n: item.n, ...edit(String(item.sentence)) })) });
			case 'reading_passage':
				return reply(passage(payload));
			case 'reading_critic':
				return reply({
					items: payload.items.map((item) => ({
						n: item.n,
						answers: (item.questions as { q: number; options: Record<string, string> }[]).map((q) => {
							const defensible = Object.entries(q.options)
								.filter(([, text]) => String(item.passage).includes(text))
								.map(([label]) => label);
							return { q: q.q, chosen: defensible[0] ?? 'A', defensible };
						})
					}))
				});
			case 'grade_writing': {
				const text = String(payload.learner_text);
				const onTopic = !text.includes(OFF_TOPIC_MARKER);
				return reply({
					...feedback(text, Number(/band (\d)/.exec(String(payload.learner_level))?.[1] ?? 1)),
					on_topic: onTopic,
					task_note_vi: onTopic ? '' : 'Đề bài hỏi về một chủ đề khác; hãy viết đúng chủ đề nhé.'
				});
			}
			case 'grade_translation':
				return reply({
					...feedback(String(payload.learner_translation), Number(/band (\d)/.exec(String(payload.learner_level))?.[1] ?? 1)),
					meaning_ok: true
				});
			case 'smoke':
				return reply({ word: String(payload.word ?? 'borrow'), cefr: 'B1', vi_gloss: 'mượn' });
			default:
				return new Response(JSON.stringify({ error: { message: `canned LLM: unknown purpose ${purpose}` } }), { status: 400 });
		}
	}) as typeof globalThis.fetch;
}
