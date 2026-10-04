// Phase 3 gate: step one card through a fixed rating sequence and print the intervals.
// Run with: node tool/srs-walkthrough.ts   (in-memory database, fuzz off, retention from settings)
import { Rating, type Grade } from 'ts-fsrs';
import { createDb, migrate } from '../src/lib/server/db/client.ts';
import { cardsRepo } from '../src/lib/server/db/repositories/cards.ts';
import { settingsRepo } from '../src/lib/server/db/repositories/settings.ts';
import { lexemes } from '../src/lib/server/db/schema.ts';
import { describeInterval } from '../src/lib/server/srs/preview.ts';
import { newCardFields, ratingName } from '../src/lib/server/srs/mapping.ts';
import { review } from '../src/lib/server/srs/review.ts';

const START = new Date('2026-10-05T02:00:00Z'); // 09:00 in Asia/Ho_Chi_Minh
const SEQUENCE: Grade[] = [
	Rating.Good,
	Rating.Good,
	Rating.Good,
	Rating.Good,
	Rating.Again,
	Rating.Good,
	Rating.Good
];

const db = createDb(':memory:');
migrate(db);
const lexeme = db
	.insert(lexemes)
	.values({ headword: 'walkthrough', forms: ['walkthrough'], source: 'tool', licenseTag: 'none' })
	.returning()
	.get();
const created = cardsRepo(db).insertIfAbsent({ kind: 'cloze', lexemeId: lexeme.id, ...newCardFields(START) });
if (created === undefined) throw new Error('could not create the card');

const ictTime = (date: Date) =>
	new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

const rows: string[][] = [['step', 'rating', 'reviewed at (ICT)', 'state after', 'next interval', 'stability', 'difficulty']];
let at = created.due;
SEQUENCE.forEach((rating, i) => {
	const { card } = review(db, created.id, rating, at, at, { fuzz: false });
	const interval = describeInterval(card.due.getTime() - at.getTime());
	rows.push([
		String(i + 1),
		ratingName(rating),
		ictTime(at),
		card.state,
		`${interval.value} ${interval.unit}${interval.value === 1 ? '' : 's'}`,
		card.stability.toFixed(2),
		card.difficulty.toFixed(2)
	]);
	at = card.due; // next review exactly when due
});

const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
const line = (r: string[]) => `| ${r.map((cell, col) => cell.padEnd(widths[col])).join(' | ')} |`;
console.log(`desired retention ${settingsRepo(db).get().desiredRetention}, fuzz off`);
console.log(line(rows[0]));
console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
for (const r of rows.slice(1)) console.log(line(r));
db.$client.close();
