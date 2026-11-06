import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createPubV2Service } from './service';

export * from './service';
export { quarterOfFileName, readB17Summary } from './summary-format';

/** Opens publishing v2 under one organization (schema `pubv2`, migrations/postgres/0023_pubv2.sql, D-182). */
export function openPubV2Module(db: Db, org: OrgScope, storageDir: string) {
  return { service: createPubV2Service(db, org, storageDir) };
}
