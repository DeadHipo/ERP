/**
 * Adds writer legal names (old IMRO registry) as owner aliases to an EXISTING data directory created by
 * import-legacy.ts, without reloading the reports. Run it with the server stopped.
 * Personal data: use only for a local, protected data directory.
 *
 * Usage: npx tsx scripts/add-writer-aliases.ts <dataDir>
 */
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { openOwnersModule } from '../src/modules/owners';
import { normalizeName } from '../src/shared/identifiers';
import { loadImroWriterNames, MAIN_DB_DEFAULT } from './legacy-writers';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data', 'real'));
const erp = new DatabaseSync(resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db'), { readOnly: true });
const imro = loadImroWriterNames(resolve(root, 'context_data', MAIN_DB_DEFAULT));
const owners = openOwnersModule(join(dataDir, 'owners.sqlite'));

let added = 0;
let ownersWithNames = 0;
for (const o of owners.service.listOwners()) {
  const m = /^legacy-erp:parties:(.+)$/.exec(o.origin);
  if (!m) continue;
  const names = new Set<string>();
  for (const pid of (m[1] as string).split(',').map(Number)) {
    const party = erp.prepare('SELECT name FROM party WHERE id = ?').get(pid) as { name: string } | undefined;
    const aliases = (
      erp.prepare('SELECT alias FROM alias WHERE party_id = ?').all(pid) as { alias: string }[]
    ).map((a) => a.alias);
    for (const k of [party?.name ?? '', ...aliases].map((n) => normalizeName(n)))
      for (const n of imro.get(k) ?? []) names.add(n);
  }
  if (names.size) ownersWithNames++;
  for (const n of names) {
    owners.service.addOwnerAlias(o.id, n);
    added++;
  }
}
owners.close();
erp.close();
console.log(JSON.stringify({ dataDir, imroPseudonyms: imro.size, ownersWithNames, aliasesAdded: added }));
