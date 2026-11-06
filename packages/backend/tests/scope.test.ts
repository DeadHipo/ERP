import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import { ACC1, ACC2, Case, I, UPC } from './helpers/golden-case';
import type { SnapshotFilter } from '../src/modules/sources';
import { testStack } from './helpers/test-sources';

// The unit scope of the facade (D-161, D-162, D-163, D-164): a method whose answer depends on a subset of the Believe
// units reads only that subset, and the answer is byte for byte the one of the full calculation. The facade has one
// path (no switch): the full answer is obtained here by patching the test's own reads to ignore every filter.
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
    { isrc: I(1), month: '2026-03', amount: '40', labelId: c.f.testLabels['0to8'] },
    { isrc: I(3), month: '2026-04', amount: '10', recoveryPercent: '30', labelId: c.f.testLabels['0to8'] },
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

/**
 * Runs `fn` with every read of the facade answering in full: the sources ignore the unit filters, the split index
 * and the known pairs ignore the ISRC list, the B17 lines are always read. The scope then narrows nothing, so the
 * public method gives the answer of the full calculation.
 */
async function withFullReads<T>(c: Case, fn: () => Promise<T>): Promise<T> {
  const service = (await testStack()).service;
  const { splits, owners, publishing } = c.f.modules;
  const saved = {
    snapshot: service.snapshot,
    index: splits.index,
    knownPairs: owners.knownPairs,
    lines: publishing.snapshotForCalculation,
  };
  const snapshot = service.snapshot.bind(service);
  const index = splits.index.bind(splits);
  const knownPairs = owners.knownPairs.bind(owners);
  const lines = publishing.snapshotForCalculation.bind(publishing);
  service.snapshot = () => snapshot({});
  splits.index = () => index({});
  owners.knownPairs = () => knownPairs({});
  publishing.snapshotForCalculation = () => lines({});
  try {
    return await fn();
  } finally {
    service.snapshot = saved.snapshot;
    splits.index = saved.index;
    owners.knownPairs = saved.knownPairs;
    publishing.snapshotForCalculation = saved.lines;
  }
}

describe('unit scope of the facade (D-161)', () => {
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
      reads.length = 0;
      const fullAnswer = text(await withFullReads(c, run));
      expect(reads[0]?.units, `${name}: the full read`).toBe(5);
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
    expect(catalog.map((i) => [i.title, i.artistName, i.artists])).toEqual(full.map((i) => [i.title, i.artistName, i.artists]));
    expect(full.map((i) => i.artists.map((a) => a.pseudonym))).toEqual([['A'], ['B'], [], [], []]); // D-166: rows and links, merged ids resolved
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

  it('the balance from the units of the owner reach equals the full balance (D-163)', async () => {
    const { c } = await world();
    const f = c.f;
    // A: a split of I(1); B: a split of I(2); R: the recipient of the sublabel rule of «Sub One» (I(3) carries it) and
    // no split, so its reach comes from the label strings alone
    const reach = async (name: string) => (await f.ownerReach(c.owners.get(name) as string)).isrcs;
    expect(await reach('A')).toEqual([I(1)]);
    expect(await reach('B')).toEqual([I(2)]);
    expect(await reach('R')).toEqual([I(3)]);
    const reads = await spy();
    for (const name of ['A', 'B', 'R']) {
      const id = c.owners.get(name) as string;
      reads.length = 0;
      const byReach = text(await f.ownerBalance(id)); // the route reads by reach (D-164)
      expect(reads.map((r) => r.units), name).toEqual([name === 'B' ? 1 : 2]); // I(1) and I(3) have two months each
      const full = text(await withFullReads(c, () => f.ownerBalance(id)));
      expect(reads.map((r) => r.units), name).toEqual([name === 'B' ? 1 : 2, 5]);
      expect(byReach, name).toBe(full);
      const total = JSON.parse(full).total as { earned: string; waiting: string };
      expect([total.earned, total.waiting], name).not.toEqual(['0', '0']); // money reached the owner, so the check is real
    }
    // the payables of a list of owners (the visible rows of P9): the full list restricted to them, from their union reach
    const ids = ['A', 'R'].map((n) => c.owners.get(n) as string);
    reads.length = 0;
    const part = (await f.ownerPayables({ ids: ids.join(',') })).items;
    expect(reads.map((r) => r.units)).toEqual([4]); // I(1) and I(3): two units each
    const everyone = (await f.ownerPayables()).items;
    expect(text(part)).toBe(text(everyone.filter((i) => ids.includes(i.ownerId))));
    expect(part.map((i) => i.ownerId).sort()).toEqual([...ids].sort());
    await expect(f.ownerPayables({ ids: Array.from({ length: 201 }, (_, n) => `id-${n}`).join(',') })).rejects.toThrow(/at most 200/);
  });

  it('a record on a pseudonym alone needs no unit; the full methods stay full', async () => {
    const { c } = await world();
    const f = c.f;
    const { created } = await f.createAds([{ isrc: null, artistId: c.id('A'), month: '2026-03', amount: '5', labelId: f.testLabels['0to8'] }]);
    const reads = await spy();
    const id = (created[0] as { id: string }).id;
    const one = text(await f.getAd(id));
    expect([reads[0]?.filter.isrcs, reads[0]?.units]).toEqual([[], 0]);
    expect(text(await withFullReads(c, () => f.getAd(id)))).toBe(one);
    reads.length = 0;
    await f.overview();
    await f.ownerPayables();
    await f.signals();
    await f.reconciliation({ from: '2026-03', to: '2026-03' });
    expect(reads.map((r) => [r.filter, r.units])).toEqual(reads.map(() => [{}, 5]));
  });

  it('a payout records the snapshot of the reach calculation, which is the full balance of the owner (D-164)', async () => {
    const { c } = await world();
    const f = c.f;
    const id = c.owners.get('A') as string;
    // the payout pays the 0to8 book: the April unit of I(1) came in the file of the Echo8 account (D-169)
    const full = await withFullReads(c, () => f.ownerBalance(id, {}, f.testLabels['0to8']));
    expect(full.payout.allowed).toBe(true);
    // the view under 0to8 is the 0to8 book of the whole balance, field by field (D-168, R6)
    const all = await withFullReads(c, () => f.ownerBalance(id));
    for (const k of ['earned', 'recouped', 'paid', 'adsCharged', 'payable'] as const)
      expect(full.total[k].toFixed()).toBe(all.byLabel['0to8']?.[k].toFixed());
    const reads = await spy();
    const op = await f.createPayout(id, { labelId: f.testLabels['0to8'] });
    expect(reads.map((r) => [r.filter.isrcs, r.units])).toEqual([[[I(1)], 2]]); // the payout calculated the reach only
    const snapshot = (await f.modules.settlements.getSnapshot(op.id)) as { amountCents: number; total: unknown; perArtist: unknown; publishing: unknown; positions: unknown; files: { believe: unknown[] } };
    expect(snapshot.amountCents).toBe(full.payout.amountCents);
    expect(text(snapshot.total)).toBe(text(full.total));
    expect(text(snapshot.publishing)).toBe(text(full.publishing));
    expect(text(snapshot.positions)).toBe(text(full.positions));
    expect(text((snapshot.perArtist as { artistId: string; earned: unknown; tracks: unknown }[]).map((a) => [a.artistId, a.earned, a.tracks]))).toBe(
      text(full.artists.map((a) => [a.artistId, a.earned, a.tracks])),
    );
    expect(snapshot.files.believe.length).toBe(2); // every file in force, from the registry, not only the reach's
  });
});

