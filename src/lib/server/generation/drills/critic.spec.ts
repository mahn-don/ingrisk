import { describe, expect, it } from 'vitest';
import { judgeDrill, normalizeSentence } from './critic.ts';

const corrected = 'She goes to work by bus.';

describe('judgeDrill', () => {
	it('accepts exactly one fix whose corrected sentence matches', () => {
		expect(judgeDrill({ fixes: [{ wrong: 'go', right: 'goes' }], corrected_sentence: 'She goes to work by bus.' }, corrected)).toMatchObject({ ok: true, reason: null });
	});

	it('rejects two fixes', () => {
		const j = judgeDrill({ fixes: [{ wrong: 'go', right: 'goes' }, { wrong: 'by bus', right: 'by the bus' }], corrected_sentence: 'She goes to work by the bus.' }, corrected);
		expect(j).toMatchObject({ ok: false, reason: 'critic:several_errors (2)' });
	});

	it('rejects a different fix', () => {
		const j = judgeDrill({ fixes: [{ wrong: 'She go', right: 'She went' }], corrected_sentence: 'She went to work by bus.' }, corrected);
		expect(j).toMatchObject({ ok: false, reason: 'critic:different_fix (She go -> She went)' });
	});

	it('rejects when the critic finds nothing wrong', () => {
		expect(judgeDrill({ fixes: [], corrected_sentence: 'She go to work by bus.' }, corrected).reason).toBe('critic:no_error_found');
	});

	it('ignores case, quotes and spacing when comparing', () => {
		expect(normalizeSentence(' It’s  fine , Tom. ')).toBe("it's fine, tom.");
		expect(judgeDrill({ fixes: [{ wrong: 'go', right: 'goes' }], corrected_sentence: 'she goes  to work by bus .' }, corrected).ok).toBe(true);
	});
});
