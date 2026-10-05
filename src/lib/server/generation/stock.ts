// Stock targets prefetch keeps full, for bands 1 .. known_band_ceiling + 1.

export interface StockTargets {
	/** Validated cloze items no card uses yet, per band. */
	clozePerBand: number;
	/** Validated, unserved reading passages per band. */
	readingPerBand: number;
	/** Validated, unserved error drills per topic code and band. */
	drillsPerTopicPerBand: number;
}

export const STOCK_TARGETS: StockTargets = {
	clozePerBand: 60,
	readingPerBand: 4,
	drillsPerTopicPerBand: 8
};

/** Calls one prefetch run may make (HTTP attempts) unless the caller says otherwise. */
export const DEFAULT_PREFETCH_MAX_CALLS = 100;

/**
 * Items requested per missing item for kinds the critic often rejects (cloze, drills): asking for
 * more fills the stock in fewer runs; overshooting the target a little is harmless.
 */
export const OVERSAMPLE = 1.5;

export const PREFETCH_LOCK = 'prefetch';
/** A lock older than this is a crashed run and counts as free. */
export const PREFETCH_STALE_LOCK_MS = 30 * 60 * 1000;
