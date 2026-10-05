// Print an argon2id hash for APP_PASSWORD_HASH. The password is typed twice with no echo; it is
// never a command-line argument (that would land in shell history).
import { type Algorithm, hash } from '@node-rs/argon2';
import { fail, parseCli } from './lib/cli.ts';

parseCli({
	command: 'npm run auth:hash --',
	summary: 'Ask for the login password twice (hidden) and print its argon2id hash for APP_PASSWORD_HASH.',
	usage: ['(no options: the password is always typed at the prompt, never passed as an argument)'],
	example: '',
	options: {}
});

export const MIN_LENGTH = 10;
/** Algorithm.Argon2id (a const enum, which plain TypeScript stripping cannot read). */
const ARGON2ID = 2 as Algorithm.Argon2id;
/** OWASP's argon2id baseline: 19 MiB, 2 iterations, 1 lane. */
export const ARGON2_OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** Read one line from a TTY without echoing it. */
function readHidden(question: string): Promise<string> {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		process.stderr.write(question);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		let input = '';
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') {
					stdin.off('data', onData);
					stdin.setRawMode(false);
					stdin.pause();
					process.stderr.write('\n');
					resolve(input);
					return;
				}
				if (ch === '\u0003') {
					stdin.setRawMode(false);
					process.stderr.write('\n');
					process.exit(130);
				}
				if (ch === '\u007f' || ch === '\b') input = Array.from(input).slice(0, -1).join('');
				else if (ch >= ' ') input += ch;
			}
		};
		stdin.on('data', onData);
	});
}

/** Piped input (not a TTY): the first two lines. */
async function readPiped(): Promise<[string, string]> {
	let text = '';
	for await (const chunk of process.stdin) text += chunk;
	const [first = '', second = ''] = text.split(/\r?\n/);
	return [first, second];
}

const [password, again] = process.stdin.isTTY
	? [await readHidden('Mật khẩu / Password: '), await readHidden('Nhập lại / Repeat: ')]
	: await readPiped();

if (password !== again) fail('The two passwords differ. Nothing was printed.');
if ([...password].length < MIN_LENGTH) fail(`Use at least ${MIN_LENGTH} characters. Nothing was printed.`);

const digest = await hash(password, ARGON2_OPTIONS);
console.log(`APP_PASSWORD_HASH='${digest}'`);
console.error('\nPut this line in .env (local) or /etc/silentenglish/.env (server), keep the single quotes, and restart the server.');
