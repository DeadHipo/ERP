/**
 * D-172 (stage 4 commit 4): derives the label history of every ISRC (`owners.track_labels`, `source = 'files'`) from the
 * loaded Believe files: an observation = (ISRC, reporting month of a loaded file, the label of the file); the runs by
 * month (a new label opens a run, a label seen again is a tail while the current one is still observed, else a return),
 * the boundary `min(max(last_A + 1, start_B), first_B)` (`facade/catalog.ts deriveIsrc`), the operator intervals cut out.
 * Navigation, not money: the calculation never reads the history.
 *
 *   npx tsx packages/backend/scripts/derive-track-labels.ts [dataDir] [--apply] [--org <id>]
 *
 * Dry run by default: prints the counters and changes nothing. `--apply` rewrites the `files` rows of the changed ISRCs
 * in one write transaction (never the `operator` rows). Idempotent: a second run prints 0 changed. Writes without an
 * audit row (a migration script, like D-131's). Needs the stack of `.env`.
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectOrg, takeOrgArgument } from '../src/connect-sources';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'data'));
const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

try {
  const names = new Map((await f.modules.labels.listLabels()).map((l) => [l.id, l.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const r = await f.deriveTrackLabels({ apply });
  console.log(`organization ${stack.orgName}: ${r.isrcs} ISRCs with a derived history`);
  console.log(`  intervals per ISRC: 1 = ${r.intervals.one}, 2 = ${r.intervals.two}, ≥3 = ${r.intervals.threeOrMore}`);
  console.log(`  returned: ${r.returned}, ties: ${r.ties}`);
  console.log(`  tails (catalogOutsideAccount): ${r.tails.isrcs} ISRCs, ${r.tails.observations} observations`);
  console.log(`  ISRCs with an operator interval: ${r.withOperator}`);
  console.log(`  loaded Believe files without a label (skipped): ${r.filesWithoutLabel}`);
  console.log('  boundaries (from → to, first month of the later run, boundary: ISRCs):');
  for (const b of r.boundaries)
    console.log(`    ${nameOf(b.fromLabelId)} → ${nameOf(b.toLabelId)}  first ${b.firstMonth}  boundary ${b.boundary}: ${b.isrcs}`);
  console.log(`  rows: inserted ${r.inserted}, deleted ${r.deleted}; ISRCs changed ${r.changedIsrcs}, unchanged ${r.unchangedIsrcs}`);
  if (!apply) console.log('dry run: nothing changed (add --apply)');
} finally {
  await stack.close();
}
