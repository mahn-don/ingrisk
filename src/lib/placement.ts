// Shared by the placement engine (server) and the placement page (client): the item views the API
// returns, and the word count (the live counter must agree with the server).

export interface PlacementProgress {
	/** 1-3. */
	part: number;
	answered: number;
	total: number;
}

export type PlacementView =
	| { attemptId: number; part: 'A'; ref: string; word: string; progress: PlacementProgress }
	| { attemptId: number; part: 'B'; ref: string; before: string; after: string; options: string[]; progress: PlacementProgress }
	| {
			attemptId: number;
			part: 'C';
			ref: string;
			prompt: { text: string; hint: string; minWords: number; maxWords: number };
			clozeSkipped: boolean;
			progress: PlacementProgress;
	  }
	| { attemptId: number; part: 'done'; resultId: number };

/** Option meaning "no word here" in a cloze item (article gaps). */
export const NO_WORD_OPTION = '—';

/** Words in a text: whitespace-separated pieces holding a letter or digit. */
export const countWords = (text: string) => text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
