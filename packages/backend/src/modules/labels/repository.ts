import { asc, eq, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgRow, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { labelAccounts, labelAliases, labels, sublabels } from './schema';

export type LabelRow = OrgFree<typeof labels.$inferSelect>;
export type AliasRow = OrgFree<typeof labelAliases.$inferSelect>;
export type AccountRow = OrgFree<typeof labelAccounts.$inferSelect>;
export type SublabelRow = OrgFree<typeof sublabels.$inferSelect>;

const containsText = (col: AnyColumn, q: string): SQL =>
  sql`lower(${col}) like ${`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`;

/** All SQL of the labels module lives here (schema `labels`); every statement is of the organization `org` (D-170). */
export function createLabelsRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = {
    labels: orgFree(labels),
    labelAliases: orgFree(labelAliases),
    labelAccounts: orgFree(labelAccounts),
    sublabels: orgFree(sublabels),
  };
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insertLabel: async (row: OrgFree<typeof labels.$inferInsert>) => {
      await orm().insert(labels).values(orgRow(org, row));
    },
    getLabel: async (id: string) =>
      (await orm().select(C.labels).from(labels).where(orgWhere(org, labels, eq(labels.id, id))))[0],
    /** The label of this exact name in the organization (`labels_org_name`, D-170). */
    labelByName: async (name: string) =>
      (await orm().select(C.labels).from(labels).where(orgWhere(org, labels, eq(labels.name, name))))[0],
    allLabels: () => orm().select(C.labels).from(labels).where(orgWhere(org, labels)).orderBy(asc(labels.name)),
    getAlias: async (aliasNorm: string) =>
      (
        await orm()
          .select(C.labelAliases)
          .from(labelAliases)
          .where(orgWhere(org, labelAliases, eq(labelAliases.aliasNorm, aliasNorm)))
      )[0],
    insertAlias: async (row: OrgFree<typeof labelAliases.$inferInsert>) => {
      await orm().insert(labelAliases).values(orgRow(org, row));
    },
    /** Substring search (N10): the name or any alias of the label. */
    searchLabels: (q: string, limit: number) =>
      orm()
        .select(C.labels)
        .from(labels)
        .where(
          orgWhere(
            org,
            labels,
            or(
              containsText(labels.name, q),
              sql`${labels.id} in (select ${labelAliases.labelId} from ${labelAliases} where ${orgWhere(org, labelAliases, containsText(labelAliases.alias, q))})`,
            ),
          ),
        )
        .orderBy(asc(labels.name), asc(labels.id))
        .limit(limit),
    allAliases: () =>
      orm()
        .select(C.labelAliases)
        .from(labelAliases)
        .where(orgWhere(org, labelAliases))
        .orderBy(asc(labelAliases.aliasNorm)),
    /** The Believe accounts of the labels (D-168). */
    allAccounts: () =>
      orm()
        .select(C.labelAccounts)
        .from(labelAccounts)
        .where(orgWhere(org, labelAccounts))
        .orderBy(asc(labelAccounts.account)),
    getAccount: async (account: string) =>
      (
        await orm()
          .select(C.labelAccounts)
          .from(labelAccounts)
          .where(orgWhere(org, labelAccounts, eq(labelAccounts.account, account)))
      )[0],
    insertAccount: async (row: OrgFree<typeof labelAccounts.$inferInsert>) => {
      await orm().insert(labelAccounts).values(orgRow(org, row));
    },
    deleteAccount: async (account: string) => {
      await orm().delete(labelAccounts).where(orgWhere(org, labelAccounts, eq(labelAccounts.account, account)));
    },
    /** The sublabels (D-217), by name. */
    allSublabels: () => orm().select(C.sublabels).from(sublabels).where(orgWhere(org, sublabels)).orderBy(asc(sublabels.name)),
    getSublabel: async (id: string) =>
      (await orm().select(C.sublabels).from(sublabels).where(orgWhere(org, sublabels, eq(sublabels.id, id))))[0],
    /** The sublabel of this name without case (`sublabels_org_name`). */
    sublabelByName: async (name: string) =>
      (
        await orm()
          .select(C.sublabels)
          .from(sublabels)
          .where(orgWhere(org, sublabels, sql`lower(${sublabels.name}) = ${name.toLowerCase()}`))
      )[0],
    insertSublabel: async (row: SublabelRow) => {
      await orm().insert(sublabels).values(orgRow(org, row));
    },
    renameSublabel: async (id: string, name: string) => {
      await orm().update(sublabels).set({ name }).where(orgWhere(org, sublabels, eq(sublabels.id, id)));
    },
  };
}
