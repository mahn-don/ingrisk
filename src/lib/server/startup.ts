// Work done once when the server starts (called from the `init` hook in src/hooks.server.ts).
import { getDb } from './db/client.ts';
import { assertLlmModeAllowed } from './generation/app-llm.ts';

/**
 * Refuse canned LLM responses in production, then open the database and apply pending
 * migrations; throws, and so stops the server, on failure.
 */
export function startServer(env: Readonly<Record<string, string | undefined>> = process.env): void {
	assertLlmModeAllowed(env);
	getDb();
}
