// Small text helpers shared by the content tools. No file I/O.

/** Split raw file contents into lines, dropping a UTF-8 BOM and handling CRLF. */
export function splitLines(raw: string): string[] {
	return raw.replace(/^﻿/, '').split(/\r?\n/);
}

/** Serialize an output file: 2-space indentation and a trailing newline. */
export function toJson(value: unknown): string {
	return JSON.stringify(value, null, 2) + '\n';
}

/** Header shared by every generated content file. */
export interface ContentFile<T> {
	source: string;
	license: string;
	attribution: string;
	count: number;
	items: T[];
}

export function contentFile<T>(
	meta: { source: string; license: string; attribution: string },
	items: T[]
): ContentFile<T> {
	return { ...meta, count: items.length, items };
}
