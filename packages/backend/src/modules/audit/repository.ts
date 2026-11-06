import { arrayContains, desc, eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgRow, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { actions } from './schema';

export type ActionRow = OrgFree<typeof actions.$inferSelect>;

/** All SQL of the audit module lives here (schema `audit`); every statement is of the organization `org` (D-170). */
export function createAuditRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = orgFree(actions);
  return {
    insert: async (row: OrgFree<typeof actions.$inferInsert>): Promise<ActionRow> =>
      (await orm().insert(actions).values(orgRow(org, row)).returning(C))[0] as ActionRow,
    byEntity: (entityId: string, limit: number, labelId?: string): Promise<ActionRow[]> =>
      orm()
        .select(C)
        .from(actions)
        .where(
          orgWhere(
            org,
            actions,
            arrayContains(actions.entityIds, [entityId]),
            labelId === undefined ? undefined : eq(actions.labelId, labelId),
          ),
        )
        .orderBy(desc(actions.at), desc(actions.id))
        .limit(limit),
    recent: (limit: number, labelId?: string): Promise<ActionRow[]> =>
      orm()
        .select(C)
        .from(actions)
        .where(orgWhere(org, actions, labelId === undefined ? undefined : eq(actions.labelId, labelId)))
        .orderBy(desc(actions.at), desc(actions.id))
        .limit(limit),
    /** The summaries of every row of one route (method + template), oldest first. */
    summariesOf: async (method: string, route: string): Promise<Record<string, unknown>[]> =>
      (
        await orm()
          .select({ summary: actions.summary })
          .from(actions)
          .where(orgWhere(org, actions, eq(actions.method, method), eq(actions.route, route)))
          .orderBy(actions.at, actions.id)
      ).map((r) => r.summary),
  };
}
