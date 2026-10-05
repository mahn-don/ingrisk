// Function words never used as lexical cloze gaps (lemmas, lowercase). About 150 words:
// articles, pronouns, auxiliaries and modals, prepositions, conjunctions, determiners,
// quantifiers and the most grammatical adverbs. Grammar gaps (articles, prepositions,
// verb forms) are handled by their own gap types instead.
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
	// articles and determiners
	'a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'any', 'no', 'every', 'each',
	'either', 'neither', 'another', 'other', 'such', 'what', 'which', 'whose', 'whatever', 'whichever',
	// quantifiers
	'all', 'both', 'few', 'little', 'many', 'much', 'more', 'most', 'less', 'least', 'several',
	'enough', 'lot', 'one', 'none', 'half',
	// pronouns
	'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him',
	'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'we', 'us', 'our', 'ours',
	'ourselves', 'they', 'them', 'their', 'theirs', 'themselves', 'who', 'whom', 'whoever', 'someone',
	'somebody', 'something', 'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything',
	'nobody', 'nothing', 'one',
	// auxiliaries and modals
	'be', 'have', 'do', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
	'ought', 'need', 'dare', 'get',
	// prepositions and particles
	'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'as', 'at', 'before',
	'behind', 'below', 'beneath', 'beside', 'besides', 'between', 'beyond', 'by', 'despite', 'down',
	'during', 'except', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto',
	'out', 'outside', 'over', 'past', 'per', 'since', 'than', 'through', 'throughout', 'till', 'to',
	'toward', 'towards', 'under', 'until', 'up', 'upon', 'via', 'with', 'within', 'without',
	// conjunctions
	'and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although', 'though', 'if', 'unless', 'whether',
	'while', 'when', 'where', 'why', 'how', 'once', 'whereas', 'however', 'therefore', 'thus',
	// grammatical adverbs
	'not', 'very', 'too', 'also', 'just', 'only', 'even', 'still', 'already', 'ever', 'never', 'always',
	'often', 'sometimes', 'then', 'there', 'here', 'now', 'again', 'quite', 'rather', 'really', 'else',
	'yes', 'no', 'oh', 'ok', 'okay', 'please', 'well', 'hi', 'yeah'
]);
