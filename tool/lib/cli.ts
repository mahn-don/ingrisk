// Shared argument parsing for every command-line script: node:util parseArgs in strict mode (an
// unknown flag is an error), plus --help that prints the usage and an example.
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';

export interface CliSpec<O extends ParseArgsOptionsConfig> {
	/** The npm command, e.g. "npm run cloze:build --". */
	command: string;
	/** One line saying what the command does. */
	summary: string;
	/** One line per option, already formatted ("--limit N   Items to build (default 200)"). */
	usage: readonly string[];
	example: string;
	options: O;
}

const HELP = { help: { type: 'boolean', short: 'h' } } as const;

export function helpText(spec: CliSpec<ParseArgsOptionsConfig>): string {
	const lines = [spec.summary, '', `Usage: ${spec.command} [options]`, '', 'Options:'];
	for (const line of [...spec.usage, '--help, -h         Show this help']) lines.push(`  ${line}`);
	lines.push('', 'Example:', `  ${spec.command} ${spec.example}`.trimEnd());
	return lines.join('\n');
}

export type CliResult =
	| { kind: 'values'; values: Record<string, string | boolean | undefined> }
	| { kind: 'help'; text: string }
	| { kind: 'error'; text: string };

/** Pure parsing (tested): values, a help request, or an error message with the usage. */
export function parseCliArgs<O extends ParseArgsOptionsConfig>(spec: CliSpec<O>, args: string[]): CliResult {
	try {
		const options: ParseArgsOptionsConfig = { ...spec.options, ...HELP };
		const { values } = parseArgs({ args, options, strict: true, allowPositionals: false });
		const parsed = values as Record<string, string | boolean | undefined>;
		if (parsed.help === true) return { kind: 'help', text: helpText(spec) };
		delete parsed.help;
		return { kind: 'values', values: parsed };
	} catch (error) {
		return { kind: 'error', text: `${(error as Error).message}\n\n${helpText(spec)}` };
	}
}

type Values<O extends ParseArgsOptionsConfig> = {
	[K in keyof O]: O[K] extends { type: 'boolean' }
		? boolean
		: O[K] extends { default: string }
			? string
			: string | undefined;
};

/** Parse process.argv: prints help and exits 0 on --help; prints the error and exits 2 on bad flags. */
export function parseCli<O extends ParseArgsOptionsConfig>(spec: CliSpec<O>, args = process.argv.slice(2)): Values<O> {
	const result = parseCliArgs(spec, args);
	if (result.kind === 'help') {
		console.log(result.text);
		process.exit(0);
	}
	if (result.kind === 'error') {
		console.error(result.text);
		process.exit(2);
	}
	const values = { ...result.values };
	for (const [name, option] of Object.entries(spec.options)) {
		if (option.type === 'boolean' && values[name] === undefined) values[name] = false;
	}
	return values as Values<O>;
}

/** Print a message and exit 1 (a usage or precondition problem detected after parsing). */
export function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

/** A positive integer flag value, or fail. */
export function positiveInt(name: string, value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a positive integer`);
	return n;
}
