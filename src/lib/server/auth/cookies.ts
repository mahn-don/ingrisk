// Cookie writing for sessions and the theme preference.
import type { Cookies } from '@sveltejs/kit';
import type { Theme } from '../../theme.ts';
import { THEME_COOKIE } from '../../theme.ts';
import { SESSION_COOKIE } from './sessions.ts';

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date, secure: boolean): void {
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: expiresAt });
}

export function clearSessionCookie(cookies: Cookies, secure: boolean): void {
	cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

export function setThemeCookie(cookies: Cookies, theme: Theme, secure: boolean): void {
	cookies.set(THEME_COOKIE, theme, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 400 * 24 * 60 * 60 });
}
