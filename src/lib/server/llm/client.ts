// The LLM client: request + Zod schema in, validated object out. Provider-agnostic.
import type { ZodType, z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { getDb } from '../db/client.ts';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { type Env, type ProviderConfig, loadFallback, loadProvider, readKey } from './config.ts';
import {
	LlmError,
	LlmHttpError,
	LlmMissingKeyError,
	LlmRefusalError,
	LlmRetriesExhaustedError,
	LlmSchemaError,
	type SchemaIssue,
	summarizeIssues
} from './errors.ts';
import { extractJson } from './extract.ts';
import { redact } from './redact.ts';
import { normalizeEnums } from './schema.ts';
import { type TransportDeps, defaultTransportDeps, postJson } from './transport.ts';
import {
	type CallMode,
	type ChatMessage,
	type GenerationResponse,
	type Usage,
	buildRequest,
	parseResponse
} from './wire.ts';

export const DEFAULT_MAX_TOKENS = 2000;
export const DEFAULT_TEMPERATURE = 0.4;

export interface LlmDeps extends TransportDeps {
	db: DbOrTx;
	env: Env;
	/** Timestamps for the call log. */
	now: () => Date;
	/** The learner the calls are for (grading), logged in llm_calls.profile_id; unset for shared content (Phase 12). */
	profileId?: number;
}

export function defaultLlmDeps(): LlmDeps {
	return { ...defaultTransportDeps(), db: getDb(), env: process.env, now: () => new Date() };
}

interface BaseRequest {
	/** What the call is for, e.g. 'cloze' or 'writing_feedback'. Logged; never the prompt itself. */
	purpose: string;
	system: string;
	user: string;
	maxTokens?: number;
	/**
	 * Sampling temperature. Defaults to 0.4 for OpenAI-compatible providers. Not sent to Anthropic
	 * unless given: Claude models after Opus 4.6 reject any value other than 1.0.
	 */
	temperature?: number;
	/** Default: the active provider. */
	providerId?: number;
	/** Fall back to the provider flagged is_fallback on availability errors (default true). */
	fallback?: boolean;
	/** The learner the call is for (grading), logged in llm_calls.profile_id; omit for shared content (Phase 12). */
	profileId?: number;
}

export interface StructuredRequest<S extends ZodType> extends BaseRequest {
	schema: S;
}

export interface CallResult {
	usage: Usage;
	model: string;
	providerId: number;
	/** Model generations used: 1, or 2 when the repair attempt was needed. */
	attempts: number;
}

/** Counts HTTP attempts across retries, repair and fallback within one generate call. */
interface CallContext {
	deps: LlmDeps;
	purpose: string;
	attempt: number;
}

function toIssues(error: z.ZodError): SchemaIssue[] {
	return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

function repairMessage(issues: SchemaIssue[]): string {
	return [
		'Your previous reply did not match the required JSON schema.',
		`Problems: ${summarizeIssues(issues)}`,
		'Reply again with only the corrected JSON object.'
	].join('\n');
}

function temperatureFor(provider: ProviderConfig, requested: number | undefined): number | undefined {
	if (requested !== undefined) return requested;
	return provider.wireFormat === 'anthropic' ? undefined : DEFAULT_TEMPERATURE;
}

/** One HTTP exchange (with transport retries), logging every attempt. */
async function exchange(
	ctx: CallContext,
	provider: ProviderConfig,
	key: string | undefined,
	mode: CallMode,
	messages: ChatMessage[],
	req: BaseRequest & { schema?: ZodType }
): Promise<{ response: GenerationResponse; record: (ok: boolean, errorCode: string | null) => void }> {
	const calls = llmCallsRepo(ctx.deps.db);
	const log = (fields: { ok: boolean; httpStatus: number | null; errorCode: string | null; latencyMs: number; usage?: Usage }) =>
		calls.record({
			createdAt: ctx.deps.now(),
			providerId: provider.id,
			model: provider.model,
			purpose: ctx.purpose,
			mode,
			attempt: ++ctx.attempt,
			ok: fields.ok,
			httpStatus: fields.httpStatus,
			errorCode: fields.errorCode,
			inputTokens: fields.usage?.inputTokens ?? null,
			outputTokens: fields.usage?.outputTokens ?? null,
			latencyMs: fields.latencyMs,
			profileId: req.profileId ?? ctx.deps.profileId ?? null
		});
	const http = buildRequest(provider, key, {
		system: req.system,
		messages,
		maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
		temperature: temperatureFor(provider, req.temperature),
		mode,
		schema: req.schema,
		purpose: req.purpose
	});
	const result = await postJson(http, (report) => log(report), ctx.deps);
	let response: GenerationResponse;
	try {
		response = parseResponse(provider, result.body, mode);
	} catch (error) {
		log({ ok: false, httpStatus: result.status, errorCode: 'bad_response', latencyMs: result.latencyMs });
		throw error;
	}
	const record = (ok: boolean, errorCode: string | null) =>
		log({ ok, httpStatus: result.status, errorCode, latencyMs: result.latencyMs, usage: response.usage });
	return { response, record };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
	inputTokens: a.inputTokens + b.inputTokens,
	outputTokens: a.outputTokens + b.outputTokens
});

async function structuredWith<S extends ZodType>(
	ctx: CallContext,
	provider: ProviderConfig,
	req: StructuredRequest<S>
): Promise<CallResult & { data: z.output<S> }> {
	const key = readKey(provider, ctx.deps.env);
	const mode = provider.structuredMode;
	const messages: ChatMessage[] = [{ role: 'user', content: req.user }];
	let usage: Usage = { inputTokens: 0, outputTokens: 0 };
	let model = provider.model;
	for (let generation = 1; generation <= 2; generation++) {
		const { response, record } = await exchange(ctx, provider, key, mode, messages, req);
		usage = addUsage(usage, response.usage);
		model = response.model || model;
		if (response.refusal) {
			record(false, 'refusal');
			throw new LlmRefusalError(response.refusal.detail, provider.id);
		}
		const raw = response.output.kind === 'text' ? response.output.value : JSON.stringify(response.output.value);
		let issues: SchemaIssue[];
		try {
			const candidate = response.output.kind === 'object' ? response.output.value : extractJson(response.output.value);
			const parsed = req.schema.safeParse(normalizeEnums(candidate, req.schema));
			if (parsed.success) {
				record(true, null);
				return { data: parsed.data, usage, model, providerId: provider.id, attempts: generation };
			}
			issues = toIssues(parsed.error);
		} catch (error) {
			issues = [{ path: '', message: (error as Error).message }];
		}
		record(false, 'schema_invalid');
		if (generation === 2) throw new LlmSchemaError(raw, issues, provider.id);
		messages.push({ role: 'assistant', content: raw || '(empty reply)' }, { role: 'user', content: repairMessage(issues) });
	}
	throw new Error('unreachable');
}

async function textWith(ctx: CallContext, provider: ProviderConfig, req: BaseRequest): Promise<CallResult & { text: string }> {
	const key = readKey(provider, ctx.deps.env);
	const { response, record } = await exchange(ctx, provider, key, 'text', [{ role: 'user', content: req.user }], req);
	if (response.refusal) {
		record(false, 'refusal');
		throw new LlmRefusalError(response.refusal.detail, provider.id);
	}
	record(true, null);
	const text = response.output.kind === 'text' ? response.output.value : JSON.stringify(response.output.value);
	return { text, usage: response.usage, model: response.model || provider.model, providerId: provider.id, attempts: 1 };
}

/** Availability problems move to the fallback provider; content problems (schema, refusal) never do. */
export function shouldFallBack(error: unknown): boolean {
	return (
		error instanceof LlmRetriesExhaustedError ||
		error instanceof LlmMissingKeyError ||
		(error instanceof LlmHttpError && (error.status === 401 || error.status === 403))
	);
}

/** Every key any configured provider could use: redacted from all errors. */
function knownSecrets(deps: LlmDeps): string[] {
	const names = providersRepo(deps.db)
		.list()
		.map((p) => p.envKeyName)
		.filter((n): n is string => n !== null);
	return names.map((n) => deps.env[n]).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** The single exit for errors: secrets scrubbed, no `cause` chain that could carry them. */
function safeError(error: unknown, deps: LlmDeps): LlmError {
	let secrets: string[] = [];
	try {
		secrets = knownSecrets(deps);
	} catch {
		// the database itself failed; pattern-based redaction still applies
	}
	if (error instanceof LlmError) return error.redacted(secrets);
	const message = error instanceof Error ? error.message : String(error);
	return new LlmError('bad_response', `Unexpected error: ${redact(message, secrets)}`).redacted(secrets);
}

async function withFallback<T>(
	deps: LlmDeps,
	req: BaseRequest,
	run: (ctx: CallContext, provider: ProviderConfig) => Promise<T>
): Promise<T> {
	const ctx: CallContext = { deps, purpose: req.purpose, attempt: 0 };
	try {
		const primary = loadProvider(deps.db, req.providerId);
		try {
			return await run(ctx, primary);
		} catch (error) {
			if (req.fallback === false || !shouldFallBack(error)) throw error;
			const fallback = loadFallback(deps.db);
			if (fallback === undefined || fallback.id === primary.id) throw error;
			return await run(ctx, fallback);
		}
	} catch (error) {
		throw safeError(error, deps);
	}
}

/**
 * Ask the provider for an object matching `schema`. The answer is always validated with Zod
 * locally (after case-insensitive enum normalization); one repair round is attempted on failure.
 * Throws LlmSchemaError, LlmRefusalError or another LlmError, all with secrets redacted.
 */
export async function generateStructured<S extends ZodType>(
	req: StructuredRequest<S>,
	deps: LlmDeps = defaultLlmDeps()
): Promise<CallResult & { data: z.output<S> }> {
	return withFallback(deps, req, (ctx, provider) => structuredWith(ctx, provider, req));
}

/** Plain text generation, with the same transport, retry, fallback and logging. */
export async function generateText(req: BaseRequest, deps: LlmDeps = defaultLlmDeps()): Promise<CallResult & { text: string }> {
	return withFallback(deps, req, (ctx, provider) => textWith(ctx, provider, req));
}
