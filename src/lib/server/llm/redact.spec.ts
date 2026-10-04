import { describe, expect, it } from 'vitest';
import { redact } from './redact.ts';

describe('redact', () => {
	it('removes given secrets, auth header values and sk- tokens', () => {
		const text = [
			'key=my-secret-value-123',
			'Authorization: Bearer abcdefghijklmnop',
			'{"x-api-key":"anything-goes-here"}',
			'token sk-proj-abcdefghij1234',
			'header authorization=Bearer qwertyuiopasdf'
		].join('\n');
		const out = redact(text, ['my-secret-value-123']);
		expect(out).not.toContain('my-secret-value-123');
		expect(out).not.toContain('abcdefghijklmnop');
		expect(out).not.toContain('anything-goes-here');
		expect(out).not.toContain('sk-proj-abcdefghij1234');
		expect(out).not.toContain('qwertyuiopasdf');
		expect(out).toContain('[REDACTED]');
	});

	it('leaves ordinary text alone', () => {
		expect(redact('HTTP 400: max_tokens is required', [])).toBe('HTTP 400: max_tokens is required');
	});
});
