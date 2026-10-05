// What the placement test shows: Part A's real words and pseudo-words, and the writing prompts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import type { LexemeRow } from '../db/repositories/lexemes.ts';
import { FUNCTION_WORDS } from '../generation/cloze/stoplist.ts';
import { CONTENT_DIR, loadLexicon } from '../generation/content-files.ts';
import { readWritingPrompts } from '../generation/writing-prompts.ts';
import type { PlacementContent } from './engine.ts';

const PseudoWordFile = z.object({ items: z.array(z.object({ form: z.string().regex(/^[a-z]+$/) })) });

export const readPseudoWords = (dir = CONTENT_DIR) =>
	PseudoWordFile.parse(JSON.parse(readFileSync(join(dir, 'pseudowords.json'), 'utf8'))).items.map((i) => i.form);

/**
 * Part A real words: NGSL headwords of the band, without supplementary words, proper nouns and
 * abbreviations (only lowercase letters), words under 3 letters, function words (everyone
 * "knows" "the") and blocklisted words.
 */
export function realWordsByBand(lexemes: readonly LexemeRow[], isBlocked: (word: string) => boolean): Map<number, string[]> {
	const byBand = new Map<number, string[]>();
	for (const lexeme of lexemes) {
		const band = lexeme.freqBand;
		const word = lexeme.headword;
		if (band === null || lexeme.supplementary || lexeme.ngslRank === null) continue;
		if (!/^[a-z]{3,}$/.test(word) || FUNCTION_WORDS.has(word) || isBlocked(word)) continue;
		byBand.set(band, [...(byBand.get(band) ?? []), word]);
	}
	return byBand;
}

let cached: PlacementContent | undefined;

/** Built once per process from the lexemes and the content files. */
export function loadPlacementContent(db: DbOrTx, dir = CONTENT_DIR): PlacementContent {
	if (cached !== undefined) return cached;
	const { blocklist } = loadLexicon(db, dir);
	const realWords = realWordsByBand(lexemesRepo(db).all(), blocklist.isBlocked);
	// Without imported content there is nothing to test with; do not cache the empty lists.
	const content = { realWords, pseudoWords: readPseudoWords(dir), prompts: readWritingPrompts(dir) };
	if (realWords.size > 0) cached = content;
	return content;
}
