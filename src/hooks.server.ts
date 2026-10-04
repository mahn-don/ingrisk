import type { ServerInit } from '@sveltejs/kit/hooks';
import { startServer } from '#lib/server/startup.js';

// Runs before the first request. A migration error throws here, and adapter-node awaits
// init at startup, so the server refuses to start instead of serving a broken database.
export const init: ServerInit = () => {
	startServer();
};
