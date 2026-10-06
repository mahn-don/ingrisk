// Progress, recomputed on read from the history (sessions, reviews, writing, drills): the stats
// page ("Tiến độ") and Home's "today" card. The maths is pure (days, streak, calendar, weakness);
// this module only gathers the rows. See plans/phase-10.md.
import type { DbOrTx } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { drillResultsRepo } from '../db/repositories/drill-results.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { reviewBookRepo } from '../db/repositories/review-book.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { learningSettingsRepo } from '../db/repositories/settings.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { DRILL_CODES, drillParamsHash } from '../generation/drills/build.ts';
import type { Progress, TodaySummary } from '../../progress/types.ts';
import type { TopicCode } from '../../session/types.ts';
import { forecast, heatMap, weeklyGoal } from './calendar.ts';
import { DAY_MS } from './days.ts';
import { computeStreak } from './streak.ts';
import { type TopicActivity, rankWeakness } from './weakness.ts';

export { computeStreak } from './streak.ts';

export const WEAKNESS_DAYS = 30;

function weakness(db: DbOrTx, profileId: number, now: Date): TopicActivity[] {
	const since = new Date(now.getTime() - WEAKNESS_DAYS * DAY_MS);
	const topics = grammarTopicsRepo(db).all();
	const codeOf = new Map(topics.map((t) => [t.id, t.code as TopicCode]));
	const activity = new Map<TopicCode, TopicActivity>(
		topics.map((t) => [t.code as TopicCode, { code: t.code as TopicCode, nameVi: t.nameVi, writingErrors: 0, drillsCorrect: 0, drillsTotal: 0, cloze: [], practicable: false }])
	);
	for (const submission of writingRepo(db, profileId).scoredSince(since)) {
		for (const e of submission.errorsJson ?? []) {
			const a = activity.get(e.topic_code);
			if (a !== undefined) a.writingErrors++;
		}
	}
	for (const d of drillResultsRepo(db, profileId).since(since)) {
		const a = activity.get(d.topicCode);
		if (a === undefined) continue;
		a.drillsTotal++;
		if (d.correct) a.drillsCorrect++;
	}
	for (const row of reviewLogsRepo(db, profileId).grammarClozeSince(since)) {
		const code = codeOf.get(row.topicId);
		if (code !== undefined) activity.get(code)!.cloze.push({ gapType: row.gapType, correct: row.total - row.again, total: row.total });
	}
	const band = profileRepo(db, profileId).get().knownBandCeiling;
	const book = reviewBookRepo(db, profileId);
	const cache = cacheRepo(db);
	for (const a of activity.values()) {
		const hasDrills = (DRILL_CODES as readonly string[]).includes(a.code) && cache.hasUnservedNear('error', band, 8, drillParamsHash(a.code));
		a.practicable = hasDrills || book.topicCandidates(a.code).length > 0;
	}
	return [...activity.values()];
}

export function loadProgress(db: DbOrTx, profileId: number, now: Date): Progress {
	const history = sessionsRepo(db, profileId).finishedHistory();
	const cards = cardsRepo(db, profileId);
	const totals = cards.progressTotals();
	return {
		streak: computeStreak(history, now),
		weekly: weeklyGoal(history, learningSettingsRepo(db, profileId).get().weeklyGoalDays, now),
		heatMap: heatMap(history, now),
		forecast: forecast(cards.introducedDue(), now),
		totals: {
			wordsLearned: totals.wordsLearned,
			cardsInLearning: totals.cardsInLearning,
			minutes: Math.round(history.reduce((n, s) => n + s.studyMs, 0) / 60_000),
			sessions: history.length,
			minedAdded: totals.minedAdded,
			minedInReview: totals.minedInReview
		},
		weakness: rankWeakness(weakness(db, profileId, now)),
		levels: placementRepo(db, profileId)
			.allResults()
			.map((r) => ({ takenAt: r.takenAt.getTime(), cefr: r.cefr, abilityBand: r.abilityBand, vocabBand: r.vocabBand }))
	};
}

export function loadToday(db: DbOrTx, profileId: number, now: Date): TodaySummary {
	const history = sessionsRepo(db, profileId).finishedHistory();
	const cards = cardsRepo(db, profileId);
	return {
		streak: computeStreak(history, now),
		thisWeek: weeklyGoal(history, learningSettingsRepo(db, profileId).get().weeklyGoalDays, now).thisWeek,
		nextReviewAt: cards.earliestIntroducedDue()?.getTime() ?? null,
		minedWaiting: cards.progressTotals().minedWaiting
	};
}
