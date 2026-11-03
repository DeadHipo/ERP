import type { Db } from '../../shared/pg-db';
import { createAuditService } from './service';

export * from './service';

/** Opens the audit module on the shared PostgreSQL database (schema `audit`, migrations/postgres/0011_audit_search.sql). */
export function openAuditModule(db: Db) {
  return { service: createAuditService(db) };
}
