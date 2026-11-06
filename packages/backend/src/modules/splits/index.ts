import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createSplitsService } from './service';

export * from './service';

/** Opens the splits module under one organization (D-170) on the shared PostgreSQL database (schema `splits`, migrations/postgres/0002_splits.sql). */
export function openSplitsModule(db: Db, org: OrgScope) {
  return { service: createSplitsService(db, org) };
}