describe('the money of a pseudonym from its reach (D-165)', () => {
  /** A: a split, an advance and an ad; A2: a second pseudonym of A's owner; B: an unconfirmed split; R: a sublabel recipient; P: a participant. */
  async function artistsWorld() {
    const c = await Case.start();
    await c.person('A', 'B', 'R', 'P');
    await c.second('A2', 'A');
    await c.track(I(1), UPC, ['A']);
    await c.track(I(2), UPC, ['B']);
    await c.track(I(3), UPC2, []);
    await c.track(I(4), UPC, ['A2']);
    await c.split(I(1), [['A', '50']]);
    await c.part(I(1), 'P', '10', 'net', 'top');
    await c.split(I(2), [['B', '30']], { doc: null }); // waits in C: split_unconfirmed
    await c.split(I(4), [['A2', '40']]);
    await c.sublabel('Sub One', '0to8', 'R');
    await c.load('2026-03', [
      { isrc: I(1), net: '100' },
      { isrc: I(2), net: '50' },
      { isrc: I(3), net: '20', upc: UPC2, label: 'Sub One' },
      { isrc: I(4), net: '10' },
    ]);
    await c.load('2026-04', [{ isrc: I(1), net: '200' }, { isrc: I(4), net: '30' }], ACC2);
    const f = c.f;
    const basis = await f.modules.owners.createDocument({
      kind: 'advance_basis',
      title: 'Advance basis A',
      fileRef: 'dummy://advance-basis-a.pdf',
      ownerId: c.owners.get('A') as string,
      requiresApproval: false,
    });
    const advance = await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'out',
      amount: '30',
      artistId: c.id('A'),
      date: '2026-03-01',
      scope: { kind: 'any' },
      documentId: basis.id,
      comment: 'advance',
    });
    await f.attachPaymentProof(advance.id, { fileRef: 'dummy://proof-a.pdf' });
    await f.createAds([{ isrc: I(1), month: '2026-03', amount: '40', labelId: f.testLabels['0to8'] }]);
    return { c, advance };
  }

  it('the artist row equals the one of the full owner balance, read from the reach of the pseudonym only', async () => {
    const { c, advance } = await artistsWorld();
    const f = c.f;
    const reach = async (name: string) => (await f.artistReach(c.id(name))).isrcs;
    expect(await reach('A')).toEqual([I(1)]);
    expect(await reach('A2')).toEqual([I(4)]);
    expect(await reach('B')).toEqual([I(2)]);
    expect(await reach('R')).toEqual([I(3)]);
    expect(await reach('P')).toEqual([I(1)]);
    const unitsOf: Record<string, number> = { A: 2, A2: 2, B: 1, R: 1, P: 2 };
    const reads = await spy();
    const row = (x: { period: { earned: unknown; waiting: unknown }; total: { recouped: unknown; unrecouped: unknown; recoupedFromMaster: unknown }; tracks: unknown }) => [
      x.period.earned,
      x.period.waiting,
      x.total.recouped,
      x.total.unrecouped,
      x.total.recoupedFromMaster,
      x.tracks,
    ];
    for (const name of ['A', 'A2', 'B', 'R', 'P']) {
      const id = c.id(name);
      reads.length = 0;
      const byReach = await f.artistBalance(id);
      expect(reads.map((r) => [r.filter.isrcs, r.units]), name).toEqual([[await reach(name), unitsOf[name]]]);
      const full = await withFullReads(c, () => f.artistBalance(id));
      expect(reads.at(-1)?.units, `${name}: the full read`).toBe(6);
      expect(text(byReach), name).toBe(text(full));
      // the very row of the owner's full balance (every pseudonym of the owner, every unit)
      const owner = await withFullReads(c, () => f.ownerBalance(c.owners.get(name) as string));
      const ownerRow = owner.artists.find((a) => a.artistId === id);
      expect(text(row(byReach)), name).toBe(text(ownerRow && row({ period: ownerRow, total: ownerRow, tracks: ownerRow.tracks })));
      expect([byReach.artistId, byReach.ownerId, byReach.artist.id, byReach.owner?.id], name).toEqual([id, owner.ownerId, id, owner.ownerId]);
      expect(text(byReach.positions), name).toBe(text(owner.positions.filter((p) => p.artistId === id)));
      expect(text(byReach.ads), name).toBe(text(owner.ads.filter((p) => p.artistId === id)));
    }
    // the golden numbers: A earns 50 % of the net after the participation of P (10 % off the top): 45 + 90, recoups the advance of 30, bears the ad of 40 (its only row); A2 is apart
    const a = await f.artistBalance(c.id('A'));
    expect([a.total.earned.toFixed(), a.total.recouped.toFixed(), a.total.unrecouped.toFixed(), a.total.adsCharged.toFixed()]).toEqual(['135', '30', '0', '40']);
    expect(a.tracks.map((t) => [t.isrc, t.net.toFixed(), t.amount.toFixed()])).toEqual([[I(1), '300', '135']]);
    expect(a.positions.map((p) => p.operationId)).toEqual([advance.id]);
    expect(a.ads.map((p) => [p.role, p.amount.toFixed()])).toEqual([['artist', '40']]);
    const a2 = await f.artistBalance(c.id('A2'));
    expect([a2.total.earned.toFixed(), a2.total.recouped.toFixed(), a2.total.adsCharged.toFixed(), a2.tracks.length]).toEqual(['16', '0', '0', 1]);
    const b = await f.artistBalance(c.id('B'));
    expect([b.total.earned.toFixed(), b.total.waiting.toFixed(), b.period.waitingBreakdown.split_unconfirmed?.toFixed()]).toEqual(['0', '15', '15']);
    const r = await f.artistBalance(c.id('R'));
    // the carve of the sublabel reached the recipient: 50 % of 20, waiting as an assumption (R1: I(3) has no split)
    expect([r.total.earned.toFixed(), r.total.waiting.toFixed(), r.period.waitingBreakdown.assumption?.toFixed()]).toEqual(['0', '10', '10']);
    expect(Object.keys(r.byLabel)).toEqual(['0to8']);
    const p = await f.artistBalance(c.id('P'));
    expect([p.total.earned.toFixed(), p.tracks.map((t) => t.isrc)]).toEqual(['30', [I(1)]]); // 10 % of the top of 100 and 200
    // the period shapes the per-period fields as in the owner balance: April of A alone
    const april = await f.artistBalance(c.id('A'), { from: '2026-04', to: '2026-04' });
    expect([april.period.earned.toFixed(), april.period.received.toFixed(), april.total.earned.toFixed()]).toEqual(['90', '200', '135']);
    expect(april.tracks.map((t) => [t.isrc, t.net.toFixed(), t.amount.toFixed()])).toEqual([[I(1), '200', '90']]);
  });

  it('the balances of a list of pseudonyms are their single balances from one calculation of the union reach; the list rows count their rules (D-167)', async () => {
    const { c } = await artistsWorld();
    const f = c.f;
    const ids = ['A', 'R', 'P'].map((n) => c.id(n));
    const reads = await spy();
    const list = await f.artistBalances({ ids: ids.join(',') });
    expect(reads.map((r) => [r.filter.isrcs, r.units])).toEqual([[[I(1), I(3)], 3]]); // the union reach: I(1) twice, I(3) once
    expect(list.items.map((i) => i.artistId).sort()).toEqual([...ids].sort());
    for (const i of list.items) {
      const one = await f.artistBalance(i.artistId);
      const t = one.total;
      expect(text([i.pseudonym, i.ownerId, i.earned, i.waiting, i.recouped, i.unrecouped, i.adsCharged, i.paid]), i.pseudonym).toBe(
        text([one.pseudonym, one.ownerId, t.earned, t.waiting, t.recouped, t.unrecouped, t.adsCharged, t.paid]),
      );
      expect(i.remaining.toFixed(), i.pseudonym).toBe(t.earned.sub(t.recouped).sub(t.adsCharged).sub(t.paid).toFixed());
    }
    // the golden numbers of A: earned 135, the advance of 30 recouped, the ad of 40 charged, nothing paid → 65 left
    const a = list.items.find((i) => i.artistId === c.id('A'));
    expect(a && [a.earned.toFixed(), a.recouped.toFixed(), a.adsCharged.toFixed(), a.paid.toFixed(), a.remaining.toFixed()]).toEqual(['135', '30', '40', '0', '65']);
    // without ids: every live pseudonym from the full calculation, the same rows
    reads.length = 0;
    const all = await f.artistBalances();
    expect(reads.map((r) => [r.filter, r.units])).toEqual([[{}, 6]]);
    expect(all.items.map((i) => i.artistId).sort()).toEqual(['A', 'A2', 'B', 'R', 'P'].map((n) => c.id(n)).sort());
    expect(text(all.items.filter((i) => ids.includes(i.artistId)))).toBe(text(list.items));
    // the list rows: owner, tracks (links, rows, participations), open rows, contracts, rows without a document
    const rows = await f.artistList();
    const row = (name: string) => {
      const r = rows.find((x) => x.id === c.id(name));
      return r && [r.owner?.id, r.owner?.status, r.previousIds, r.tracks, r.splitRows, r.participations, r.contracts, r.undocumented];
    };
    expect(row('A')).toEqual([c.owners.get('A'), 'confirmed', 0, 1, 1, 0, 1, 0]);
    expect(row('A2')).toEqual([c.owners.get('A'), 'confirmed', 0, 1, 1, 0, 0, 0]);
    expect(row('B')).toEqual([c.owners.get('B'), 'confirmed', 0, 1, 1, 0, 1, 1]); // the split of I(2) has no document
    expect(row('P')).toEqual([c.owners.get('P'), 'confirmed', 0, 1, 0, 1, 1, 0]);
    expect(row('R')).toEqual([c.owners.get('R'), 'confirmed', 0, 0, 0, 0, 1, 0]);
    expect(rows.map((r) => r.pseudonym)).toEqual([...rows.map((r) => r.pseudonym)].sort((x, y) => x.localeCompare(y)));
    // a merged id answers for the survivor once, an unknown id is left out, more than 200 ids are refused
    await f.modules.owners.mergeArtists(c.id('A2'), c.id('A'), 'same person');
    reads.length = 0;
    const merged = await f.artistBalances({ ids: [c.id('A2'), c.id('A'), 'no-such-artist'].join(',') });
    expect(reads.map((r) => [r.filter.isrcs, r.units])).toEqual([[[I(1), I(4)], 4]]);
    expect(merged.items.map((i) => [i.artistId, i.earned.toFixed()])).toEqual([[c.id('A'), '151']]);
    expect(row('A')).toEqual([c.owners.get('A'), 'confirmed', 0, 1, 1, 0, 1, 0]); // the rows above were read before the merge
    const after = (await f.artistList()).find((x) => x.id === c.id('A'));
    expect(after && [after.previousIds, after.tracks, after.splitRows]).toEqual([1, 2, 2]);
    expect((await f.artistList()).some((x) => x.id === c.id('A2'))).toBe(false);
    await expect(f.artistBalances({ ids: Array.from({ length: 201 }, (_, n) => `id-${n}`).join(',') })).rejects.toThrow(/at most 200/);
  });

  it('a pseudonym without owner waits by reach; a merged id answers for the survivor by every id it had', async () => {
    const { c } = await artistsWorld();
    const f = c.f;
    const lone = await f.modules.owners.createArtist({ pseudonym: 'Lone', ownerId: null });
    await c.track(I(5), UPC, []);
    await f.createSplit({ isrc: I(5), validFrom: '2020-01-01', validTo: null, shares: [{ artistId: lone.id, percent: '20' }], documentId: c.appendix });
    await c.load('2026-05', [{ isrc: I(5), net: '10' }]);
    expect((await f.artistReach(lone.id)).isrcs).toEqual([I(5)]);
    const reads = await spy();
    const byReach = await f.artistBalance(lone.id);
    expect(reads.map((r) => r.units)).toEqual([1]);
    expect(text(byReach)).toBe(text(await withFullReads(c, () => f.artistBalance(lone.id))));
    expect([byReach.ownerId, byReach.owner, byReach.total.earned.toFixed(), byReach.total.waiting.toFixed()]).toEqual([null, null, '0', '2']);
    expect(byReach.period.waitingBreakdown.artist_without_owner?.toFixed()).toBe('2');
    expect(byReach.tracks.map((t) => [t.isrc, t.waiting.toFixed()])).toEqual([[I(5), '2']]);
    const card = await f.artistDetail(lone.id);
    expect([card.merged, card.owner, card.splits.map((s) => s.isrc), card.documents.map((d) => d.id)]).toEqual([false, null, [I(5)], [c.appendix]]);

    // A2 merged into A: the old id answers for A, with the split of I(4) counted by the old id
    await f.modules.owners.mergeArtists(c.id('A2'), c.id('A'), 'same person');
    expect((await f.artistReach(c.id('A2'))).isrcs).toEqual([I(1), I(4)]);
    reads.length = 0;
    const merged = await f.artistBalance(c.id('A2'));
    expect(reads.map((r) => [r.filter.isrcs, r.units])).toEqual([[[I(1), I(4)], 4]]);
    expect([merged.artistId, merged.total.earned.toFixed()]).toEqual([c.id('A'), '151']); // 135 of I(1) + 16 of I(4)
    expect(text(merged)).toBe(text(await withFullReads(c, () => f.artistBalance(c.id('A')))));
    const full = await withFullReads(c, () => f.ownerBalance(c.owners.get('A') as string));
    expect(text(full.artists.find((x) => x.artistId === c.id('A'))?.tracks)).toBe(text(merged.tracks));
    const detail = await f.artistDetail(c.id('A2'));
    expect([detail.merged, detail.artist.id, detail.previousIds, detail.merges.map((m) => m.fromId)]).toEqual([true, c.id('A'), [c.id('A2')], [c.id('A2')]]);
    expect(detail.splits.map((s) => s.isrc)).toEqual([I(1), I(4)]);
    expect(detail.participations).toEqual([]);
    expect(detail.tracks.map((t) => t.isrc).sort()).toEqual([I(1), I(4)]);
    expect(detail.contracts.length).toBe(1);
    expect(detail.documents.map((d) => d.kind).sort()).toEqual(['appendix', 'contract']);
    const r = await f.artistDetail(c.id('R'));
    expect(r.labelRules.map((x) => [x.labelName, x.recipientArtistId])).toEqual([['Sub One', c.id('R')]]);
    await expect(f.artistDetail('no-such-artist')).rejects.toThrow();
    await expect(f.artistBalance('no-such-artist')).rejects.toThrow();
  });
});

