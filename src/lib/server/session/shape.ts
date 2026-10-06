// The database reads behind the session shape (the rules are in src/lib/session/shape.ts).
import type { DbOrTx } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { llmConfigured } from '../generation/app-llm.ts';
import type { ShapeContext } from '../../session/shape.ts';

export { QUICK_BUDGET_MIN, type ShapeContext, defaultShape, resolveShape, shapeOptions } from '../../session/shape.ts';

/** A passage within this many bands of known_band_ceiling counts as "at the right band". */
export const READING_BAND_DISTANCE = 1;

export function shapeContext(db: DbOrTx, budgetMin: number): ShapeContext {
	const last = sessionsRepo(db).lastFinishedNonQuick()?.shape;
	return {
		budgetMin,
		lastNonQuick: last === 'read' || last === 'write' ? last : null,
		unseenFeedback: writingRepo(db).unseenFeedback().length > 0,
		readAvailable: cacheRepo(db).hasUnservedNear('reading', profileRepo(db).get().knownBandCeiling, READING_BAND_DISTANCE),
		writeAvailable: llmConfigured(db)
	};
}
