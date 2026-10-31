/**
 * Reference check: compares the new calculation for one month (master, July 2026) and one quarter (B17 2026-Q2)
 * with the accruals of the current ERP (context_data/data/erp/data/erp.db, read-only). Differences are expected; each one
 * is classified by cause. Output: data/<demo>/recon/summary.json and diffs.csv (aggregated amounts, no names).
 *
 * Usage: npx tsx scripts/reconcile-erp.ts [dataDir]
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Decimal from 'decimal.js';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { calculate } from '../src/facade/calculation';
import { normalizeIsrc } from '../src/shared/identifiers';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data', 'demo'));
const erp = new DatabaseSync(resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db'), { readOnly: true });
const all = <T>(sql: string, ...p: (string | number)[]) => erp.prepare(sql).all(...p) as T[];
const D = (v: string | number | null | undefined) => new Decimal(v ?? 0);
const MONTH = '2026-07';
// The old ERP counts only the main Believe account; other loaded accounts (e.g. echo8) are left out of the comparison.
const ACCOUNT = process.env.ACCOUNT ?? '1052428';
const inScope = (u: { reportingMonth: string; account: string }) =>
  u.reportingMonth === MONTH && u.account === ACCOUNT;

const stack = connectSources(join(dataDir, 'files', 'sources')); // PostgreSQL + ClickHouse (docker compose up -d)
const f = openFacade({ dataDir, payoutThresholdCents: 0, sources: stack.sources });
const { owners, splits, sources, publishing } = f.modules;
const calc = await calculate({ owners, splits, sources, publishing });

// party id of every new artist (stored in origin by the import)
const partyOfArtist = new Map<string, number>();
for (const [id, a] of owners.artistIndex()) {
  const artist = owners.getArtist(id);
  const m = /^legacy-erp:party:(\d+)$/.exec(artist.origin);
  if (m && id === a.id) partyOfArtist.set(id, Number(m[1]));
}
const HOUSE = new Set(all<{ id: number }>('SELECT id FROM party WHERE is_house = 1').map((r) => r.id));

// ---------- master, per (ISRC, party) ----------
const key = (isrc: string, party: number) => `${isrc}|${party}`;
const neu = new Map<string, Decimal>();
let newOurs = D(0);
let newUnallocated = D(0);
let newNoSplit = D(0);
for (const u of calc.units) {
  if (!inScope(u)) continue;
  newOurs = newOurs.add(u.ours);
  if (u.status === 'no_isrc' || u.status === 'unknown_pair') newUnallocated = newUnallocated.add(u.net);
  if (u.status === 'no_split') newNoSplit = newNoSplit.add(u.net);
  for (const a of u.allocations) {
    const party = partyOfArtist.get(a.artistId) ?? -1;
    const k = key(u.isrc, party);
    neu.set(k, (neu.get(k) ?? D(0)).add(a.amount));
  }
}
const old = new Map<string, Decimal>();
let oldLabel = D(0);
let oldNoIsrcAllocated = D(0);
const oldRules = new Map<string, Decimal>();
for (const r of all<{
  party_id: number;
  isrc: string;
  amount_x: string | null;
  amount: number;
  rule: string;
}>(`SELECT party_id, isrc, amount_x, amount, rule FROM accrual WHERE stream='master' AND period=?`, MONTH)) {
  const amt = D(r.amount_x ?? r.amount);
  const ruleKey = r.rule.startsWith('split ·') ? 'split · album without ISRC (donor)' : r.rule;
  oldRules.set(ruleKey, (oldRules.get(ruleKey) ?? D(0)).add(amt));
  if (r.isrc.startsWith('NOISRC')) oldNoIsrcAllocated = oldNoIsrcAllocated.add(amt);
  if (HOUSE.has(r.party_id) || r.rule.startsWith('sublabel')) {
    oldLabel = oldLabel.add(amt);
    continue;
  }
  const k = key(r.isrc.startsWith('NOISRC') ? '' : normalizeIsrc(r.isrc), r.party_id);
  old.set(k, (old.get(k) ?? D(0)).add(amt));
}
const oldUnallocated =
  all<{ s: number }>(`SELECT SUM(net) s FROM unallocated_income WHERE month=?`, MONTH)[0]?.s ?? 0;

// causes
const buyoutTracks = new Map<string, { effective: string; seller: number }[]>();
for (const b of all<{ isrc: string; effective: string; seller_id: number }>(
  'SELECT bt.isrc, b.effective, b.seller_id FROM buyout_track bt JOIN buyout b ON b.id = bt.buyout_id',
)) {
  const list = buyoutTracks.get(normalizeIsrc(b.isrc)) ?? [];
  list.push({ effective: b.effective, seller: b.seller_id });
  buyoutTracks.set(normalizeIsrc(b.isrc), list);
}
const exceptions = new Set(
  all<{ isrc: string }>('SELECT isrc FROM split_exception').map((r) => normalizeIsrc(r.isrc)),
);
const unknownPairIsrcs = new Set(
  calc.units.filter((u) => inScope(u) && u.status === 'unknown_pair').map((u) => u.isrc),
);
const noSplitIsrcs = new Set(
  calc.units.filter((u) => inScope(u) && u.status === 'no_split').map((u) => u.isrc),
);

function cause(isrc: string, party: number): string {
  if (isrc === '') return 'album sale without ISRC: old donor-track split, new unallocated (C) (M10)';
  if (exceptions.has(isrc))
    return 'split exception in old ERP (participant ambiguous): new has no split -> our share';
  if (unknownPairIsrcs.has(isrc))
    return 'ISRC+UPC pair not in module 1 (release not entered): new keeps it unallocated (C), old allocated by ISRC';
  if (noSplitIsrcs.has(isrc)) return 'no split in new (old used a fallback split)';
  const b = (buyoutTracks.get(isrc) ?? []).find((x) => x.seller === party);
  if (b && b.effective > `${MONTH}-01`)
    return 'buyout effective after the report date: old applies it from the report month M-1/M-2, new by report date';
  if (b) return 'buyout applied with a different share/date rule';
  return 'other';
}

const diffs: { isrc: string; party: number; old: Decimal; neu: Decimal; diff: Decimal; cause: string }[] = [];
for (const k of new Set([...old.keys(), ...neu.keys()])) {
  const [isrc, partyS] = k.split('|') as [string, string];
  const o = old.get(k) ?? D(0);
  const n = neu.get(k) ?? D(0);
  const d = n.sub(o);
  if (d.abs().gt('0.000001'))
    diffs.push({ isrc, party: Number(partyS), old: o, neu: n, diff: d, cause: cause(isrc, Number(partyS)) });
}
const byCause = new Map<string, { rows: number; diff: Decimal; abs: Decimal }>();
for (const d of diffs) {
  const c = byCause.get(d.cause) ?? { rows: 0, diff: D(0), abs: D(0) };
  c.rows++;
  c.diff = c.diff.add(d.diff);
  c.abs = c.abs.add(d.diff.abs());
  byCause.set(d.cause, c);
}
const sumMap = (m: Map<string, Decimal>) => [...m.values()].reduce((s, v) => s.add(v), D(0));
const rounding = [...old.keys()].filter(
  (k) =>
    neu.has(k) &&
    (neu.get(k) as Decimal)
      .sub(old.get(k) as Decimal)
      .abs()
      .lte('0.000001'),
).length;

// ---------- publishing B17 2026-Q2, per owner group ----------
const ownerOfParty = new Map<number, string>();
for (const o of owners.listOwners()) {
  const m = /^legacy-erp:parties:(.+)$/.exec(o.origin);
  if (m) for (const p of (m[1] as string).split(',')) ownerOfParty.set(Number(p), o.id);
}
const pubOld = new Map<string, Decimal>();
for (const r of all<{ party_id: number; amount_x: string | null; amount: number }>(
  `SELECT party_id, amount_x, amount FROM accrual WHERE stream='publishing' AND period='2026-Q2' AND source LIKE 'b17:%' AND rule LIKE '%:writer'`,
)) {
  const oid = ownerOfParty.get(r.party_id) ?? `party:${r.party_id}`;
  pubOld.set(oid, (pubOld.get(oid) ?? D(0)).add(D(r.amount_x ?? r.amount)));
}
const pubNew = new Map<string, Decimal>();
const pubNewCat = { B: D(0), C: D(0) };
for (const p of calc.publishing) {
  if (p.period !== '2026-Q2' || !p.ownerId) continue;
  pubNew.set(p.ownerId, (pubNew.get(p.ownerId) ?? D(0)).add(p.authorAmount));
  pubNewCat[p.category] = pubNewCat[p.category].add(p.authorAmount);
}
const pubDiffs = [...new Set([...pubOld.keys(), ...pubNew.keys()])]
  .map((k) => ({ owner: k, old: pubOld.get(k) ?? D(0), neu: pubNew.get(k) ?? D(0) }))
  .map((x) => ({ ...x, diff: x.neu.sub(x.old) }))
  .filter((x) => x.diff.abs().gt('0.000001'));
const oldPubRules = all<{ rule: string; s: number }>(
  `SELECT substr(rule, instr(substr(rule,5),':')+5) rule, SUM(amount) s FROM accrual WHERE stream='publishing' AND period='2026-Q2' AND source LIKE 'b17:%' GROUP BY 1 ORDER BY 2 DESC`,
);

const summary = {
  month: MONTH,
  master: {
    revenueOld: all<{ s: string }>(`SELECT SUM(net) s FROM revenue WHERE month=?`, MONTH)[0]?.s,
    receivedNew: calc.units
      .filter((u) => inScope(u))
      .reduce((s, u) => s.add(u.net), D(0))
      .toFixed(),
    artistsOld: sumMap(old).toFixed(6),
    artistsNew: sumMap(neu).toFixed(6),
    labelOld_partyHouse_plus_sublabel: oldLabel.toFixed(6),
    oursNew: newOurs.toFixed(6),
    oursNew_ofWhichNoSplit: newNoSplit.toFixed(6),
    unallocatedOld: String(oldUnallocated),
    unallocatedNew: newUnallocated.toFixed(6),
    oldNoIsrcAllocatedByDonor: oldNoIsrcAllocated.toFixed(6),
    oldByRule: Object.fromEntries([...oldRules].map(([k, v]) => [k, v.toFixed(6)])),
    pairsCompared: new Set([...old.keys(), ...neu.keys()]).size,
    pairsEqualWithin1e6: rounding,
    pairsDifferent: diffs.length,
    differenceByCause: Object.fromEntries(
      [...byCause].map(([k, v]) => [
        k,
        { rows: v.rows, netDiff: v.diff.toFixed(6), absDiff: v.abs.toFixed(6) },
      ]),
    ),
  },
  publishing: {
    quarter: '2026-Q2',
    writersOld: sumMap(pubOld).toFixed(6),
    authorsNewB: pubNewCat.B.toFixed(6),
    authorsNewC: pubNewCat.C.toFixed(6),
    ownersCompared: new Set([...pubOld.keys(), ...pubNew.keys()]).size,
    ownersDifferent: pubDiffs.length,
    oldByRule: Object.fromEntries(oldPubRules.map((r) => [r.rule, Number(r.s).toFixed(2)])),
    largestDifferences: pubDiffs
      .sort((a, b) => b.diff.abs().cmp(a.diff.abs()))
      .slice(0, 10)
      .map((x) => ({
        owner: x.owner.slice(0, 8),
        old: x.old.toFixed(2),
        new: x.neu.toFixed(2),
        diff: x.diff.toFixed(2),
      })),
  },
};
const outDir = join(dataDir, 'recon');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(
  join(outDir, 'diffs.csv'),
  [
    'isrc;party_id;old;new;diff;cause',
    ...diffs
      .sort((a, b) => b.diff.abs().cmp(a.diff.abs()))
      .map(
        (d) => `${d.isrc};${d.party};${d.old.toFixed(6)};${d.neu.toFixed(6)};${d.diff.toFixed(6)};${d.cause}`,
      ),
  ].join('\n'),
);
f.close();
await stack.close();
console.log(JSON.stringify(summary, null, 2));
