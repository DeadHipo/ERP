/**
 * D-215: adds the signed contracts of final_index that ERP lacks for owners whose money waits in C `owner_unconfirmed`.
 *
 * The plan is a JSON list `{ contractId, kind, sha256, number, pseudonyms[] }` prepared from final_index (read only).
 * For each item: the pseudonyms are found by their exact ERP spelling; the owner of the first one is the target;
 * a `contract` document is created with the file reference `pandadoc:<sha256>` (the form of the other contracts),
 * approved, and `createContract` binds it to the target owner and its listed pseudonyms. The owners of the other
 * pseudonyms of the same item (duplicates of one person) are then merged into the target, which is confirmed now.
 * Idempotent: an item whose file reference is already a document is skipped. Dry run by default.
 *
 *   npx tsx packages/backend/scripts/stage3/add-index-contracts.ts <plan.json> [--apply] [--org <id>] [dataDir]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';

const args = process.argv.slice(2);
const ORG = takeOrgArgument(args);
const apply = args.includes('--apply');
const [file, dataDirArg] = args.filter((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: add-index-contracts.ts <plan.json> [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const OPERATOR = 'final_index (D-215)';

interface Item {
  contractId: string;
  kind: string;
  sha256: string;
  number: string | null;
  pseudonyms: string[];
}
const plan = JSON.parse(readFileSync(file, 'utf8')) as Item[];

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { owners } = f.modules;
  const counts = { created: 0, skipped: 0, merged: 0, failed: 0 };
  for (const item of plan) {
    const fileRef = `pandadoc:${item.sha256}`;
    const docs = await owners.listDocuments();
    if (docs.some((d) => d.fileRef === fileRef)) {
      console.log(`= ${item.contractId}: the file is already a document — skipped`);
      counts.skipped++;
      continue;
    }
    const index = await owners.artistIndex();
    const resolveOwner = await owners.ownerResolver();
    const artists: { id: string; ownerId: string }[] = [];
    for (const nick of item.pseudonyms) {
      for (const [id, a] of index) {
        if (id !== a.id || a.pseudonym !== nick || !a.ownerId) continue;
        if (!artists.some((x) => x.id === a.id)) artists.push({ id: a.id, ownerId: resolveOwner(a.ownerId) });
      }
    }
    if (artists.length === 0) {
      console.log(`! ${item.contractId}: no pseudonym of ${item.pseudonyms.join(', ')} — skipped`);
      counts.failed++;
      continue;
    }
    const target = artists[0]!.ownerId;
    const own = artists.filter((a) => a.ownerId === target).map((a) => a.id);
    const others = [...new Set(artists.map((a) => a.ownerId).filter((o) => o !== target))];
    const title = `${item.kind.replace(/_/g, ' ')} ${item.number ?? item.contractId.slice(0, 10)} [${item.sha256.slice(0, 8)}]`;
    console.log(`${apply ? '+' : '·'} ${title}: owner ${target}, pseudonyms ${own.length}${others.length ? `, merge ${others.length} owner(s) into it` : ''}`);
    if (!apply) continue;
    const doc = await f.createDocument({ kind: 'contract', title, fileRef, ownerId: target, requiresApproval: true, labelId: null });
    await f.approveDocument(doc.id, OPERATOR);
    await f.createContract({ ownerId: target, documentId: doc.id, number: item.number, artistIds: own });
    counts.created++;
    for (const from of others) {
      await f.mergeOwners(from, target, `D-215: one person, contract ${item.number ?? item.contractId}`);
      counts.merged++;
    }
  }
  console.log(`items ${plan.length}: ${apply ? 'created' : 'to create'} ${apply ? counts.created : plan.length - counts.skipped - counts.failed}, merged ${counts.merged}, skipped ${counts.skipped}, failed ${counts.failed}`);
} finally {
  await stack.close();
}
