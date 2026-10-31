import { openModuleDb } from '../../shared/db';
import { OWNERS_DDL, ownersSchema } from './schema';
import { createOwnersService } from './service';

export * from './service';

/** Opens module 1 with its own SQLite file. */
export function openOwnersModule(file: string) {
  const db = openModuleDb(file, OWNERS_DDL, ownersSchema);
  return { service: createOwnersService(db), close: db.close, sqlite: db.sqlite };
}
