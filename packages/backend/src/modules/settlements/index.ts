import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createSettlementsService } from './service';

export * from './service';
export * from './recoup-types';

/** Opens the settlements and payouts module under one organization (D-170) on the shared PostgreSQL database (schema `settlements`, migrations/postgres/0004_settlements.sql). */
export function openSettlementsModule(db: Db, org: OrgScope) {
  return { service: createSettlementsService(db, org) };
}
