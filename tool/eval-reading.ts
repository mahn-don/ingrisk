// Evaluation sheet for reading passages: full passages, questions, answers and glossary.
import { cacheRepo } from '../src/lib/server/db/repositories/cache.ts';
import { dailyCapFromEnv, startBudget } from '../src/lib/server/generation/budget.ts';
import { readingMarkdown } from '../src/lib/server/generation/eval-sheets.ts';
import { buildReading } from '../src/lib/server/generation/reading/build.ts';
import { formatSummary } from '../src/lib/server/generation/summary.ts';
import { parseCli, positiveInt } from './lib/cli.ts';
import { world, writeEval } from './lib/world.ts';

const args = parseCli({
	command: 'npm run eval:reading --',
	summary: 'Write a reading evaluation sheet to tmp/eval/: full passages, questions, answers and glossary.',
	usage: [
		'--n N              Passages to show (default 4)',
		'--generate         First build N new passages (spread over bands 1-8)',
		'--max-calls N      Call budget for --generate (default 20)',
		'--dry-run          Generate into an in-memory database with canned LLM answers (implies --generate)'
	],
	example: '--n 4 --generate',
	options: { n: { type: 'string', default: '4' }, generate: { type: 'boolean' }, 'max-calls': { type: 'string', default: '20' }, 'dry-run': { type: 'boolean' } }
});
const n = positiveInt('n', args.n);
const w = world(args['dry-run']);
if (args.generate || args['dry-run']) {
	const budget = startBudget(w.db, new Date(), { maxCalls: positiveInt('max-calls', args['max-calls']), dailyCap: dailyCapFromEnv(process.env) });
	// Spread over the bands: 2, 4, 6, 8, 1, 3, ... so a small n still shows every length range.
	const order = [2, 4, 6, 8, 1, 3, 5, 7];
	const requests = order.slice(0, Math.min(n, 8)).map((band, i) => ({ band, count: Math.ceil((n - i) / 8) }));
	const summary = await buildReading(requests, { llm: w.llm, forms: w.context.forms, blocklist: w.context.blocklist }, { budget });
	for (const line of formatSummary(summary)) console.log(line);
	console.log(`LLM calls: ${budget.calls()}`);
}
const cache = cacheRepo(w.db);
const at = new Date();
const path = writeEval('reading', readingMarkdown(cache.byKind('reading', true), cache.byKind('reading', false), { n, seed: at.toISOString(), generatedAt: at }), at);
console.log(`Wrote ${path}`);
