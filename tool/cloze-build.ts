// Build the cloze pool: candidates -> LLM distractors -> rules -> blind critic -> store.
import { getDb } from '../src/lib/server/db/client.ts';
import { clozeItemsRepo } from '../src/lib/server/db/repositories/cloze-items.ts';
import { lexemesRepo } from '../src/lib/server/db/repositories/lexemes.ts';
import { providersRepo } from '../src/lib/server/db/repositories/providers.ts';
import { CLOZE_GAP_TYPES } from '../src/lib/server/db/schema.ts';
import { DailyCapError, dailyCapFromEnv } from '../src/lib/server/generation/budget.ts';
import { buildCloze, formatSummary } from '../src/lib/server/generation/cloze/build.ts';
import type { GapType } from '../src/lib/server/generation/cloze/candidates.ts';
import { loadGenerationContext } from '../src/lib/server/generation/context.ts';
import { createDryRun } from '../src/lib/server/generation/dry-run.ts';
import { tokenize, withGap } from '../src/lib/server/generation/tokens.ts';
import { defaultLlmDeps } from '../src/lib/server/llm/client.ts';
import { fail, parseCli, positiveInt } from './lib/cli.ts';

const args = parseCli({
	command: 'npm run cloze:build --',
	summary: 'Build validated cloze items from Tatoeba sentences (LLM distractors and a blind critic).',
	usage: [
		'--bands 1-3        Item bands to build, a band or a range (default 1-8)',
		`--types a,b        Gap types: ${CLOZE_GAP_TYPES.join(', ')} (default all)`,
		'--limit N          Candidates to process (default 200)',
		'--provider NAME    Use this provider, without fallback (default: the active one)',
		'--max-calls N      Stop after N HTTP attempts (default 50; LLM_DAILY_CALL_CAP also applies)',
		'--dry-run          In-memory copy of the content and canned LLM answers: no network, no writes'
	],
	example: '--bands 1-3 --limit 40 --max-calls 12',
	options: {
		bands: { type: 'string' },
		types: { type: 'string' },
		limit: { type: 'string', default: '200' },
		provider: { type: 'string' },
		'max-calls': { type: 'string', default: '50' },
		'dry-run': { type: 'boolean' }
	}
});

const limit = positiveInt('limit', args.limit);
const maxCalls = positiveInt('max-calls', args['max-calls']);
let bands: [number, number] | undefined;
if (args.bands !== undefined) {
	const m = /^(\d)(?:-(\d))?$/.exec(args.bands);
	if (m === null) fail('--bands must look like 2 or 1-3');
	bands = [Number(m[1]), Number(m[2] ?? m[1])];
	if (bands[0] < 1 || bands[1] > 8 || bands[0] > bands[1]) fail('--bands must be within 1-8, low to high');
}
let types: GapType[] | undefined;
if (args.types !== undefined) {
	types = args.types.split(',').map((t) => t.trim()) as GapType[];
	const unknown = types.filter((t) => !(CLOZE_GAP_TYPES as readonly string[]).includes(t));
	if (unknown.length > 0) fail(`Unknown --types: ${unknown.join(', ')} (allowed: ${CLOZE_GAP_TYPES.join(', ')})`);
}
let dailyCap: number;
try {
	dailyCap = dailyCapFromEnv(process.env);
} catch (error) {
	fail((error as Error).message);
}

let world;
let providerId: number | undefined;
if (args['dry-run']) {
	if (args.provider !== undefined) fail('--provider cannot be combined with --dry-run');
	world = createDryRun();
	console.log('Dry run: in-memory database with the imported content, canned LLM responses, no network.');
} else {
	const db = getDb();
	if (lexemesRepo(db).all().length === 0) fail('No lexemes in the database. Run npm run content:import first.');
	const providers = providersRepo(db);
	const provider = args.provider === undefined ? providers.active() : providers.byName(args.provider);
	if (provider === undefined) {
		fail(args.provider === undefined ? 'No active LLM provider. Add one with npm run llm:provider:add.' : `No provider named "${args.provider}".`);
	}
	if (provider.envKeyName !== null && !process.env[provider.envKeyName]) {
		fail(`${provider.envKeyName} is not set. Put it in .env (never commit it) or export it, then retry.`);
	}
	providerId = args.provider === undefined ? undefined : provider.id;
	world = { db, llm: { ...defaultLlmDeps(), db }, context: loadGenerationContext(db) };
	console.log(`Provider: ${provider.name} (${provider.model}); max calls ${maxCalls}; daily cap ${dailyCap}.`);
}

try {
	const summary = await buildCloze(
		{ bands, types, limit, providerId, maxCalls, dailyCap },
		{ llm: world.llm, isWord: world.context.isWord, blocklist: world.context.blocklist }
	);
	for (const line of formatSummary(summary)) console.log(line);
	if (args['dry-run']) {
		console.log('Sample of validated items:');
		for (const item of clozeItemsRepo(world.db).byValidated(true).slice(0, 3)) {
			console.log(`  ${withGap(item.enText, tokenize(item.enText), item.tokenIndex)}  [${item.options.join(' / ')}] -> ${item.answer}`);
		}
	}
} catch (error) {
	if (error instanceof DailyCapError) fail(error.message);
	throw error;
}
