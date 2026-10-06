// One tiny structured call to a provider, with no fallback: `npm run llm:smoke` and the settings
// page's "Kiểm tra kết nối". The error message is already redacted by the LLM layer; only its code
// and message leave this module, never a key.
import { z } from 'zod';
import { type LlmDeps, generateStructured } from './client.ts';
import { LlmError, type LlmErrorCode } from './errors.ts';
import { redact } from './redact.ts';

export const SMOKE_PURPOSE = 'smoke';

export const SmokeWord = z.object({
	word: z.string(),
	cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
	vi_gloss: z.string()
});

export type SmokeResult =
	| { ok: true; latencyMs: number; model: string; data: z.output<typeof SmokeWord>; inputTokens: number; outputTokens: number; attempts: number }
	| { ok: false; latencyMs: number; code: LlmErrorCode | 'unknown'; message: string };

export async function smokeTest(providerId: number, deps: LlmDeps, clock: () => number = () => performance.now()): Promise<SmokeResult> {
	const started = clock();
	try {
		const result = await generateStructured(
			{
				purpose: SMOKE_PURPOSE,
				system: 'You are a concise English-Vietnamese lexicographer.',
				user: 'Give the CEFR level of this English word and a short Vietnamese gloss: {"word": "borrow"}',
				schema: SmokeWord,
				maxTokens: 300,
				providerId,
				fallback: false
			},
			deps
		);
		return {
			ok: true,
			latencyMs: Math.round(clock() - started),
			model: result.model,
			data: result.data,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			attempts: result.attempts
		};
	} catch (error) {
		const latencyMs = Math.round(clock() - started);
		if (error instanceof LlmError) return { ok: false, latencyMs, code: error.code, message: error.message };
		return { ok: false, latencyMs, code: 'unknown', message: redact(error instanceof Error ? error.message : String(error)) };
	}
}
