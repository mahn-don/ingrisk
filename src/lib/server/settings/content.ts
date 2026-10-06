// "Nội dung": the stock prefetch keeps full, as the settings page shows it.
import type { DbOrTx } from '../db/client.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { DRILL_CODES } from '../generation/drills/build.ts';
import { bandsInRange, readStockLevels } from '../generation/prefetch.ts';
import { STOCK_TARGETS } from '../generation/stock.ts';

export interface StockOverview {
	/** Bands prefetch fills (1 .. known_band_ceiling + 1), plus any other band with stock. */
	bands: { band: number; cloze: number; reading: number }[];
	drills: { code: string; nameVi: string; count: number }[];
	targets: { clozePerBand: number; readingPerBand: number; drillsPerTopic: number };
}

export function stockOverview(db: DbOrTx): StockOverview {
	const levels = readStockLevels(db);
	const bands = new Set([...bandsInRange(levels.ceiling), ...levels.cloze.keys(), ...levels.reading.keys()]);
	const names = new Map(grammarTopicsRepo(db).all().map((t) => [t.code, t.nameVi]));
	const drills = DRILL_CODES.map((code) => ({
		code,
		nameVi: names.get(code) ?? code,
		count: [...levels.drills].filter(([key]) => key.startsWith(`${code}|`)).reduce((n, [, c]) => n + c, 0)
	}));
	return {
		bands: [...bands].sort((a, b) => a - b).map((band) => ({ band, cloze: levels.cloze.get(band) ?? 0, reading: levels.reading.get(band) ?? 0 })),
		drills,
		targets: {
			clozePerBand: STOCK_TARGETS.clozePerBand,
			readingPerBand: STOCK_TARGETS.readingPerBand,
			drillsPerTopic: STOCK_TARGETS.drillsPerTopicPerBand * bandsInRange(levels.ceiling).length
		}
	};
}
