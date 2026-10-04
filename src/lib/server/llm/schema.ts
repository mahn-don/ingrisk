// Zod is the single source of truth for every LLM output shape. JSON Schema is derived from it,
// sanitized per provider, and the provider's answer is always validated again with Zod locally.
import { z, type ZodType } from 'zod';

export type JsonSchema = { [key: string]: unknown };
export type SchemaTarget = 'openai-strict' | 'anthropic' | 'prompt';

/** The JSON Schema of what the model must produce (the schema's input side), without `$schema`. */
export function toJsonSchema(schema: ZodType): JsonSchema {
	const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
	return rest;
}

/**
 * Constraint keywords each target rejects. They are removed from the wire schema and appended to
 * the field's description as a hint; Zod still enforces them on the response.
 * - OpenAI strict mode rejects length, range and pattern keywords.
 * - Anthropic rejects numeric and string-length constraints, and array sizes other than
 *   `minItems` 0 or 1 (verified against the structured-outputs docs, Oct 2026).
 */
const STRIPPED: Record<Exclude<SchemaTarget, 'prompt'>, readonly string[]> = {
	'openai-strict': [
		'minItems',
		'maxItems',
		'minLength',
		'maxLength',
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf',
		'pattern'
	],
	anthropic: [
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf',
		'minLength',
		'maxLength',
		'maxItems',
		'minItems'
	]
};

const isObject = (value: unknown): value is JsonSchema =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function sanitize(node: unknown, target: Exclude<SchemaTarget, 'prompt'>): unknown {
	if (Array.isArray(node)) return node.map((n) => sanitize(n, target));
	if (!isObject(node)) return node;
	const out: JsonSchema = {};
	const hints: string[] = [];
	for (const [key, value] of Object.entries(node)) {
		const keepSmallMinItems = target === 'anthropic' && key === 'minItems' && (value === 0 || value === 1);
		if (STRIPPED[target].includes(key) && !keepSmallMinItems) {
			hints.push(`${key}: ${JSON.stringify(value)}`);
		} else if (key === 'properties' && isObject(value)) {
			out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, target)]));
		} else {
			out[key] = sanitize(value, target);
		}
	}
	if (hints.length > 0) {
		const hint = `{${hints.join(', ')}}`;
		out.description = typeof out.description === 'string' ? `${out.description} ${hint}` : hint;
	}
	if (out.type === 'object' || isObject(out.properties)) {
		out.additionalProperties = false;
		// OpenAI strict mode: every property must be listed as required.
		if (target === 'openai-strict' && isObject(out.properties)) out.required = Object.keys(out.properties);
	}
	return out;
}

/** The schema to send to a provider: `openai-strict`, `anthropic`, or `prompt` (unchanged, for json_prompt). */
export function toProviderSchema(schema: ZodType, target: SchemaTarget): JsonSchema {
	const json = toJsonSchema(schema);
	return target === 'prompt' ? json : (sanitize(json, target) as JsonSchema);
}

function resolveRef(ref: string, root: JsonSchema): unknown {
	if (!ref.startsWith('#/')) return undefined;
	return ref
		.slice(2)
		.split('/')
		.reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), root);
}

function canonical(value: string, members: unknown[]): string {
	if (members.includes(value)) return value;
	const match = members.find((m) => typeof m === 'string' && m.toLowerCase() === value.toLowerCase());
	return typeof match === 'string' ? match : value;
}

function normalizeNode(value: unknown, node: unknown, root: JsonSchema, depth: number): unknown {
	if (!isObject(node) || depth > 64) return value;
	if (typeof node.$ref === 'string') return normalizeNode(value, resolveRef(node.$ref, root), root, depth + 1);
	if (typeof value === 'string') {
		if (Array.isArray(node.enum)) return canonical(value, node.enum);
		if (typeof node.const === 'string') return canonical(value, [node.const]);
	}
	for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
		const branches = node[key];
		if (Array.isArray(branches)) {
			for (const branch of branches) {
				const normalized = normalizeNode(value, branch, root, depth + 1);
				if (normalized !== value) return normalized;
			}
		}
	}
	if (Array.isArray(value) && node.items !== undefined) {
		return value.map((item) => normalizeNode(item, node.items, root, depth + 1));
	}
	if (isObject(value) && isObject(node.properties)) {
		const properties = node.properties;
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, k in properties ? normalizeNode(v, properties[k], root, depth + 1) : v])
		);
	}
	return value;
}

/**
 * Map string enum (and const) values that match a member case-insensitively to the canonical
 * member, e.g. "art" -> "ART". Providers do not guarantee enum casing. Unknown values are left
 * as they are, so Zod still rejects them.
 */
export function normalizeEnums(value: unknown, schema: ZodType): unknown {
	const json = toJsonSchema(schema);
	return normalizeNode(value, json, json, 0);
}
