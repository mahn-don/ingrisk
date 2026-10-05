import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { generateStructured, generateText, type LlmDeps } from './client.ts';
import { assertAllowedBaseUrl, loadProvider } from './config.ts';
import {
	LlmConfigError,
	LlmError,
	LlmHttpError,
	LlmMissingKeyError,
	LlmRefusalError,
	LlmRetriesExhaustedError,
	LlmSchemaError
} from './errors.ts';
import { defaultTransportDeps } from './transport.ts';
import {
	ANTHROPIC_KEY,
	OPENAI_KEY,
	type Scripted,
	anthropicProvider,
	anthropicText,
	anthropicToolUse,
	openaiContent,
	openaiProvider,
	openaiToolCall,
	scriptedFetch,
	setupProviders,
	testDeps
} from './test-helpers.ts';

const Word = z.object({
	word: z.string(),
	cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
	vi_gloss: z.string(),
	examples: z.array(z.string()).length(2)
});
const GOOD = { word: 'borrow', cefr: 'A2', vi_gloss: 'mượn', examples: ['Can I borrow it?', 'She borrowed a pen.'] };
const req = { purpose: 'smoke', system: 'You are a lexicographer.', user: 'Describe "borrow".', schema: Word };

async function run(primary = anthropicProvider, script: Scripted[], fallback?: typeof openaiProvider, overrides: Partial<LlmDeps> = {}) {
	const { db, primaryId, fallbackId } = setupProviders(primary, fallback);
	const fake = scriptedFetch(script);
	const { deps, sleeps } = testDeps(db, fake.fetch, overrides);
	return { db, deps, sleeps, fake, primaryId, fallbackId };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('expected a rejection');
}

