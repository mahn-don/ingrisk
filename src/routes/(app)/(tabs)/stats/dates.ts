// Learning dates ('YYYY-MM-DD') as the stats page words them.
import { t } from '#lib/messages/vi.js';

const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dayMonth = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** T2 … CN. */
export const weekdayShort = (date: string) => t.stats.weekdays[KEYS[asDate(date).getUTCDay()]];

/** "5/10". */
export const shortDate = (date: string) => dayMonth.format(asDate(date));

/** "T2 5/10". */
export const dayLabel = (date: string) => `${weekdayShort(date)} ${shortDate(date)}`;
