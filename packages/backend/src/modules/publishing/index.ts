import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createPublishingService } from './service';

export * from './service';
export { quartersFromFileName, parsePeriodCell, parseSongwriters } from './b17-format';

/**
 * Opens the publishing module (B17) under one organization (D-170) on the shared PostgreSQL database (schema `publishing`,
 * migrations/postgres/0005_publishing.sql); the original statements are kept in storageDir.
 */
export function openPublishingModule(db: Db, org: OrgScope, storageDir: string) {
  return { service: createPublishingService(db, org, storageDir) };
}
