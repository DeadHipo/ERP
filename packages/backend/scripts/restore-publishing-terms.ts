/**
 * Re-creates the publishing contract terms of import-legacy.ts (50% for writers whose owner has a contract,
 * 0% from the date of a buyout) in an EXISTING data directory, e.g. after the publishing database was reset.
 * Run it with the server stopped.
 * Reads owners and writes publishing terms in the PostgreSQL database of <repo>/.env (DB_*, D-121), not
 * <dataDir>/{owners,publishing}.sqlite: choose the data set with DB_DATABASE. One transaction. dataDir only locates the
 * files (<dataDir>/files/publishing).
 *
 * Usage: DB_DATABASE=<db> npx tsx scripts/restore-publishing-terms.ts <dataDir>
 */
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { connectOrg, orgFilesDir, takeOrgArgument } from '../src/connect-sources';
import { orgScope } from '../src/shared/org-scope';
import { openOwnersModule } from '../src/modules/owners';
import { openPublishingModule } from '../src/modules/publishing';

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data', 'real'));
const erp = new DatabaseSync(resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db'), {
  readOnly: true,
});
const stack = await connectOrg({ dataDir, org: ORG });
const { db } = stack;
const org = orgScope(stack.orgId);
const owners = openOwnersModule(db, org);
const publishing = openPublishingModule(db, org, orgFilesDir(dataDir, stack.orgId, 'publishing'));

const pubParties = new Set(
  (
    erp
      .prepare(`SELECT DISTINCT party_id FROM accrual WHERE stream='publishing' AND source LIKE 'b17:%'`)
      .all() as { party_id: number }[]
  ).map((r) => r.party_id),
);
const ownerOfParty = new Map<number, string>();
for (const o of await owners.service.listOwners()) {
  const m = /^legacy-erp:parties:(.+)$/.exec(o.origin);
  if (m) for (const p of (m[1] as string).split(',')) ownerOfParty.set(Number(p), o.id);
}
const stats = { terms: 0, buyoutTerms: 0 };
const done = new Set<string>();
await db.transaction(async () => {
  for (const [pid, ownerId] of ownerOfParty) {
    if (!pubParties.has(pid) || done.has(ownerId)) continue;
    if ((await publishing.service.termsOf([ownerId])).length > 0) {
      done.add(ownerId); // already restored: the script can be run again
      continue;
    }
    const contract = (await owners.service.contractsOfOwner(ownerId))[0];
    if (!contract) continue;
    await publishing.service.setTerms({
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
    const doc = (await owners.service.listDocuments(ownerId)).find(
      (d) => d.kind === 'buyout' && d.title === `Legacy buyout #${b.id}`,
    );
    if (!doc) continue;
    // setTerms checks the overlap before it writes, so a refused call leaves the transaction usable.
    try {
      await publishing.service.setTerms({
        ownerId,
        percent: '0',
        validFrom: b.effective,
        documentId: doc.id,
      });
      stats.buyoutTerms++;
    } catch {
      // terms already start on or after this date
    }
  }
});
await stack.close();
erp.close();
console.log(JSON.stringify({ dataDir, ...stats }));
