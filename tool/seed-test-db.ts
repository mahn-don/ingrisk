// Build a throwaway database for the e2e tests and the screenshots (canned LLM, no network).
import { seedTestDatabase } from './lib/test-content.ts';
import { fail, parseCli, positiveInt } from './lib/cli.ts';

const args = parseCli({
	command: 'npm run test:seed --',
	summary: 'Create a test database: migrations, the content, and a cloze pool built with canned LLM responses. Overwrites the file.',
	usage: ['--db PATH          Database file to (re)create (required; never data/app.db)', '--per-band N       Cloze items to build per band (default 50)'],
	example: '--db tmp/e2e/placement.db --per-band 50',
	options: { db: { type: 'string' }, 'per-band': { type: 'string', default: '50' } }
});
if (args.db === undefined) fail('--db is required');
if (/(^|\/)data\/app\.db$/.test(args.db)) fail('Refusing to overwrite the app database');
const started = Date.now();
const pool = await seedTestDatabase(args.db, { clozePerBand: positiveInt('per-band', args['per-band']) });
console.log(`Seeded ${args.db} in ${((Date.now() - started) / 1000).toFixed(1)} s; validated cloze items per band: ${[...pool].map(([b, n]) => `${b}:${n}`).join(' ')}`);
