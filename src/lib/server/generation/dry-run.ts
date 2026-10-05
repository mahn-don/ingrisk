// The --dry-run world for the CLIs (never imported by app code): an in-memory database with the
// content imported, a keyless provider and the canned LLM. Nothing touches the network or data/app.db.
import { type Db, createDb, migrate } from '../db/client.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import type { LlmDeps } from '../llm/client.ts';
import { defaultTransportDeps } from '../llm/transport.ts';
import { CANNED_MODEL, cannedFetch } from './canned-llm.ts';
import { importContent } from './content-files.ts';
import { type GenerationContext, loadGenerationContext } from './context.ts';

export function createDryRun(): { db: Db; llm: LlmDeps; context: GenerationContext } {
	const db = createDb(':memory:');
	migrate(db);
	importContent(db);
	const provider = providersRepo(db).upsert({
		name: 'dry-run',
		baseUrl: 'http://localhost:9/v1',
		model: CANNED_MODEL,
		wireFormat: 'openai',
		structuredMode: 'json_schema',
		envKeyName: null
	});
	settingsRepo(db).update({ activeProviderId: provider.id });
	const context = loadGenerationContext(db);
	const fetch = cannedFetch({ forms: context.forms, blocklist: context.blocklist, isWord: context.isWord, corpus: context.corpus });
	// Not defaultLlmDeps(): that would open data/app.db.
	return { db, llm: { ...defaultTransportDeps(), db, env: {}, now: () => new Date(), fetch }, context };
}
