// Everything the generators need besides the LLM: the form map, blocklist, word classes and the
// real-word test. Built from the database (and the content files) once per run.
// The --dry-run world is in dry-run.ts, kept out of the server bundle.
import { readFileSync } from 'node:fs';
import wordListPath from 'word-list';
import type { DbOrTx } from '../db/client.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import type { BlocklistMatcher } from './blocklist.ts';
import { loadLexicon } from './content-files.ts';
import { type WordClasses, buildWordClasses } from './drills/word-classes.ts';
import type { FormIndex } from './forms.ts';

export interface GenerationContext {
	forms: FormIndex;
	blocklist: BlocklistMatcher;
	classes: WordClasses;
	/** The word-list package or an NGSL headword (NGSL form lists include nonstandard forms). */
	isWord: (word: string) => boolean;
	/** Every English sentence in the database. */
	corpus: string[];
}

let wordList: Set<string> | undefined;
export function loadWordList(): Set<string> {
	wordList ??= new Set(readFileSync(wordListPath, 'utf8').split('\n'));
	return wordList;
}

export function loadGenerationContext(db: DbOrTx, words: ReadonlySet<string> = loadWordList()): GenerationContext {
	const { forms, blocklist } = loadLexicon(db);
	const corpus = sentencesRepo(db)
		.all()
		.map((s) => s.enText);
	return {
		forms,
		blocklist,
		classes: buildWordClasses(forms, corpus),
		isWord: (word) => words.has(word) || forms.formsOf.has(word),
		corpus
	};
}
