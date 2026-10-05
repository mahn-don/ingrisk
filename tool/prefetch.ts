// Fill the stock of validated items (the same function the cron endpoint runs), one run at a time.
import { randomUUID } from 'node:crypto';
import { jobLocksRepo } from '../src/lib/server/db/repositories/job-locks.ts';
import { DailyCapError, dailyCapFromEnv } from '../src/lib/server/generation/budget.ts';
import { prefetch } from '../src/lib/server/generation/prefetch.ts';
import { DEFAULT_PREFETCH_MAX_CALLS, PREFETCH_LOCK, PREFETCH_STALE_LOCK_MS } from '../src/lib/server/generation/stock.ts';
import { formatSummary } from '../src/lib/server/generation/summary.ts';
import { fail, parseCli, positiveInt } from './lib/cli.ts';
import { world } from './lib/world.ts';

const args = parseCli({
	command: 'npm run prefetch --',
	summary: 'Top up the stock of validated cloze items, error drills and reading passages, cheapest first.',
	usage: [
		`--max-calls N      Stop after N HTTP attempts (default ${DEFAULT_PREFETCH_MAX_CALLS}; LLM_DAILY_CALL_CAP also applies)`,
		'--dry-run          In-memory copy of the content and canned LLM answers: no network, no writes'
	],
	example: '--max-calls 40 --dry-run',
	options: { 'max-calls': { type: 'string', default: String(DEFAULT_PREFETCH_MAX_CALLS) }, 'dry-run': { type: 'boolean' } }
});
const maxCalls = positiveInt('max-calls', args['max-calls']);
let dailyCap: number;
try {
	dailyCap = dailyCapFromEnv(process.env);
} catch (error) {
	fail((error as Error).message);
}

const w = world(args['dry-run']);
const locks = jobLocksRepo(w.db);
const holder = randomUUID();
if (!locks.acquire(PREFETCH_LOCK, holder, new Date(), PREFETCH_STALE_LOCK_MS)) fail('A prefetch run is already in progress.');
try {
	const summary = await prefetch({ maxCalls }, { llm: w.llm, context: w.context, dailyCap });
	console.log('shortfall (cheapest first):');
	if (summary.shortfall.length === 0) console.log('  none: every stock is full');
	for (const s of summary.shortfall) console.log(`  ${s.kind}${s.topic ? ` ${s.topic}` : ''} band ${s.band}: ${s.have}/${s.target}`);
	console.log(`steps run: ${summary.steps.join(', ') || 'none'}`);
	for (const line of formatSummary(summary)) console.log(line);
	const input = summary.llm.usage.reduce((n, u) => n + u.inputTokens, 0);
	const output = summary.llm.usage.reduce((n, u) => n + u.outputTokens, 0);
	console.log(`LLM calls (HTTP attempts): ${summary.llm.calls}; tokens: ${input} input + ${output} output${summary.budgetExhausted ? '; budget reached' : ''}`);
} catch (error) {
	if (error instanceof DailyCapError) fail(error.message);
	throw error;
} finally {
	locks.release(PREFETCH_LOCK, holder);
}
