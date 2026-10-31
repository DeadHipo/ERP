/**
 * Re-creates the publishing contract terms of import-legacy.ts (50% for writers whose owner has a contract,
 * 0% from the date of a buyout) in an EXISTING data directory, e.g. after the publishing database was reset.
 * Run it with the server stopped.
 *
 * Usage: npx tsx scripts/restore-publishing-terms.ts <dataDir>
 */
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { openOwnersModule } from '../src/modules/owners';
import { openPublishingModule } from '../src/modules/publishing';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data', 'real'));
const erp = new DatabaseSync(resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db'), { readOnly: true });
const owners = openOwnersModule(join(dataDir, 'owners.sqlite'));
const publishing = openPublishingModule(
  join(dataDir, 'publishing.sqlite'),
  join(dataDir, 'files', 'publishing'),
);

const pubParties = new Set(
  (
    erp
      .prepare(`SELECT DISTINCT party_id FROM accrual WHERE stream='publishing' AND source LIKE 'b17:%'`)
      .all() as { party_id: number }[]
  ).map((r) => r.party_id),
);
const ownerOfParty = new Map<number, string>();
for (const o of owners.service.listOwners()) {
  const m = /^legacy-erp:parties:(.+)$/.exec(o.origin);
  if (m) for (const p of (m[1] as string).split(',')) ownerOfParty.set(Number(p), o.id);
}
const stats = { terms: 0, buyoutTerms: 0 };
const done = new Set<string>();
for (const [pid, ownerId] of ownerOfParty) {
  if (!pubParties.has(pid) || done.has(ownerId)) continue;
  if (publishing.service.termsOf([ownerId]).length > 0) {
    done.add(ownerId); // already restored: the script can be run again
    continue;
  }
  const contract = owners.service.contractsOfOwner(ownerId)[0];
  if (!contract) continue;
  publishing.service.setTerms({
    ownerId,
    percent: '50',
    validFrom: '2000-01-01',
    documentId: contract.documentId,
  });
  done.add(ownerId);
  stats.terms++;
}
// Publishing buyout: the seller's author share becomes 0 from the effective date (D-045), confirmed by the buyout document.
for (const b of erp.prepare('SELECT id, effective, seller_id FROM buyout ORDER BY effective').all() as {
  id: number;
  effective: string;
  seller_id: number;
}[]) {
  const ownerId = ownerOfParty.get(b.seller_id);
  if (!ownerId || !done.has(ownerId)) continue;
  const doc = owners.service
    .listDocuments(ownerId)
    .find((d) => d.kind === 'buyout' && d.title === `Legacy buyout #${b.id}`);
  if (!doc) continue;
  try {
    publishing.service.setTerms({ ownerId, percent: '0', validFrom: b.effective, documentId: doc.id });
    stats.buyoutTerms++;
  } catch {
    // terms already start on or after this date
  }
}
owners.close();
publishing.close();
erp.close();
console.log(JSON.stringify({ dataDir, ...stats }));
