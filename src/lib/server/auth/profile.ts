// The current learner of a request, for routes. src/hooks.server.ts already sends a request with
// no profile to /profiles (or answers 409 on /api); this only narrows the type.
import { error } from '@sveltejs/kit';

export function profileIdOf(locals: App.Locals): number {
	if (locals.profile === null) error(409, 'no profile selected');
	return locals.profile.id;
}