describe('request shape per wire format and mode', () => {
	it('Anthropic json_schema: top-level system, max_tokens, output_config.format, headers, no temperature', async () => {
		const t = await run(anthropicProvider, [anthropicText(JSON.stringify(GOOD))]);
		await generateStructured(req, t.deps);
		const [r] = t.fake.requests;
		expect(r.url).toBe('https://api.anthropic.com/v1/messages');
		expect(r.headers['x-api-key']).toBe(ANTHROPIC_KEY);
		expect(r.headers['anthropic-version']).toBe('2023-06-01');
		expect(r.body.system).toBe(req.system);
		expect(r.body.max_tokens).toBe(2000);
		expect(r.body).not.toHaveProperty('temperature');
		expect(r.body).not.toHaveProperty('output_format');
		expect(r.body.messages).toEqual([{ role: 'user', content: req.user }]);
		const format = (r.body.output_config as any).format;
		expect(format.type).toBe('json_schema');
		expect(format.schema.properties.examples).not.toHaveProperty('minItems');
		expect(format.schema.additionalProperties).toBe(false);
	});

	it('Anthropic sends temperature only when the caller sets it', async () => {
		const t = await run(anthropicProvider, [anthropicText(JSON.stringify(GOOD))]);
		await generateStructured({ ...req, temperature: 1, maxTokens: 500 }, t.deps);
		expect(t.fake.requests[0].body).toMatchObject({ temperature: 1, max_tokens: 500 });
	});

	it('OpenAI json_schema: system message, strict response_format, bearer auth, default temperature', async () => {
		const t = await run(openaiProvider, [openaiContent(JSON.stringify(GOOD))]);
		await generateStructured(req, t.deps);
		const [r] = t.fake.requests;
		expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(r.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
		expect((r.body.messages as any[])[0]).toEqual({ role: 'system', content: req.system });
		expect(r.body).not.toHaveProperty('system');
		expect(r.body.temperature).toBe(0.4);
		expect(r.body.max_completion_tokens).toBe(2000);
		const rf = r.body.response_format as any;
		expect(rf.type).toBe('json_schema');
		expect(rf.json_schema).toMatchObject({ name: 'smoke', strict: true });
		expect(rf.json_schema.schema.required).toEqual(['word', 'cefr', 'vi_gloss', 'examples']);
		expect(JSON.stringify(rf.json_schema.schema)).not.toContain('"minItems"');
	});

	it('other OpenAI-compatible servers get max_tokens', async () => {
		const t = await run({ ...openaiProvider, name: 'Ollama', baseUrl: 'http://localhost:11434/v1', envKeyName: null }, [
			openaiContent(JSON.stringify(GOOD))
		]);
		await generateStructured(req, t.deps);
		expect(t.fake.requests[0].body.max_tokens).toBe(2000);
		expect(t.fake.requests[0].headers).not.toHaveProperty('authorization');
	});

	it('tool mode forces the single output tool for both formats', async () => {
		const a = await run({ ...anthropicProvider, structuredMode: 'tool' }, [anthropicToolUse(GOOD)]);
		await generateStructured(req, a.deps);
		const ab = a.fake.requests[0].body as any;
		expect(ab.tool_choice).toEqual({ type: 'tool', name: 'record_output' });
		expect(ab.tools[0].input_schema.properties.word).toEqual({ type: 'string' });
		expect(ab).not.toHaveProperty('output_config');

		const o = await run({ ...openaiProvider, structuredMode: 'tool' }, [openaiToolCall(JSON.stringify(GOOD))]);
		await generateStructured(req, o.deps);
		const ob = o.fake.requests[0].body as any;
		expect(ob.tool_choice).toEqual({ type: 'function', function: { name: 'record_output' } });
		expect(ob.tools[0].function).toMatchObject({ name: 'record_output', strict: true });
		expect(ob).not.toHaveProperty('response_format');
	});

	it('json_prompt mode embeds the schema in the system prompt and asks for nothing native', async () => {
		const a = await run({ ...anthropicProvider, structuredMode: 'json_prompt' }, [anthropicText(JSON.stringify(GOOD))]);
		await generateStructured(req, a.deps);
		const ab = a.fake.requests[0].body as any;
		expect(ab.system).toContain(req.system);
		expect(ab.system).toContain('"vi_gloss"');
		expect(ab.system).toContain('"maxItems":2');
		expect(ab).not.toHaveProperty('output_config');
		expect(ab).not.toHaveProperty('tools');

		const o = await run({ ...openaiProvider, structuredMode: 'json_prompt' }, [openaiContent(JSON.stringify(GOOD))]);
		await generateStructured(req, o.deps);
		const ob = o.fake.requests[0].body as any;
		expect(ob.messages[0].content).toContain('"vi_gloss"');
		expect(ob).not.toHaveProperty('response_format');
	});
});

describe('response parsing', () => {
	it('Anthropic text output, with usage mapped', async () => {
		const t = await run(anthropicProvider, [anthropicText(JSON.stringify(GOOD))]);
		const out = await generateStructured(req, t.deps);
		expect(out).toMatchObject({ data: GOOD, usage: { inputTokens: 120, outputTokens: 30 }, model: 'claude-test-20261001', attempts: 1 });
	});

	it('Anthropic tool_use input is already an object', async () => {
		const t = await run({ ...anthropicProvider, structuredMode: 'tool' }, [anthropicToolUse(GOOD)]);
		expect((await generateStructured(req, t.deps)).data).toEqual(GOOD);
	});

	it('OpenAI content is a JSON string, with usage mapped', async () => {
		const t = await run(openaiProvider, [openaiContent(JSON.stringify(GOOD))]);
		const out = await generateStructured(req, t.deps);
		expect(out).toMatchObject({ data: GOOD, usage: { inputTokens: 90, outputTokens: 20 }, model: 'gpt-test-2026' });
	});

	it('OpenAI tool_calls arguments are a string that needs parsing', async () => {
		const t = await run({ ...openaiProvider, structuredMode: 'tool' }, [openaiToolCall(JSON.stringify(GOOD))]);
		expect((await generateStructured(req, t.deps)).data).toEqual(GOOD);
	});

	it('json_prompt extracts JSON from fenced, chatty text', async () => {
		const t = await run({ ...openaiProvider, structuredMode: 'json_prompt' }, [
			openaiContent(`Sure! Here it is:\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\nLet me know.`)
		]);
		expect((await generateStructured(req, t.deps)).data).toEqual(GOOD);
	});

	it('normalizes enum casing before validating', async () => {
		const t = await run(anthropicProvider, [anthropicText(JSON.stringify({ ...GOOD, cefr: 'a2' }))]);
		expect((await generateStructured(req, t.deps)).data.cefr).toBe('A2');
	});

	it('generateText returns plain text', async () => {
		const t = await run(anthropicProvider, [anthropicText('Hello there.')]);
		const out = await generateText({ purpose: 'chat', system: 's', user: 'u' }, t.deps);
		expect(out).toMatchObject({ text: 'Hello there.', attempts: 1, usage: { inputTokens: 120, outputTokens: 30 } });
		expect(t.fake.requests[0].body).not.toHaveProperty('output_config');
	});
});

describe('repair', () => {
	it('one invalid answer then a valid one succeeds with attempts: 2 and sends the issues back', async () => {
		const bad = JSON.stringify({ ...GOOD, examples: ['only one'] });
		const t = await run(anthropicProvider, [anthropicText(bad), anthropicText(JSON.stringify(GOOD))]);
		const out = await generateStructured(req, t.deps);
		expect(out.attempts).toBe(2);
		expect(out.usage).toEqual({ inputTokens: 240, outputTokens: 60 });
		const messages = t.fake.requests[1].body.messages as { role: string; content: string }[];
		expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
		expect(messages[1].content).toBe(bad);
		expect(messages[2].content).toContain('examples');
	});

	it('two invalid answers throw LlmSchemaError with the raw output and issues', async () => {
		const t = await run(anthropicProvider, [anthropicText('not json at all'), anthropicText(JSON.stringify({ ...GOOD, cefr: 'Z9' }))]);
		const error = await caught(generateStructured(req, t.deps));
		expect(error).toBeInstanceOf(LlmSchemaError);
		const schemaError = error as LlmSchemaError;
		expect(schemaError.rawOutput).toContain('Z9');
		expect(schemaError.issues[0].path).toBe('cefr');
		expect(t.fake.requests).toHaveLength(2);
	});
});

describe('retry', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('honours Retry-After on 429 (real sleep under fake timers)', async () => {
		vi.useFakeTimers();
		const { db } = setupProviders(anthropicProvider);
		const fake = scriptedFetch([{ status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '7' } }, anthropicText(JSON.stringify(GOOD))]);
		const deps: LlmDeps = { ...defaultTransportDeps(), db, fetch: fake.fetch, env: testDeps(db, fake.fetch).deps.env, now: () => new Date(0) };
		const promise = generateStructured(req, deps);
		await vi.advanceTimersByTimeAsync(6_900);
		expect(fake.requests).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(200);
		await expect(promise).resolves.toMatchObject({ data: GOOD });
		expect(fake.requests).toHaveLength(2);
	});

	it('retries 500 up to 3 attempts with exponential backoff, then gives up', async () => {
		const t = await run(anthropicProvider, [{ status: 500 }, { status: 500 }, { status: 500 }]);
		const error = await caught(generateStructured(req, t.deps));
		expect(error).toBeInstanceOf(LlmRetriesExhaustedError);
		expect(t.fake.requests).toHaveLength(3);
		expect(t.sleeps).toEqual([1000, 2000]); // jitter fixed at the midpoint
	});

	it('retries 529, network errors and timeouts', async () => {
		const t = await run(anthropicProvider, [{ status: 529 }, { networkError: 'ECONNRESET' }, anthropicText(JSON.stringify(GOOD))]);
		expect((await generateStructured(req, t.deps)).data).toEqual(GOOD);
		const timeout = await run(anthropicProvider, [{ hang: true }, anthropicText(JSON.stringify(GOOD))], undefined, { timeoutMs: 20 });
		expect((await generateStructured(req, timeout.deps)).data).toEqual(GOOD);
		expect(llmCallsRepo(timeout.db).all()[0].errorCode).toBe('timeout');
	});

	it('does not retry a 400', async () => {
		const t = await run(anthropicProvider, [{ status: 400, body: { error: { type: 'invalid_request_error', message: 'bad schema' } } }]);
		const error = await caught(generateStructured(req, t.deps));
		expect(error).toBeInstanceOf(LlmHttpError);
		expect((error as LlmHttpError).status).toBe(400);
		expect((error as Error).message).toContain('bad schema');
		expect(t.fake.requests).toHaveLength(1);
	});
});

