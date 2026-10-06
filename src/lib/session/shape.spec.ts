import { describe, expect, it } from 'vitest';
import { type ShapeContext, defaultShape, resolveShape, shapeOptions } from './shape.ts';

const ctx = (over: Partial<ShapeContext> = {}): ShapeContext => ({
	budgetMin: 8,
	lastNonQuick: null,
	unseenFeedback: false,
	readAvailable: true,
	writeAvailable: true,
	...over
});

describe('session shape rotation', () => {
	it('1. a 5-minute budget is always quick', () => {
		expect(defaultShape(ctx({ budgetMin: 5 }))).toBe('quick');
		expect(defaultShape(ctx({ budgetMin: 5, unseenFeedback: true }))).toBe('quick');
		expect(defaultShape(ctx({ budgetMin: 8 }))).not.toBe('quick');
	});

	it('2. alternates read and write after the last non-quick session, read first', () => {
		expect(defaultShape(ctx())).toBe('read');
		expect(defaultShape(ctx({ lastNonQuick: 'read' }))).toBe('write');
		expect(defaultShape(ctx({ lastNonQuick: 'write' }))).toBe('read');
	});

	it('3. unseen graded feedback prefers read', () => {
		expect(defaultShape(ctx({ lastNonQuick: 'read', unseenFeedback: true }))).toBe('read');
	});

	it('4. falls back when a passage or a provider is missing', () => {
		expect(defaultShape(ctx({ readAvailable: false }))).toBe('write');
		expect(defaultShape(ctx({ lastNonQuick: 'read', writeAvailable: false }))).toBe('read');
		expect(defaultShape(ctx({ unseenFeedback: true, readAvailable: false }))).toBe('write');
		expect(defaultShape(ctx({ readAvailable: false, writeAvailable: false }))).toBe('quick');
	});

	it('accepts an override only when that shape is available', () => {
		expect(resolveShape(ctx(), 'write')).toBe('write');
		expect(resolveShape(ctx({ budgetMin: 5 }), 'read')).toBe('read');
		expect(resolveShape(ctx({ readAvailable: false }), 'read')).toBeNull();
		expect(resolveShape(ctx({ writeAvailable: false }), 'write')).toBeNull();
		expect(resolveShape(ctx({ readAvailable: false, writeAvailable: false }), 'quick')).toBe('quick');
		expect(resolveShape(ctx({ lastNonQuick: 'read' }))).toBe('write');
		expect(shapeOptions(ctx({ writeAvailable: false }))).toEqual([
			{ shape: 'quick', available: true },
			{ shape: 'read', available: true },
			{ shape: 'write', available: false }
		]);
	});
});
