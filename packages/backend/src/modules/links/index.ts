import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createLinksService } from './service';

export * from './service';

/** Opens the links module under one organization (schema `links`, migrations/postgres/0024_links.sql, D-183). */
export function openLinksModule(db: Db, org: OrgScope) {
  return { service: createLinksService(db, org) };
}