describe('the label as a book (D-168)', () => {
  /**
   * A: splits on I(1) (0to8) and I(2) (Echo8); B: an unconfirmed split on I(3) (0to8); E: an unconfirmed split on I(4)
   * (Echo8). Account 1 (0to8) carries I(1) and I(3) of March; account 2 (Echo8) the Echo8 units of March and April
   * (D-169: the book is the label of the file). A has an advance without a label (60), an advance of Echo8 (20), an ad
   * on I(1) (10, 0to8) and a pseudonym-only ad under Echo8 (5).
   */
  async function labelWorld() {
    const c = await Case.start();
    const f = c.f;
    await c.person('A', 'B', 'E');
    for (const n of [1, 2, 3, 4]) await c.track(I(n));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']]);
    await c.split(I(3), [['B', '50']], { doc: null });
    await c.split(I(4), [['E', '30']], { doc: null });
    await c.load('2026-03', [
      { isrc: I(1), net: '100' },
      { isrc: I(3), net: '40' },
    ]);
    await c.load('2026-03', [
      { isrc: I(2), net: '60', label: 'Echo8' },
      { isrc: I(4), net: '50', label: 'Echo8' },
    ], ACC2);
    await c.load('2026-04', [{ isrc: I(2), net: '40', label: 'Echo8' }], ACC2);
    const zero = f.testLabels['0to8'];
    const echo = f.testLabels.Echo8;
    // ACC1 → 0to8 and ACC2 → Echo8 are registered by newFacade (D-169)
    const basis = (await f.modules.owners.createDocument({
      kind: 'advance_basis',
      title: 'Advance basis A',
      fileRef: 'dummy://advance-basis-a.pdf',
      ownerId: c.owners.get('A') as string,
      requiresApproval: false,
    })).id;
    const advance = async (amount: string, labelId: string | null) => {
      const op = await f.createOperation({
        direction: 'out',
        amount,
        artistId: c.id('A'),
        date: '2026-03-01',
        scope: { kind: 'any' },
        documentId: basis,
        comment: 'advance',
        ...(labelId ? { labelId } : { migration: true }),
      });
      if (labelId) await f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
      return op;
    };
    const unlabelled = await advance('60', null); // a migrated advance: without a label, as the history before the split
    const echoAdvance = await advance('20', echo);
    await f.createAds([
      { isrc: I(1), month: '2026-03', amount: '10', labelId: zero },
      { isrc: null, artistId: c.id('A'), month: '2026-03', amount: '5', labelId: echo },
    ]);
    return { c, f, zero, echo, unlabelled, echoAdvance };
  }

  const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), new Decimal(0)).toFixed();
  const bookText = (b: { earned: Decimal; waiting: Decimal; recouped: Decimal; adsCharged: Decimal; paid: Decimal; returns: Decimal; credits: Decimal; payable: Decimal }) =>
    [b.earned, b.waiting, b.recouped, b.adsCharged, b.paid, b.returns, b.credits, b.payable].map((x) => x.toFixed());

  it('the books of the labels and «without a label» add up to the total; a view under a label is the book of that label', async () => {
    const { c, f, zero, echo } = await labelWorld();
    const a = await f.ownerBalance(c.owners.get('A') as string);
    // A: 0to8 earned 50 (I1), Echo8 earned 30 + 20 (I2). The advance of 60 without a label is recouped from any income in
    // month order (50 of 0to8, then 10 of Echo8); the advance of Echo8 (20) from Echo8 alone. Ads: 10 under 0to8, 5 under Echo8.
    expect(Object.fromEntries(Object.entries(a.byLabel).map(([k, b]) => [k, bookText(b)]))).toEqual({
      '0to8': ['50', '0', '50', '10', '0', '0', '0', '-10'],
      Echo8: ['50', '0', '30', '5', '0', '0', '0', '15'],
    });
    expect(bookText(a.total)).toEqual(['100', '0', '80', '15', '0', '0', '0', '5']);
    expect([a.byLabel['0to8']?.labelId, a.byLabel.Echo8?.labelId, a.label]).toEqual([zero, echo, null]);
    for (const k of ['earned', 'waiting', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'payable'] as const)
      expect(sum(Object.values(a.byLabel).map((b) => b[k])), k).toBe(a.total[k].toFixed());
    // the artist row is partitioned the same way: recouped by the income consumed, unrecouped by the position
    const row = a.artists.find((x) => x.artistId === c.id('A'));
    expect(Object.fromEntries(Object.entries(row?.byLabel ?? {}).map(([k, b]) => [k, [b.earned, b.recouped, b.unrecouped, b.recoupedFromMaster].map((x) => x.toFixed())]))).toEqual({
      '0to8': ['50', '50', '0', '50'],
      Echo8: ['50', '30', '0', '30'],
    });
    expect(a.positions.map((p) => [p.labelId, p.recouped.toFixed()])).toEqual([[null, '60'], [echo, '20']]);
    expect(a.ads.map((p) => [p.labelId, p.amount.toFixed()]).sort()).toEqual([[zero, '10'], [echo, '5']].sort());
    // the view under a label: the same computation projected to the book
    for (const [name, id] of [['0to8', zero], ['Echo8', echo]] as const) {
      const v = await f.ownerBalance(c.owners.get('A') as string, {}, id);
      expect(bookText(v.total), name).toEqual(bookText(a.byLabel[name] as NonNullable<(typeof a.byLabel)[string]>));
      expect(Object.keys(v.byLabel), name).toEqual([name]);
      expect([v.label, v.payout.amountCents], name).toEqual([{ id, name }, name === 'Echo8' ? 1500 : 0]);
      expect(text(v.positions), name).toBe(text(a.positions.filter((p) => p.labelId === id)));
      expect(text(v.ads), name).toBe(text(a.ads.filter((p) => p.labelId === id)));
      expect(v.artists.find((x) => x.artistId === c.id('A'))?.byLabel, name).toEqual({ [name]: row?.byLabel[name] });
      const m = await f.artistBalance(c.id('A'), {}, id);
      expect([m.label, Object.keys(m.byLabel), m.total.earned.toFixed(), m.total.recouped.toFixed(), m.total.adsCharged.toFixed()], name).toEqual([
        { id, name },
        [name],
        '50',
        name === 'Echo8' ? '30' : '50',
        name === 'Echo8' ? '5' : '10',
      ]);
    }
    // the pseudonym: Σ books = total too
    const m = await f.artistBalance(c.id('A'));
    for (const k of ['earned', 'waiting', 'recouped', 'unrecouped', 'recoupedFromMaster', 'adsCharged', 'paid'] as const)
      expect(sum(Object.values(m.byLabel).map((b) => b[k])), k).toBe(m.total[k].toFixed());
    await c.verify();
    // a sublabel or an unknown id is refused as a view
    await c.sublabel('Sub One', '0to8', 'B');
    const sub = await c.labelId('Sub One');
    await expect(f.ownerBalance(c.owners.get('A') as string, {}, sub)).rejects.toMatchObject({ code: 'label_not_own' });
    await expect(f.ownerBalance(c.owners.get('A') as string, {}, 'no-such-label')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a payout under a label pays the book of that label and carries it; an operation needs a label', async () => {
    const { c, f, zero, echo } = await labelWorld();
    const id = c.owners.get('A') as string;
    await expect(f.createPayout(id)).rejects.toMatchObject({ code: 'label_required' });
    await expect(f.createPayout(id, { labelId: zero })).rejects.toMatchObject({ code: 'nothing_to_pay' }); // the 0to8 book is −10
    const op = await f.createPayout(id, { labelId: echo });
    expect([op.amountCents, op.labelId]).toEqual([1500, echo]);
    const snapshot = (await f.modules.settlements.getSnapshot(op.id)) as { labelId: string; labelName: string; total: { payable: string } };
    expect([snapshot.labelId, snapshot.labelName, snapshot.total.payable]).toEqual([echo, 'Echo8', '15']);
    await f.attachPaymentProof(op.id, { fileRef: 'dummy://proof-echo.pdf' });
    const after = await f.ownerBalance(id);
    expect([after.byLabel.Echo8?.paid.toFixed(), after.byLabel.Echo8?.payable.toFixed(), after.byLabel['0to8']?.paid.toFixed(), after.total.payable.toFixed()]).toEqual(['15', '0', '0', '-10']);
    // a return inherits the label of its payout
    const ret = await f.returnPayout(op.id, { fileRef: 'dummy://return.pdf', date: '2099-12-31', comment: 'bounced' });
    expect(ret.labelId).toBe(echo);
    expect((await f.ownerBalance(id)).byLabel.Echo8?.returns.toFixed()).toBe('15');
    // an operation needs an own label
    const basis = (await f.modules.owners.createDocument({ kind: 'adjustment_basis', title: 'adj', fileRef: 'dummy://adj.pdf', ownerId: id, requiresApproval: false })).id;
    const deduction = { direction: 'in' as const, amount: '1', artistId: c.id('A'), date: '2026-05-01', documentId: basis, comment: 'deduction' };
    await expect(f.createOperation(deduction)).rejects.toMatchObject({ code: 'label_required' });
    await expect(f.createOperation({ ...deduction, labelId: 'no-such-label' })).rejects.toMatchObject({ statusCode: 404 });
    await c.sublabel('Sub One', '0to8', 'B');
    await expect(f.createOperation({ ...deduction, labelId: await c.labelId('Sub One') })).rejects.toMatchObject({ code: 'label_not_own' });
    const d = await f.createOperation({ ...deduction, labelId: zero });
    expect(d.labelId).toBe(zero);
    // an ad without an ISRC needs a label; an own one
    await expect(f.createAds([{ isrc: null, artistId: c.id('A'), month: '2026-05', amount: '1' }])).rejects.toMatchObject({ code: 'label_required' });
    await expect(f.createAds([{ isrc: null, artistId: c.id('A'), month: '2026-05', amount: '1', labelId: await c.labelId('Sub One') }])).rejects.toMatchObject({ code: 'label_not_own' });
    // the accounts of a label
    await expect(f.modules.labels.addAccount(echo, ACC1)).rejects.toMatchObject({ code: 'account_taken' });
    await expect(f.modules.labels.addAccount(await c.labelId('Sub One'), '9')).rejects.toMatchObject({ code: 'account_for_sublabel' });
    expect((await f.listLabels()).map((l) => [l.name, l.accounts])).toEqual(expect.arrayContaining([['0to8', [ACC1]], ['Echo8', [ACC2]], ['Sub One', []]]));
  });

  it('setting the label of an operation without one makes it recoup from that label only (D-168)', async () => {
    const { c, f, zero, unlabelled } = await labelWorld();
    const id = c.owners.get('A') as string;
    const before = await f.signals();
    expect(before.operationsWithoutLabel.map((o) => [o.operationId, o.meaning, o.pseudonym])).toEqual([[unlabelled.id, 'recoupable_payout', 'A']]);
    const set = await f.setOperationLabel(unlabelled.id, zero);
    expect(set.labelId).toBe(zero);
    expect((await f.signals()).operationsWithoutLabel).toEqual([]);
    // the advance of 60 now takes the 0to8 income alone (50) and keeps 10 unrecouped; the Echo8 advance takes 20 of Echo8
    const a = await f.ownerBalance(id);
    expect(Object.fromEntries(Object.entries(a.byLabel).map(([k, b]) => [k, [b.recouped.toFixed(), b.payable.toFixed()]]))).toEqual({
      '0to8': ['50', '-10'],
      Echo8: ['20', '25'],
    });
    expect(a.positions.map((p) => [p.labelId, p.recouped.toFixed(), p.remaining.toFixed()])).toEqual([[zero, '50', '10'], [f.testLabels.Echo8, '20', '0']]);
    await expect(f.setOperationLabel(unlabelled.id, 'no-such-label')).rejects.toMatchObject({ statusCode: 404 });
    await c.verify();
  });

  it('every read under a label is the full answer restricted to the label', async () => {
    const { c, f, zero, echo } = await labelWorld();
    const owner = (n: string) => c.owners.get(n) as string;
    const reads = await spy();
    // who is visible: 0to8 → A (I1), B (I3); Echo8 → A (I2), E (I4)
    expect((await f.ownerList({ label: zero })).map((o) => o.id).sort()).toEqual([owner('A'), owner('B')].sort());
    expect((await f.ownerList({ label: echo })).map((o) => o.id).sort()).toEqual([owner('A'), owner('E')].sort());
    expect((await f.artistList({ label: echo })).map((a) => a.pseudonym)).toEqual(['A', 'E']);
    expect((await f.artistList()).map((a) => a.pseudonym)).toEqual(['A', 'B', 'E']);
    // the payables under a label: the visible owners, each the book of the label (the gate on its payable)
    const full = (await f.ownerPayables()).items;
    reads.length = 0;
    const underEcho = (await f.ownerPayables({ label: echo })).items;
    expect(reads.map((r) => [r.filter, r.units])).toEqual([[{}, 5]]); // the recoup needs every unit: the calculation stays full
    expect(underEcho.map((i) => i.ownerId).sort()).toEqual([owner('A'), owner('E')].sort());
    const aFull = await f.ownerBalance(owner('A'));
    const aEcho = underEcho.find((i) => i.ownerId === owner('A'));
    expect(aEcho && [aEcho.earned, aEcho.recouped, aEcho.payable, aEcho.payout.amountCents].map(String)).toEqual(['50', '30', '15', '1500']);
    expect(full.find((i) => i.ownerId === owner('A'))?.payable.toFixed()).toBe(aFull.total.payable.toFixed());
    const byIds = (await f.ownerPayables({ label: echo, ids: owner('A') })).items;
    expect(text(byIds)).toBe(text(underEcho.filter((i) => i.ownerId === owner('A'))));
    // the balances of the pseudonyms under a label: the artist book, `remaining` of it
    const rows = (await f.artistBalances({ label: echo })).items;
    expect(rows.map((r) => [r.pseudonym, r.earned.toFixed(), r.recouped.toFixed(), r.adsCharged.toFixed(), r.remaining.toFixed()])).toEqual([
      ['A', '50', '30', '5', '15'],
      ['E', '0', '0', '0', '0'],
    ]);
    expect(text((await f.artistBalances({ label: echo, ids: c.id('A') })).items)).toBe(text(rows.filter((r) => r.artistId === c.id('A'))));
    // the tracks: the summary and the catalog under Echo8 are the full ones restricted to its ISRCs (its units only)
    const summary = (await f.trackSummary()).items;
    reads.length = 0;
    const summaryEcho = (await f.trackSummary({ label: echo })).items;
    expect(reads.map((r) => [r.filter.labelIds, r.filter.isrcs, r.units])).toEqual([[[echo], [I(2), I(4)], 3]]);
    expect(text(summaryEcho)).toBe(text(summary.filter((i) => i.isrc === I(2) || i.isrc === I(4))));
    expect(text((await f.trackSummary({ label: echo, isrcs: `${I(1)},${I(2)}` })).items)).toBe(text(summary.filter((i) => i.isrc === I(2))));
    const catalog = (await f.trackCatalog()).items;
    expect(text((await f.trackCatalog({ label: echo })).items)).toBe(text(catalog.filter((i) => i.isrc === I(2) || i.isrc === I(4))));
    // the releases: the UPC with the Echo8 tracks only, the net of the Echo8 units
    const releases = (await f.releases(undefined, echo)).items;
    expect(releases.map((r) => [r.upc, r.trackCount, r.net])).toEqual([[UPC, 2, '150']]);
    expect((await f.releases()).items.map((r) => [r.trackCount, r.net])).toEqual([[4, '290']]);
    const release = await f.release(UPC, echo);
    expect(release.tracks.map((t) => [t.isrc, t.net.toFixed()])).toEqual([[I(2), '100'], [I(4), '50']]);
    expect(release.months.map((m) => [m.reportingMonth, m.net.toFixed()])).toEqual([['2026-03', '110'], ['2026-04', '40']]);
    // the queue: the unconfirmed split of E (Echo8) alone; of B under 0to8
    const q = await f.queue('split_unconfirmed');
    expect(q.groups.map((g) => g.key.label).sort()).toEqual([I(3), I(4)]);
    expect(text((await f.queue('split_unconfirmed', {}, {}, echo)).groups)).toBe(text(q.groups.filter((g) => g.key.label === I(4))));
    expect(text((await f.queue('split_unconfirmed', {}, {}, zero)).groups)).toBe(text(q.groups.filter((g) => g.key.label === I(3))));
    // the signals: every file is in the account of its label and has a label (D-169): nothing outside its account
    const s = await f.signals();
    expect([s.labelOutsideAccount, s.filesWithoutLabel]).toEqual([[], []]);
    reads.length = 0;
    expect((await f.signals({}, echo)).labelOutsideAccount).toEqual([]);
    expect((await f.signals({}, zero)).labelOutsideAccount).toEqual([]);
    // the ads under a label (D-169): the income book of the ISRCs the label pays (I1 under 0to8) needs every unit of them
    expect(reads.map((r) => [r.filter.labelIds, r.filter.isrcs, r.units])).toEqual([[[echo], undefined, 3], [[zero], undefined, 2], [undefined, [I(1)], 1]]);
    // the operations and the advertising under a label
    expect((await f.listOperations({ labelId: echo })).map((o) => [o.amountCents, o.labelName])).toEqual([[2000, 'Echo8']]);
    expect((await f.listOperations({ labelId: null })).map((o) => o.amountCents)).toEqual([6000]);
    expect((await f.listAds({ labelId: echo })).items.map((a) => [a.amountCents, a.allocation?.ourLabelName])).toEqual([[500, 'Echo8']]);
    expect((await f.listAds({ labelId: zero })).items.map((a) => a.amountCents)).toEqual([1000]);
    // under a label = the full answer restricted to the records the label pays (D-169: the payer, not the line)
    const allAds = (await f.listAds()).items;
    for (const id of [zero, echo]) expect(text((await f.listAds({ labelId: id })).items)).toBe(text(allAds.filter((x) => x.labelId === id)));
    expect((await f.adsSummary({ labelId: echo })).rows.map((r) => [r.label, r.amount.toFixed()])).toEqual([['Echo8', '5']]);
    expect((await f.adsSummary()).totals.amount.toFixed()).toBe('15');
    // the reconciliation and the overview: «Все» with the book of its files' label on every row (D-169)
    const recon = await f.reconciliation();
    const books = (account: string) => {
      const row = recon.find((r) => r.account === account && r.month === '2026-03');
      return row && Object.fromEntries(Object.entries(row.byLabel).map(([k, b]) => [k, [b.A_received, b.B_notOurs, b.C_waiting, b.ourShare].map((x) => x.toFixed())]));
    };
    expect(books(ACC1)).toEqual({ '0to8': ['140', '50', '20', '70'] });
    expect(books(ACC2)).toEqual({ Echo8: ['110', '30', '15', '65'] });
    const overview = await f.overview();
    expect(Object.entries(overview.totals.byLabel).map(([k, v]) => [k, v.received.toFixed(), v.discrepancy.toFixed()])).toEqual([
      ['0to8', '140', '0'],
      ['Echo8', '150', '0'],
    ]);
    expect(sum(Object.values(overview.totals.byLabel).map((v) => v.received))).toBe(overview.totals.all.received.toFixed());
    await c.verify();
  });
});

