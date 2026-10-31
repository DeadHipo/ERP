import { openModuleDb } from '../../shared/db';
import { PUBLISHING_DDL, publishingSchema } from './schema';
import { createPublishingService } from './service';

export * from './service';
export { quartersFromFileName, parsePeriodCell } from './b17-format';

/** Opens the publishing module (B17) with its own SQLite file; statements are kept in storageDir. */
export function openPublishingModule(file: string, storageDir: string) {
  const db = openModuleDb(file, PUBLISHING_DDL, publishingSchema);
  return { service: createPublishingService(db, storageDir), close: db.close, sqlite: db.sqlite };
}
