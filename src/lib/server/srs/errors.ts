// Typed errors thrown by the SRS engine. Callers branch on `instanceof` or `code`.

export class SrsError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = new.target.name;
		this.code = code;
	}
}

export class CardNotFoundError extends SrsError {
	readonly cardId: number;
	constructor(cardId: number) {
		super('card_not_found', `Card ${cardId} does not exist`);
		this.cardId = cardId;
	}
}

export class InvalidRatingError extends SrsError {
	readonly rating: unknown;
	constructor(rating: unknown) {
		super('invalid_rating', `Rating must be Again, Hard, Good or Easy (1-4), got ${String(rating)}`);
		this.rating = rating;
	}
}

export type ReviewTimeProblem = 'before_last_review' | 'in_future';

export class ReviewTimeError extends SrsError {
	readonly problem: ReviewTimeProblem;
	readonly cardId: number;
	readonly reviewedAt: Date;
	constructor(problem: ReviewTimeProblem, cardId: number, reviewedAt: Date, limit: Date) {
		super(
			`review_${problem}`,
			problem === 'before_last_review'
				? `Review of card ${cardId} at ${reviewedAt.toISOString()} is before its last review (${limit.toISOString()})`
				: `Review of card ${cardId} at ${reviewedAt.toISOString()} is too far in the future (limit ${limit.toISOString()})`
		);
		this.problem = problem;
		this.cardId = cardId;
		this.reviewedAt = reviewedAt;
	}
}
