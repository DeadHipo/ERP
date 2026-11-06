import { randomUUID } from 'node:crypto';
import { AppError, ConflictError, ValidationError } from '../shared/errors';
import type { Facade } from '../facade';
import type { Db } from '../shared/pg-db';
import { createOrgsRepository, type OrganizationRow } from './repository';

export type Organization = OrganizationRow;

/** `404 org_not_found`: `X-Org`, ERP_DEFAULT_ORG, the organization of a session or `:id` is not an organization. */
export class OrgNotFoundError extends AppError {
  constructor(id: string) {
    super(`Organization ${id} not found`, 404, 'org_not_found');
  }
}

/** The counts of an organization's screen (no money): through its facade, the users from the auth service. */
export async function orgCounts(facade: Facade, users: number) {
  const m = facade.modules;
  const [labels, files, statements, owners] = await Promise.all([
    m.labels.listLabels(),
    m.sources.listFiles(),
    m.publishing.listStatements(),
    m.owners.listOwners(),
  ]);
  return {
    labels: labels.length,
    files: files.filter((f) => f.status === 'loaded').length,
    statements: statements.filter((s) => s.status === 'loaded').length, // a superseded one is not counted (D-173)
    owners: owners.length,
    users,
  };
}

/**
 * The labels of a `label_manager` (D-171) must be own labels of the organization: an unknown id (or one of another
 * organization) is `404 not_found`, a sublabel `400 label_not_own`. Checked through the organization's facade by the
 * caller of the auth service (the route, `scripts/create-user.ts`).
 */
export async function assertOwnLabels(facade: Facade, labelIds: string[]): Promise<void> {
  for (const id of new Set(labelIds)) {
    const l = await facade.modules.labels.getLabel(id);
    if (l.kind !== 'own')
      throw new ValidationError(`Label "${l.name}" is a sublabel; a manager is given own labels`, { labelId: id }, 'label_not_own');
  }
}

/**
 * The organizations (stage 2, D-170). The id is always generated here (a UUID), never taken from a client. The name
 * is unique without regard to case (`organizations_name_key`, `409 org_name_taken`).
 */
export function createOrgsService(db: Db) {
  const repo = createOrgsRepository(db);
  return {
    async createOrganization(input: { name: string; createdBy: string }): Promise<Organization> {
      const name = input.name.trim();
      if (name === '') throw new ValidationError('The name of an organization is required');
      try {
        return await repo.insert({ id: randomUUID(), name, createdBy: input.createdBy });
      } catch (e) {
        const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
        const pgErr = err.cause ?? err;
        if (pgErr.code === '23505' && pgErr.constraint === 'organizations_name_key')
          throw new ConflictError(`An organization named "${name}" already exists`, 'org_name_taken');
        throw e;
      }
    },
    async getOrganization(id: string): Promise<Organization> {
      const row = await repo.get(id);
      if (!row) throw new OrgNotFoundError(id);
      return row;
    },
    /** The organization or undefined (startup and scripts check an id without an exception). */
    findOrganization: (id: string): Promise<Organization | undefined> => repo.get(id),
    listOrganizations: (): Promise<Organization[]> => repo.list(),
  };
}

export type OrgsService = ReturnType<typeof createOrgsService>;
