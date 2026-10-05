// Add (or update, by name) an LLM provider row. The key itself is never stored: only the name of
// the environment variable that holds it.
// Usage: npm run llm:provider:add -- --name Anthropic --base-url https://api.anthropic.com \
//          --model <model-id> --wire-format anthropic [--structured-mode json_schema] \
//          [--env-key-name ANTHROPIC_API_KEY | --no-key] [--fallback] [--activate]
import { parseArgs } from 'node:util';
import { DEFAULT_DATABASE_PATH, getDb } from '../src/lib/server/db/client.ts';
import { providersRepo } from '../src/lib/server/db/repositories/providers.ts';
import { settingsRepo } from '../src/lib/server/db/repositories/settings.ts';
import { STRUCTURED_MODES, WIRE_FORMATS } from '../src/lib/server/db/schema.ts';
import { assertAllowedBaseUrl } from '../src/lib/server/llm/config.ts';

function fail(message: string): never {
	console.error(`llm:provider:add: ${message}`);
	process.exit(1);
}

const { values } = parseArgs({
	options: {
		name: { type: 'string' },
		'base-url': { type: 'string' },
		model: { type: 'string' },
		'wire-format': { type: 'string' },
		'structured-mode': { type: 'string', default: 'json_schema' },
		'env-key-name': { type: 'string' },
		'no-key': { type: 'boolean', default: false },
		fallback: { type: 'boolean', default: false },
		activate: { type: 'boolean', default: false }
	}
});

const name = values.name ?? fail('--name is required');
const baseUrl = values['base-url'] ?? fail('--base-url is required');
const model = values.model ?? fail('--model is required');
const wireFormat = values['wire-format'] ?? fail('--wire-format is required (openai or anthropic)');
const structuredMode = values['structured-mode'] ?? 'json_schema';
if (!(WIRE_FORMATS as readonly string[]).includes(wireFormat)) fail(`--wire-format must be one of ${WIRE_FORMATS.join(', ')}`);
if (!(STRUCTURED_MODES as readonly string[]).includes(structuredMode)) {
	fail(`--structured-mode must be one of ${STRUCTURED_MODES.join(', ')}`);
}
const envKeyName = values['no-key'] ? null : (values['env-key-name'] ?? fail('--env-key-name is required (or --no-key)'));
if (envKeyName !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(envKeyName)) {
	fail('--env-key-name must be an environment variable NAME like OPENAI_API_KEY, never the key itself');
}
try {
	assertAllowedBaseUrl(baseUrl);
} catch (error) {
	fail((error as Error).message);
}

const db = getDb();
const provider = providersRepo(db).upsert({
	name,
	baseUrl,
	model,
	wireFormat: wireFormat as (typeof WIRE_FORMATS)[number],
	structuredMode: structuredMode as (typeof STRUCTURED_MODES)[number],
	envKeyName,
	isFallback: values.fallback
});
if (values.activate) settingsRepo(db).update({ activeProviderId: provider.id });

console.log(`Saved provider #${provider.id} "${provider.name}" in ${process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH}`);
console.log(
	JSON.stringify(
		{ ...provider, active: settingsRepo(db).get().activeProviderId === provider.id },
		null,
		2
	)
);
