// A throwaway database for the e2e tests and the screenshots: migrated, the content imported, and a
// validated cloze pool built with the canned LLM (no network, never data/app.db).
import { rmSync } from 'node:fs';
import { createDb, migrate } from '../../src/lib/server/db/client.ts';
import { cardsRepo } from '../../src/lib/server/db/repositories/cards.ts';
import { clozeItemsRepo } from '../../src/lib/server/db/repositories/cloze-items.ts';
import { newCardFields } from '../../src/lib/server/srs/mapping.ts';
import { appLlmDeps } from '../../src/lib/server/generation/app-llm.ts';
import { unlimitedBudget } from '../../src/lib/server/generation/batch.ts';
import { buildCloze } from '../../src/lib/server/generation/cloze/build.ts';
import { DRILL_CODES, buildDrills } from '../../src/lib/server/generation/drills/build.ts';
import { buildReading } from '../../src/lib/server/generation/reading/build.ts';
import { importContent } from '../../src/lib/server/generation/content-files.ts';
import { loadGenerationContext } from '../../src/lib/server/generation/context.ts';

/**
 * `anchors`: also reading passages (bands 1-3) and error drills (every code, bands 1-2) for Đọc
 * and Viết sessions, all from the canned LLM.
 */
export async function seedTestDatabase(path: string, options: { clozePerBand: number; anchors?: boolean }): Promise<Map<number, number>> {
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
	const db = createDb(path);
	migrate(db);
	importContent(db);
	const llm = appLlmDeps(db, { LLM_CANNED: '1' });
	const context = loadGenerationContext(db);
	for (let band = 1; band <= 8; band++) {
		await buildCloze(
			{ bands: [band, band], limit: options.clozePerBand, maxCalls: 1000, dailyCap: 1_000_000 },
			{ llm, isWord: context.isWord, blocklist: context.blocklist }
		);
	}
	if (options.anchors) {
		const budget = unlimitedBudget;
		await buildReading([1, 2, 3].map((band) => ({ band, count: 6 })), { llm, forms: context.forms, blocklist: context.blocklist }, { budget });
		await buildDrills(
			DRILL_CODES.flatMap((topic) => [1, 2].map((band) => ({ topic, band, count: 4 }))),
			{ llm, forms: context.forms, classes: context.classes, blocklist: context.blocklist },
			{ budget }
		);
	}
	const pool = clozeItemsRepo(db).availableByBand();
	db.$client.close();
	return pool;
}

/**
 * Make `count` cloze cards due now in a test database (Review state, a day overdue), from validated
 * items without a card and without stock names; the first is a strong lexical card (typing mode).
 */
export function addDueCards(path: string, count: number, now = new Date()): void {
	const db = createDb(path);
	const cards = cardsRepo(db);
	const candidates = clozeItemsRepo(db)
		.newCardCandidates(8)
		.filter((c) => !c.hasStockNames && c.gapType !== 'article');
	const strong = candidates.find((c) => c.gapType === 'lexical' && c.answer.length >= 6 && c.answer === c.answer.toLowerCase());
	const chosen = [...(strong ? [strong] : []), ...candidates.filter((c) => c !== strong)].slice(0, count);
	chosen.forEach((item, i) => {
		const due = new Date(now.getTime() - 86_400_000 - i * 60_000);
		cards.insertIfAbsent({
			kind: 'cloze',
			lexemeId: item.lexemeId,
			sentenceId: item.sentenceId,
			grammarTopicId: item.grammarTopicId,
			clozeItemId: item.id,
			...newCardFields(now),
			state: 'Review',
			stability: item === strong ? 30 : 3,
			difficulty: 5,
			reps: 3,
			scheduledDays: 3,
			due,
			lastReview: new Date(due.getTime() - 3 * 86_400_000)
		});
	});
	db.$client.close();
}
