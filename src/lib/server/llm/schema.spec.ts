import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { normalizeEnums, toJsonSchema, toProviderSchema, type JsonSchema } from './schema.ts';

const Topic = z.enum(['ART', 'TNS', 'COL']);
const Item = z
	.object({
		sentence_en: z.string().min(3).describe('The sentence'),
		distractors: z.array(z.string()).length(3),
		score: z.number().int().min(0).max(5),
		note: z.string().optional(),
		nested: z.object({ code: Topic, tags: z.array(z.string()).max(2) }),
		errors: z.array(z.object({ topic_code: Topic, text: z.string().regex(/^[a-z ]+$/) })).max(3)
	})
	.strict();

/** Visit every schema object in a JSON Schema tree. */
function walk(node: unknown, visit: (n: JsonSchema) => void): void {
	if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
	else if (node && typeof node === 'object') {
		visit(node as JsonSchema);
		Object.values(node).forEach((v) => walk(v, visit));
	}
}

describe('toProviderSchema', () => {
	it('openai-strict: no size/range/pattern keywords, full required lists, closed objects everywhere', () => {
		const schema = toProviderSchema(Item, 'openai-strict');
		const text = JSON.stringify(schema);
		for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', '$schema']) {
			expect(text).not.toContain(`"${keyword}"`);
		}
		let objects = 0;
		walk(schema, (node) => {
			if (node.type === 'object') {
				objects++;
				expect(node.additionalProperties).toBe(false);
				expect(node.required).toEqual(Object.keys(node.properties as object));
			}
		});
		expect(objects).toBe(3);
		const props = schema.properties as Record<string, JsonSchema>;
		expect(props.distractors.description).toBe('{minItems: 3, maxItems: 3}');
		expect(props.sentence_en.description).toBe('The sentence {minLength: 3}');
		expect(props.score.description).toContain('minimum: 0');
	});

	it('anthropic: strips numeric, length and large array constraints but keeps minItems 0/1 and pattern', () => {
		const schema = toProviderSchema(
			z.object({ a: z.array(z.string()).min(1), b: z.array(z.string()).length(3), c: z.string().regex(/^x$/).max(5), n: z.number().max(3) }),
			'anthropic'
		);
		const props = schema.properties as Record<string, JsonSchema>;
		expect(props.a.minItems).toBe(1);
		expect(props.b).not.toHaveProperty('minItems');
		expect(props.b).not.toHaveProperty('maxItems');
		expect(props.c.pattern).toBe('^x$');
		expect(props.c).not.toHaveProperty('maxLength');
		expect(props.n).not.toHaveProperty('maximum');
		expect(schema.additionalProperties).toBe(false);
	});

	it('prompt target keeps every constraint', () => {
		expect(toProviderSchema(Item, 'prompt')).toEqual(toJsonSchema(Item));
		expect(JSON.stringify(toJsonSchema(Item))).toContain('"maxItems":3');
	});

	it('stripped constraints are still enforced by the Zod schema', () => {
		const valid = {
			sentence_en: 'abc',
			distractors: ['a', 'b', 'c'],
			score: 1,
			nested: { code: 'ART', tags: [] },
			errors: []
		};
		expect(Item.safeParse(valid).success).toBe(true);
		expect(Item.safeParse({ ...valid, distractors: ['a', 'b'] }).success).toBe(false);
		expect(Item.safeParse({ ...valid, score: 9 }).success).toBe(false);
	});
});

describe('normalizeEnums', () => {
	it('maps enum values case-insensitively to the canonical member, at any depth', () => {
		const out = normalizeEnums(
			{ nested: { code: 'art', tags: [] }, errors: [{ topic_code: 'Col', text: 'x' }], sentence_en: 'art' },
			Item
		) as Record<string, any>;
		expect(out.nested.code).toBe('ART');
		expect(out.errors[0].topic_code).toBe('COL');
		expect(out.sentence_en).toBe('art'); // not an enum field: untouched
	});

	it('leaves unknown values alone so validation still fails', () => {
		const schema = z.object({ code: Topic });
		const out = normalizeEnums({ code: 'xyz' }, schema);
		expect(out).toEqual({ code: 'xyz' });
		expect(schema.safeParse(out).success).toBe(false);
		expect(schema.parse(normalizeEnums({ code: 'tns' }, schema))).toEqual({ code: 'TNS' });
	});
});
