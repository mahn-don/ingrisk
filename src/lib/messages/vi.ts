// Every user-facing string in the app lives here, grouped by screen.
// `.svelte` files must import from this module instead of containing literals
// (enforced heuristically by `npm run lint:strings`).

type Messages = { readonly [key: string]: string | Messages };

export const t = {
	app: {
		name: 'SilentEnglish'
	},
	home: {
		greeting: 'Xin chào! Hôm nay mình học một chút nhé.',
		tagline: 'Đọc, viết, từ vựng và ngữ pháp tiếng Anh — mỗi ngày 5–10 phút, không cần âm thanh.'
	}
} as const satisfies Messages;
