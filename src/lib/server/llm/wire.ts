// Wire formats: turning one generation request into an HTTP request, and a response body into
// a normalized result. Anthropic Messages API and OpenAI-compatible Chat Completions.
import type { ZodType } from 'zod';
import type { STRUCTURED_MODES } from '../db/schema.ts';
import type { ProviderConfig } from './config.ts';
import { LlmBadResponseError } from './errors.ts';
import { toProviderSchema } from './schema.ts';

export type StructuredMode = (typeof STRUCTURED_MODES)[number];
export type CallMode = StructuredMode | 'text';

export const ANTHROPIC_VERSION = '2023-06-01';
/** Name of the single forced tool in `tool` mode. */
export const OUTPUT_TOOL_NAME = 'record_output';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface GenerationRequest {
	system: string;
	messages: ChatMessage[];
	maxTokens: number;
	/** Omitted from the request when undefined. */
	temperature?: number;
	mode: CallMode;
	/** Required for structured modes. */
	schema?: ZodType;
	/** Used to name the schema / tool for the provider. */
	purpose: string;
}

export interface HttpRequest {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
}

export type RawOutput = { kind: 'object'; value: unknown } | { kind: 'text'; value: string };

export interface GenerationResponse {
	output: RawOutput;
	/** Set when the model refused; carries the provider's explanation if any. */
	refusal: { detail: string | null } | null;
	usage: Usage;
	model: string;
	stopReason: string | null;
}

const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

/** A provider-safe identifier for schema / tool names. */
export const schemaName = (purpose: string) => purpose.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'output';

/** System prompt addition for json_prompt mode: the schema itself, and "JSON only". */
export function jsonPromptInstructions(schema: ZodType): string {
	return [
		'Respond with a single JSON object and nothing else (no prose, no code fences).',
		'It must match this JSON Schema:',
		JSON.stringify(toProviderSchema(schema, 'prompt'))
	].join('\n');
}

function requireSchema(req: GenerationRequest): ZodType {
	if (req.schema === undefined) throw new Error(`mode ${req.mode} needs a schema`);
	return req.schema;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

// --- Anthropic Messages API ---------------------------------------------------------------------

export function buildAnthropicRequest(provider: ProviderConfig, key: string | undefined, req: GenerationRequest): HttpRequest {
	const system = req.mode === 'json_prompt' ? `${req.system}\n\n${jsonPromptInstructions(requireSchema(req))}` : req.system;
	const body: Record<string, unknown> = {
		model: provider.model,
		max_tokens: req.maxTokens,
		system,
		messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
	};
	// Newer Claude models reject any temperature other than 1.0, so it is only sent when set.
	if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.mode === 'json_schema') {
		// GA structured outputs. (The beta `output_format` parameter is deprecated; never use it.)
		body.output_config = { format: { type: 'json_schema', schema: toProviderSchema(requireSchema(req), 'anthropic') } };
	} else if (req.mode === 'tool') {
		body.tools = [
			{
				name: OUTPUT_TOOL_NAME,
				description: `Record the ${req.purpose} result.`,
				input_schema: toProviderSchema(requireSchema(req), 'anthropic')
			}
		];
		body.tool_choice = { type: 'tool', name: OUTPUT_TOOL_NAME };
	}
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'anthropic-version': ANTHROPIC_VERSION
	};
	if (key !== undefined) headers['x-api-key'] = key;
	return { url: joinUrl(provider.baseUrl, '/v1/messages'), headers, body };
}

