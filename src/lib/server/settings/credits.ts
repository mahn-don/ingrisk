// "Nguồn dữ liệu & giấy phép": credits generated from the license tags present in the content
// tables and the word-list package's own metadata.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import wordListPath from 'word-list';
import type { DbOrTx } from '../db/client.ts';
import { lexemes, sentences } from '../db/schema.ts';
import { NGSL_LICENSE, TATOEBA_LICENSE } from '../generation/import.ts';

export interface SourceCredit {
	id: 'ngsl' | 'tatoeba';
	license: string;
	licenseUrl: string;
	url: string;
}

export interface PackageCredit {
	name: string;
	version: string;
	license: string;
	url: string;
}

export interface Credits {
	sources: SourceCredit[];
	packages: PackageCredit[];
	/** Other license tags found in the content (not the learner's own text). */
	other: string[];
}

const KNOWN: Record<string, SourceCredit> = {
	[NGSL_LICENSE]: { id: 'ngsl', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', url: 'https://www.newgeneralservicelist.com/' },
	[TATOEBA_LICENSE]: { id: 'tatoeba', license: 'CC BY 2.0 FR', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/', url: 'https://tatoeba.org' }
};
/** Tags of text that is not third-party content. */
const OWN = new Set(['user']);

/** The word-list package (its words.txt sits next to its package.json). */
export function wordListCredit(): PackageCredit {
	const pkg = JSON.parse(readFileSync(join(dirname(wordListPath), 'package.json'), 'utf8')) as { name: string; version: string; license: string; repository?: string };
	return { name: pkg.name, version: pkg.version, license: pkg.license, url: `https://github.com/${pkg.repository ?? 'sindresorhus/word-list'}` };
}

export function credits(db: DbOrTx): Credits {
	const tags = new Set([
		...db.selectDistinct({ tag: lexemes.licenseTag }).from(lexemes).all().map((r) => r.tag),
		...db.selectDistinct({ tag: sentences.licenseTag }).from(sentences).all().map((r) => r.tag)
	]);
	const present = [...tags].sort();
	return {
		sources: present.filter((t) => KNOWN[t] !== undefined).map((t) => KNOWN[t]),
		packages: [wordListCredit()],
		other: present.filter((t) => KNOWN[t] === undefined && !OWN.has(t))
	};
}
