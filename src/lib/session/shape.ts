// Which session shape today: Nhanh (quick), Đọc (read) or Viết (write). Pure rules, shared by
// the server (composition) and Home (the label follows the budget chips). See Part I §8.
import type { SessionShape, ShapeOption } from './types.ts';

/** A budget at or under this is always quick. */
export const QUICK_BUDGET_MIN = 5;
export interface ShapeContext {
	budgetMin: number;
	/** Shape of the most recent finished non-quick session. */
	lastNonQuick: 'read' | 'write' | null;
	unseenFeedback: boolean;
	/** A cached passage at the right band. */
	readAvailable: boolean;
	/** An LLM provider to grade writing. */
	writeAvailable: boolean;
}

const available = (ctx: ShapeContext, shape: SessionShape) =>
	shape === 'quick' || (shape === 'read' ? ctx.readAvailable : ctx.writeAvailable);

/**
 * In priority order: a 5-minute budget is quick; otherwise alternate read and write after the last
 * non-quick session (read first); unseen graded feedback prefers read; then fall back when content
 * or a provider is missing (no passage → write, no provider → read, neither → quick).
 */
export function defaultShape(ctx: ShapeContext): SessionShape {
	if (ctx.budgetMin <= QUICK_BUDGET_MIN) return 'quick';
	let shape: SessionShape = ctx.lastNonQuick === 'read' ? 'write' : 'read';
	if (ctx.unseenFeedback) shape = 'read';
	if (available(ctx, shape)) return shape;
	const other: SessionShape = shape === 'read' ? 'write' : 'read';
	return available(ctx, other) ? other : 'quick';
}

/** The shapes the learner may pick on Home, the default first... in a fixed order. */
export const shapeOptions = (ctx: ShapeContext): ShapeOption[] =>
	(['quick', 'read', 'write'] as const).map((shape) => ({ shape, available: available(ctx, shape) }));

/** The shape to use: the override if it is available, else the default. Null: override refused. */
export function resolveShape(ctx: ShapeContext, override?: SessionShape): SessionShape | null {
	if (override === undefined) return defaultShape(ctx);
	return available(ctx, override) ? override : null;
}

