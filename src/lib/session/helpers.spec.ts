import { describe, expect, it } from 'vitest';
import { checkDrill } from './check.ts';
import { changedWords } from './diff.ts';
import { glossarySegments } from './glossary.ts';

describe('checkDrill', () => {
	it('compares normalized sentences, ignoring final punctuation', () => {
		expect(checkDrill('She goes to work', 'She goes to work.')).toBe(true);
		expect(checkDrill('  she GOES  to work !', 'She goes to work.')).toBe(true);
		expect(checkDrill('She go to work.', 'She goes to work.')).toBe(false);
		expect(checkDrill('', 'She goes to work.')).toBe(false);
	});
});

describe('changedWords', () => {
	it('marks the words a correction changed or inserted', () => {
		expect(changedWords('Yesterday I go to market.', 'Yesterday I went to the market.')).toEqual([
			{ text: 'Yesterday I ', changed: false },
			{ text: 'went', changed: true },
			{ text: ' to ', changed: false },
			{ text: 'the', changed: true },
			{ text: ' market.', changed: false }
		]);
		expect(changedWords('All good here.', 'All good here.')).toEqual([{ text: 'All good here.', changed: false }]);
	});
});

describe('glossarySegments', () => {
	it('splits the passage at the first whole-word occurrence of each glossary word', () => {
		expect(glossarySegments('The market is busy. Markets are fun.', ['market', 'busy'])).toEqual([
			{ text: 'The ' },
			{ text: 'market', word: 'market' },
			{ text: ' is ' },
			{ text: 'busy', word: 'busy' },
			{ text: '. Markets are fun.' }
		]);
		expect(glossarySegments('No match here.', ['xyz'])).toEqual([{ text: 'No match here.' }]);
	});
});
