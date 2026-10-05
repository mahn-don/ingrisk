// Batched LLM calls with a call budget: one failing batch never loses the others.
import { LlmError } from '../../llm/errors.ts';

export const BATCH_SIZE = 10;

/** Decides, before every call, whether another LLM call may be made (see build.ts). */
export interface CallBudget {
	canCall(): boolean;
}

export const unlimitedBudget: CallBudget = { canCall: () => true };

export interface BatchFailure<T> {
	items: T[];
	/** `llm:<error code>`; never contains prompt text or keys (LlmError messages are redacted). */
	reason: string;
}

export interface BatchRun<T> {
	failures: BatchFailure<T>[];
	/** Items never sent because the budget ran out. */
	notRun: T[];
	calls: number;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/**
 * Run `call` on consecutive batches of `size`. An LlmError fails only its own batch; any other
 * error is a bug and propagates. Stops (leaving the rest in `notRun`) once the budget is spent.
 */
export async function runBatches<T>(
	items: readonly T[],
	call: (batch: T[]) => Promise<void>,
	options: { budget: CallBudget; size?: number }
): Promise<BatchRun<T>> {
	const run: BatchRun<T> = { failures: [], notRun: [], calls: 0 };
	const batches = chunk(items, options.size ?? BATCH_SIZE);
	for (const [i, batch] of batches.entries()) {
		if (!options.budget.canCall()) {
			run.notRun = batches.slice(i).flat();
			break;
		}
		run.calls++;
		try {
			await call(batch);
		} catch (error) {
			if (!(error instanceof LlmError)) throw error;
			run.failures.push({ items: batch, reason: `llm:${error.code}` });
		}
	}
	return run;
}
