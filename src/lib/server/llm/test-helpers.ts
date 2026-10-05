// Test fixtures: an in-memory database with providers, and a scripted fake fetch. No network.
import type { Db } from '../db/client.ts';
import { type ProviderInput, providersRepo } from '../db/repositories/providers.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { createTestDb } from '../db/test-db.ts';
import type { LlmDeps } from './client.ts';

export const ANTHROPIC_KEY = 'sk-ant-api03-FAKEanthropicKEY1234567890abcdef';
export const OPENAI_KEY = 'sk-proj-FAKEopenaiKEY0987654321zyxwvu';

export const anthropicProvider: ProviderInput = {
	name: 'Anthropic',
	baseUrl: 'https://api.anthropic.com',
	model: 'claude-test',
	wireFormat: 'anthropic',
	structuredMode: 'json_schema',
	envKeyName: 'ANTHROPIC_API_KEY'
};

export const openaiProvider: ProviderInput = {
	name: 'OpenAI',
	baseUrl: 'https://api.openai.com/v1',
	model: 'gpt-test',
	wireFormat: 'openai',
	structuredMode: 'json_schema',
	envKeyName: 'OPENAI_API_KEY'
};

/** A database with the given providers; the first is active. */
export function setupProviders(primary: ProviderInput, fallback?: ProviderInput): { db: Db; primaryId: number; fallbackId?: number } {
	const db = createTestDb();
	const providers = providersRepo(db);
	const p = providers.upsert(primary);
	const f = fallback ? providers.upsert({ ...fallback, isFallback: true }) : undefined;
	settingsRepo(db).update({ activeProviderId: p.id });
	return { db, primaryId: p.id, fallbackId: f?.id };
}

export interface RecordedRequest {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

export type Scripted =
	| { status: number; body?: unknown; headers?: Record<string, string> }
	| { networkError: string }
	| { hang: true };

/** A fetch that answers from a script, in order, and records every request. */
export function scriptedFetch(script: Scripted[]) {
	const requests: RecordedRequest[] = [];
	const queue = [...script];
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push({
			url: String(input),
			headers: { ...(init?.headers as Record<string, string>) },
			body: JSON.parse(String(init?.body))
		});
		const next = queue.shift();
		if (next === undefined) throw new Error('fake fetch: script exhausted');
		if ('networkError' in next) throw new TypeError(next.networkError);
		if ('hang' in next) {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			});
		}
		const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
		return new Response(text, { status: next.status, headers: next.headers });
	}) as typeof globalThis.fetch;
	return { fetch, requests, remaining: () => queue.length };
}

/** Deps with instant sleeps (recorded), fixed jitter, a fake clock and the fake keys set. */
export function testDeps(db: Db, fetch: typeof globalThis.fetch, overrides: Partial<LlmDeps> = {}) {
	const sleeps: number[] = [];
	let tick = 0;
	const deps: LlmDeps = {
		db,
		fetch,
		env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: OPENAI_KEY },
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		random: () => 0.5,
		clock: () => (tick += 25),
		timeoutMs: 60_000,
		now: () => new Date('2026-10-05T02:00:00Z'),
		...overrides
	};
	return { deps, sleeps };
}

// Response builders ------------------------------------------------------------------------------

export function anthropicText(text: string, extra: Record<string, unknown> = {}) {
	return {
		status: 200,
		body: {
			id: 'msg_1',
			type: 'message',
			role: 'assistant',
			model: 'claude-test-20261001',
			content: [{ type: 'text', text }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 120, output_tokens: 30 },
			...extra
		}
	};
}

export function anthropicToolUse(input: unknown) {
	return {
		status: 200,
		body: {
			model: 'claude-test-20261001',
			content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_output', input }],
			stop_reason: 'tool_use',
			usage: { input_tokens: 140, output_tokens: 40 }
		}
	};
}

export function openaiContent(content: string | null, message: Record<string, unknown> = {}, finishReason = 'stop') {
	return {
		status: 200,
		body: {
			id: 'chatcmpl-1',
			model: 'gpt-test-2026',
			choices: [{ index: 0, message: { role: 'assistant', content, ...message }, finish_reason: finishReason }],
			usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 }
		}
	};
}

export function openaiToolCall(args: string) {
	return openaiContent(null, {
		tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'record_output', arguments: args } }]
	}, 'tool_calls');
}
