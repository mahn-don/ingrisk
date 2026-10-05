// Test fixtures for content import and the cloze pipeline: a tiny NGSL, a tiny Tatoeba file,
// and a database with both imported and a provider configured. No network, no real content.
import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { openaiProvider, setupProviders, testDeps } from '../llm/test-helpers.ts';
import { type CannedOptions, cannedFetch } from './canned-llm.ts';
import type { GenerationContext } from './context.ts';
import { buildWordClasses } from './drills/word-classes.ts';
import { type BlocklistMatcher, blocklistMatcher, parseBlocklist } from './blocklist.ts';
import { type FormIndex, buildFormIndex } from './forms.ts';
import { type NgslFile, type TatoebaFile, importLexemes, importSentences } from './import.ts';

type Ngsl = z.infer<typeof NgslFile>;
type Tatoeba = z.infer<typeof TatoebaFile>;

const lemma = (headword: string, rank: number, band: number, forms: string[] = [headword], pos = 'noun') => ({
	headword,
	pos,
	rank,
	band,
	forms: [headword, ...forms.filter((f) => f !== headword)]
});

export const NOUNS = ['dog', 'cat', 'book', 'garden', 'house', 'car', 'tree', 'bird', 'river', 'city', 'door', 'table'];

export const NGSL: Ngsl = {
	items: [
		lemma('be', 1, 1, ['is', 'are', 'am', 'was', 'were', 'been', 'being'], 'verb'),
		lemma('go', 2, 1, ['goes', 'went', 'gone', 'going', 'goings'], 'verb'),
		lemma('say', 3, 1, ['says', 'said', 'saying', 'sayed'], 'verb'),
		lemma('like', 4, 1, ['likes', 'liked', 'liking'], 'verb'),
		lemma('drink', 5, 1, ['drinks', 'drank', 'drunk', 'drinking'], 'verb'),
		lemma('kill', 6, 2, ['kills', 'killed', 'killing'], 'verb'),
		lemma('can', 7, 1, ['cans', 'canned', 'canning', 'could'], 'verb'),
		lemma('rule', 8, 2, ['rules', 'ruled', 'ruling'], 'noun'),
		lemma('school', 9, 1, ['schools']),
		lemma('water', 10, 1, ['waters']),
		lemma('big', 11, 1, ['bigger', 'biggest'], 'adj'),
		lemma('small', 12, 1, ['smaller', 'smallest'], 'adj'),
		lemma('happy', 13, 2, ['happier', 'happiest'], 'adj'),
		lemma('rose', 14, 3, ['roses']),
		lemma('sister', 15, 1, ['sisters']),
		lemma('law', 16, 2, ['laws']),
		lemma('table', 17, 1, ['tables']),
		...NOUNS.filter((n) => n !== 'table').map((n, i) => lemma(n, 20 + i, (i % 3) + 1, [`${n}s`])),
		lemma('may', 40, 1, ['might'], 'verb')
	],
	supplementary: [
		{ headword: 'may', forms: ['may'] },
		{ headword: 'okay', forms: ['okay', 'ok'] }
	]
};

const pair = (id: number, en: string, band: number | null = 1, offList = 0) => ({
	tatoeba_id_en: id,
	tatoeba_id_vi: id + 100000,
	en,
	vi: `(vi) ${en}`,
	word_count: en.split(/\s+/).length,
	ngsl_band_max: band,
	off_list_count: offList
});

/** Two template sentences per noun (24 sentences), plus a few special cases. */
export const TATOEBA: Tatoeba = {
	items: [
		...NOUNS.flatMap((noun, i) => [
			pair(1000 + i, `The ${noun} is very big.`, (i % 3) + 1),
			pair(2000 + i, `I saw a small ${noun} at school.`, (i % 3) + 1)
		]),
		pair(1, 'Tom wants to kill time.', 2),
		pair(2, 'They killed the story.', 2),
		pair(3, 'Mary is happy.', null),
		pair(4, 'Too short.', 1)
	]
};

export const BLOCKLIST = 'kill\nmurder*\n';

export const EXTRA_WORDS = new Set(['purple', 'quickly', 'green', 'loud', 'banana']);

/** The word list stand-in: fixture headwords and a few extra words (never "sayed"). */
export const fixtureIsWord = (forms: FormIndex) => (word: string) => forms.formsOf.has(word) || EXTRA_WORDS.has(word) || (forms.lemmaOf.has(word) && word !== 'sayed');

export interface Fixture {
	db: Db;
	providerId: number;
	forms: FormIndex;
	blocklist: BlocklistMatcher;
	isWord: (word: string) => boolean;
}

/** A migrated in-memory database with the fixture content imported and an OpenAI provider active. */
export function fixtureDb(): Fixture {
	const { db, primaryId } = setupProviders(openaiProvider);
	importLexemes(db, NGSL);
	const forms = buildFormIndex(lexemesRepo(db).all());
	const blocklist = blocklistMatcher(parseBlocklist(BLOCKLIST), forms);
	importSentences(db, TATOEBA, blocklist);
	return { db, providerId: primaryId, forms, blocklist, isWord: fixtureIsWord(forms) };
}

/** The fixture database plus the canned LLM and a full generation context (for builder tests). */
export function cannedWorld(overrides: Partial<CannedOptions> = {}) {
	const fx = fixtureDb();
	const corpus = sentencesRepo(fx.db)
		.all()
		.map((s) => s.enText);
	const requests: { purpose: string; payload: Record<string, unknown> }[] = [];
	const fetch = cannedFetch({
		forms: fx.forms,
		blocklist: fx.blocklist,
		isWord: fx.isWord,
		corpus,
		...overrides,
		onRequest: (payload, purpose) => {
			requests.push({ purpose, payload });
			return overrides.onRequest?.(payload, purpose) ?? 'ok';
		}
	});
	const { deps: llm } = testDeps(fx.db, fetch);
	const context: GenerationContext = { forms: fx.forms, blocklist: fx.blocklist, classes: buildWordClasses(fx.forms, corpus), isWord: fx.isWord, corpus };
	return { fx, llm, context, requests };
}
