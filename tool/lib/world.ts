// The database + LLM a generation tool works with: the real ones, or the --dry-run world.
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Db, getDb } from '../../src/lib/server/db/client.ts';
import { lexemesRepo } from '../../src/lib/server/db/repositories/lexemes.ts';
import { providersRepo } from '../../src/lib/server/db/repositories/providers.ts';
import { type GenerationContext, loadGenerationContext } from '../../src/lib/server/generation/context.ts';
import { createDryRun } from '../../src/lib/server/generation/dry-run.ts';
import { type LlmDeps, defaultLlmDeps } from '../../src/lib/server/llm/client.ts';
import { fail } from './cli.ts';

export interface World {
	db: Db;
	llm: LlmDeps;
	context: GenerationContext;
	dryRun: boolean;
}

/** The app database with the active provider, after checking content and key are in place. */
export function liveWorld(options: { needsContent?: boolean } = {}): World {
	const db = getDb();
	if (options.needsContent !== false && lexemesRepo(db).all().length === 0) {
		fail('No lexemes in the database. Run npm run content:import first.');
	}
	const provider = providersRepo(db).active();
	if (provider === undefined) fail('No active LLM provider. Add one with npm run llm:provider:add -- ... --activate.');
	if (provider.envKeyName !== null && !process.env[provider.envKeyName]) {
		fail(`${provider.envKeyName} is not set. Put it in .env (never commit it) or export it, then retry.`);
	}
	console.log(`Provider: ${provider.name} (${provider.model}).`);
	return { db, llm: { ...defaultLlmDeps(), db }, context: loadGenerationContext(db), dryRun: false };
}

export function world(dryRun: boolean, options: { needsContent?: boolean } = {}): World {
	if (!dryRun) return liveWorld(options);
	console.log('Dry run: in-memory database with the imported content, canned LLM responses, no network.');
	return { ...createDryRun(), dryRun: true };
}

/** Write tmp/eval/<name>-<timestamp>.md and return its path. */
export function writeEval(name: string, markdown: string, at: Date): string {
	const path = `tmp/eval/${name}-${at.toISOString().replace(/[:.]/g, '-')}.md`;
	mkdirSync('tmp/eval', { recursive: true });
	writeFileSync(path, markdown);
	return path;
}