describe('fallback', () => {
	it('falls back after retries are exhausted', async () => {
		const t = await run(anthropicProvider, [{ status: 503 }, { status: 503 }, { status: 503 }, openaiContent(JSON.stringify(GOOD))], openaiProvider);
		const out = await generateStructured(req, t.deps);
		expect(out.providerId).toBe(t.fallbackId);
		expect(t.fake.requests.map((r) => new URL(r.url).hostname)).toEqual([
			'api.anthropic.com',
			'api.anthropic.com',
			'api.anthropic.com',
			'api.openai.com'
		]);
	});

	it('falls back on 401 without retrying', async () => {
		const t = await run(anthropicProvider, [{ status: 401 }, openaiContent(JSON.stringify(GOOD))], openaiProvider);
		expect((await generateStructured(req, t.deps)).providerId).toBe(t.fallbackId);
		expect(t.fake.requests).toHaveLength(2);
	});

	it('falls back when the key env var is missing, without calling the primary', async () => {
		const t = await run(anthropicProvider, [openaiContent(JSON.stringify(GOOD))], openaiProvider, {
			env: { OPENAI_API_KEY: OPENAI_KEY }
		});
		expect((await generateStructured(req, t.deps)).providerId).toBe(t.fallbackId);
		expect(t.fake.requests).toHaveLength(1);
	});

	it('does not fall back on a schema error or a refusal', async () => {
		const schema = await run(anthropicProvider, [anthropicText('{}'), anthropicText('{}')], openaiProvider);
		expect(await caught(generateStructured(req, schema.deps))).toBeInstanceOf(LlmSchemaError);
		expect(schema.fake.requests).toHaveLength(2);
		expect(schema.fake.remaining()).toBe(0);

		const refusal = await run(anthropicProvider, [anthropicText('', { stop_reason: 'refusal' })], openaiProvider);
		expect(await caught(generateStructured(req, refusal.deps))).toBeInstanceOf(LlmRefusalError);
		expect(refusal.fake.requests).toHaveLength(1);
	});

	it('can be disabled per call, and needs a fallback provider to exist', async () => {
		const off = await run(anthropicProvider, [{ status: 401 }], openaiProvider);
		expect(await caught(generateStructured({ ...req, fallback: false }, off.deps))).toBeInstanceOf(LlmHttpError);
		const none = await run(anthropicProvider, [], undefined, { env: {} });
		expect(await caught(generateStructured(req, none.deps))).toBeInstanceOf(LlmMissingKeyError);
	});
});

