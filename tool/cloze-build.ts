// Build the cloze pool: candidates -> LLM distractors -> rules -> blind critic -> store.
// Usage: npm run cloze:build -- [--bands 1-3] [--types lexical,article,preposition,verb_form]
//        [--limit 200] [--provider name] [--max-calls 50] [--dry-run]
// --dry-run works on an in-memory copy of the content with a canned LLM: no network, no writes.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import wordListPath from 'word-list';
import { type Db, createDb, getDb, migrate } from '../src/lib/server/db/client.ts';
import { clozeItemsRepo } from '../src/lib/server/db/repositories/cloze-items.ts';
import { lexemesRepo } from '../src/lib/server/db/repositories/lexemes.ts';
import { providersRepo } from '../src/lib/server/db/repositories/providers.ts';
import { sentencesRepo } from '../src/lib/server/db/repositories/sentences.ts';
import { settingsRepo } from '../src/lib/server/db/repositories/settings.ts';
import { CLOZE_GAP_TYPES } from '../src/lib/server/db/schema.ts';
import { DEFAULT_DAILY_CALL_CAP, DailyCapError, buildCloze, formatSummary } from '../src/lib/server/generation/cloze/build.ts';
import { CANNED_MODEL, cannedFetch } from '../src/lib/server/generation/cloze/canned-llm.ts';
import type { GapType } from '../src/lib/server/generation/cloze/candidates.ts';
import { importContent, loadLexicon } from '../src/lib/server/generation/content-files.ts';
import type { FormIndex } from '../src/lib/server/generation/forms.ts';
import { tokenize, withGap } from '../src/lib/server/generation/tokens.ts';
import { type LlmDeps, defaultLlmDeps } from '../src/lib/server/llm/client.ts';

const wordList = new Set(readFileSync(wordListPath, 'utf8').split('\n'));
/** The word list or an NGSL headword (NGSL forms include nonstandard ones like "makeing"). */
const realWord = (forms: FormIndex) => (word: string) => wordList.has(word) || forms.formsOf.has(word);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

const { values } = parseArgs({
	options: {
		bands: { type: 'string' },
		types: { type: 'string' },
		limit: { type: 'string', default: '200' },
		provider: { type: 'string' },
		'max-calls': { type: 'string', default: '50' },
		'dry-run': { type: 'boolean', default: false }
	}
});

const positiveInt = (name: string, value: string) => {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a positive integer`);
	return n;
};
const limit = positiveInt('limit', values.limit);
const maxCalls = positiveInt('max-calls', values['max-calls']);
let bands: [number, number] | undefined;
if (values.bands !== undefined) {
	const m = /^(\d)(?:-(\d))?$/.exec(values.bands);
	if (m === null) fail('--bands must look like 2 or 1-3');
	bands = [Number(m[1]), Number(m[2] ?? m[1])];
	if (bands[0] < 1 || bands[1] > 8 || bands[0] > bands[1]) fail('--bands must be within 1-8, low to high');
}
let types: GapType[] | undefined;
if (values.types !== undefined) {
	types = values.types.split(',').map((t) => t.trim()) as GapType[];
	const unknown = types.filter((t) => !(CLOZE_GAP_TYPES as readonly string[]).includes(t));
	if (unknown.length > 0) fail(`Unknown --types: ${unknown.join(', ')} (allowed: ${CLOZE_GAP_TYPES.join(', ')})`);
}
const capRaw = process.env.LLM_DAILY_CALL_CAP;
const dailyCap = capRaw === undefined || capRaw.trim() === '' ? DEFAULT_DAILY_CALL_CAP : positiveInt('LLM_DAILY_CALL_CAP', capRaw);

let db: Db;
let llm: LlmDeps;
let providerId: number | undefined;
if (values['dry-run']) {
	if (values.provider !== undefined) fail('--provider cannot be combined with --dry-run');
	db = createDb(':memory:');
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
	const { forms, blocklist } = loadLexicon(db);
	const knownSentences = new Set(sentencesRepo(db).all().map((s) => s.enText));
	llm = { ...defaultLlmDeps(), db, env: {}, fetch: cannedFetch({ forms, blocklist, isWord: realWord(forms), knownSentences }) };
	console.log('Dry run: in-memory database with the imported content, canned LLM responses, no network.');
} else {
	db = getDb();
	if (lexemesRepo(db).all().length === 0) fail('No lexemes in the database. Run npm run content:import first.');
	const providers = providersRepo(db);
	const provider = values.provider === undefined ? providers.active() : providers.byName(values.provider);
	if (provider === undefined) {
		fail(values.provider === undefined ? 'No active LLM provider. Add one with npm run llm:provider:add.' : `No provider named "${values.provider}".`);
	}
	if (provider.envKeyName !== null && !process.env[provider.envKeyName]) {
		fail(`${provider.envKeyName} is not set. Put it in .env (never commit it) or export it, then retry.`);
	}
	providerId = values.provider === undefined ? undefined : provider.id;
	llm = { ...defaultLlmDeps(), db };
	console.log(`Provider: ${provider.name} (${provider.model}); max calls ${maxCalls}; daily cap ${dailyCap}.`);
}

const { forms, blocklist } = loadLexicon(db);
const isWord = realWord(forms);

try {
	const summary = await buildCloze({ bands, types, limit, providerId, maxCalls, dailyCap }, { llm, isWord, blocklist });
	for (const line of formatSummary(summary)) console.log(line);
	if (values['dry-run']) {
		console.log('Sample of validated items:');
		for (const item of clozeItemsRepo(db).byValidated(true).slice(0, 3)) {
			console.log(`  ${withGap(item.enText, tokenize(item.enText), item.tokenIndex)}  [${item.options.join(' / ')}] -> ${item.answer}`);
		}
	}
} catch (error) {
	if (error instanceof DailyCapError) fail(error.message);
	throw error;
}
