// Request parsing and error mapping for the session API routes (the routes stay thin).
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { SessionError } from './engine.ts';

const Shape = z.enum(['quick', 'read', 'write']);
const Id = z.number().int().positive();

export const StartBody = z.object({ budgetMin: z.number().int().min(1).max(60).optional(), shape: Shape.optional() }).strict();
export const AnchorBody = z.object({ sessionId: Id, text: z.string().max(20_000) }).strict();
export const GlossaryBody = z.object({ sessionId: Id, word: z.string().min(1).max(60) }).strict();
export const FeedbackSeenBody = z.object({ submissionId: Id }).strict();

const DrillResult = z.object({ cacheId: Id, correct: z.boolean(), responseMs: z.number().min(0).max(1e9) }).strict();
const AnchorResult = z.discriminatedUnion('type', [
	z.object({ type: z.literal('reading'), cacheId: Id, answers: z.array(z.number().int().min(0).max(3)).max(10) }).strict(),
	z.object({ type: z.literal('writing') }).strict(),
	z.object({ type: z.literal('translation') }).strict()
]);

const Result = z
	.object({
		cardId: z.number().int().positive(),
		correct: z.boolean(),
		mode: z.enum(['choice', 'typing']),
		responseMs: z.number().min(0).max(1e9),
		hintUsed: z.boolean(),
		ratingOverride: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
		answeredOffsetMs: z.number().int().max(1e10)
	})
	.strict();

export const FinishBody = z
	.object({
		sessionId: z.number().int().positive(),
		clientSessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
		results: z.array(Result).max(100),
		drills: z.array(DrillResult).max(10).optional(),
		anchor: AnchorResult.optional()
	})
	.strict();

/** Parse a JSON body with `schema`; a SessionError (400) when it does not match. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw new SessionError(400, 'invalid', 'body is not JSON');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new SessionError(400, 'invalid', 'body does not match');
	return parsed.data;
}

/** Run a handler; SessionErrors become `{ error: code }` with their status. */
export async function sessionResponse(handler: () => unknown): Promise<Response> {
	try {
		return json(await handler());
	} catch (error) {
		if (error instanceof SessionError) return json({ error: error.code }, { status: error.status });
		throw error;
	}
}
