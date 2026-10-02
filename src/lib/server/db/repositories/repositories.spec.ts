import { describe, expect, it } from 'vitest';
import type { NewCard } from './cards.ts';
import { createRepositories } from './index.ts';
import { createTestDb } from '../test-db.ts';

const T0 = new Date(1_800_000_000_000);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function setup() {
	return createRepositories(createTestDb());
}

const card = (overrides: Partial<NewCard> = {}): NewCard => ({
	kind: 'cloze',
	due: T0,
	stability: 0,
	difficulty: 0,
	elapsedDays: 0,
	scheduledDays: 0,
	learningSteps: 0,
	reps: 0,
	lapses: 0,
	state: 'New',
	...overrides
});

describe('settings', () => {
	it('reads the seeded row and applies a patch', () => {
		const { settings } = setup();
		expect(settings.get().desiredRetention).toBe(0.9);
		expect(settings.update({ desiredRetention: 0.85, weeklyGoalDays: 4 })).toMatchObject({
			id: 1,
			desiredRetention: 0.85,
			weeklyGoalDays: 4,
			feedbackMode: 'direct'
		});
		expect(settings.get().weeklyGoalDays).toBe(4);
	});
});

describe('profile', () => {
	it('reads the seeded row and updates it with a timestamp', () => {
		const { profile } = setup();
		expect(profile.get()).toMatchObject({ id: 1, cefrEstimate: null, knownBandCeiling: 1 });
		const updated = profile.update({ theta: 1350, cefrEstimate: 'B1', knownBandCeiling: 3 }, T0);
		expect(updated).toMatchObject({ theta: 1350, cefrEstimate: 'B1', knownBandCeiling: 3, updatedAt: T0 });
		expect(profile.get()).toEqual(updated);
	});
});

describe('providers', () => {
	const openai = {
		name: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		model: 'gpt-x',
		wireFormat: 'openai' as const,
		envKeyName: 'OPENAI_API_KEY'
	};
	const anthropic = {
		name: 'Anthropic',
		baseUrl: 'https://api.anthropic.com',
		model: 'claude-x',
		wireFormat: 'anthropic' as const,
		envKeyName: 'ANTHROPIC_API_KEY',
		isFallback: true
	};

	it('upserts by name, lists, and finds the active and fallback providers', () => {
		const { providers, settings } = setup();
		const a = providers.upsert(openai);
		const b = providers.upsert(anthropic);
		expect(providers.active()).toBeUndefined();
		settings.update({ activeProviderId: a.id });
		expect(providers.active()?.name).toBe('OpenAI');
		expect(providers.fallback()?.name).toBe('Anthropic');

		const updated = providers.upsert({ ...openai, model: 'gpt-y' });
		expect(updated.id).toBe(a.id);
		expect(providers.list().map((p) => [p.name, p.model])).toEqual([
			['OpenAI', 'gpt-y'],
			['Anthropic', 'claude-x']
		]);

		providers.upsert({ ...openai, enabled: false });
		expect(providers.active()).toBeUndefined();
		expect(providers.remove(b.id)).toBe(true);
		expect(providers.fallback()).toBeUndefined();
	});

	it('allows only one fallback provider', () => {
		const { providers } = setup();
		providers.upsert(anthropic);
		expect(() => providers.upsert({ ...openai, isFallback: true })).toThrow(/UNIQUE/);
	});

	it('clears the active provider when it is removed', () => {
		const { providers, settings } = setup();
		const a = providers.upsert(openai);
		settings.update({ activeProviderId: a.id });
		providers.remove(a.id);
		expect(settings.get().activeProviderId).toBeNull();
	});
});

describe('cards', () => {
	it('inserts once per item, reads, saves and lists due cards', () => {
		const { cards } = setup();
		const first = cards.insertIfAbsent(card({ grammarTopicId: 1, kind: 'error' }));
		expect(first).toBeDefined();
		expect(cards.insertIfAbsent(card({ grammarTopicId: 1, kind: 'error' }))).toBeUndefined();
		expect(cards.byId(first!.id)).toEqual(first);

		const saved = cards.save({ ...first!, state: 'Review', due: at(10), stability: 2.5, reps: 1, lastReview: T0, promptMode: 'typing' });
		expect(cards.byId(first!.id)).toEqual(saved);
		expect(saved).toMatchObject({ kind: 'error', grammarTopicId: 1, state: 'Review', promptMode: 'typing' });
	});

	it('orders due cards by due time and leaves out new and future cards', () => {
		const { cards } = setup();
		const make = (grammarTopicId: number, state: NewCard['state'], due: Date) =>
			cards.insertIfAbsent(card({ kind: 'error', grammarTopicId, state, due }))!.id;
		const late = make(1, 'Review', at(-5));
		const learning = make(2, 'Learning', at(-1));
		const overdue = make(3, 'Relearning', at(-60));
		make(4, 'Review', at(30)); // not due yet
		make(5, 'New', at(-100)); // new: not part of the due queue
		expect(cards.dueCards(T0, 10).map((c) => c.id)).toEqual([overdue, late, learning]);
		expect(cards.dueCards(T0, 2).map((c) => c.id)).toEqual([overdue, late]);
		expect(cards.counts(T0)).toEqual({ due: 3, new: 1, learning: 2 });
	});

	it('counts zero on an empty table', () => {
		expect(setup().cards.counts(T0)).toEqual({ due: 0, new: 0, learning: 0 });
	});
});

