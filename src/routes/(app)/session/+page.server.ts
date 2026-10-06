import type { PageServerLoad } from './$types';

// The budget and shape chosen on Home (?budget=8&shape=read); the page starts the session (one POST).
export const load: PageServerLoad = ({ url }) => {
	const budget = Number(url.searchParams.get('budget'));
	const shape = url.searchParams.get('shape');
	return {
		budgetMin: Number.isInteger(budget) && budget >= 1 && budget <= 60 ? budget : null,
		shape: shape === 'quick' || shape === 'read' || shape === 'write' ? shape : null
	};
};
