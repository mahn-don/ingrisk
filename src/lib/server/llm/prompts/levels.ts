// How a level band (1-8, the NGSL frequency bands of 352 headwords each) is described to the model.

export const MIN_BAND = 1;
export const MAX_BAND = 8;
const BAND_SIZE = 352;

const CEFR_BY_BAND = ['A1', 'A1-A2', 'A2', 'A2-B1', 'B1', 'B1-B2', 'B2', 'B2-C1'] as const;

/** e.g. "band 3 of 8 (about CEFR A2): use mostly the 1,400 most common English words" */
export function describeBand(band: number): string {
	const words = (Math.min(band + 1, MAX_BAND) * BAND_SIZE).toLocaleString('en-US');
	return `band ${band} of ${MAX_BAND} (about CEFR ${CEFR_BY_BAND[band - 1]}): use mostly the ${words} most common English words`;
}
