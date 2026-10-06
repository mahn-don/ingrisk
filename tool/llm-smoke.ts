// Manual smoke test against a real provider (never run in CI): one tiny structured call.
import { getDb } from '../src/lib/server/db/client.ts';
import { providersRepo } from '../src/lib/server/db/repositories/providers.ts';
import { defaultLlmDeps } from '../src/lib/server/llm/client.ts';
import { smokeTest } from '../src/lib/server/llm/smoke.ts';
import { parseCli } from './lib/cli.ts';

const values = parseCli({
	command: 'npm run llm:smoke --',
	summary: 'One live structured call to a provider (manual; never in CI). Uses the real key from the environment.',
	usage: ['--provider NAME    The provider to call (required)'],
	example: '--provider Anthropic',
	options: { provider: { type: 'string' } }
});
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

const result = await smokeTest(provider.id, { ...defaultLlmDeps(), db });
if (!result.ok) {
	console.error(`smoke test failed [${result.code}] after ${result.latencyMs} ms: ${result.message}`);
	process.exit(1);
}
console.log(`provider: ${provider.name} (${provider.wireFormat}, ${provider.structuredMode}), model: ${result.model}`);
console.log('result:', JSON.stringify(result.data, null, 2));
console.log(`usage: ${result.inputTokens} input + ${result.outputTokens} output tokens`);
console.log(`generations: ${result.attempts}, latency: ${result.latencyMs} ms`);
