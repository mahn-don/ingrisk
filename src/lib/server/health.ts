// GET /healthz: is the server up and its database readable? Public (no session) and used by
// deploy/deploy.sh and deploy/install.sh after a restart, so it says nothing beyond that.
import type { Db } from './db/client.ts';

export type Health = { status: 200; body: { ok: true; db: 'ok'; migrations: number } } | { status: 503; body: { ok: false; db: 'error' } };

/**
 * A trivial query on the app database: the number of applied migrations. Any failure (the
 * database cannot be opened or migrated, the file is gone, the query throws) is a 503, without
 * details.
 */
export function checkHealth(open: () => Db): Health {
	try {
		const row = open().$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
		return { status: 200, body: { ok: true, db: 'ok', migrations: row.n } };
	} catch {
		return { status: 503, body: { ok: false, db: 'error' } };
	}
}
