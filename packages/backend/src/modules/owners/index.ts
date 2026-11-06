import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createOwnersService } from './service';

export * from './service';

/** Opens module 1 under one organization (D-170) on the shared PostgreSQL database (schema `owners`, migrations/postgres/0003_owners.sql). */
export function openOwnersModule(db: Db, org: OrgScope) {
  return { service: createOwnersService(db, org) };
}
