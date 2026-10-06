import { describe, expect, it } from 'vitest';
import { blocklistMatcher, parseBlocklist } from './blocklist.ts';
import { readBlocklist } from './content-files.ts';
import { buildFormIndex } from './forms.ts';

const lexeme = (id: number, headword: string, forms: string[]) => ({ id, headword, forms: [headword, ...forms], freqBand: 1, ngslRank: id });
const forms = buildFormIndex([
	lexeme(1, 'make', ['makes', 'made', 'making']),
	lexeme(2, 'love', ['loves', 'loved', 'loving']),
	lexeme(3, 'die', ['dies', 'died', 'dying']),
	lexeme(4, 'kill', ['kills', 'killed', 'killing']),
	lexeme(5, 'hang', ['hangs', 'hanged', 'hung', 'hanging']),
	lexeme(6, 'cut', ['cuts', 'cutting'])
]);

describe('blocklist phrases', () => {
	it('match consecutive words by lemma, never a word alone', () => {
		const m = blocklistMatcher(parseBlocklist('make love\n'), forms);
		expect(m.match('They made love all night.')).toBe('make love');
		expect(m.match('She is making love letters.')).toBe('make love'); // conservative on purpose
		expect(m.match('I love to make cakes.')).toBeNull();
		expect(m.match('Make the bed, love.')).toBeNull();
		expect(parseBlocklist('make  love\nkill\n')).toEqual({ words: new Set(['kill']), prefixes: [], phrases: [['make', 'love']] });
	});
});

describe('the content filter (src/lib/server/content/blocklist.txt)', () => {
	const m = blocklistMatcher(readBlocklist(), forms);

	it('blocks violence, sex, drugs and drinking, death and self-harm', () => {
		const blocked: [string, string][] = [
			['He tried to strangle her.', 'strangle*'],
			['They killed the man.', 'kill'],
			['It was a murder.', 'murder*'],
			['They made love.', 'make love'],
			['He talked about suicide.', 'suicid*'],
			['He was drunk again.', 'drunk*'],
			['My grandfather died last year.', 'die'],
			['The dog is dead.', 'dead'],
			['She cut herself on purpose.', 'cut herself'],
			['He hung himself.', 'hang himself'],
			['They smoke weed.', 'weed']
		];
		for (const [sentence, term] of blocked) expect(m.match(sentence), sentence).toBe(term);
	});

	it('leaves everyday sentences alone', () => {
		for (const sentence of ['I love my family.', 'She makes a cake for her mother.', 'Please cut the bread with this knife.', 'We hang our coats here.', 'The battery lasts all day.']) {
			expect(m.match(sentence), sentence).toBeNull();
		}
	});
});
