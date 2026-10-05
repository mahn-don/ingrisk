// Reading the Phase 1 content files from disk (tools only; app code never bundles them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbOrTx } from '../db/client.ts';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import { type BlocklistMatcher, blocklistMatcher, parseBlocklist } from './blocklist.ts';
import { type FormIndex, buildFormIndex } from './forms.ts';
import { NgslFile, TatoebaFile, importLexemes, importSentences } from './import.ts';

export const CONTENT_DIR = 'src/lib/server/content';

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

export const readNgsl = (dir = CONTENT_DIR) => NgslFile.parse(readJson(dir, 'ngsl.json'));
export const readTatoeba = (dir = CONTENT_DIR) => TatoebaFile.parse(readJson(dir, 'tatoeba-en-vi.json'));
export const readBlocklist = (dir = CONTENT_DIR) => parseBlocklist(readFileSync(join(dir, 'blocklist.txt'), 'utf8'));

/** The NGSL form index and the blocklist matcher built on it, from the lexemes in `db`. */
export function loadLexicon(db: DbOrTx, dir = CONTENT_DIR): { forms: FormIndex; blocklist: BlocklistMatcher } {
	const forms = buildFormIndex(lexemesRepo(db).all());
	return { forms, blocklist: blocklistMatcher(readBlocklist(dir), forms) };
}

/** Import lexemes, then sentences (the blocklist needs the lexemes' form map). */
export function importContent(db: DbOrTx, options: { reblock?: boolean; dir?: string } = {}) {
	const dir = options.dir ?? CONTENT_DIR;
	const lexemes = importLexemes(db, readNgsl(dir));
	const { blocklist } = loadLexicon(db, dir);
	const sentences = importSentences(db, readTatoeba(dir), blocklist, { reblock: options.reblock });
	return { lexemes, sentences };
}
