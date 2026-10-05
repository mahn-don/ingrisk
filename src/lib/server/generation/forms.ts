// The NGSL form map: every inflected form -> its lemma (lexeme), built from the lexemes table.
import type { LexemeRow } from '../db/repositories/lexemes.ts';

export interface LemmaInfo {
	lexemeId: number;
	headword: string;
	/** Frequency band 1..8 (supplementary words count as band 1). */
	band: number;
	rank: number | null;
}

export interface FormIndex {
	/** form -> the most frequent lemma that lists it. */
	lemmaOf: Map<string, LemmaInfo>;
	/** headword -> all its forms (headword included). */
	formsOf: Map<string, string[]>;
}

export function buildFormIndex(lexemes: readonly Pick<LexemeRow, 'id' | 'headword' | 'forms' | 'freqBand' | 'ngslRank'>[]): FormIndex {
	const lemmaOf = new Map<string, LemmaInfo>();
	const formsOf = new Map<string, string[]>();
	for (const lexeme of lexemes) {
		const info: LemmaInfo = {
			lexemeId: lexeme.id,
			headword: lexeme.headword,
			band: lexeme.freqBand ?? 1,
			rank: lexeme.ngslRank
		};
		formsOf.set(lexeme.headword, lexeme.forms);
		for (const form of lexeme.forms) {
			const current = lemmaOf.get(form);
			const better =
				current === undefined ||
				info.band < current.band ||
				(info.band === current.band && (info.rank ?? Infinity) < (current.rank ?? Infinity));
			if (better) lemmaOf.set(form, info);
		}
	}
	return { lemmaOf, formsOf };
}
