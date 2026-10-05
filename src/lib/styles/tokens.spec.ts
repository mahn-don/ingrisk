import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/lib/styles/tokens.css', 'utf8');

/** The --name: #hex declarations of each block, in file order: light, dark (chosen), dark (system). */
function blocks(): Record<string, string>[] {
	return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) =>
		Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((d) => [d[1], d[2].toLowerCase()]))
	);
}

const luminance = (hex: string) => {
	const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map((h) => {
		const v = parseInt(h, 16) / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/** Every text/background pair the components use (WCAG AA for normal text: 4.5:1). */
const TEXT_PAIRS: [string, string][] = [
	['text', 'bg'],
	['text', 'surface'],
	['text', 'surface-2'],
	['muted', 'bg'],
	['muted', 'surface'],
	['muted', 'surface-2'],
	['primary', 'bg'],
	['primary', 'surface'],
	['primary-contrast', 'primary'],
	['text', 'primary-soft'],
	['primary', 'primary-soft'],
	['correct', 'surface'],
	['correct', 'correct-soft'],
	['text', 'correct-soft'],
	['incorrect', 'surface'],
	['incorrect', 'incorrect-soft'],
	['text', 'incorrect-soft'],
	['warning', 'surface'],
	['warning', 'warning-soft']
];
/** Boundaries of interactive controls (WCAG 1.4.11: 3:1). */
const CONTROL_PAIRS: [string, string][] = [
	['control', 'surface'],
	['control', 'bg']
];

describe('colour tokens', () => {
	const [light, dark, systemDark] = blocks();

	it('defines the same tokens for light and dark, and the two dark blocks match', () => {
		expect(Object.keys(light).length).toBeGreaterThanOrEqual(16);
		expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
		expect(systemDark).toEqual(dark);
	});

	for (const [name, theme] of [
		['light', 0],
		['dark', 1]
	] as const) {
		it(`meets WCAG AA in the ${name} theme`, () => {
			const tokens = blocks()[theme];
			for (const [fg, bg] of TEXT_PAIRS) expect(contrast(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
			for (const [fg, bg] of CONTROL_PAIRS) expect(contrast(tokens[fg], tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
		});
	}
});
