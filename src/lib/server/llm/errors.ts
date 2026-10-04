// Typed errors of the LLM layer. Every error that leaves the layer has passed through redact().
import { redact } from './redact.ts';

export type LlmErrorCode =
	| 'config'
	| 'missing_key'
	| 'http'
	| 'timeout'
	| 'network'
	| 'retries_exhausted'
	| 'bad_response'
	| 'schema'
	| 'refusal';

export class LlmError extends Error {
	readonly code: LlmErrorCode;
	readonly providerId: number | undefined;
	constructor(code: LlmErrorCode, message: string, providerId?: number) {
		super(message);
		this.name = new.target.name;
		this.code = code;
		this.providerId = providerId;
	}

	/** Scrub secrets from the message and stack (in place) and return this error. */
	redacted(secrets: readonly (string | undefined | null)[]): this {
		this.message = redact(this.message, secrets);
		if (this.stack) this.stack = redact(this.stack, secrets);
		return this;
	}
}

/** Bad provider configuration (unknown provider, disallowed base_url, ...). Never falls back. */
export class LlmConfigError extends LlmError {
	constructor(message: string, providerId?: number) {
		super('config', message, providerId);
	}
}

/** The provider's key environment variable is not set. Triggers the fallback provider. */
export class LlmMissingKeyError extends LlmError {
	readonly envKeyName: string;
	constructor(envKeyName: string, providerId: number) {
		super('missing_key', `Environment variable ${envKeyName} is not set`, providerId);
		this.envKeyName = envKeyName;
	}
}

/** A non-retryable HTTP error (4xx other than 429), or the last of the retried ones. */
export class LlmHttpError extends LlmError {
	readonly status: number;
	constructor(status: number, message: string, providerId?: number) {
		super('http', message, providerId);
		this.status = status;
	}
}

/** Retries exhausted on 429/5xx, timeouts or network errors. Triggers the fallback provider. */
export class LlmRetriesExhaustedError extends LlmError {
	readonly lastStatus: number | null;
	readonly attempts: number;
	constructor(attempts: number, lastStatus: number | null, detail: string, providerId?: number) {
		super('retries_exhausted', `Gave up after ${attempts} attempts: ${detail}`, providerId);
		this.attempts = attempts;
		this.lastStatus = lastStatus;
	}
}

/** The provider answered 200 but the body is not what its wire format promises. */
export class LlmBadResponseError extends LlmError {
	constructor(message: string, providerId?: number) {
		super('bad_response', message, providerId);
	}
}

export interface SchemaIssue {
	path: string;
	message: string;
}

/** The output failed Zod validation even after the repair attempt. Never falls back. */
export class LlmSchemaError extends LlmError {
	/** The model's last raw output (redacted), for logging. */
	readonly rawOutput: string;
	readonly issues: SchemaIssue[];
	constructor(rawOutput: string, issues: SchemaIssue[], providerId?: number) {
		super('schema', `Output did not match the schema: ${summarizeIssues(issues)}`, providerId);
		this.rawOutput = rawOutput;
		this.issues = issues;
	}

	override redacted(secrets: readonly (string | undefined | null)[]): this {
		super.redacted(secrets);
		(this as { rawOutput: string }).rawOutput = redact(this.rawOutput, secrets);
		(this as { issues: SchemaIssue[] }).issues = this.issues.map((i) => ({
			path: redact(i.path, secrets),
			message: redact(i.message, secrets)
		}));
		return this;
	}
}

/** The model refused. Never retried, never falls back. */
export class LlmRefusalError extends LlmError {
	readonly detail: string | null;
	constructor(detail: string | null, providerId?: number) {
		super('refusal', `The model refused${detail ? `: ${detail}` : ''}`, providerId);
		this.detail = detail;
	}

	override redacted(secrets: readonly (string | undefined | null)[]): this {
		super.redacted(secrets);
		if (this.detail !== null) (this as { detail: string | null }).detail = redact(this.detail, secrets);
		return this;
	}
}

export function summarizeIssues(issues: readonly SchemaIssue[], max = 8): string {
	const shown = issues.slice(0, max).map((i) => `${i.path || '(root)'}: ${i.message}`);
	return shown.join('; ') + (issues.length > max ? `; and ${issues.length - max} more` : '');
}
