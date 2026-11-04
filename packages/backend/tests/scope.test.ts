import { afterEach, describe, expect, it } from 'vitest';
import { ACC1, ACC2, Case, I, UPC } from './helpers/golden-case';
import type { SnapshotFilter } from '../src/modules/sources';
import { testStack } from './helpers/test-sources';

// The unit scope of the facade (D-161): a method whose answer depends on a subset of the Believe units reads only
// that subset, and the answer is byte for byte the one of the full calculation. `FACADE_SCOPE=off` is the switch.
// Synthetic data only.

const UPC2 = '1234567890124';

async function world() {
  const c = await Case.start();
  await c.person('A', 'B', 'R');
  await c.track(I(1), UPC, ['A']);
  await c.track(I(2), UPC, ['B']);
  await c.track(I(3), UPC2, []);
  await c.split(I(1), [['A', '50']]);
  await c.split(I(2), [['B', '30']], { doc: null }); // waits in C: split_unconfirmed
  await c.sublabel('Sub One', '0to8', 'R');
  await c.load('2026-03', [
    { isrc: I(1), net: '100' },
    { isrc: I(2), net: '50' },
    { isrc: I(3), net: '20', upc: UPC2, label: 'Sub One' },
  ]);
  await c.load('2026-04', [{ isrc: I(1), net: '200' }, { isrc: I(3), net: '30', upc: UPC2 }], ACC2);
  const { created } = await c.f.createAds([
    { isrc: I(1), month: '2026-03', amount: '40' },
    { isrc: I(3), month: '2026-04', amount: '10', recoveryPercent: '30' },
  ]);
  return { c, adId: (created[0] as { id: string }).id };
}

/**
 * Records every snapshot read of the facade: the filter it got and how many units came back. The facade holds the
 * test sources through a proxy that looks a method up on the real service at every call, so the real one is patched.
 */
async function spy() {
  const reads: { filter: SnapshotFilter; units: number }[] = [];
  const service = (await testStack()).service;
  const original = service.snapshot.bind(service);
  service.snapshot = async (filter: SnapshotFilter = {}) => {
    const r = await original(filter);
    reads.push({ filter, units: r.units.length });
    return r;
  };
  return reads;
}

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));

