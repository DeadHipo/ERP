/**
 * Writer names (legal names, as B17 lists them in "songwriters") for owners imported from the old ERP.
 * Source: the IMRO registry of the old main sheet (`data/data/main_sheet/main.db`, table pro_imro: artist pseudonym,
 * writer name(s), IMRO code), read-only. These are personal data: use only for a local, protected data directory.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { normalizeName } from '../src/shared/identifiers';

export const MAIN_DB_DEFAULT = 'data/data/main_sheet/main.db';

/** pseudonym (normalized) -> writer names with at least two words */
export function loadImroWriterNames(mainDbPath: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!existsSync(mainDbPath)) return result;
  const db = new DatabaseSync(mainDbPath, { readOnly: true });
  const rows = db.prepare('SELECT artist, name FROM pro_imro').all() as {
    artist: string | null;
    name: string | null;
  }[];
  for (const r of rows) {
    if (!r.artist) continue;
    const key = normalizeName(r.artist);
    const names = String(r.name ?? '')
      .split(/\n|\(|\)|\//)
      .map((s) => s.trim())
      .filter((s) => normalizeName(s).split(' ').length >= 2);
    if (names.length === 0) continue;
    result.set(key, [...new Set([...(result.get(key) ?? []), ...names])]);
  }
  db.close();
  return result;
}
