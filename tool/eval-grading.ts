// Grade the fixtures in test/eval/grading-fixtures.json twice each and report agreement.
import { gradeFixture, gradingMarkdown, gradingSummary, readGradingFixtures } from '../src/lib/server/grading/eval.ts';
import { parseCli } from './lib/cli.ts';
import { world, writeEval } from './lib/world.ts';

const RUNS = 2;
const args = parseCli({
	command: 'npm run eval:grading --',
	summary: `Grade the 12 fixtures in test/eval/grading-fixtures.json ${RUNS} times each with the active provider (live calls).`,
	usage: ['--dry-run          Canned grading answers: checks the plumbing only, no network'],
	example: '',
	options: { 'dry-run': { type: 'boolean' } }
});
const fixtures = readGradingFixtures();
const w = world(args['dry-run'], { needsContent: false });
const results = [];
for (const fixture of fixtures) {
	results.push(await gradeFixture(fixture, RUNS, w.llm));
	process.stdout.write('.');
}
console.log('');
for (const line of gradingSummary(results)) console.log(line);
const at = new Date();
console.log(`Wrote ${writeEval('grading', gradingMarkdown(results, at), at)}`);
