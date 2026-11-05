import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import type { AdExpense } from '../src/modules/ads';
import type { SplitAtDate } from '../src/modules/splits';
import type { LabelOfRecord } from '../src/modules/labels';
import { adPositionsByOwner, adSummary, allocateAd, isMcPseudonym, type AdContext } from '../src/facade/ads';
import {
  approvedAppendix,
  confirmedOwner,
  labelOwner,
  newFacade,
  writeBelieve,
  type TestFacade,
} from './helpers/fixtures';

// Advertising expenses (D-155, D-156). Synthetic data only.

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const UPC = '1234567890123';
const D = (v: string) => new Decimal(v);

const ad = (over: Partial<AdExpense> = {}): AdExpense => ({
  id: 'ad1',
  isrc: I1,
  month: '2026-07',
  amountCents: 10000,
  recoveryPercent: '100',
  scope: 'any',
  artistId: null,
  externalRef: null,
  source: 'manual',
  migration: false,
  comment: '',
  createdAt: '2026-11-03T00:00:00.000Z',
  active: true,
  deactivatedReason: null,
  labelId: null,
  ...over,
});

/** A hand-built context: artists a, b (persons), mc (MC pseudonym), brand (a label owner), sub (sublabel pseudonym). */
function world(opts: { split?: [string, string][] | null; label?: 'own' | 'sublabel'; rulePercent?: string } = {}) {
  const artists = new Map(
    [
      ['a', 'Artist A', 'oa'],
      ['b', 'Artist B', 'ob'],
      ['mc', 'MC Test', 'omc'],
      ['brand', 'Brand', 'olabel'],
      ['sub', 'Sub Label', 'osub'],
    ].map(([id, pseudonym, ownerId]) => [id as string, { id: id as string, pseudonym: pseudonym as string, ownerId: ownerId as string }]),
  );
  const split: SplitAtDate | undefined =
    opts.split === null
      ? undefined
      : {
          splitId: 's1',
          documentId: null,
          ourShare: D('0'),
          shares: (opts.split ?? [['a', '30'], ['b', '20']]).map(([artistId, p]) => ({
            artistId,
            percent: D(p),
            documentId: null,
          })),
        };
  const label: LabelOfRecord =
    opts.label === 'sublabel'
      ? {
          id: 'L-sub',
          name: 'Sub',
          kind: 'sublabel',
          ownLabelId: 'L-own',
          rule: { id: 'r1', percent: D(opts.rulePercent ?? '50'), recipientArtistId: 'sub', documentId: null },
        }
      : { id: 'L-own', name: '0to8', kind: 'own', ownLabelId: null, rule: null };
  const ctx: AdContext = {
    splitAt: () => split,
    labelOf: () => label,
    labelName: (id) => (id === 'L-own' ? '0to8' : undefined),
    artistIndex: artists,
    labelOwners: new Set(['olabel', 'osub']),
    labelStringOf: () => 'Test Label',
  };
  return ctx;
}

