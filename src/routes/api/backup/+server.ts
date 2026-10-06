import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { backupBytes, backupFileName } from '#lib/server/settings/backup.js';

// "Tải bản sao lưu": the whole database as a SQLite file (behind auth, like every /api path).
export const GET: RequestHandler = async () => {
	const bytes = await backupBytes(getDb());
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'application/vnd.sqlite3',
			'content-disposition': `attachment; filename="${backupFileName(new Date())}"`,
			'content-length': String(bytes.length),
			'cache-control': 'no-store'
		}
	});
};