export function parseAnthropicResponse(body: unknown, mode: CallMode): GenerationResponse {
	const root = asRecord(body);
	const content = root?.content;
	if (root === undefined || !Array.isArray(content)) throw new LlmBadResponseError('Anthropic response has no content array');
	const usage = asRecord(root.usage);
	const stopReason = typeof root.stop_reason === 'string' ? root.stop_reason : null;
	const blocks = content.map(asRecord).filter((b) => b !== undefined);
	const text = blocks
		.filter((b) => b.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text as string)
		.join('');
	const toolUse = blocks.find((b) => b.type === 'tool_use');
	let refusal: GenerationResponse['refusal'] = null;
	if (stopReason === 'refusal') {
		const details = asRecord(root.stop_details);
		const detail = [details?.category, details?.explanation].filter((d) => typeof d === 'string').join(': ');
		refusal = { detail: detail || text || null };
	}
	const output: RawOutput =
		mode === 'tool' && toolUse !== undefined ? { kind: 'object', value: toolUse.input } : { kind: 'text', value: text };
	return {
		output,
		refusal,
		usage: {
			inputTokens: Number(usage?.input_tokens ?? 0),
			outputTokens: Number(usage?.output_tokens ?? 0)
		},
		model: typeof root.model === 'string' ? root.model : '',
		stopReason
	};
}

// --- OpenAI-compatible Chat Completions --------------------------------------------------------

/** api.openai.com takes `max_completion_tokens`; other compatible servers expect `max_tokens`. */
function maxTokensField(provider: ProviderConfig): string {
	return new URL(provider.baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
}

export function buildOpenAiRequest(provider: ProviderConfig, key: string | undefined, req: GenerationRequest): HttpRequest {
	const system = req.mode === 'json_prompt' ? `${req.system}\n\n${jsonPromptInstructions(requireSchema(req))}` : req.system;
	const body: Record<string, unknown> = {
		model: provider.model,
		messages: [{ role: 'system', content: system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
		[maxTokensField(provider)]: req.maxTokens
	};
	if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.mode === 'json_schema') {
		body.response_format = {
			type: 'json_schema',
			json_schema: { name: schemaName(req.purpose), schema: toProviderSchema(requireSchema(req), 'openai-strict'), strict: true }
		};
	} else if (req.mode === 'tool') {
		body.tools = [
			{
				type: 'function',
				function: {
					name: OUTPUT_TOOL_NAME,
					description: `Record the ${req.purpose} result.`,
					parameters: toProviderSchema(requireSchema(req), 'openai-strict'),
					strict: true
				}
			}
		];
		body.tool_choice = { type: 'function', function: { name: OUTPUT_TOOL_NAME } };
	}
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (key !== undefined) headers.authorization = `Bearer ${key}`;
	return { url: joinUrl(provider.baseUrl, '/chat/completions'), headers, body };
}

export function parseOpenAiResponse(body: unknown, mode: CallMode): GenerationResponse {
	const root = asRecord(body);
	const choice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : undefined;
	const message = asRecord(choice?.message);
	if (root === undefined || message === undefined) throw new LlmBadResponseError('Chat completion has no message');
	const usage = asRecord(root.usage);
	const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
	let refusal: GenerationResponse['refusal'] = null;
	if (typeof message.refusal === 'string' && message.refusal !== '') refusal = { detail: message.refusal };
	else if (finishReason === 'content_filter') refusal = { detail: 'content_filter' };

	let output: RawOutput = { kind: 'text', value: typeof message.content === 'string' ? message.content : '' };
	const call = Array.isArray(message.tool_calls) ? asRecord(message.tool_calls[0]) : undefined;
	const args = asRecord(call?.function)?.arguments;
	if (mode === 'tool' && typeof args === 'string') {
		// Tool arguments arrive as a JSON string.
		try {
			output = { kind: 'object', value: JSON.parse(args) };
		} catch {
			output = { kind: 'text', value: args };
		}
	}
	return {
		output,
		refusal,
		usage: {
			inputTokens: Number(usage?.prompt_tokens ?? 0),
			outputTokens: Number(usage?.completion_tokens ?? 0)
		},
		model: typeof root.model === 'string' ? root.model : '',
		stopReason: finishReason
	};
}

export function buildRequest(provider: ProviderConfig, key: string | undefined, req: GenerationRequest): HttpRequest {
	return provider.wireFormat === 'anthropic'
		? buildAnthropicRequest(provider, key, req)
		: buildOpenAiRequest(provider, key, req);
}

export function parseResponse(provider: ProviderConfig, body: unknown, mode: CallMode): GenerationResponse {
	return provider.wireFormat === 'anthropic' ? parseAnthropicResponse(body, mode) : parseOpenAiResponse(body, mode);
}
