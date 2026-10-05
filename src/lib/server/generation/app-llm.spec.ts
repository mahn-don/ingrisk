import { describe, expect, it } from 'vitest';
import { providersRepo } from '../db/repositories/providers.ts';
import { createTestDb } from '../db/test-db.ts';
import { startServer } from '../startup.ts';
import { CANNED_PROVIDER, assertLlmModeAllowed, cannedLlmEnabled, llmConfigured } from './app-llm.ts';

describe('the canned LLM flag', () => {
	it('is on only for LLM_CANNED=1', () => {
		expect(cannedLlmEnabled({ LLM_CANNED: '1' })).toBe(true);
		expect(cannedLlmEnabled({ LLM_CANNED: 'true' })).toBe(false);
		expect(cannedLlmEnabled({})).toBe(false);
	});

	it('is refused in production, and startup throws before opening the database', () => {
		expect(() => assertLlmModeAllowed({ LLM_CANNED: '1', NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
		expect(() => startServer({ LLM_CANNED: '1', NODE_ENV: 'production' })).toThrow(/LLM_CANNED/);
		expect(() => assertLlmModeAllowed({ LLM_CANNED: '1', NODE_ENV: 'test' })).not.toThrow();
		expect(() => assertLlmModeAllowed({ NODE_ENV: 'production' })).not.toThrow();
	});

	it('counts as configured in canned mode, otherwise only with an active provider', () => {
		const db = createTestDb();
		expect(llmConfigured(db, {})).toBe(false);
		expect(llmConfigured(db, { LLM_CANNED: '1' })).toBe(true);
		expect(providersRepo(db).active()).toBeUndefined();
		expect(CANNED_PROVIDER).toBe('canned');
	});
});
