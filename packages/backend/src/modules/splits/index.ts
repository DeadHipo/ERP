import type { Db } from '../../shared/pg-db';
import { createSplitsService } from './service';

export * from './service';

/** Opens the splits module on the shared PostgreSQL database (schema `splits`, migrations/postgres/0002_splits.sql). */
export function openSplitsModule(db: Db) {
  return { service: createSplitsService(db) };
}
