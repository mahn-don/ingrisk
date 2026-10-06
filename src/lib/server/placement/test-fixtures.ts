// Placement test fixtures: synthetic Part A words, writing prompts and a cloze pool.
import type { DbOrTx } from '../db/client.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import type { CLOZE_GAP_TYPES } from '../db/schema.ts';
import { createTestDb } from '../db/test-db.ts';
import type { WritingPrompt } from '../generation/writing-prompts.ts';
import type { EngineDeps, PlacementContent } from './engine.ts';

/** Real words are `r<band>w<i>`, pseudo-words `pseudo<i>`: tests answer by name. */
export const isPseudo = (word: string) => word.startsWith('pseudo');
export const bandOfWord = (word: string) => Number(/^r(\d)w/.exec(word)?.[1]);

const prompt = (id: string, band_min: number, band_max: number): WritingPrompt => ({
	id,
	band_min,
	band_max,
	prompt_vi: `Đề bài ${id}: hãy viết về cuối tuần của bạn.`,
	hint_en: 'Use: On Saturday I ...',
	min_words: 20 * band_min,
	max_words: 20 * band_min + 30
});

export const CONTENT: PlacementContent = {
	realWords: new Map(Array.from({ length: 8 }, (_, b) => [b + 1, Array.from({ length: 40 }, (_, i) => `r${b + 1}w${i}`)])),
	pseudoWords: Array.from({ length: 30 }, (_, i) => `pseudo${i}`),
	prompts: [prompt('daily-01', 1, 2), prompt('daily-02', 3, 4), prompt('daily-03', 5, 6), prompt('daily-04', 7, 8)]
};

type GapType = (typeof CLOZE_GAP_TYPES)[number];
const GAPS: Record<Exclude<GapType, 'user_error'>, { text: string; index: number; answer: string; options: string[] }> = {
	// tokens: I(0) like(1) the(2) cat(3) .(4)
	lexical: { text: 'I like the cat number', index: 1, answer: 'like', options: ['eat', 'like', 'sit', 'run'] },
	article: { text: 'I like the cat number', index: 2, answer: 'the', options: ['a', 'an', 'the', '—'] },
	preposition: { text: 'She sat on the chair number', index: 2, answer: 'on', options: ['on', 'at', 'of', 'to'] },
	verb_form: { text: 'He goes home number', index: 1, answer: 'goes', options: ['go', 'goes', 'going', 'gone'] }
};

let seeded = 0;

/** `perBand` validated items in each band of `bands`, the gap types in turn. Returns their ids. */
export function seedClozePool(db: DbOrTx, bands: readonly number[], perBand: number): number[] {
	const sentences = sentencesRepo(db);
	const items = clozeItemsRepo(db);
	const ids: number[] = [];
	const types = Object.keys(GAPS) as (keyof typeof GAPS)[];
	let n = 0;
	const base = (seeded += 10_000);
	for (const band of bands) {
		for (let i = 0; i < perBand; i++, n++) {
			const type = types[n % types.length];
			const gap = GAPS[type];
			const sentence = sentences.insert({ enText: `${gap.text} ${n}.`, viText: `(vi) ${n}`, source: 'llm', licenseTag: 'test', levelBand: band });
			const row = items.insert({
				sentenceId: sentence.id,
				gapType: type,
				tokenIndex: gap.index,
				answer: gap.answer,
				options: gap.options,
				levelBand: band,
				ruleOk: true,
				criticOk: true,
				validated: true,
				promptVersion: 'test',
				contentHash: `test-${base + n}`,
				createdAt: new Date(0)
			})!;
			ids.push(row.id);
		}
	}
	return ids;
}

/** The correct option index for a Part B view (fixture items only). */
export const correctIndex = (options: readonly string[]) => options.findIndex((o) => Object.values(GAPS).some((g) => g.answer === o));

export function engineDeps(overrides: Partial<EngineDeps> = {}): EngineDeps & { clock: { t: number } } {
	const clock = { t: 1_800_000_000_000 };
	return {
		db: createTestDb(),
		now: () => new Date((clock.t += 1000)),
		content: CONTENT,
		grade: null,
		gradeTimeoutMs: 50,
		clock,
		...overrides
	};
}
