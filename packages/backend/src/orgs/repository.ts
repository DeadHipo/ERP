import { asc, eq } from 'drizzle-orm';
import type { Db } from '../shared/pg-db';
import { organizations } from './schema';

export type OrganizationRow = typeof organizations.$inferSelect;

/** All SQL of the organizations (schema `orgs`). Global: the table of organizations is not under an organization. */
export function createOrgsRepository(db: Db) {
  const orm = () => db.orm();
  return {
    insert: async (row: typeof organizations.$inferInsert): Promise<OrganizationRow> =>
      (await orm().insert(organizations).values(row).returning())[0] as OrganizationRow,
    get: async (id: string): Promise<OrganizationRow | undefined> =>
      (await orm().select().from(organizations).where(eq(organizations.id, id)))[0],
    list: (): Promise<OrganizationRow[]> =>
      orm().select().from(organizations).orderBy(asc(organizations.createdAt), asc(organizations.id)),
  };
}

export type OrgsRepository = ReturnType<typeof createOrgsRepository>;
