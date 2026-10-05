// Write a human evaluation sheet of the cloze pool to tmp/eval/cloze-<timestamp>.md.
// Usage: npm run eval:cloze [-- --n 30]
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { getDb } from '../src/lib/server/db/client.ts';
import { clozeItemsRepo } from '../src/lib/server/db/repositories/cloze-items.ts';
import { evalMarkdown } from '../src/lib/server/generation/cloze/eval.ts';

const { values } = parseArgs({ options: { n: { type: 'string', default: '30' } } });
const n = Number(values.n);
if (!Number.isInteger(n) || n < 1) {
	console.error('--n must be a positive integer');
	process.exit(1);
}

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
