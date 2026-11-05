import { describe, expect, it } from 'vitest';
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
    const { created } = await f.createAds([{ isrc: null, artistId: c.id('A'), month: '2026-03', amount: '5' }]);
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
    const full = await withFullReads(c, () => f.ownerBalance(id));
    expect(full.payout.allowed).toBe(true);
    const reads = await spy();
    const op = await f.createPayout(id);
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
    const advance = await f.createOperation({
      direction: 'out',
      amount: '30',
      artistId: c.id('A'),
      date: '2026-03-01',
      scope: { kind: 'any' },
      documentId: basis.id,
      comment: 'advance',
    });
    await f.attachPaymentProof(advance.id, { fileRef: 'dummy://proof-a.pdf' });
    await f.createAds([{ isrc: I(1), month: '2026-03', amount: '40' }]);
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
