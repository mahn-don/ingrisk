// The numbers on Home: due cards, new cards still available today, cards in learning.
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { type HomeCounts, counts, learningDayStart } from '../srs/index.ts';

const DAY = 86_400_000;

/**
 * Like srs counts(), but new cards also count the validated cloze items a session would turn into
 * cards (they are created when a session is composed), within today's new-card allowance.
 */
export function homeCounts(db: DbOrTx, now: Date): HomeCounts {
	const limit = settingsRepo(db).get().newCardsPerDay;
	const base = counts(db, now, limit);
	const start = learningDayStart(now);
	const left = Math.max(0, limit - reviewLogsRepo(db).countIntroducedBetween(start, new Date(start.getTime() + DAY)));
	const pool = cardsRepo(db).counts(now).new + clozeItemsRepo(db).countNewCardCandidates(profileRepo(db).get().knownBandCeiling + 1);
	return { ...base, newAvailableToday: Math.min(left, pool) };
}
