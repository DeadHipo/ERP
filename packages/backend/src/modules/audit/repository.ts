import { and, arrayContains, desc, eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { actions } from './schema';

export type ActionRow = typeof actions.$inferSelect;

/** All SQL of the audit module lives here (schema `audit`). */
export function createAuditRepository(db: Db) {
  const orm = () => db.orm();
  return {
    insert: async (row: typeof actions.$inferInsert): Promise<ActionRow> =>
      (await orm().insert(actions).values(row).returning())[0] as ActionRow,
    byEntity: (entityId: string, limit: number, labelId?: string): Promise<ActionRow[]> =>
      orm()
        .select()
        .from(actions)
        .where(
          and(
            arrayContains(actions.entityIds, [entityId]),
            labelId === undefined ? undefined : eq(actions.labelId, labelId),
          ),
        )
        .orderBy(desc(actions.at), desc(actions.id))
        .limit(limit),
    recent: (limit: number, labelId?: string): Promise<ActionRow[]> =>
      orm()
        .select()
        .from(actions)
        .where(labelId === undefined ? undefined : eq(actions.labelId, labelId))
        .orderBy(desc(actions.at), desc(actions.id))
        .limit(limit),
  };
}
