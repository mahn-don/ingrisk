// `npm run db:snapshot`: a verified copy of DATABASE_PATH in data/backups/, keeping the newest 14.
// Used by deploy/backup.sh (nightly) and deploy/deploy.sh (before each restart). No sudo needed.
import { DEFAULT_DATABASE_PATH } from '../src/lib/server/db/client.ts';
import { fail, parseCli, positiveInt } from './lib/cli.ts';
import { DEFAULT_DIR, DEFAULT_KEEP, snapshotDatabase } from './lib/snapshot.ts';

const values = parseCli({
	command: 'npm run db:snapshot --',
	summary: 'VACUUM INTO a snapshot of DATABASE_PATH, verify it with PRAGMA integrity_check, and keep the newest N.',
	usage: [
		`--dir DIR          Where snapshots go (default ${DEFAULT_DIR})`,
		`--keep N           Snapshots to keep (default ${DEFAULT_KEEP})`,
		'--label NAME       Suffix for the file name, e.g. predeploy ([a-z0-9-])'
	],
	example: '--label predeploy',
	options: { dir: { type: 'string', default: DEFAULT_DIR }, keep: { type: 'string', default: String(DEFAULT_KEEP) }, label: { type: 'string' } }
});

const dbPath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
try {
	const result = snapshotDatabase({ dbPath, dir: values.dir, now: new Date(), keep: positiveInt('keep', values.keep), label: values.label });
	if (result.status === 'skipped') {
		console.warn(`db:snapshot skipped: ${result.reason}`);
	} else {
		console.log(`snapshot ${result.path} (${result.bytes} bytes), integrity ok`);
		for (const name of result.deleted) console.log(`deleted old snapshot ${name}`);
	}
} catch (error) {
	fail(`db:snapshot failed: ${(error as Error).message}`);
}
