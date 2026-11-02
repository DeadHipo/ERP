import type { Db } from '../../shared/pg-db';
import { createLabelsService } from './service';

export * from './service';

/** Opens the labels module on the shared PostgreSQL database (schema `labels`, migrations/postgres/0006_labels.sql). */
export function openLabelsModule(db: Db) {
  return { service: createLabelsService(db) };
}