describe('reviewLogs', () => {
	it('appends and lists a card history oldest first', () => {
		const { cards, reviewLogs } = setup();
		const c = cards.insertIfAbsent(card())!;
		const log = (minutes: number, rating: 'Again' | 'Good') =>
			reviewLogs.append({ cardId: c.id, rating, state: 'Learning', due: at(minutes), stability: 1, difficulty: 5, elapsedDays: 0, lastElapsedDays: 0, scheduledDays: 0, learningSteps: 1, review: at(minutes), oldS: 1, newS: 2, oldD: 5, newD: 5 });
		const second = log(10, 'Good');
		const first = log(0, 'Again');
		expect(reviewLogs.forCard(c.id)).toEqual([first, second]);
		expect(reviewLogs.forCard(c.id + 1)).toEqual([]);
	});
});

describe('cache', () => {
	const item = (contentHash: string, levelBand = 2, kind: 'cloze' | 'reading' = 'cloze') => ({
		kind,
		paramsHash: 'p1',
		contentHash,
		levelBand,
		payloadJson: { sentence_en: contentHash },
		model: 'm'
	});

	it('ignores an item whose content_hash already exists', () => {
		const { cache } = setup();
		expect(cache.insertValidated(item('h1'))).toMatchObject({ validated: true, servedAt: null });
		expect(cache.insertValidated({ ...item('h1'), paramsHash: 'other' })).toBeUndefined();
		expect(cache.stock()).toEqual([{ kind: 'cloze', levelBand: 2, available: 1 }]);
	});

	it('never serves the same item twice and reports stock per kind and band', () => {
		const { cache } = setup();
		for (const h of ['a', 'b', 'c']) cache.insertValidated(item(h));
		cache.insertValidated(item('d', 3));
		cache.insertValidated(item('e', 2, 'reading'));

		const first = cache.takeUnserved('cloze', 2, 2, T0);
		const second = cache.takeUnserved('cloze', 2, 2, T0);
		expect(first.map((i) => i.contentHash)).toEqual(['a', 'b']);
		expect(second.map((i) => i.contentHash)).toEqual(['c']);
		expect(first.every((i) => i.servedAt?.getTime() === T0.getTime())).toBe(true);
		expect(cache.takeUnserved('cloze', 2, 5, T0)).toEqual([]);
		expect(cache.stock()).toEqual([
			{ kind: 'cloze', levelBand: 3, available: 1 },
			{ kind: 'reading', levelBand: 2, available: 1 }
		]);
	});
});

describe('writing', () => {
	it('queues, scores and tracks seen feedback', () => {
		const { writing } = setup();
		const a = writing.queue({ prompt: 'Viết về cuối tuần', userText: 'I go to beach.', submittedAt: T0 });
		const b = writing.queue({ prompt: 'Viết về gia đình', userText: 'My family have four people.', submittedAt: at(1) });
		expect(a.status).toBe('queued');
		expect(writing.queued().map((w) => w.id)).toEqual([a.id, b.id]);

		const scored = writing.markScored(
			a.id,
			{
				correctedText: 'I went to the beach.',
				errors: [{ original: 'go', correction: 'went', topic_code: 'TNS', explanation_vi: 'Dùng thì quá khứ.' }],
				cefrEstimate: 'A2'
			},
			at(2)
		);
		expect(scored).toMatchObject({ status: 'scored', cefrEstimate: 'A2', scoredAt: at(2) });
		expect(scored.errorsJson?.[0].topic_code).toBe('TNS');
		writing.markFailed(b.id);
		expect(writing.queued()).toEqual([]);

		expect(writing.unseenFeedback().map((w) => w.id)).toEqual([a.id]);
		writing.markSeen(a.id, at(3));
		expect(writing.unseenFeedback()).toEqual([]);
	});
});

describe('sessions', () => {
	it('records a finished session once per client_session_id', () => {
		const repos = setup();
		const payload = { clientSessionId: 'c-1', startedAt: T0, endedAt: at(8), budgetMin: 8, shape: 'read' as const, itemsDone: 17, streakAfter: 3 };
		const first = repos.sessions.recordFinished(payload);
		const retry = repos.sessions.recordFinished({ ...payload, itemsDone: 99 });
		expect(first.created).toBe(true);
		expect(retry).toEqual({ session: first.session, created: false });
		expect(retry.session.itemsDone).toBe(17);
	});
});

describe('grammarTopics', () => {
	it('lists the seeded taxonomy and finds a topic by code', () => {
		const { grammarTopics } = setup();
		expect(grammarTopics.all()).toHaveLength(10);
		expect(grammarTopics.byCode('COL')).toMatchObject({ nameEn: 'Collocation', nameVi: 'Kết hợp từ' });
	});
});
