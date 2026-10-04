// Manual smoke test against a real provider (never run in CI): one tiny structured call.
// Usage: npm run llm:smoke -- --provider <name>
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { getDb } from '../src/lib/server/db/client.ts';
import { llmCallsRepo } from '../src/lib/server/db/repositories/llm-calls.ts';
import { providersRepo } from '../src/lib/server/db/repositories/providers.ts';
import { defaultLlmDeps, generateStructured } from '../src/lib/server/llm/client.ts';
import { LlmError } from '../src/lib/server/llm/errors.ts';

const { values } = parseArgs({ options: { provider: { type: 'string' } } });
const db = getDb();
const providers = providersRepo(db);
if (values.provider === undefined) {
	const names = providers.list().map((p) => p.name);
	console.error(`Usage: npm run llm:smoke -- --provider <name>   (configured: ${names.join(', ') || 'none'})`);
	process.exit(1);
}
const provider = providers.byName(values.provider);
if (provider === undefined) {
	console.error(`No provider named "${values.provider}". Add one with npm run llm:provider:add.`);
	process.exit(1);
}
if (provider.envKeyName !== null && !process.env[provider.envKeyName]) {
	console.error(`${provider.envKeyName} is not set. Put it in .env (never commit it) or export it, then retry.`);
	process.exit(1);
}

const Word = z.object({
	word: z.string(),
	cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
	vi_gloss: z.string()
});

const started = performance.now();
const since = new Date(Date.now() - 1000);
try {
	const result = await generateStructured(
		{
			purpose: 'smoke',
			system: 'You are a concise English-Vietnamese lexicographer.',
			user: 'Give the CEFR level of the English word "borrow" and a short Vietnamese gloss.',
			schema: Word,
			maxTokens: 300,
			providerId: provider.id,
			fallback: false
		},
		{ ...defaultLlmDeps(), db }
	);
	const latency = Math.round(performance.now() - started);
	console.log(`provider: ${provider.name} (${provider.wireFormat}, ${provider.structuredMode}), model: ${result.model}`);
	console.log('result:', JSON.stringify(result.data, null, 2));
	console.log(`usage: ${result.usage.inputTokens} input + ${result.usage.outputTokens} output tokens`);
	console.log(`generations: ${result.attempts}, HTTP attempts: ${llmCallsRepo(db).countSince(since)}, latency: ${latency} ms`);
} catch (error) {
	const code = error instanceof LlmError ? error.code : 'unknown';
	console.error(`smoke test failed [${code}]: ${(error as Error).message}`);
	process.exit(1);
}