describe('refusal', () => {
	it('Anthropic stop_reason "refusal" (with stop_details)', async () => {
		const t = await run(anthropicProvider, [
			anthropicText('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' } })
		]);
		const error = await caught(generateStructured(req, t.deps));
		expect(error).toBeInstanceOf(LlmRefusalError);
		expect((error as LlmRefusalError).detail).toBe('cyber: no');
	});

	it('OpenAI message.refusal', async () => {
		const t = await run(openaiProvider, [openaiContent(null, { refusal: "I can't help with that." })]);
		const error = await caught(generateStructured(req, t.deps));
		expect(error).toBeInstanceOf(LlmRefusalError);
		expect(t.fake.requests).toHaveLength(1);
	});

	it('generateText also throws on refusal', async () => {
		const t = await run(openaiProvider, [openaiContent(null, { refusal: 'No.' })]);
		expect(await caught(generateText({ purpose: 'p', system: 's', user: 'u' }, t.deps))).toBeInstanceOf(LlmRefusalError);
	});
});

describe('key safety', () => {
	const leaks = (error: unknown) => {
		const e = error as Error;
		return [e.message, e.stack ?? '', String(e), JSON.stringify(e)].some(
			(s) => s.includes(ANTHROPIC_KEY) || s.includes(OPENAI_KEY) || s.includes('FAKEanthropic') || s.includes('FAKEopenai')
		);
	};
	const echo = (status: number) => ({
		status,
		body: { error: { message: `invalid x-api-key: ${ANTHROPIC_KEY}; Authorization: Bearer ${OPENAI_KEY}` } }
	});

	it('no error path leaks a key in message, stack, String() or the call log', async () => {
		const scenarios: { script: Scripted[]; fallback?: typeof openaiProvider }[] = [
			{ script: [echo(400)] },
			{ script: [echo(401)] },
			{ script: [echo(500), echo(500), echo(500)] },
			{ script: [echo(401), echo(403)], fallback: openaiProvider },
			{ script: [{ networkError: `connect failed for key ${ANTHROPIC_KEY}` }, { networkError: 'x' }, { networkError: 'y' }] },
			{ script: [anthropicText(`here: ${ANTHROPIC_KEY}`), anthropicText(`again ${OPENAI_KEY}`)] },
			{ script: [anthropicText('', { stop_reason: 'refusal', stop_details: { explanation: `key ${ANTHROPIC_KEY}` } })] },
			{ script: [{ status: 200, body: `not json ${ANTHROPIC_KEY}` }] },
			{ script: [{ status: 200, body: { unexpected: ANTHROPIC_KEY } }] }
		];
		for (const { script, fallback } of scenarios) {
			const t = await run(anthropicProvider, script, fallback);
			const error = await caught(generateStructured(req, t.deps));
			expect(error).toBeInstanceOf(LlmError);
			expect(leaks(error), String(error)).toBe(false);
			if (error instanceof LlmSchemaError) expect(error.rawOutput).not.toContain(ANTHROPIC_KEY);
			const rows = JSON.stringify(llmCallsRepo(t.db).all());
			expect(rows).not.toContain(ANTHROPIC_KEY);
			expect(rows).not.toContain(OPENAI_KEY);
		}
		// Missing key: the error names the variable, never a value.
		const missing = await run(anthropicProvider, [], undefined, { env: {} });
		const error = await caught(generateStructured(req, missing.deps));
		expect((error as Error).message).toBe('Environment variable ANTHROPIC_API_KEY is not set');
	});

	it('no thrown error carries a cause chain', async () => {
		const t = await run(anthropicProvider, [echo(400)]);
		expect(((await caught(generateStructured(req, t.deps))) as Error).cause).toBeUndefined();
	});
});

