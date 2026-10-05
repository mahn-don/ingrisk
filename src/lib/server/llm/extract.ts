// Pulling a JSON object out of model text (json_prompt mode, or text-wrapped native output).

/** The first balanced `{...}` in `text`, honouring strings and escapes; null if there is none. */
function outermostObject(text: string): string | null {
	const start = text.indexOf('{');
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
		} else if (ch === '"') inString = true;
		else if (ch === '{') depth++;
		else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
	}
	return null;
}

/**
 * Parse a JSON object from model output: strips markdown code fences and any prose before or
 * after, then takes the outermost object. Throws SyntaxError when no object can be parsed.
 */
export function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed);
	const candidates = [fenced?.[1], trimmed].filter((c): c is string => c !== undefined);
	for (const candidate of candidates) {
		const object = outermostObject(candidate);
		if (object !== null) {
			try {
				return JSON.parse(object);
			} catch {
				// try the next candidate
			}
		}
	}
	throw new SyntaxError('No JSON object found in the model output');
}
