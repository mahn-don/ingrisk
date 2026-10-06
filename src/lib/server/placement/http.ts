// Request parsing and error mapping for the placement API routes (the routes stay thin).
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { PlacementError } from './engine.ts';

const Id = z.number().int().positive();

export const StartBody = z.object({ restart: z.boolean().optional() }).strict();
export const AnswerBody = z
	.object({
		attemptId: Id,
		itemRef: z.string().min(1).max(20),
		answer: z.union([z.boolean(), z.number().int().min(0).max(3)]),
		responseMs: z.number().min(0).max(1e9)
	})
	.strict();
export const WritingBody = z.union([
	z.object({ attemptId: Id, text: z.string().max(20_000) }).strict(),
	z.object({ attemptId: Id, skip: z.literal(true) }).strict()
]);

/** Parse a JSON body with `schema`; a PlacementError (400) when it does not match. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw new PlacementError(400, 'invalid', 'body is not JSON');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new PlacementError(400, 'invalid', 'body does not match');
	return parsed.data;
}

/** Run a handler; PlacementErrors become `{ error: code }` with their status. */
export async function placementResponse(handler: () => unknown): Promise<Response> {
	try {
		return json(await handler());
	} catch (error) {
		if (error instanceof PlacementError) return json({ error: error.code }, { status: error.status });
		throw error;
	}
}
