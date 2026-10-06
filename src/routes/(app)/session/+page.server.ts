import type { PageServerLoad } from './$types';

// The budget chosen on Home (?budget=5|8|10); the session itself is started by the page (one POST).
export const load: PageServerLoad = ({ url }) => {
	const budget = Number(url.searchParams.get('budget'));
	return { budgetMin: Number.isInteger(budget) && budget >= 1 && budget <= 60 ? budget : null };
};
