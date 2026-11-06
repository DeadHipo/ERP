/**
 * Adds writer legal names (old IMRO registry) as owner aliases to an EXISTING data directory created by
 * import-legacy.ts, without reloading the reports. Run it with the server stopped.
 * Writes into the owners schema of the PostgreSQL database of <repo>/.env (DB_*, D-121), not <dataDir>/owners.sqlite:
 * choose the data set with DB_DATABASE. All aliases are added in one transaction. dataDir only locates the files.
 * Personal data: use only for a local, protected data directory.
 *
 * Usage: DB_DATABASE=<db> npx tsx scripts/add-writer-aliases.ts <dataDir>
 */
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { connectOrg, takeOrgArgument } from '../src/connect-sources';
import { orgScope } from '../src/shared/org-scope';
import { openOwnersModule } from '../src/modules/owners';
import { normalizeName } from '../src/shared/identifiers';
import { loadImroWriterNames, MAIN_DB_DEFAULT } from './legacy-writers';

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data', 'real'));
const erp = new DatabaseSync(resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db'), {
  readOnly: true,
});
const imro = loadImroWriterNames(resolve(root, 'context_data', MAIN_DB_DEFAULT));
const stack = await connectOrg({ dataDir, org: ORG });
const owners = openOwnersModule(stack.db, orgScope(stack.orgId));

let added = 0;
let ownersWithNames = 0;
await stack.db.transaction(async () => {
  for (const o of await owners.service.listOwners()) {
    const m = /^legacy-erp:parties:(.+)$/.exec(o.origin);
    if (!m) continue;
    const names = new Set<string>();
    for (const pid of (m[1] as string).split(',').map(Number)) {
      const party = erp.prepare('SELECT name FROM party WHERE id = ?').get(pid) as
        { name: string } | undefined;
      const aliases = (
        erp.prepare('SELECT alias FROM alias WHERE party_id = ?').all(pid) as { alias: string }[]
      ).map((a) => a.alias);
      for (const k of [party?.name ?? '', ...aliases].map((n) => normalizeName(n)))
        for (const n of imro.get(k) ?? []) names.add(n);
    }
    if (names.size) ownersWithNames++;
    for (const n of names) {
      await owners.service.addOwnerAlias(o.id, n);
      added++;
    }
  }
});
await stack.close();
erp.close();
console.log(JSON.stringify({ dataDir, imroPseudonyms: imro.size, ownersWithNames, aliasesAdded: added }));
