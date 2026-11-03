/**
 * Read-only: the effect of the advertising records on the payables (D-156). Prints totals as JSON:
 * owners with positive / negative payable, Σ payable, Σ ads recouped, and the ads summary totals.
 * Usage: npx tsx packages/backend/scripts/mvp/ads-effect.ts [out.json]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from '../../src/shared/money';
import { connectSources } from '../../src/connect-sources';
import { openFacade } from '../../src/facade';
import { ROOT } from './lib';

const stack = connectSources(join(ROOT, 'data', 'mvp-load', 'files', 'sources'));
const f = openFacade({ db: stack.db, dataDir: join(ROOT, 'data', 'mvp-load'), payoutThresholdCents: 0, sources: stack.sources });
try {
  const p = await f.ownerPayables();
  const items = p.items as unknown as { ownerId: string; payable: Decimal; payableShown: Decimal }[];
  const pos = items.filter((i) => i.payable.gt(0));
  const neg = items.filter((i) => i.payable.lt(0));
  const sum = (xs: { payable: Decimal }[]) => xs.reduce((s, x) => s.add(x.payable), new Decimal(0)).toFixed(2);
  const s = await f.adsSummary();
  const tot = (k: 'amount' | 'recoveredFromArtists' | 'borneBySublabels' | 'borneByUs' | 'noSplit') =>
    s.rows.reduce((a, r) => a.add(r[k]), new Decimal(0)).toFixed(2);
  const byLabel: Record<string, string> = {};
  for (const r of s.rows) byLabel[r.label] = new Decimal(byLabel[r.label] ?? 0).add(r.amount).toFixed(2);
  const out = {
    owners: items.length,
    positive: { count: pos.length, payable: sum(pos) },
    negative: { count: neg.length, payable: sum(neg) },
    ads: {
      records: s.rows.reduce((a, r) => a + r.count, 0),
      amount: tot('amount'),
      recoveredFromArtists: tot('recoveredFromArtists'),
      borneBySublabels: tot('borneBySublabels'),
      borneByUs: tot('borneByUs'),
      noSplit: tot('noSplit'),
      byLabel,
    },
  };
  console.log(JSON.stringify(out, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
} finally {
  await stack.close();
}
