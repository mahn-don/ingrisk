import { describe, expect, it } from 'vitest';
import { extractJson } from './extract.ts';

describe('extractJson', () => {
	it.each([
		['bare', '{"a":1}'],
		['fenced', '```json\n{"a":1}\n```'],
		['fenced without language', '```\n{"a":1}\n```'],
		['prefixed', 'Here is the JSON you asked for: {"a":1}'],
		['suffixed', '{"a":1}\nHope this helps!'],
		['prefixed and fenced', 'Sure!\n```json\n{"a":1}\n```\nAnything else?']
	])('%s', (_name, text) => {
		expect(extractJson(text)).toEqual({ a: 1 });
	});

	it('takes the outermost object and ignores braces inside strings', () => {
		expect(extractJson('x {"a":{"b":"} {"},"c":[1,{"d":2}]} y {"e":3}')).toEqual({ a: { b: '} {' }, c: [1, { d: 2 }] });
	});

	it('throws when there is no object', () => {
		expect(() => extractJson('no json here')).toThrow(SyntaxError);
		expect(() => extractJson('{"a": 1')).toThrow(SyntaxError);
	});
});
