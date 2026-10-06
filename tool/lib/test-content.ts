// A throwaway database for the e2e tests and the screenshots: migrated, the content imported, and a
// validated cloze pool built with the canned LLM (no network, never data/app.db).
import { rmSync } from 'node:fs';
import { createDb, migrate } from '../../src/lib/server/db/client.ts';
import { clozeItemsRepo } from '../../src/lib/server/db/repositories/cloze-items.ts';
import { appLlmDeps } from '../../src/lib/server/generation/app-llm.ts';
import { buildCloze } from '../../src/lib/server/generation/cloze/build.ts';
import { importContent } from '../../src/lib/server/generation/content-files.ts';
import { loadGenerationContext } from '../../src/lib/server/generation/context.ts';

export async function seedTestDatabase(path: string, options: { clozePerBand: number }): Promise<Map<number, number>> {
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
	const pool = clozeItemsRepo(db).availableByBand();
	db.$client.close();
	return pool;
}
