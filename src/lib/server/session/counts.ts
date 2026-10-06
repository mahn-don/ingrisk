// The numbers on Home: due cards, new cards still available today, cards in learning.
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { learnerClozeRepo } from '../db/repositories/cloze-items.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { learningSettingsRepo } from '../db/repositories/settings.ts';
import { type HomeCounts, counts, learningDayStart } from '../srs/index.ts';

const DAY = 86_400_000;

/**
 * Like srs counts(), but new cards also count the validated cloze items a session would turn into
 * cards (they are created when a session is composed), within today's new-card allowance.
 */
export function homeCounts(db: DbOrTx, profileId: number, now: Date): HomeCounts {
	const limit = learningSettingsRepo(db, profileId).get().newCardsPerDay;
	const base = counts(db, profileId, now, limit);
	const start = learningDayStart(now);
	const left = Math.max(0, limit - reviewLogsRepo(db, profileId).countIntroducedBetween(start, new Date(start.getTime() + DAY)));
	const pool = cardsRepo(db, profileId).counts(now).new + learnerClozeRepo(db, profileId).countNewCardCandidates(profileRepo(db, profileId).get().knownBandCeiling + 1);
	return { ...base, newAvailableToday: Math.min(left, pool) };
}