describe('unit scope of the facade (D-161)', () => {
  afterEach(() => {
    delete process.env.FACADE_SCOPE;
  });

  it('every scoped method answers exactly as the full calculation and reads only its units', async () => {
    const { c, adId } = await world();
    const f = c.f;
    const calls: [string, () => Promise<unknown>, (r: { filter: SnapshotFilter; units: number }) => void][] = [
      ['trackMoney', () => f.trackMoney(I(1)), (r) => expect([r.filter.isrcs, r.units]).toEqual([[I(1)], 2])],
      ['explainTrack', () => f.explainTrack(I(3)), (r) => expect([r.filter.isrcs, r.units]).toEqual([[I(3)], 2])],
      ['release', () => f.release(UPC2), (r) => expect([r.filter.upcs, r.units]).toEqual([[UPC2], 2])],
      ['release UPC', () => f.release(UPC), (r) => expect(r.units).toBe(3)],
      [
        'trackSummary account+month',
        () => f.trackSummary({ account: ACC1, month: '2026-03' }),
        (r) => expect([r.filter.accounts, r.filter.from, r.filter.to, r.units]).toEqual([[ACC1], '2026-03', '2026-03', 3]),
      ],
      ['trackSummary month', () => f.trackSummary({ month: '2026-04' }), (r) => expect(r.units).toBe(2)],
      ['trackSummary account', () => f.trackSummary({ account: ACC2 }), (r) => expect(r.units).toBe(2)],
      ['trackSummary all', () => f.trackSummary(), (r) => expect(r.units).toBe(5)],
      [
        'queue period',
        () => f.queue('split_unconfirmed', { from: '2026-03', to: '2026-03' }),
        (r) => expect([r.filter.from, r.units]).toEqual(['2026-03', 3]),
      ],
      ['queue sales basis', () => f.queue('split_unconfirmed', { from: '2026-04', basis: 'sales' }), (r) => expect(r.units).toBe(2)],
      ['queue all', () => f.queue('split_unconfirmed'), (r) => expect(r.units).toBe(5)],
      ['listAds', () => f.listAds({}), (r) => expect([r.filter.isrcs, r.units]).toEqual([[I(1), I(3)], 4])],
      ['listAds by isrc', () => f.listAds({ isrc: I(3) }), (r) => expect(r.units).toBe(2)],
      ['getAd', () => f.getAd(adId), (r) => expect([r.filter.isrcs, r.units]).toEqual([[I(1)], 2])],
      ['adsSummary', () => f.adsSummary({}), (r) => expect(r.units).toBe(4)],
      // D-162: a list of ISRCs (the visible rows of P5) narrows the units, the splits, the tracks and the names
      [
        'trackSummary isrcs',
        () => f.trackSummary({ isrcs: `${I(3)},${I(1)}` }),
        (r) => expect([r.filter.isrcs, r.units]).toEqual([[I(1), I(3)], 4]),
      ],
      ['trackSummary isrcs+month', () => f.trackSummary({ isrcs: I(1), month: '2026-04' }), (r) => expect(r.units).toBe(1)],
    ];
    const reads = await spy();
    for (const [name, run, check] of calls) {
      reads.length = 0;
      const scopedAnswer = text(await run());
      expect(reads.length, name).toBe(1);
      check(reads[0] as { filter: SnapshotFilter; units: number });
      process.env.FACADE_SCOPE = 'off';
      reads.length = 0;
      const fullAnswer = text(await run());
      delete process.env.FACADE_SCOPE;
      expect(reads[0]?.units, `${name}: the switch gives the full read`).toBe(5);
      expect(scopedAnswer, name).toBe(fullAnswer);
    }
  });

  it('the summary of a list of ISRCs is the full summary restricted to them; the catalog has every ISRC of the summary', async () => {
    const { c } = await world();
    const f = c.f;
    await c.track(I(4)); // registered, no money: in the catalog and the summary (hasSplit false), with zero sums
    await c.load('2026-05', [{ isrc: I(5), net: '10' }]); // money, not registered: known from the reports only
    const full = (await f.trackSummary()).items;
    expect(full.map((i) => i.isrc)).toEqual([I(1), I(2), I(3), I(4), I(5)]);
    const part = (await f.trackSummary({ isrcs: `${I(4)},${I(1)}` })).items;
    expect(text(part)).toBe(text(full.filter((i) => i.isrc === I(1) || i.isrc === I(4))));
    const catalog = (await f.trackCatalog()).items;
    expect(catalog.map((i) => [i.isrc, i.upcs, i.hasSplit, i.hasParticipations, i.registered])).toEqual(
      full.map((i) => [i.isrc, i.upcs, i.hasSplit, i.hasParticipations, i.isrc !== I(5)]),
    );
    expect(catalog.map((i) => [i.title, i.artistName])).toEqual(full.map((i) => [i.title, i.artistName]));
    await expect(f.trackSummary({ isrcs: 'not-an-isrc' })).rejects.toThrow();
    await expect(f.trackSummary({ isrcs: Array.from({ length: 501 }, (_, n) => I(n)).join(',') })).rejects.toThrow(/at most 500/);
  });

  it('the master-only methods skip the B17 lines and narrow the split index; the full methods read everything', async () => {
    const { c, adId } = await world();
    const f = c.f;
    const pub: { lines?: boolean }[] = [];
    const idx: { isrcs?: string[] }[] = [];
    const publishing = f.modules.publishing;
    const splits = f.modules.splits;
    const snap = publishing.snapshotForCalculation.bind(publishing);
    const index = splits.index.bind(splits);
    publishing.snapshotForCalculation = (o = {}) => {
      pub.push(o);
      return snap(o);
    };
    splits.index = (o = {}) => {
      idx.push(o);
      return index(o);
    };
    await f.trackMoney(I(1));
    await f.trackSummary({ isrcs: `${I(1)},${I(2)}` });
    await f.getAd(adId);
    await f.release(UPC);
    expect(pub).toEqual([{ lines: false }, { lines: false }, { lines: false }, { lines: false }]);
    expect(idx).toEqual([{ isrcs: [I(1)] }, { isrcs: [I(1), I(2)] }, { isrcs: [I(1)] }, {}]);
    pub.length = 0;
    idx.length = 0;
    await f.queue('split_unconfirmed', { from: '2026-03' });
    await f.overview();
    expect(pub).toEqual([{}, {}]);
    expect(idx).toEqual([{}, {}]);
  });

  it('a record on a pseudonym alone needs no unit; the full methods stay full', async () => {
    const { c } = await world();
    const f = c.f;
    const { created } = await f.createAds([{ isrc: null, artistId: c.id('A'), month: '2026-03', amount: '5' }]);
    const reads = await spy();
    const id = (created[0] as { id: string }).id;
    const one = text(await f.getAd(id));
    expect([reads[0]?.filter.isrcs, reads[0]?.units]).toEqual([[], 0]);
    process.env.FACADE_SCOPE = 'off';
    expect(text(await f.getAd(id))).toBe(one);
    delete process.env.FACADE_SCOPE;
    reads.length = 0;
    await f.overview();
    await f.ownerBalance(c.owners.get('A') as string);
    await f.ownerPayables();
    await f.signals();
    await f.reconciliation({ from: '2026-03', to: '2026-03' });
    expect(reads.map((r) => [r.filter, r.units])).toEqual(reads.map(() => [{}, 5]));
  });
});
