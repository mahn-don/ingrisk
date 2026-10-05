// `npm run db:migrate`: apply pending migrations to DATABASE_PATH (default data/app.db).
import { parseCli } from '../../../../tool/lib/cli.ts';
import { DEFAULT_DATABASE_PATH, createDb, migrate } from './client.ts';

parseCli({
	command: 'npm run db:migrate --',
	summary: 'Apply pending migrations to DATABASE_PATH (default data/app.db).',
	usage: [],
	example: '',
	options: {}
});

const path = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
const db = createDb(path);
const applied = () =>
	db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
const tableExists = () =>
	db.$client.prepare("select 1 from sqlite_master where name = '__drizzle_migrations'").get() !== undefined;

const before = tableExists() ? applied().n : 0;
migrate(db);
const after = applied().n;
db.$client.close();

console.log(
	after > before
		? `Applied ${after - before} migration(s) to ${path}.`
		: `${path} is up to date (${after} migration(s) applied).`
);