describe('ads: allocation of one expense (pure)', () => {
  it('splits by the artists\' percents (30/20 -> 60/40), recovers 100 %: nothing is ours', () => {
    const r = allocateAd(ad(), world());
    expect(r.status).toBe('allocated');
    expect(r.parts.map((p) => [p.artistId, p.amount.toFixed(), p.recovered.toFixed()])).toEqual([
      ['a', '60', '60'],
      ['b', '40', '40'],
    ]);
    expect(r.unrecovered.toFixed()).toBe('0');
    expect(r.borneBy).toMatchObject({ kind: 'ours' });
  });

  it('MC and label rows bear nothing: their share goes to the artists', () => {
    const r = allocateAd(ad(), world({ split: [['a', '30'], ['mc', '20'], ['brand', '50']] }));
    expect(r.parts.map((p) => [p.artistId, p.amount.toFixed()])).toEqual([['a', '100']]);
    expect(isMcPseudonym('MC Test')).toBe(true);
    expect(isMcPseudonym('mc_x')).toBe(true);
    expect(isMcPseudonym('MCQUEEN')).toBe(false);
  });

  it('recovery 50 %: artists owe half; on our own label the rest is ours', () => {
    const r = allocateAd(ad({ recoveryPercent: '50' }), world());
    expect(r.parts.map((p) => p.recovered.toFixed())).toEqual(['30', '20']);
    expect(r.borneBy).toEqual({ kind: 'ours', amount: D('50') });
  });

  it('a sublabel with a rule bears the unrecovered part as a debt on its pseudonym', () => {
    const r = allocateAd(ad({ recoveryPercent: '0' }), world({ label: 'sublabel' }));
    expect(r.parts.map((p) => p.recovered.toFixed())).toEqual(['0', '0']);
    expect(r.borneBy).toMatchObject({ kind: 'sublabel', artistId: 'sub', ownerId: 'osub' });
    expect(r.borneBy.amount.toFixed()).toBe('100');
    const pos = adPositionsByOwner([r]);
    expect(pos.get('osub')?.map((p) => [p.role, p.amount.toFixed(), p.scope.kind])).toEqual([['sublabel', '100', 'any']]);
    expect(pos.has('oa')).toBe(false);
  });

  it('no split: the whole expense is ours (even on a sublabel), status no_split', () => {
    const r = allocateAd(ad(), world({ split: null, label: 'sublabel' }));
    expect(r.status).toBe('no_split');
    expect(r.parts).toEqual([]);
    expect(r.borneBy).toEqual({ kind: 'ours', amount: D('100') });
  });

  it('only MC and labels in the split: no artist, the expense is unrecovered', () => {
    const r = allocateAd(ad(), world({ split: [['mc', '50']] }));
    expect(r.status).toBe('no_artist');
    expect(r.unrecovered.toFixed()).toBe('100');
  });

  it('an allocated expense goes whole to its pseudonym without a split; scope isrc becomes the ISRC list', () => {
    const r = allocateAd(ad({ artistId: 'b', scope: 'isrc', recoveryPercent: '75' }), world({ split: null }));
    expect(r.status).toBe('pre_allocated');
    expect(r.parts.map((p) => [p.artistId, p.recovered.toFixed()])).toEqual([['b', '75']]);
    expect(adPositionsByOwner([r]).get('ob')?.[0]?.scope).toEqual({ kind: 'isrcs', isrcs: [I1] });
  });

  it('exact: 100.00 over three equal artists sums back to the amount (residue to one part)', () => {
    const r = allocateAd(
      ad({ recoveryPercent: '33.33' }),
      world({ split: [['a', '10'], ['b', '10'], ['sub', '0'], ['x', '10']] }),
    );
    const parts = r.parts.reduce((s, p) => s.add(p.amount), D('0'));
    expect(parts.toFixed()).toBe('100');
    const recovered = r.parts.reduce((s, p) => s.add(p.recovered), D('0'));
    expect(recovered.add(r.unrecovered).toFixed()).toBe('100');
  });

  it('summary per month and label: total, returned, sublabels, us, without split', () => {
    const rows = adSummary([
      allocateAd(ad({ id: 'x1', recoveryPercent: '50' }), world()),
      allocateAd(ad({ id: 'x2' }), world({ split: null })),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: '2026-07', label: '0to8', count: 2 });
    expect(rows[0]?.amount.toFixed()).toBe('200');
    expect(rows[0]?.recoveredFromArtists.toFixed()).toBe('50');
    expect(rows[0]?.borneByUs.toFixed()).toBe('150');
    expect(rows[0]?.noSplit.toFixed()).toBe('100');
  });
});

/** Owner A (artist A1) with a 50 % split on I1 and I2; July income 100 on I1 and 20 on I2. */
async function stackWorld(f: TestFacade) {
  const a = await confirmedOwner(f, 'Owner A', ['A1']);
  const a1 = a.artists[0] as { id: string };
  const o = f.modules.owners;
  for (const isrc of [I1, I2]) await o.createTrack({ title: isrc, isrc, upc: UPC, artistIds: [a1.id] });
  const appendix = await approvedAppendix(f, a.owner.id);
  for (const isrc of [I1, I2])
    await f.createSplit({ isrc, validFrom: '2020-01-01', shares: [{ artistId: a1.id, percent: '50' }], documentId: appendix.id });
  await f.ingestBelieve(
    writeBelieve('2026-07', [
      { isrc: I1, upc: UPC, net: '100' },
      { isrc: I2, upc: UPC, net: '20' },
    ]),
  );
  return { a, a1 };
}

