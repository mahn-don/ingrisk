import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { type TOPIC_CODES, grammarTopics } from '../schema.ts';

export type GrammarTopic = typeof grammarTopics.$inferSelect;
export type TopicCode = (typeof TOPIC_CODES)[number];

/** The L1 interference taxonomy (seeded by the initial migration; read-only). */
export function grammarTopicsRepo(db: DbOrTx) {
	return {
		all(): GrammarTopic[] {
			return db.select().from(grammarTopics).orderBy(asc(grammarTopics.id)).all();
		},
		byCode(code: TopicCode): GrammarTopic | undefined {
			return db.select().from(grammarTopics).where(eq(grammarTopics.code, code)).get();
		}
	};
}
