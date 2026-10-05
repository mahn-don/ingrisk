// Evaluation sheet for error-correction drills: accepted sample + 10 rejected with reasons.
import { cacheRepo } from '../src/lib/server/db/repositories/cache.ts';
import { dailyCapFromEnv, startBudget } from '../src/lib/server/generation/budget.ts';
import { DRILL_CODES, buildDrills } from '../src/lib/server/generation/drills/build.ts';
import { drillsMarkdown } from '../src/lib/server/generation/eval-sheets.ts';
import { formatSummary } from '../src/lib/server/generation/summary.ts';
import { parseCli, positiveInt } from './lib/cli.ts';
import { world, writeEval } from './lib/world.ts';

const args = parseCli({
	command: 'npm run eval:drills --',
	summary: 'Write a drill evaluation sheet to tmp/eval/: accepted drills and 10 rejected ones with reasons.',
	usage: [
		'--n N              Accepted drills to show (default 20)',
		'--generate         First build about N new drills (spread over the 9 codes, bands 1-2)',
		'--max-calls N      Call budget for --generate (default 30)',
		'--dry-run          Generate into an in-memory database with canned LLM answers (implies --generate)'
	],
	example: '--n 20 --generate',
	options: { n: { type: 'string', default: '20' }, generate: { type: 'boolean' }, 'max-calls': { type: 'string', default: '30' }, 'dry-run': { type: 'boolean' } }
});
const n = positiveInt('n', args.n);
const w = world(args['dry-run']);
if (args.generate || args['dry-run']) {
	const budget = startBudget(w.db, new Date(), { maxCalls: positiveInt('max-calls', args['max-calls']), dailyCap: dailyCapFromEnv(process.env) });
	const perCode = Math.ceil(n / DRILL_CODES.length);
	const requests = DRILL_CODES.flatMap((topic) => [1, 2].map((band) => ({ topic, band, count: Math.ceil(perCode / 2) })));
	const summary = await buildDrills(requests, { llm: w.llm, ...w.context }, { budget });
	for (const line of formatSummary(summary)) console.log(line);
	console.log(`LLM calls: ${budget.calls()}`);
}
const cache = cacheRepo(w.db);
const at = new Date();
const path = writeEval('drills', drillsMarkdown(cache.byKind('error', true), cache.byKind('error', false), { n, seed: at.toISOString(), generatedAt: at }), at);
console.log(`Wrote ${path}`);
