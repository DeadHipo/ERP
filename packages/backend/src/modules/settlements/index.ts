import type { Db } from '../../shared/pg-db';
import { createSettlementsService } from './service';

export * from './service';
export * from './recoup-types';

/** Opens the settlements and payouts module on the shared PostgreSQL database (schema `settlements`, migrations/postgres/0004_settlements.sql). */
export function openSettlementsModule(db: Db) {
  return { service: createSettlementsService(db) };
}
