// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session } from '#lib/server/auth/sessions.js';
import type { CurrentProfile } from '#lib/server/profiles/index.js';
import type { Theme } from '#lib/theme.js';

declare global {
	namespace App {
		interface Locals {
			/** Set by src/hooks.server.ts; null when not logged in. */
			session: Session | null;
			/** The learner picked on /profiles (set by src/hooks.server.ts); null before one is picked. */
			profile: CurrentProfile | null;
			theme: Theme;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
