import { openModuleDb } from '../../shared/db';
import { SETTLEMENTS_DDL, settlementsSchema } from './schema';
import { createSettlementsService } from './service';

export * from './service';
export * from './recoup';

/** Opens the settlements and payouts module with its own SQLite file. */
export function openSettlementsModule(file: string) {
  const db = openModuleDb(file, SETTLEMENTS_DDL, settlementsSchema);
  return { service: createSettlementsService(db), close: db.close, sqlite: db.sqlite };
}