describe('ads: the owner balance (stack)', () => {
  it('D-155 example: income 100, split 50/50, ad 40 at 100 % -> the artist gets 10; 0 % -> 50; back in time', async () => {
    const f = await newFacade();
    const { a } = await stackWorld(f);
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('60');
    const { created } = await f.createAds([{ isrc: I1, month: '2026-07', amount: '40' }]);
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.payable.toFixed()).toBe('20');
    expect(b.total.adsCharged.toFixed()).toBe('40');
    expect(b.total.recouped.toFixed()).toBe('0'); // not recouped: taken off at once (D-157)
    expect(b.ads.map((x) => [x.isrc, x.amount.toFixed(), x.role])).toEqual([[I1, '40', 'artist']]);
    const id = created[0]?.id as string;
    await f.updateAd(id, { recoveryPercent: '0' });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('60');
    // D-157: charged at once and in full, above the income too: payable goes negative (shown as 0)
    await f.updateAd(id, { recoveryPercent: '100' });
    await f.createAds([{ isrc: I1, month: '2026-12', amount: '100' }]);
    const more = await f.ownerBalance(a.owner.id);
    expect(more.total.adsCharged.toFixed()).toBe('140');
    expect(more.total.payable.toFixed()).toBe('-80');
    expect(more.total.payableShown.toFixed()).toBe('0');
    expect(more.total.payableNegative).toBe(true);
    expect(more.ads.map((x) => [x.month, x.amount.toFixed()])).toEqual([
      ['2026-12', '100'],
      ['2026-07', '40'],
    ]);
  });

  it('the whole amount is charged whatever the income of the ISRC; deactivation removes it', async () => {
    const f = await newFacade();
    const { a } = await stackWorld(f);
    const { created } = await f.createAds([{ isrc: I2, month: '2026-07', amount: '30', scope: 'isrc' }]);
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.adsCharged.toFixed()).toBe('30'); // I2 gives the artist 10 only, the 30 is charged anyway
    expect(b.total.payable.toFixed()).toBe('30');
    await f.deactivateAd(created[0]?.id as string, 'entered twice');
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('60');
    expect((await f.listAds()).count).toBe(0);
    expect((await f.listAds({ includeInactive: true })).items[0]?.allocation).toBeNull();
    expect((await f.getAd(created[0]?.id as string)).allocation).toBeNull();
    await expect(f.getAd('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a sublabel bears the unrecovered part; a repeated external ref is skipped; the list and summary show it', async () => {
    const f = await newFacade();
    const { a } = await stackWorld(f);
    const own = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8');
    const sub = await f.modules.labels.createLabel({ name: 'Sub One', kind: 'sublabel', ownLabelId: own?.id ?? null });
    await f.modules.labels.addAlias(sub.id, 'Sub One');
    const subOwner = await labelOwner(f, 'Sub One');
    // the sublabel's income counts (B) only with its contract
    const o = f.modules.owners;
    const doc = await o.createDocument({ kind: 'contract', title: 'Dummy sublabel contract', fileRef: 'dummy://sub.pdf', ownerId: subOwner.owner.id, requiresApproval: true });
    await o.approveDocument(doc.id, 'manager');
    await o.createContract({ ownerId: subOwner.owner.id, documentId: doc.id, artistIds: [subOwner.artist.id] });
    await f.createLabelRule({
      labelId: sub.id,
      percent: '50',
      recipientArtistId: subOwner.artist.id,
      validFrom: '2020-01-01',
      documentId: (await approvedAppendix(f, subOwner.owner.id)).id,
    });
    await f.ingestBelieve(writeBelieve('2026-08', [{ isrc: I2, upc: UPC, net: '40', labelName: 'Sub One' }]));
    const first = await f.createAds([
      { isrc: I2, month: '2026-08', amount: '10', recoveryPercent: '30', externalRef: 'post-1' },
    ]);
    const again = await f.createAds([
      { isrc: I2, month: '2026-08', amount: '10', recoveryPercent: '30', externalRef: 'post-1' },
    ]);
    expect(first.created).toHaveLength(1);
    expect(again).toEqual({ created: [], skipped: ['post-1'] });
    const list = await f.listAds({ ownerId: subOwner.owner.id });
    expect(list.items[0]?.allocation?.borneBy).toMatchObject({ kind: 'sublabel', artistId: subOwner.artist.id });
    expect(list.items[0]?.allocation?.parts.map((p) => [p.pseudonym, p.recovered.toFixed()])).toEqual([['A1', '3']]);
    const subBalance = await f.ownerBalance(subOwner.owner.id);
    expect(subBalance.total.adsCharged.toFixed()).toBe('7');
    expect(subBalance.total.payable.toFixed()).toBe('3'); // its sublabel share of I2 in August is 10
    expect((await f.ownerBalance(a.owner.id)).total.adsCharged.toFixed()).toBe('3');
    const summary = await f.adsSummary();
    expect(summary.totals.count).toBe(1);
    expect(summary.totals.amount.toFixed()).toBe('10');
    expect((await f.getAd(first.created[0]?.id as string)).allocation?.parts[0]?.pseudonym).toBe('A1');
    expect(summary.rows.map((r) => [r.month, r.label, r.borneBySublabels.toFixed(), r.recoveredFromArtists.toFixed()])).toEqual([
      ['2026-08', '0to8', '7', '3'],
    ]);
  });

  it('refuses a bad record: no ISRC and no pseudonym, amount 0, percent above 100, an unknown pseudonym', async () => {
    const f = await newFacade();
    await expect(f.createAds([{ month: '2026-07', amount: '1' }])).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.createAds([{ isrc: I1, month: '2026-07', amount: '0' }])).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      f.createAds([{ isrc: I1, month: '2026-07', amount: '5', recoveryPercent: '101' }]),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.createAds([{ isrc: I1, month: '2026-07', amount: '5', artistId: 'nope' }])).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