describe('config', () => {
	it('rejects http to a non-local host and accepts https and http://localhost', () => {
		expect(() => assertAllowedBaseUrl('http://api.example.com/v1')).toThrow(LlmConfigError);
		expect(() => assertAllowedBaseUrl('ftp://localhost')).toThrow(LlmConfigError);
		expect(() => assertAllowedBaseUrl('not a url')).toThrow(LlmConfigError);
		expect(assertAllowedBaseUrl('http://localhost:11434').hostname).toBe('localhost');
		expect(assertAllowedBaseUrl('http://127.0.0.1:11434/v1').port).toBe('11434');
		expect(assertAllowedBaseUrl('https://api.openai.com/v1').protocol).toBe('https:');
	});

	it('refuses to call a provider whose base_url is not allowed', async () => {
		const t = await run({ ...openaiProvider, baseUrl: 'http://evil.example.com/v1' }, []);
		expect(await caught(generateStructured(req, t.deps))).toBeInstanceOf(LlmConfigError);
		expect(t.fake.requests).toHaveLength(0);
	});

	it('needs an active, enabled provider', () => {
		const { db, primaryId } = setupProviders(anthropicProvider);
		expect(loadProvider(db).id).toBe(primaryId);
		providersRepo(db).upsert({ ...anthropicProvider, enabled: false });
		expect(() => loadProvider(db)).toThrow(LlmConfigError);
	});
});

describe('call log', () => {
	it('writes one row per HTTP attempt with status, error code and tokens', async () => {
		const t = await run(
			anthropicProvider,
			[{ status: 429 }, anthropicText('{"word": 1}'), { status: 500 }, anthropicText(JSON.stringify(GOOD))],
			undefined
		);
		await generateStructured(req, t.deps);
		const rows = llmCallsRepo(t.db).all();
		expect(rows.map((r) => [r.attempt, r.ok, r.httpStatus, r.errorCode, r.inputTokens, r.outputTokens])).toEqual([
			[1, false, 429, 'http_429', null, null],
			[2, false, 200, 'schema_invalid', 120, 30],
			[3, false, 500, 'http_500', null, null],
			[4, true, 200, null, 120, 30]
		]);
		expect(rows.every((r) => r.purpose === 'smoke' && r.mode === 'json_schema' && r.model === 'claude-test')).toBe(true);
		expect(rows.every((r) => r.latencyMs > 0)).toBe(true);

		const since = new Date('2026-10-05T00:00:00Z');
		expect(llmCallsRepo(t.db).countSince(since)).toBe(4);
		expect(llmCallsRepo(t.db).countSince(new Date('2026-10-06T00:00:00Z'))).toBe(0);
		expect(llmCallsRepo(t.db).usageSince(since)).toEqual([
			{ providerId: t.primaryId, model: 'claude-test', calls: 4, inputTokens: 240, outputTokens: 60 }
		]);
	});

	it('stores no prompt or response text', async () => {
		const t = await run(anthropicProvider, [anthropicText(JSON.stringify(GOOD))]);
		await generateStructured(req, t.deps);
		const rows = JSON.stringify(llmCallsRepo(t.db).all());
		expect(rows).not.toContain('lexicographer');
		expect(rows).not.toContain('borrow');
	});
});
