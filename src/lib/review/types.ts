// The review book ("Sổ ôn tập") as the page shows it (Phase 10).
import type { GapType, IntervalUnit, TopicCode } from '../session/types.ts';

/** When a card comes back, in plain words (the page words it). */
export type NextReview =
	| { kind: 'new' }
	| { kind: 'suspended' }
	| { kind: 'now' }
	| { kind: 'today' }
	| { kind: 'tomorrow' }
	| { kind: 'days'; n: number }
	| { kind: 'months'; n: number };

export interface BookRow {
	cardId: number;
	answer: string;
	answerVi: string | null;
	/** The sentence with the gap as "___". */
	sentenceWithGap: string;
	gapType: GapType;
	mined: boolean;
	suspended: boolean;
	lapses: number;
	next: NextReview;
}

export interface BookHistoryEntry {
	review: number;
	rating: 'Manual' | 'Again' | 'Hard' | 'Good' | 'Easy';
	/** The interval this review set (until the next review was due). */
	interval: { value: number; unit: IntervalUnit };
}

export interface BookDetail extends BookRow {
	/** The sentence around the answer (the answer is highlighted between them). */
	before: string;
	after: string;
	viText: string;
	topicCode: TopicCode | null;
	topicNameVi: string | null;
	source: 'tatoeba' | 'user' | 'llm' | 'other';
	history: BookHistoryEntry[];
}
