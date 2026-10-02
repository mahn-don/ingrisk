// Join the Tatoeba per-language exports in tool/raw/tatoeba-full/ into tool/raw/tatoeba-eng-vie.tsv.
// Run with: npm run content:tatoeba-pairs  (see tool/raw/README.md for the inputs)
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { formatPairsTsv, joinPairs, parseLinks, parseSentenceLine } from './lib/tatoeba-pairs.ts';

const RAW = join(import.meta.dirname, 'raw');
const FULL = join(RAW, 'tatoeba-full');
const inputs = {
	links: join(FULL, 'eng-vie_links.tsv'),
	vie: join(FULL, 'vie_sentences.tsv'),
	eng: join(FULL, 'eng_sentences.tsv')
};

for (const path of Object.values(inputs)) {
	if (!existsSync(path)) {
		console.error(`Missing ${path}. Decompress the exports first: bunzip2 -k tool/raw/tatoeba-full/*.bz2`);
		process.exit(1);
	}
}

function readSentences(text: string, lang: string): Map<number, string> {
	const map = new Map<number, string>();
	for (const line of text.split('\n')) addSentence(map, line, lang);
	return map;
}

function addSentence(map: Map<number, string>, line: string, lang: string): void {
	const sentence = parseSentenceLine(line);
	if (sentence === null) return;
	if (sentence.lang !== lang) throw new Error(`Expected lang "${lang}": ${line}`);
	map.set(sentence.id, sentence.text);
}

const links = parseLinks(readFileSync(inputs.links, 'utf8'));
const vie = readSentences(readFileSync(inputs.vie, 'utf8'), 'vie');

// The English export is ~100 MB: stream it and keep only sentences that have a Vietnamese link.
const wantedEng = new Set(links.map(([engId]) => engId));
const eng = new Map<number, string>();
const reader = createInterface({ input: createReadStream(inputs.eng, 'utf8'), crlfDelay: Infinity });
for await (const line of reader) {
	const tab = line.indexOf('\t');
	if (tab > 0 && wantedEng.has(Number(line.slice(0, tab)))) addSentence(eng, line, 'eng');
}

const { rows, missingEng, missingVie } = joinPairs(links, eng, vie);
const output = join(RAW, 'tatoeba-eng-vie.tsv');
writeFileSync(output, formatPairsTsv(rows));

console.log(`links: ${links.length}`);
console.log(`vietnamese sentences: ${vie.size}, linked english sentences found: ${eng.size}`);
console.log(`links skipped (english missing: ${missingEng}, vietnamese missing: ${missingVie})`);
console.log(`wrote ${rows.length} pairs to ${output}`);
