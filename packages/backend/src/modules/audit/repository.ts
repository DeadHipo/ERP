import { arrayContains, desc } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { actions } from './schema';

export type ActionRow = typeof actions.$inferSelect;

/** All SQL of the audit module lives here (schema `audit`). */
export function createAuditRepository(db: Db) {
  const orm = () => db.orm();
  return {
    insert: async (row: typeof actions.$inferInsert): Promise<ActionRow> =>
      (await orm().insert(actions).values(row).returning())[0] as ActionRow,
    byEntity: (entityId: string, limit: number): Promise<ActionRow[]> =>
      orm()
        .select()
        .from(actions)
        .where(arrayContains(actions.entityIds, [entityId]))
        .orderBy(desc(actions.at), desc(actions.id))
        .limit(limit),
    recent: (limit: number): Promise<ActionRow[]> =>
      orm().select().from(actions).orderBy(desc(actions.at), desc(actions.id)).limit(limit),
  };
}
