// Work done once when the server starts (called from the `init` hook in src/hooks.server.ts).
import { getDb } from './db/client.ts';

/** Open the database and apply pending migrations; throws, and so stops the server, on failure. */
export function startServer(): void {
	getDb();
}
