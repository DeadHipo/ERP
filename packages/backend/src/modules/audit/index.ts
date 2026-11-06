import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createAuditService } from './service';

export * from './service';

/** Opens the audit module under one organization (D-170) on the shared PostgreSQL database (schema `audit`, migrations/postgres/0011_audit_search.sql). */
export function openAuditModule(db: Db, org: OrgScope) {
  return { service: createAuditService(db, org) };
}
