import { asc, eq, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { orgFree, orgRow, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { labelAccounts, labelAliases, labelRules, labels } from './schema';

export type LabelRow = OrgFree<typeof labels.$inferSelect>;
export type AliasRow = OrgFree<typeof labelAliases.$inferSelect>;
export type RuleRow = OrgFree<typeof labelRules.$inferSelect>;
export type AccountRow = OrgFree<typeof labelAccounts.$inferSelect>;

/** PostgreSQL pads numeric(9,6) with zeros; the application keeps percents as they were entered. */
const canonicalRule = (r: RuleRow): RuleRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

const containsText = (col: AnyColumn, q: string): SQL =>
  sql`lower(${col}) like ${`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`;

/** All SQL of the labels module lives here (schema `labels`); every statement is of the organization `org` (D-170). */
export function createLabelsRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = {
    labels: orgFree(labels),
    labelAliases: orgFree(labelAliases),
    labelRules: orgFree(labelRules),
    labelAccounts: orgFree(labelAccounts),
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
    insertRule: async (row: OrgFree<typeof labelRules.$inferInsert>) => {
      await orm().insert(labelRules).values(orgRow(org, row));
    },
    getRule: async (id: string) => {
      const r = (
        await orm().select(C.labelRules).from(labelRules).where(orgWhere(org, labelRules, eq(labelRules.id, id)))
      )[0];
      return r ? canonicalRule(r) : undefined;
    },
    rulesOfLabel: async (labelId: string) =>
      (
        await orm()
          .select(C.labelRules)
          .from(labelRules)
          .where(orgWhere(org, labelRules, eq(labelRules.labelId, labelId)))
          .orderBy(asc(labelRules.validFrom))
      ).map(canonicalRule),
    allRules: async () =>
      (
        await orm()
          .select(C.labelRules)
          .from(labelRules)
          .where(orgWhere(org, labelRules))
          .orderBy(asc(labelRules.labelId), asc(labelRules.validFrom))
      ).map(canonicalRule),
    setRuleValidTo: async (id: string, validTo: string | null) => {
      await orm().update(labelRules).set({ validTo }).where(orgWhere(org, labelRules, eq(labelRules.id, id)));
    },
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
  };
}
