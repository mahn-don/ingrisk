// The static writing-prompt bank (src/lib/server/content/writing-prompts.json, hand-written).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CONTENT_DIR } from './content-files.ts';

export const WritingPrompt = z
	.object({
		id: z.string().regex(/^[a-z-]+-\d{2}$/),
		band_min: z.number().int().min(1).max(8),
		band_max: z.number().int().min(1).max(8),
		prompt_vi: z.string().min(10),
		hint_en: z.string().min(5),
		min_words: z.number().int().min(10),
		max_words: z.number().int()
	})
	.refine((p) => p.band_min <= p.band_max && p.min_words < p.max_words, 'band or word range reversed');
export type WritingPrompt = z.infer<typeof WritingPrompt>;

export const WritingPromptFile = z.object({ description: z.string(), items: z.array(WritingPrompt) });

export function readWritingPrompts(dir = CONTENT_DIR): WritingPrompt[] {
	return WritingPromptFile.parse(JSON.parse(readFileSync(join(dir, 'writing-prompts.json'), 'utf8'))).items;
}

/** Prompts suitable for a learner at `band`. */
export const promptsForBand = (prompts: readonly WritingPrompt[], band: number) =>
	prompts.filter((p) => p.band_min <= band && band <= p.band_max);
