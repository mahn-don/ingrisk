import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { placementRepo } from '#lib/server/db/repositories/placement.js';
import { profileRepo } from '#lib/server/db/repositories/profile.js';
import { gradeQueuedInBackground } from '#lib/server/placement/app.js';
import { placementOverview } from '#lib/server/placement/engine.js';
import { learningSettingsRepo } from '#lib/server/db/repositories/settings.js';
import { loadToday } from '#lib/server/progress/index.js';
import { homeCounts } from '#lib/server/session/counts.js';
import { shapeContext } from '#lib/server/session/shape.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const profileId = profileIdOf(locals);
	// Queued writings (a placement graded late) are graded in the background, never awaited.
	gradeQueuedInBackground();
	const profile = profileRepo(db, profileId).get();
	const overview = placementOverview(db, profileId);
	const defaultBudget = learningSettingsRepo(db, profileId).get().defaultSessionBudget;
	const now = new Date();
	return {
		counts: homeCounts(db, profileId, now),
		today: { ...loadToday(db, profileId, now), now: now.getTime() },
		defaultBudget,
		// The rotation's inputs; the page applies the rules to the budget chosen (src/lib/session/shape.ts).
		shape: shapeContext(db, profileId, defaultBudget),
		placement: {
			...overview,
			// Offered until a test is completed or the learner chose to start from the basics.
			offer: !overview.completed && !overview.inProgress && profile.placementSkippedAt === null,
			cefr: overview.completed ? (placementRepo(db, profileId).latestResult()?.cefr ?? null) : null
		}
	};
};

export const actions: Actions = {
	/** "Bỏ qua, bắt đầu từ cơ bản": no test; start from band 1. */
	skipPlacement: ({ locals }) => {
		const now = new Date();
		profileRepo(getDb(), profileIdOf(locals)).update({ placementSkippedAt: now, knownBandCeiling: 1 }, now);
	}
};
