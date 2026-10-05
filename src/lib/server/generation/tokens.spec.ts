import { describe, expect, it } from 'vitest';
import { NO_WORD, fillGap, firstWordIndex, tokenize, withGap } from './tokens.ts';

describe('tokens', () => {
	it('splits words (with inner apostrophes), numbers and punctuation', () => {
		expect(tokenize("Tom's dog isn't 3.5 kg, okay?").map((t) => t.text)).toEqual(["Tom's", 'dog', "isn't", '3.5', 'kg', ',', 'okay', '?']);
		expect(firstWordIndex(tokenize('"Why?" he asked.'))).toBe(1);
	});

	it('shows and fills a gap', () => {
		const text = 'I saw a dog there.';
		const tokens = tokenize(text);
		expect(withGap(text, tokens, 2)).toBe('I saw ___ dog there.');
		expect(fillGap(text, tokens, 2, 'the')).toBe('I saw the dog there.');
		expect(fillGap(text, tokens, 2, NO_WORD)).toBe('I saw dog there.');
	});

	it('capitalizes the next word when a sentence-initial gap is left empty', () => {
		const text = 'The dogs are happy.';
		expect(fillGap(text, tokenize(text), 0, NO_WORD)).toBe('Dogs are happy.');
	});
});
