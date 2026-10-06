// "Next review" in plain words, for the review book's rows and detail sheet.
import { fill } from '#lib/format.js';
import { t } from '#lib/messages/vi.js';
import type { NextReview } from '#lib/review/types.js';

export function nextReviewText(next: NextReview): string {
	const m = t.review.next;
	switch (next.kind) {
		case 'days':
			return fill(m.days, { n: next.n });
		case 'months':
			return fill(m.months, { n: next.n });
		default:
			return m[next.kind];
	}
}
