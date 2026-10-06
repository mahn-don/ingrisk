import { describe, expect, it } from 'vitest';
import { TEST_PROFILE } from '../db/test-db.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { learningSettingsRepo, settingsRepo } from '../db/repositories/settings.ts';
import type { SessionSummary } from '../db/schema.ts';
import { setup } from '../session/test-fixtures.ts';
import { forecast, heatBucket, heatMap, weeklyGoal } from './calendar.ts';
import { dayDate, dayIndex, dayStart, weekIndex } from './days.ts';
import { loadProgress, loadToday } from './index.ts';
import { type FinishedSessionFacts, computeStreak } from './streak.ts';
import { type TopicActivity, rankWeakness } from './weakness.ts';

/** Monday 2026-10-05 + `day` days, at `hour`:`minute` in Asia/Ho_Chi_Minh (UTC+7). */
const ict = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 5 + day, hour - 7, minute));
const MIN = 60_000;

/** [day, hour, items (default 8), how many such sessions (default 1)] */
type S = [number, number, number?, number?];
const history = (specs: S[]): FinishedSessionFacts[] =>
	specs.flatMap(([day, hour, items = 8, n = 1]) => Array.from({ length: n }, () => ({ finishedAt: ict(day, hour), itemsDone: items, studyMs: 3 * MIN })));

describe('learning days', () => {
	it('start at 04:00 Asia/Ho_Chi_Minh, weeks on Monday', () => {
		expect(dayIndex(ict(0, 3, 59))).toBe(dayIndex(ict(-1, 12)));
		expect(dayIndex(ict(0, 4))).toBe(dayIndex(ict(0, 23, 59)));
		expect(dayStart(dayIndex(ict(0, 12)))).toEqual(ict(0, 4));
		expect(dayDate(dayIndex(ict(0, 12)))).toBe('2026-10-05');
		expect(dayDate(dayIndex(ict(0, 3)))).toBe('2026-10-04');
		expect(weekIndex(dayIndex(ict(0, 12)))).toBe(weekIndex(dayIndex(ict(6, 12))));
		expect(weekIndex(dayIndex(ict(0, 3)))).toBe(weekIndex(dayIndex(ict(0, 12))) - 1); // Sunday's learning day
	});
});

describe('computeStreak', () => {
	const NOW = ict(0, 20);
	const cases: { name: string; sessions: S[]; now?: Date; expected: Partial<ReturnType<typeof computeStreak>> }[] = [
		{ name: 'nothing yet', sessions: [], expected: { current: 0, longest: 0, freezesBanked: 0, freezesUsedDates: [], studiedToday: false } },
		{ name: 'consecutive days', sessions: [[-3, 9], [-2, 9], [-1, 21], [0, 8]], expected: { current: 4, longest: 4, freezesUsedDates: [], studiedToday: true } },
		{
			name: 'a gap covered by a freeze',
			sessions: [[-7, 9, 8, 5], [-5, 9], [-4, 9], [-3, 9], [-2, 9], [-1, 9], [0, 9]],
			expected: { current: 7, longest: 7, freezesUsedDates: ['2026-09-29'], freezesBanked: 1 }
		},
		{ name: 'a gap without a freeze', sessions: [[-3, 9], [-1, 9], [0, 9]], expected: { current: 2, longest: 2, freezesBanked: 0, freezesUsedDates: [] } },
		{
			name: 'two gaps use both freezes',
			sessions: [[-6, 9, 8, 10], [-4, 9], [-2, 9], [-1, 9], [0, 9]],
			expected: { current: 5, longest: 5, freezesBanked: 0, freezesUsedDates: ['2026-09-30', '2026-10-02'] }
		},
		{ name: 'a third gap breaks it', sessions: [[-8, 9, 8, 10], [-6, 9], [-4, 9], [-2, 9], [0, 9]], expected: { current: 1, longest: 3, freezesBanked: 0 } },
		{ name: 'no more than 2 freezes in the bank', sessions: [[-1, 9, 8, 15]], expected: { current: 1, freezesBanked: 2, studiedToday: false } },
		{ name: 'no freeze is spent before a streak starts', sessions: [[-5, 9, 2, 5], [-1, 9]], expected: { current: 1, freezesBanked: 1, freezesUsedDates: [] } },
		{ name: '03:30 belongs to the day before', sessions: [[-1, 10], [0, 3]], expected: { current: 1, studiedToday: false } },
		{ name: '04:30 is today', sessions: [[-1, 10], [0, 4]], expected: { current: 2, studiedToday: true } },
		{ name: 'today not yet studied keeps the streak', sessions: [[-2, 9], [-1, 9]], expected: { current: 2, studiedToday: false } },
		{ name: 'yesterday missed breaks it', sessions: [[-3, 9], [-2, 9]], expected: { current: 0, longest: 2 } },
		{ name: 'fewer than 5 items is not a studied day', sessions: [[-2, 9, 5], [-1, 9, 4]], expected: { current: 0, longest: 1 } },
		{ name: 'short sessions still earn freezes', sessions: [[-3, 9, 1, 5], [-2, 9], [-1, 23, 4]], expected: { current: 1, freezesBanked: 0, freezesUsedDates: ['2026-10-04'] } }
	];
	for (const c of cases) {
		it(c.name, () => expect(computeStreak(history(c.sessions), c.now ?? NOW)).toMatchObject(c.expected));
	}
});

