// The colour theme preference, stored in a cookie so the server renders the right theme on the
// first paint (no flash). "system" follows prefers-color-scheme.

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = 'theme';

export const parseTheme = (value: string | null | undefined): Theme =>
	(THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'system';
