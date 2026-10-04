// FSRS scheduler built from the learner's settings. Thin wrapper: ts-fsrs does all the maths.
import { type FSRS, fsrs, generatorParameters } from 'ts-fsrs';
import type { Settings } from '../db/repositories/settings.ts';

export const MAXIMUM_INTERVAL_DAYS = 36_500;
export const LEARNING_STEPS = ['1m', '10m'] as const;
export const RELEARNING_STEPS = ['10m'] as const;

export interface SchedulerOptions {
	/** Spread long intervals a little (default true). Tests turn it off for exact results. */
	fuzz?: boolean;
}

/**
 * FSRS with the default FSRS-6 weights shipped by ts-fsrs, the learner's desired retention,
 * short-term learning steps 1m/10m and relearning step 10m.
 */
export function createScheduler(
	settings: Pick<Settings, 'desiredRetention'>,
	options: SchedulerOptions = {}
): FSRS {
	return fsrs(
		generatorParameters({
			request_retention: settings.desiredRetention,
			maximum_interval: MAXIMUM_INTERVAL_DAYS,
			enable_fuzz: options.fuzz ?? true,
			enable_short_term: true,
			learning_steps: [...LEARNING_STEPS],
			relearning_steps: [...RELEARNING_STEPS]
		})
	);
}
