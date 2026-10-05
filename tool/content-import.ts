// Import the Phase 1 content files into the database. Idempotent: a second run changes nothing.
import { DEFAULT_DATABASE_PATH, getDb } from '../src/lib/server/db/client.ts';
import { importContent } from '../src/lib/server/generation/content-files.ts';
import { parseCli } from './lib/cli.ts';

const values = parseCli({
	command: 'npm run content:import --',
	summary: 'Upsert the Phase 1 content JSON (NGSL lexemes, Tatoeba sentences) into the database. Idempotent.',
	usage: ['--reblock          Re-apply the current blocklist to every sentence (new sentences always get it)'],
	example: '--reblock',
	options: { reblock: { type: 'boolean' } }
});

console.log(`Importing into ${process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH}`);
const { lexemes, sentences } = importContent(getDb(), { reblock: values.reblock });
console.log(
	`lexemes: ${lexemes.inserted} inserted, ${lexemes.updated} updated, ${lexemes.unchanged} unchanged` +
		` (supplementary skipped as already ranked: ${lexemes.skippedSupplementary.join(', ') || 'none'})`
);
console.log(
	`sentences: ${sentences.inserted} inserted, ${sentences.updated} updated, ${sentences.unchanged} unchanged` +
		(values.reblock ? ` (reblock: ${sentences.newlyBlocked} newly blocked, ${sentences.unblocked} unblocked)` : '')
);
console.log(`blocked sentences: ${sentences.blockedTotal}; top matches:`);
for (const [term, n] of sentences.topMatches) console.log(`  ${term}: ${n}`);
