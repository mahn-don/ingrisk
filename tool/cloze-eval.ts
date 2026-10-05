// Write a human evaluation sheet of the cloze pool to tmp/eval/cloze-<timestamp>.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDb } from '../src/lib/server/db/client.ts';
import { clozeItemsRepo } from '../src/lib/server/db/repositories/cloze-items.ts';
import { evalMarkdown } from '../src/lib/server/generation/cloze/eval.ts';
import { parseCli, positiveInt } from './lib/cli.ts';

const values = parseCli({
	command: 'npm run eval:cloze --',
	summary: 'Write a cloze evaluation sheet (validated sample + 10 rejected items) to tmp/eval/.',
	usage: ['--n N              Validated items to sample (default 30)'],
	example: '--n 30',
	options: { n: { type: 'string', default: '30' } }
});
const n = positiveInt('n', values.n);

const repo = clozeItemsRepo(getDb());
const validated = repo.byValidated(true);
const rejected = repo.byValidated(false);
const generatedAt = new Date();
const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');
const path = `tmp/eval/cloze-${stamp}.md`;
mkdirSync('tmp/eval', { recursive: true });
writeFileSync(path, evalMarkdown(validated, rejected, { n, seed: stamp, generatedAt }));
console.log(`Wrote ${path}: ${Math.min(n, validated.length)} of ${validated.length} validated items, ${Math.min(10, rejected.length)} of ${rejected.length} rejected.`);
if (validated.length < n) console.log(`Note: the pool has fewer than ${n} validated items; run npm run cloze:build first.`);
