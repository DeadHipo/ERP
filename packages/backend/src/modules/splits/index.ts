import { openModuleDb } from '../../shared/db';
import { SPLITS_DDL, splitsSchema } from './schema';
import { createSplitsService } from './service';

export * from './service';

/** Opens the splits module with its own SQLite file. */
export function openSplitsModule(file: string) {
  const db = openModuleDb(file, SPLITS_DDL, splitsSchema);
  return { service: createSplitsService(db), close: db.close, sqlite: db.sqlite };
}
