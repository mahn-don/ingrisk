import type { PageServerLoad } from './$types';
import type { TopicCode } from '#lib/session/types.js';

const TOPIC = /^topic:([A-Z]{3})$/;

// The budget and shape chosen on Home (?budget=8&shape=read), or a focus (?focus=hard, from the review
// book; ?focus=topic:ART, from the stats page); the page starts the session (one POST), and the
// start endpoint validates the focus.
export const load: PageServerLoad = ({ url }) => {
	const budget = Number(url.searchParams.get('budget'));
	const shape = url.searchParams.get('shape');
	const focusParam = url.searchParams.get('focus') ?? '';
	const topic = TOPIC.exec(focusParam)?.[1] as TopicCode | undefined;
	return {
		budgetMin: Number.isInteger(budget) && budget >= 1 && budget <= 60 ? budget : null,
		shape: shape === 'quick' || shape === 'read' || shape === 'write' ? shape : null,
		focus: focusParam === 'hard' ? { kind: 'hard' as const } : topic !== undefined ? { kind: 'topic' as const, code: topic } : null
	};
};
