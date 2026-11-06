import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createLabelsService } from './service';

export * from './service';

/** Opens the labels module under one organization (D-170) on the shared PostgreSQL database (schema `labels`, migrations/postgres/0006_labels.sql). */
export function openLabelsModule(db: Db, org: OrgScope) {
  return { service: createLabelsService(db, org) };
}
