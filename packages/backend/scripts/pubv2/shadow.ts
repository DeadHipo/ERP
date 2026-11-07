/**
 * The shadow run of publishing (D-185): `calculate()` over the old module and over the summaries and the links, side
 * by side. Reads only; nothing changes. Per quarter and per owner: payable, the author's amount, the label's, the
 * reasons of C. With `--csv <file>` the owner table goes to the file (names: keep it out of the repository).
 *
 *   npx tsx packages/backend/scripts/pubv2/shadow.ts [--csv <file>] [--org <id>] [dataDir]
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { calculate, type Calculation } from '../../src/facade/calculation';
import { pubV2Source } from '../../src/facade/pubv2-source';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { Decimal } from '../../src/shared/money';

const args = process.argv.slice(2);
const ORG = takeOrgArgument(args);
const csvAt = args.indexOf('--csv');
const csv = csvAt >= 0 ? args[csvAt + 1] : undefined;
const free = args.filter((a, i) => !a.startsWith('--') && i !== csvAt + 1);
const dataDir = resolve(free[0] ?? join(import.meta.dirname, '..', '..', '..', '..', 'data', 'real'));

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources, publishingSource: 'v1' });
const { owners, splits, labels, sources, publishing, ads, pubv2, links } = f.modules;
const base = { db: f.db, owners, splits, labels, sources, ads };
const v1 = await calculate({ ...base, publishing });
const v2 = await calculate({ ...base, publishing: pubV2Source(f.db, publishing, { pubv2, links }) });

interface Sum { payable: Decimal; author: Decimal; label: Decimal; b: Decimal; c: Decimal }
const zero = (): Sum => ({ payable: new Decimal(0), author: new Decimal(0), label: new Decimal(0), b: new Decimal(0), c: new Decimal(0) });
const add = (s: Sum, p: Calculation['publishing'][number]) => {
  s.payable = s.payable.add(p.payable);
  s.author = s.author.add(p.authorAmount);
  s.label = s.label.add(p.labelAmount);
  if (p.category === 'B') s.b = s.b.add(p.authorAmount);
  else s.c = s.c.add(p.authorAmount);
};
const group = (c: Calculation, key: (p: Calculation['publishing'][number]) => string) => {
  const out = new Map<string, Sum>();
  for (const p of c.publishing) {
    const k = key(p);
    const s = out.get(k) ?? zero();
    add(s, p);
    out.set(k, s);
  }
  return out;
};
const reasons = (c: Calculation) => {
  const out = new Map<string, Decimal>();
  for (const p of c.publishing) {
    const k = p.reason ?? 'B';
    out.set(k, (out.get(k) ?? new Decimal(0)).add(p.payable));
  }
  return out;
};
const n = (d: Decimal | undefined) => (d ?? new Decimal(0)).toFixed(2).padStart(14);

console.log('quarter      payable v1     payable v2     author v1      author v2       label v1       label v2');
const q1 = group(v1, (p) => p.period);
const q2 = group(v2, (p) => p.period);
for (const q of [...new Set([...q1.keys(), ...q2.keys()])].sort())
  console.log(q.padEnd(8), n(q1.get(q)?.payable), n(q2.get(q)?.payable), n(q1.get(q)?.author), n(q2.get(q)?.author), n(q1.get(q)?.label), n(q2.get(q)?.label));

console.log('\nby reason (the sum of the parts)          v1             v2');
const r1 = reasons(v1);
const r2 = reasons(v2);
for (const r of [...new Set([...r1.keys(), ...r2.keys()])].sort()) console.log(r.padEnd(32), n(r1.get(r)), n(r2.get(r)));

const names = new Map((await owners.listOwners()).map((o) => [o.id, o.name]));
const o1 = group(v1, (p) => p.ownerId ?? '');
const o2 = group(v2, (p) => p.ownerId ?? '');
const rows = [...new Set([...o1.keys(), ...o2.keys()])]
  .map((id) => {
    const a = o1.get(id) ?? zero();
    const b = o2.get(id) ?? zero();
    return { id, name: names.get(id) ?? '(no owner)', a, b, delta: b.author.sub(a.author) };
  })
  .sort((x, y) => y.delta.abs().comparedTo(x.delta.abs()));
console.log(`\nowners: ${rows.length}, author amount moved ${rows.reduce((s, r) => s.add(r.delta.abs()), new Decimal(0)).div(2).toFixed(2)}`);
if (csv) {
  const text = ['owner,payable_v1,payable_v2,author_v1,author_v2,author_delta,confirmed_v1,confirmed_v2'];
  for (const r of rows)
    text.push([JSON.stringify(r.name), r.a.payable.toFixed(2), r.b.payable.toFixed(2), r.a.author.toFixed(2), r.b.author.toFixed(2), r.delta.toFixed(2), r.a.b.toFixed(2), r.b.b.toFixed(2)].join(','));
  writeFileSync(csv, text.join('\n') + '\n');
  console.log(`written ${csv}`);
}
await stack.close();
