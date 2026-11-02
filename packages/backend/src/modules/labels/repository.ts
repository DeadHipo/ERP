import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { labelAliases, labelRules, labels } from './schema';

export type LabelRow = typeof labels.$inferSelect;
export type AliasRow = typeof labelAliases.$inferSelect;
export type RuleRow = typeof labelRules.$inferSelect;

/** PostgreSQL pads numeric(9,6) with zeros; the application keeps percents as they were entered. */
const canonicalRule = (r: RuleRow): RuleRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

/** All SQL of the labels module lives here (schema `labels`). */
export function createLabelsRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insertLabel: async (row: typeof labels.$inferInsert) => {
      await orm().insert(labels).values(row);
    },
    getLabel: async (id: string) => (await orm().select().from(labels).where(eq(labels.id, id)))[0],
    allLabels: () => orm().select().from(labels).orderBy(asc(labels.name)),
    getAlias: async (aliasNorm: string) =>
      (await orm().select().from(labelAliases).where(eq(labelAliases.aliasNorm, aliasNorm)))[0],
    insertAlias: async (row: typeof labelAliases.$inferInsert) => {
      await orm().insert(labelAliases).values(row);
    },
    allAliases: () => orm().select().from(labelAliases).orderBy(asc(labelAliases.aliasNorm)),
    insertRule: async (row: typeof labelRules.$inferInsert) => {
      await orm().insert(labelRules).values(row);
    },
    getRule: async (id: string) => {
      const r = (await orm().select().from(labelRules).where(eq(labelRules.id, id)))[0];
      return r ? canonicalRule(r) : undefined;
    },
    rulesOfLabel: async (labelId: string) =>
      (
        await orm()
          .select()
          .from(labelRules)
          .where(eq(labelRules.labelId, labelId))
          .orderBy(asc(labelRules.validFrom))
      ).map(canonicalRule),
    allRules: async () =>
      (await orm().select().from(labelRules).orderBy(asc(labelRules.labelId), asc(labelRules.validFrom))).map(
        canonicalRule,
      ),
    setRuleValidTo: async (id: string, validTo: string | null) => {
      await orm().update(labelRules).set({ validTo }).where(eq(labelRules.id, id));
    },
  };
}
