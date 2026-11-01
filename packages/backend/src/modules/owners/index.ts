import type { Db } from '../../shared/pg-db';
import { createOwnersService } from './service';

export * from './service';

/** Opens module 1 on the shared PostgreSQL database (schema `owners`, migrations/postgres/0003_owners.sql). */
export function openOwnersModule(db: Db) {
  return { service: createOwnersService(db) };
}
