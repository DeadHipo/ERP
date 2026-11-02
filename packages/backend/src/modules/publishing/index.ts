import type { Db } from '../../shared/pg-db';
import { createPublishingService } from './service';

export * from './service';
export { quartersFromFileName, parsePeriodCell, parseSongwriters } from './b17-format';

/**
 * Opens the publishing module (B17) on the shared PostgreSQL database (schema `publishing`,
 * migrations/postgres/0005_publishing.sql); the original statements are kept in storageDir.
 */
export function openPublishingModule(db: Db, storageDir: string) {
  return { service: createPublishingService(db, storageDir) };
}
