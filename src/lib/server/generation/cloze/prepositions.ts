// Prepositions used for PRE gaps and the confusion table their distractors come from. Each entry
// lists the prepositions Vietnamese learners most often confuse it with (at least three).
export const PREPOSITION_CONFUSIONS: Readonly<Record<string, readonly string[]>> = {
	in: ['on', 'at', 'into'],
	on: ['in', 'at', 'onto'],
	at: ['in', 'on', 'to'],
	to: ['for', 'at', 'into'],
	for: ['to', 'of', 'with'],
	of: ['about', 'for', 'from'],
	about: ['of', 'on', 'for'],
	with: ['by', 'to', 'for'],
	by: ['with', 'from', 'at'],
	from: ['of', 'by', 'since'],
	into: ['in', 'to', 'onto'],
	onto: ['on', 'into', 'in'],
	since: ['for', 'from', 'during'],
	during: ['for', 'in', 'while'],
	until: ['by', 'to', 'since'],
	after: ['before', 'behind', 'since'],
	before: ['after', 'until', 'by'],
	under: ['below', 'beneath', 'over'],
	over: ['above', 'on', 'across'],
	through: ['across', 'along', 'over'],
	across: ['through', 'over', 'along'],
	between: ['among', 'through', 'in'],
	among: ['between', 'within', 'in']
};

/** Single-word distractor candidates only (e.g. "in front of" is dropped). */
export function prepositionDistractors(preposition: string): string[] {
	return (PREPOSITION_CONFUSIONS[preposition] ?? []).filter((p) => !p.includes(' '));
}

export const PREPOSITIONS: ReadonlySet<string> = new Set(
	Object.keys(PREPOSITION_CONFUSIONS).filter((p) => prepositionDistractors(p).length >= 3)
);