describe('the book by the account of the file (D-169)', () => {
  /**
   * A: rows A 50 on I(1) and I(2); R: the recipient of the rule of the sublabel «Sub Echo» of Echo8 (50 of the label
   * share). The 0to8 account carries I(1) 100 with the string «Sub Echo» (it leads to Echo8 through the sublabel); the
   * Echo8 account carries I(2) 40 with the string `Echo8`. One month.
   */
  async function bookWorld() {
    const c = await Case.start();
    await c.person('A', 'R');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']]);
    await c.sublabel('Sub Echo', 'Echo8', 'R');
    await c.load('2026-03', [{ isrc: I(1), net: '100', label: 'Sub Echo' }]);
    await c.load('2026-03', [{ isrc: I(2), net: '40', label: 'Echo8' }], ACC2);
    return { c, f: c.f, zero: c.f.testLabels['0to8'], echo: c.f.testLabels.Echo8 };
  }
  const fields = ['earned', 'waiting', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'payable'] as const;
  const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), new Decimal(0)).toFixed();
  const earnedBooks = (b: { byLabel: Record<string, { earned: Decimal }> }) =>
    Object.fromEntries(Object.entries(b.byLabel).map(([k, x]) => [k, x.earned.toFixed()]));

  it('the book of a unit is the label of its file, the sublabel rule still follows the label string', async () => {
    const { c, f, zero, echo } = await bookWorld();
    // the unit: book 0to8 (its file), label of record Echo8 and the rule of «Sub Echo» (its string)
    const [m] = (await f.trackMoney(I(1))).months;
    expect(m && [m.bookLabelId, m.bookLabelName, m.ourLabelName, m.sublabelName, m.rule !== null]).toEqual([zero, '0to8', 'Echo8', 'Sub Echo', true]);
    expect(m?.allocations.map((a) => [a.pseudonym, a.layer, a.amount.toFixed()])).toEqual([
      ['A', 'split', '50'],
      ['R', 'sublabel', '25'],
    ]);
    // the reconciliation: one book per Believe row, ourShareByLabel by the string (the reference invariant)
    const recon = await f.reconciliation();
    const row = (account: string) => recon.find((r) => r.account === account && r.month === '2026-03');
    expect(Object.keys(row(ACC1)?.byLabel ?? {})).toEqual(['0to8']);
    expect(Object.keys(row(ACC2)?.byLabel ?? {})).toEqual(['Echo8']);
    expect(Object.fromEntries(Object.entries(row(ACC1)?.ourShareByLabel ?? {}).map(([k, v]) => [k, v.toFixed()]))).toEqual({ Echo8: '25' });
    // the balances: R's rule money sits in the 0to8 book
    expect(earnedBooks(await f.ownerBalance(c.owners.get('R') as string))).toEqual({ '0to8': '25' });
    expect(earnedBooks(await f.ownerBalance(c.owners.get('A') as string))).toEqual({ '0to8': '50', Echo8: '20' });
    // the signal: the string leads to Echo8 inside the file of 0to8; seen whole and under 0to8, not under Echo8
    const s = await f.signals();
    expect(s.labelOutsideAccount.map((x) => [x.account, x.month, x.labelName, x.ourLabelName, x.accountLabelName, x.net.toFixed(), x.units])).toEqual([
      [ACC1, '2026-03', 'Sub Echo', 'Echo8', '0to8', '100', 1],
    ]);
    expect(text((await f.signals({}, zero)).labelOutsideAccount)).toBe(text(s.labelOutsideAccount));
    expect((await f.signals({}, echo)).labelOutsideAccount).toEqual([]);
    // under Echo8 the unit is absent
    expect((await f.trackSummary({ label: echo })).items.map((i) => i.isrc)).toEqual([I(2)]);
    expect((await f.trackSummary({ label: zero })).items.map((i) => i.isrc)).toEqual([I(1)]);
    await c.verify();
  });

  it('Σ books = total', async () => {
    const { c, f } = await bookWorld();
    for (const name of ['A', 'R']) {
      const b = await f.ownerBalance(c.owners.get(name) as string);
      for (const k of fields) expect(sum(Object.values(b.byLabel).map((x) => x[k])), `${name} ${k}`).toBe(b.total[k].toFixed());
    }
    for (const r of await f.reconciliation()) {
      const books = Object.values(r.byLabel);
      expect(sum(books.map((b) => b.A_received))).toBe(r.A_received.toFixed());
      expect(sum(books.map((b) => b.B_notOurs))).toBe(r.B_notOurs.toFixed());
      expect(sum(books.map((b) => b.C_waiting))).toBe(r.C_waiting.toFixed());
      expect(sum(books.map((b) => b.ourShare))).toBe(r.ourShare.toFixed());
    }
    const o = await f.overview();
    expect(Object.fromEntries(Object.entries(o.totals.byLabel).map(([k, v]) => [k, v.received.toFixed()]))).toEqual({ '0to8': '100', Echo8: '40' });
    expect(sum(Object.values(o.totals.byLabel).map((v) => v.received))).toBe(o.totals.all.received.toFixed());
    await c.verify();
  });

  it('a view under a label = the book', async () => {
    const { c, f, zero, echo } = await bookWorld();
    const a = c.owners.get('A') as string;
    const full = await f.ownerBalance(a);
    for (const [name, id] of [['0to8', zero], ['Echo8', echo]] as const) {
      const v = await f.ownerBalance(a, {}, id);
      const book = full.byLabel[name];
      expect(fields.map((k) => v.total[k].toFixed()), name).toEqual(fields.map((k) => book?.[k].toFixed()));
      expect(Object.keys(v.byLabel), name).toEqual([name]);
      expect((await f.artistBalance(c.id('A'), {}, id)).total.earned.toFixed(), name).toBe(book?.earned.toFixed());
      const item = (await f.ownerPayables({ label: id })).items.find((i) => i.ownerId === a);
      expect(item?.earned.toFixed(), name).toBe(book?.earned.toFixed());
    }
    // R's rule money is in the 0to8 book: nothing of it under Echo8, though the rule is of an Echo8 sublabel
    expect((await f.ownerBalance(c.owners.get('R') as string, {}, echo)).total.earned.toFixed()).toBe('0');
  });

  it('every read under a label is the full answer restricted to the files of the label', async () => {
    const { c, f, zero, echo } = await bookWorld();
    const reads = await spy();
    const summary = (await f.trackSummary()).items;
    for (const [id, isrc] of [[echo, I(2)], [zero, I(1)]] as const) {
      reads.length = 0;
      const under = (await f.trackSummary({ label: id })).items;
      expect(reads.map((r) => [r.filter.labelIds, r.filter.isrcs, r.units])).toEqual([[[id], [isrc], 1]]);
      expect(text(under)).toBe(text(summary.filter((i) => i.isrc === isrc)));
    }
    const catalog = (await f.trackCatalog()).items;
    expect(text((await f.trackCatalog({ label: zero })).items)).toBe(text(catalog.filter((i) => i.isrc === I(1))));
    expect((await f.releases(undefined, echo)).items.map((r) => [r.upc, r.trackCount, r.net])).toEqual([[UPC, 1, '40']]);
    reads.length = 0;
    const release = await f.release(UPC, echo);
    expect(release.tracks.map((t) => [t.isrc, t.net.toFixed()])).toEqual([[I(2), '40']]);
    expect(reads.map((r) => [r.filter.labelIds, r.filter.upcs])).toEqual([[[echo], [UPC]]]);
    reads.length = 0;
    await f.queue('label_unmapped', {}, {}, echo);
    expect(reads.map((r) => r.filter.labelIds)).toEqual([[echo]]);
    await c.verify();
  });

  it("a file without a label is the book '?' and no label payout pays it", async () => {
    const { c, f, zero, echo } = await bookWorld();
    const { pg } = await testStack();
    await pg.pool.query(`UPDATE source_files SET label_id = NULL WHERE account = $1`, [ACC2]);
    const a = c.owners.get('A') as string;
    expect(earnedBooks(await f.ownerBalance(a))).toEqual({ '0to8': '50', '?': '20' });
    const row = (await f.reconciliation()).find((r) => r.account === ACC2 && r.month === '2026-03');
    expect(Object.keys(row?.byLabel ?? {})).toEqual(['?']);
    const [m] = (await f.trackMoney(I(2))).months;
    expect(m && [m.bookLabelId, m.bookLabelName, m.ourLabelName]).toEqual([null, null, 'Echo8']);
    // the signal lists the file; under a label the list is empty
    const s = await f.signals();
    expect(s.filesWithoutLabel.map((x) => [x.account, x.reportingMonth])).toEqual([[ACC2, '2026-03']]);
    expect(s.counts.filesWithoutLabel).toBe(1);
    expect((await f.signals({}, zero)).filesWithoutLabel).toEqual([]);
    // no label payout pays the book '?': Echo8 has nothing, 0to8 pays its own 50
    expect((await f.ownerBalance(a, {}, echo)).total.earned.toFixed()).toBe('0');
    await expect(f.createPayout(a, { labelId: echo })).rejects.toMatchObject({ code: 'nothing_to_pay' });
    const p = await f.createPayout(a, { labelId: zero });
    expect(p.amountCents).toBe(5000);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof.pdf' });
    const after = await f.ownerBalance(a);
    expect([after.byLabel['?']?.payable.toFixed(), after.byLabel['0to8']?.payable.toFixed(), after.total.payable.toFixed()]).toEqual(['20', '0', '20']);
    await c.verify();
  });

  it('withFullReads ignores labelIds', async () => {
    const { c, f, echo } = await bookWorld();
    const service = (await testStack()).service;
    expect((await service.snapshot({ labelIds: [echo] })).units.map((u) => [u.isrc, u.labelId])).toEqual([[I(2), echo]]);
    expect((await service.snapshot({ labelIds: [] })).units).toEqual([]);
    expect(await withFullReads(c, async () => (await service.snapshot({ labelIds: [echo] })).units.length)).toBe(2);
    // the ISRCs of the two labels are disjoint here, so the answer under a label is the one of the full reads
    const scopedAnswer = text((await f.trackSummary({ label: echo })).items);
    expect(text((await withFullReads(c, () => f.trackSummary({ label: echo }))).items)).toBe(scopedAnswer);
  });
});
