// Small formatting helpers for UI strings (the templates live in messages/vi.ts).

/** Replace `{name}` placeholders: fill('Phần {n}/3', { n: 2 }) → 'Phần 2/3'. */
export const fill = (template: string, values: object) =>
	template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String((values as Record<string, unknown>)[key]) : match));

const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });

/** A date as the learner reads it (Vietnam time, so the server and the browser agree). */
export const formatDate = (ms: number) => dateFormat.format(ms);