describe('weeklyGoal', () => {
	it('counts studied learning days per Monday-start week, across the boundary', () => {
		// Sunday 03:00 → Saturday; Monday 03:00 → Sunday (last week); Monday 05:00 → this week.
		const sessions = history([[-8, 10], [-2, 10], [-1, 3], [0, 3], [0, 5]]);
		const goal = weeklyGoal(sessions, 3, ict(0, 20));
		expect(goal.thisWeek).toEqual({ weekStart: '2026-10-05', studiedDays: 1, goal: 3, hit: false });
		expect(goal.past).toHaveLength(8);
		expect(goal.past[7]).toEqual({ weekStart: '2026-09-28', studiedDays: 2, goal: 3, hit: false });
		expect(goal.past[6]).toMatchObject({ weekStart: '2026-09-21', studiedDays: 1, hit: false });
		expect(goal.past[5].hit).toBeNull(); // before the first session
		expect(weeklyGoal(sessions, 2, ict(0, 20)).past[7].hit).toBe(true);
	});
});

describe('heatMap', () => {
	it('buckets minutes: none, under 5, 5 to under 10, 10 or more', () => {
		expect([0, 1, 5 * MIN - 1, 5 * MIN, 10 * MIN - 1, 10 * MIN, 90 * MIN].map(heatBucket)).toEqual([0, 1, 1, 2, 2, 3, 3]);
	});

	it('12 Monday-start weeks up to this one, minutes from response times', () => {
		const sessions: FinishedSessionFacts[] = [
			{ finishedAt: ict(0, 9), itemsDone: 10, studyMs: 4 * MIN },
			{ finishedAt: ict(0, 21), itemsDone: 10, studyMs: 4 * MIN },
			{ finishedAt: ict(-1, 9), itemsDone: 2, studyMs: 12 * MIN },
			{ finishedAt: ict(-200, 9), itemsDone: 10, studyMs: 12 * MIN }
		];
		const map = heatMap(sessions, ict(1, 12));
		expect(map).toHaveLength(12);
		expect(map.every((w) => w.length === 7)).toBe(true);
		expect(map[0][0].date).toBe('2026-07-20');
		expect(map[11][0]).toEqual({ date: '2026-10-05', minutes: 8, bucket: 2, future: false });
		expect(map[10][6]).toEqual({ date: '2026-10-04', minutes: 12, bucket: 3, future: false });
		expect(map[11][1]).toMatchObject({ date: '2026-10-06', bucket: 0, future: false });
		expect(map[11][2]).toMatchObject({ date: '2026-10-07', future: true });
	});
});

