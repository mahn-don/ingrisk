// Everyday concrete and topic words that graded passages need but NGSL ranks above the lowest
// bands (gift, cake, soup, online, borrow, bowl …). For bands ≤ EVERYDAY_MAX_BAND they count as
// known in the coverage rule, and the passage prompt lists them as allowed. Lemmas, lowercase.

/** Bands for which the everyday words count as known. */
export const EVERYDAY_MAX_BAND = 4;

const GROUPS = {
	food: [
		'bread', 'rice', 'noodle', 'soup', 'cake', 'egg', 'fish', 'chicken', 'beef', 'pork', 'meat', 'fruit',
		'apple', 'banana', 'orange', 'mango', 'vegetable', 'tomato', 'potato', 'salad', 'sugar', 'salt', 'tea',
		'coffee', 'milk', 'juice', 'water', 'breakfast', 'lunch', 'dinner', 'snack', 'sandwich', 'pizza', 'bowl',
		'plate', 'cup', 'glass', 'spoon', 'fork', 'knife', 'chopstick', 'menu', 'restaurant', 'market', 'cook', 'delicious'
	],
	family: [
		'mother', 'father', 'mom', 'dad', 'parent', 'brother', 'sister', 'son', 'daughter', 'grandmother',
		'grandfather', 'grandma', 'grandpa', 'aunt', 'uncle', 'cousin', 'baby', 'husband', 'wife', 'friend',
		'neighbour', 'neighbor', 'birthday', 'gift', 'present', 'party', 'wedding', 'visit'
	],
	home: [
		'house', 'apartment', 'room', 'kitchen', 'bedroom', 'bathroom', 'garden', 'door', 'window', 'bed', 'chair',
		'table', 'sofa', 'lamp', 'shelf', 'floor', 'wall', 'roof', 'key', 'clock', 'towel', 'shower', 'clean', 'wash',
		'pet', 'dog', 'cat', 'bike', 'bicycle', 'motorbike', 'car', 'bus', 'train', 'street'
	],
	school: [
		'school', 'class', 'classroom', 'teacher', 'student', 'lesson', 'homework', 'exam', 'test', 'book',
		'notebook', 'pen', 'pencil', 'bag', 'desk', 'library', 'borrow', 'lend', 'page', 'story', 'subject',
		'math', 'English', 'music', 'art', 'sport', 'football', 'game', 'team'
	],
	time: [
		'morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow', 'yesterday', 'weekend', 'week', 'month',
		'holiday', 'minute', 'hour', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
		'early', 'late'
	],
	weather: ['weather', 'sun', 'sunny', 'rain', 'rainy', 'wind', 'windy', 'cloud', 'cloudy', 'hot', 'cold', 'warm', 'cool', 'snow', 'storm', 'umbrella', 'season', 'summer', 'winter'],
	tech: ['phone', 'computer', 'laptop', 'internet', 'online', 'email', 'message', 'photo', 'camera', 'video', 'screen', 'app', 'website', 'text', 'call', 'charge']
} as const;

export const EVERYDAY_WORDS: ReadonlySet<string> = new Set(Object.values(GROUPS).flat().map((w) => w.toLowerCase()));

/** Whether `word` (lowercase) or its lemma is an everyday word: plain plurals and -ed/-ing forms included. */
export function isEveryday(word: string, lemma?: string): boolean {
	const candidates = [word, lemma, word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, ''), word.replace(/ed$/, ''), word.replace(/ing$/, '')];
	return candidates.some((c) => c !== undefined && EVERYDAY_WORDS.has(c));
}
