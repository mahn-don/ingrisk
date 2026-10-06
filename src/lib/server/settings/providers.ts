// "Nhà cung cấp AI": provider rows as the settings page shows and edits them. Keys live only in
// the server's environment: the page sees the NAME of the variable and whether it is set (a
// boolean), never a value, and no form field accepts a key.
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { type Provider, providersRepo } from '../db/repositories/providers.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { STRUCTURED_MODES, WIRE_FORMATS } from '../db/schema.ts';
import { assertAllowedBaseUrl } from '../llm/config.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** An environment variable NAME (upper case): a pasted key is rejected. Same rule as the CHECK. */
export const ENV_KEY_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const allowedUrl = (value: string) => {
	try {
		assertAllowedBaseUrl(value);
		return true;
	} catch {
		return false;
	}
};

export const ProviderForm = z
	.object({
		name: z.string().trim().min(1).max(40),
		baseUrl: z.string().trim().max(300).refine(allowedUrl),
		model: z.string().trim().min(1).max(120),
		wireFormat: z.enum(WIRE_FORMATS),
		structuredMode: z.enum(STRUCTURED_MODES),
		envKeyName: z
			.string()
			.trim()
			.transform((v) => (v === '' ? null : v))
			.pipe(z.string().regex(ENV_KEY_NAME).nullable())
	})
	.strict()
	.refine((p) => p.wireFormat !== 'anthropic' || p.envKeyName !== null, { path: ['envKeyName'] });
export type ProviderForm = z.output<typeof ProviderForm>;

const FIELDS = ['name', 'baseUrl', 'model', 'wireFormat', 'structuredMode', 'envKeyName'] as const;

/** Parse the provider form (only its own fields are read); on failure, the invalid field names. */
export function parseProviderForm(form: FormData): { ok: true; value: ProviderForm } | { ok: false; fields: string[] } {
	const raw = Object.fromEntries(FIELDS.map((f) => [f, form.get(f) ?? '']));
	const parsed = ProviderForm.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
}

export interface ProviderView {
	id: number;
	name: string;
	baseUrl: string;
	model: string;
	wireFormat: Provider['wireFormat'];
	structuredMode: Provider['structuredMode'];
	envKeyName: string | null;
	/** Whether the variable is set in the server's environment now; null when no key is needed. */
	keySet: boolean | null;
	enabled: boolean;
	isFallback: boolean;
	active: boolean;
}

/** Every provider as the page shows it: the key's presence only, never its value. */
export function providerViews(db: DbOrTx, env: Env = process.env): ProviderView[] {
	const activeId = settingsRepo(db).get().activeProviderId;
	return providersRepo(db)
		.list()
		.map((p) => ({
			id: p.id,
			name: p.name,
			baseUrl: p.baseUrl,
			model: p.model,
			wireFormat: p.wireFormat,
			structuredMode: p.structuredMode,
			envKeyName: p.envKeyName,
			keySet: p.envKeyName === null ? null : (env[p.envKeyName] ?? '').trim() !== '',
			enabled: p.enabled,
			isFallback: p.isFallback,
			active: p.id === activeId
		}));
}

export type SaveResult = { ok: true; id: number } | { ok: false; error: 'name_taken' | 'not_found' };

/** Add a provider, or edit `id`. A name already used by another provider is refused. */
export function saveProvider(db: DbOrTx, value: ProviderForm, id?: number): SaveResult {
	const repo = providersRepo(db);
	const sameName = repo.byName(value.name);
	if (sameName !== undefined && sameName.id !== id) return { ok: false, error: 'name_taken' };
	if (id === undefined) return { ok: true, id: repo.insert(value).id };
	const updated = repo.update(id, value);
	return updated === undefined ? { ok: false, error: 'not_found' } : { ok: true, id };
}

export function deleteProvider(db: DbOrTx, id: number): boolean {
	return providersRepo(db).remove(id);
}

/** Make `id` the active provider. */
export function setActiveProvider(db: DbOrTx, id: number): boolean {
	if (providersRepo(db).byId(id) === undefined) return false;
	settingsRepo(db).update({ activeProviderId: id });
	return true;
}

/** Make `id` the single fallback provider, or clear the fallback (null). */
export function setFallbackProvider(db: DbOrTx, id: number | null): boolean {
	if (id !== null && providersRepo(db).byId(id) === undefined) return false;
	providersRepo(db).setFallback(id);
	return true;
}