describe('forecast', () => {
	it('cards due on each of the next 7 learning days; today includes the overdue', () => {
		const dues = [ict(-3, 9), ict(0, 23), ict(1, 3), ict(1, 5), ict(6, 12), ict(7, 12)];
		expect(forecast(dues, ict(0, 20))).toEqual([
			{ date: '2026-10-05', due: 3 },
			{ date: '2026-10-06', due: 1 },
			{ date: '2026-10-07', due: 0 },
			{ date: '2026-10-08', due: 0 },
			{ date: '2026-10-09', due: 0 },
			{ date: '2026-10-10', due: 0 },
			{ date: '2026-10-11', due: 1 }
		]);
	});
});

describe('rankWeakness', () => {
	const topic = (code: TopicActivity['code'], over: Partial<TopicActivity>): TopicActivity => ({
		code,
		nameVi: code,
		writingErrors: 0,
		drillsCorrect: 0,
		drillsTotal: 0,
		cloze: [],
		practicable: true,
		...over
	});

	it('weakest first: most errors, then the lowest accuracy; idle topics left out', () => {
		const ranked = rankWeakness([
			topic('ART', { writingErrors: 4, cloze: [{ gapType: 'article', correct: 7, total: 12 }] }), // 4 + 5 = 9
			topic('PRE', { writingErrors: 1, drillsCorrect: 0, drillsTotal: 2, cloze: [{ gapType: 'preposition', correct: 1, total: 3 }] }), // 1 + 2 + 2 = 5
			topic('TNS', { drillsCorrect: 1, drillsTotal: 2, cloze: [{ gapType: 'verb_form', correct: 6, total: 10 }] }), // 1 + 4 = 5, but 7/12 right beats PRE's 1/5
			topic('SVA', {}),
			topic('COL', { cloze: [{ gapType: 'user_error', correct: 2, total: 2 }] })
		]);
		expect(ranked.map((t) => t.code)).toEqual(['ART', 'PRE', 'TNS', 'COL']);
		expect(ranked[0]).toMatchObject({ score: 9, clozeCorrect: 7, clozeTotal: 12, writingErrors: 4 });
	});
});

describe('loadProgress', () => {
	it('reads the history: totals, streak and the forecast; suspended cards are out of the forecast', () => {
		const fx = setup();
		learningSettingsRepo(fx.db, TEST_PROFILE).update({ weeklyGoalDays: 2 });
		const now = ict(0, 20);
		for (const [i, day] of [-1, 0].entries()) {
			sessionsRepo(fx.db, TEST_PROFILE).recordFinished({
				clientSessionId: `progress-${i}`,
				startedAt: ict(day, 9),
				finishedAt: ict(day, 9, 5),
				budgetMin: 5,
				shape: 'quick',
				itemsDone: 6,
				summaryJson: { studyMs: 3 * MIN } as SessionSummary
			});
		}
		const card = fx.addDueCard({ gapType: 'lexical', now });
		fx.addDueCard({ gapType: 'article', now, state: 'Learning' });
		const progress = loadProgress(fx.db, TEST_PROFILE, now);
		expect(progress.streak).toMatchObject({ current: 2, studiedToday: true });
		expect(progress.weekly.thisWeek).toMatchObject({ studiedDays: 1, goal: 2 });
		expect(progress.totals).toEqual({ wordsLearned: 1, cardsInLearning: 1, minutes: 6, sessions: 2, minedAdded: 0, minedInReview: 0 });
		expect(progress.forecast[0].due).toBe(2);
		cardsRepo(fx.db, TEST_PROFILE).setSuspended(card.id, true);
		expect(loadProgress(fx.db, TEST_PROFILE, now).forecast[0].due).toBe(1);
		expect(loadToday(fx.db, TEST_PROFILE, now)).toMatchObject({ streak: { current: 2 }, thisWeek: { studiedDays: 1 }, minedWaiting: 0 });
	});
});
