// LLM calls and tokens per day (ICT) x purpose x model, from llm_calls. No cost estimates.
import { getDb } from '../src/lib/server/db/client.ts';
import { llmCallsRepo } from '../src/lib/server/db/repositories/llm-calls.ts';
import { parseCli, positiveInt } from './lib/cli.ts';

const args = parseCli({
	command: 'npm run llm:usage --',
	summary: 'LLM calls (HTTP attempts) and input/output tokens per day x purpose x model, from llm_calls.',
	usage: ['--days N           Days to cover, today included (default 7; days are Asia/Ho_Chi_Minh)'],
	example: '--days 30',
	options: { days: { type: 'string', default: '7' } }
});
const days = positiveInt('days', args.days);

// Midnight in ICT (UTC+7) `days - 1` days ago.
const ICT_MS = 7 * 3_600_000;
const todayStart = Math.floor((Date.now() + ICT_MS) / 86_400_000) * 86_400_000 - ICT_MS;
const since = new Date(todayStart - (days - 1) * 86_400_000);
const rows = llmCallsRepo(getDb()).usageByDay(since);

const table = [['day', 'purpose', 'model', 'calls', 'input tokens', 'output tokens']];
for (const r of rows) table.push([r.day, r.purpose, r.model, String(r.calls), String(r.inputTokens), String(r.outputTokens)]);
const total = rows.reduce((t, r) => ({ calls: t.calls + r.calls, input: t.input + r.inputTokens, output: t.output + r.outputTokens }), { calls: 0, input: 0, output: 0 });
table.push(['total', '', '', String(total.calls), String(total.input), String(total.output)]);
const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
const line = (r: string[]) => r.map((cell, c) => (c >= 3 ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join('  ');
console.log(`LLM usage since ${since.toISOString()} (${days} day${days === 1 ? '' : 's'}, ICT):`);
console.log(line(table[0]));
for (const r of table.slice(1)) console.log(line(r));
