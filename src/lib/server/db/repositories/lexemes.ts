import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { lexemes } from '../schema.ts';

export type LexemeRow = typeof lexemes.$inferSelect;
export type NewLexeme = Omit<typeof lexemes.$inferInsert, 'id'>;

export function lexemesRepo(db: DbOrTx) {
	return {
		all(): LexemeRow[] {
			return db.select().from(lexemes).orderBy(asc(lexemes.id)).all();
		},
		insert(row: NewLexeme): LexemeRow {
			return db.insert(lexemes).values(row).returning().get();
		},
		update(id: number, patch: Partial<NewLexeme>): void {
			db.update(lexemes).set(patch).where(eq(lexemes.id, id)).run();
		}
	};
}
