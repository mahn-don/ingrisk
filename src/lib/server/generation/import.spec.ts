import { describe, expect, it } from 'vitest';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { createTestDb } from '../db/test-db.ts';
import { blocklistMatcher, parseBlocklist } from './blocklist.ts';
import { buildFormIndex } from './forms.ts';
import { importLexemes, importSentences } from './import.ts';
import { BLOCKLIST, NGSL, TATOEBA } from './test-fixtures.ts';

function setup(blocklist = BLOCKLIST) {
	const db = createTestDb();
	const lexemes = importLexemes(db, NGSL);
	const matcher = blocklistMatcher(parseBlocklist(blocklist), buildFormIndex(lexemesRepo(db).all()));
	const sentences = importSentences(db, TATOEBA, matcher);
	return { db, lexemes, sentences };
}

const matcherFor = (db: ReturnType<typeof createTestDb>, list: string) =>
	blocklistMatcher(parseBlocklist(list), buildFormIndex(lexemesRepo(db).all()));

const byEn = (db: ReturnType<typeof createTestDb>, en: string) => sentencesRepo(db).all().find((s) => s.enText === en)!;

describe('importLexemes', () => {
	it('upserts by headword and skips supplementary words that are already ranked', () => {
		const { db, lexemes } = setup();
		expect(lexemes.skippedSupplementary).toEqual(['may']);
		const rows = lexemesRepo(db).all();
		expect(rows).toHaveLength(NGSL.items.length + 1);
		expect(rows.filter((r) => r.headword === 'may')).toHaveLength(1);
		const okay = rows.find((r) => r.headword === 'okay')!;
		expect(okay).toMatchObject({ supplementary: true, freqBand: 1, ngslRank: null, source: 'ngsl-supplementary' });
	});

	it('is idempotent and never overwrites glosses added later', () => {
		const { db } = setup();
		const dog = lexemesRepo(db).all().find((r) => r.headword === 'dog')!;
		lexemesRepo(db).update(dog.id, { viGloss: 'con chó' });
		const again = importLexemes(db, NGSL);
		expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: NGSL.items.length + 1 });
		expect(lexemesRepo(db).all().find((r) => r.headword === 'dog')!.viGloss).toBe('con chó');
	});
});

describe('importSentences', () => {
	it('derives level_band, stock names and licensing', () => {
		const { db } = setup();
		expect(byEn(db, 'Mary is happy.')).toMatchObject({ levelBand: 1, ngslBandMax: null, hasStockNames: true });
		expect(byEn(db, 'The garden is very big.')).toMatchObject({ hasStockNames: false, source: 'tatoeba', licenseTag: 'CC-BY-2.0-FR' });
	});

	it('is idempotent: a second run changes nothing', () => {
		const { db, sentences } = setup();
		expect(sentences.inserted).toBe(TATOEBA.items.length);
		const before = sentencesRepo(db).all();
		const again = importSentences(db, TATOEBA, matcherFor(db, BLOCKLIST));
		expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: TATOEBA.items.length, newlyBlocked: 0 });
		expect(sentencesRepo(db).all()).toEqual(before);
	});

	it('marks blocklisted sentences (by lemma) as blocked without deleting them', () => {
		const { db, sentences } = setup();
		expect(sentencesRepo(db).all()).toHaveLength(TATOEBA.items.length);
		expect(byEn(db, 'Tom wants to kill time.')).toMatchObject({ blocked: true, blockedReason: 'blocklist: kill' });
		expect(byEn(db, 'They killed the story.')).toMatchObject({ blocked: true, blockedReason: 'blocklist: kill' });
		expect(byEn(db, 'Mary is happy.')).toMatchObject({ blocked: false, blockedReason: null });
		expect(sentences.blockedTotal).toBe(2);
		expect(sentences.topMatches).toEqual([['kill', 2]]);
		expect(sentencesRepo(db).forCloze(2).some((s) => s.blocked)).toBe(false);
	});

	it('keeps existing flags when the list changes, until --reblock re-applies it', () => {
		const { db } = setup();
		const changedList = 'happ*\n';
		const plain = importSentences(db, TATOEBA, matcherFor(db, changedList));
		expect(plain).toMatchObject({ updated: 0, newlyBlocked: 0, unblocked: 0, blockedTotal: 2 });

		const reblock = importSentences(db, TATOEBA, matcherFor(db, changedList), { reblock: true });
		expect(reblock).toMatchObject({ newlyBlocked: 1, unblocked: 2, blockedTotal: 1, updated: 3 });
		expect(byEn(db, 'Mary is happy.')).toMatchObject({ blocked: true, blockedReason: 'blocklist: happ*' });
		expect(byEn(db, 'Tom wants to kill time.')).toMatchObject({ blocked: false, blockedReason: null });
		expect(sentencesRepo(db).all()).toHaveLength(TATOEBA.items.length);
	});
});

describe('blocklist', () => {
	it('parses words, prefixes and comments', () => {
		const list = parseBlocklist('# comment\nKill\nmurder*  # violent\n\n');
		expect([...list.words]).toEqual(['kill']);
		expect(list.prefixes).toEqual(['murder']);
	});
});
