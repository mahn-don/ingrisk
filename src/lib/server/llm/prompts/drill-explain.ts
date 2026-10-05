// Prompt: a short Vietnamese explanation for an error-correction drill. 10 drills per call.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';

export const PROMPT_VERSION = 'drill-explain@1';
export const PURPOSE = 'drill_explain';

export const system = `You explain English grammar errors to a Vietnamese adult learning English (CEFR A1-B2).

For every item you get a sentence with one error, the corrected sentence, the wrong part, its correction and the error type code:
ART articles, PLU plural forms, SVA subject-verb agreement, COP missing "be", TNS tense, PRE prepositions, COL collocations, WFM word form, WOR word order.

For each item write explanation_vi: at most 2 short sentences in plain, natural Vietnamese that say why the original is wrong and what the rule is. Quote the English words exactly. No grammar jargon beyond simple terms (danh từ, động từ, tính từ, số nhiều, quá khứ, giới từ, mạo từ). Do not start with "Câu này".

Return the items in the order given, with the same n.`;

export interface ExplainItem {
	n: number;
	sentence_with_error: string;
	corrected: string;
	original_span: string;
	corrected_span: string;
	topic_code: string;
}

export function buildUser(items: readonly ExplainItem[]): string {
	return `Items (JSON):\n${JSON.stringify({ items })}`;
}

export const Response = z.object({
	items: z.array(z.object({ n: z.number().int(), explanation_vi: z.string() }))
});
export type Response = z.infer<typeof Response>;
