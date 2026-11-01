import { describe, expect, it } from 'vitest';
import { approvedDoc, newFacade } from './helpers/fixtures';

const ISRC = 'QZTST2600001';

describe('splits (README 5)', () => {
  it('stores only artist and MC shares; our share is the remainder', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: ISRC,
      validFrom: '2020-01-01',
      shares: [
        { newArtistPseudonym: 'Artist 1', percent: '20' },
        { newArtistPseudonym: 'Artist 2', percent: '15' },
        { newArtistPseudonym: 'MC', percent: '15' },
      ],
    });
    expect(s.ourShare).toBe('50');
    expect(s.shares).toHaveLength(3);
  });

  it('the sum must not exceed 100; a share of 0 is allowed', async () => {
    const f = await newFacade();
    await expect(
      async () =>
        await f.createSplit({
          isrc: ISRC,
          validFrom: '2020-01-01',
          shares: [
            { newArtistPseudonym: 'A', percent: '60' },
            { newArtistPseudonym: 'B', percent: '40.0001' },
          ],
        }),
    ).rejects.toThrow(/exceeds 100/);
    const s = await f.createSplit({
      isrc: ISRC,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '0' }],
    });
    expect(s.ourShare).toBe('100');
  });

  it('an unknown artist in a split becomes an artist without owner ("waiting for documents")', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: ISRC,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'Newcomer', percent: '50' }],
    });
    const artist = await f.modules.owners.getArtist(s.shares[0]?.artistId as string);
    expect(artist.ownerId).toBeNull();
    expect(artist.status).toBe('no_owner');
  });

  it('validity periods of one ISRC never overlap; the split is chosen by the report date', async () => {
    const f = await newFacade();
    await f.createSplit({
      isrc: ISRC,
      validFrom: '2026-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    await expect(
      async () =>
        await f.createSplit({
          isrc: ISRC,
          validFrom: '2026-06-01',
          shares: [{ newArtistPseudonym: 'B', percent: '40' }],
        }),
    ).rejects.toThrow(/overlaps/);
    await f.createSplit({
      isrc: ISRC,
      validFrom: '2026-07-01',
      shares: [{ newArtistPseudonym: 'B', percent: '40' }],
    });
    const sp = f.modules.splits;
    expect((await sp.splitAt(ISRC, '2026-06-01'))?.ourShare.toFixed()).toBe('50');
    expect((await sp.splitAt(ISRC, '2026-07-01'))?.ourShare.toFixed()).toBe('60');
    expect(await sp.splitAt(ISRC, '2025-12-01')).toBeUndefined();
  });

  it('a split change needs a document and closes the previous split at the change date', async () => {
    const f = await newFacade();
    const first = await f.createSplit({
      isrc: ISRC,
      validFrom: '2025-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    const a = first.shares[0]?.artistId as string;
    await expect(
      async () =>
        await f.changeSplit({
          isrc: ISRC,
          from: '2026-03-01',
          shares: [{ artistId: a, percent: '60' }],
          documentId: '',
        }),
    ).rejects.toThrow(/document/);
    const doc = await approvedDoc(f, 'appendix');
    await f.changeSplit({
      isrc: ISRC,
      from: '2026-03-01',
      shares: [{ artistId: a, percent: '60' }],
      documentId: doc.id,
    });
    const list = await f.modules.splits.listSplits({ isrc: ISRC });
    expect(list.map((s) => [s.validFrom, s.validTo, s.ourShare])).toEqual([
      ['2025-01-01', '2026-03-01', '50'],
      ['2026-03-01', null, '40'],
    ]);
  });

  it('a buyout is a split change: the seller share becomes 0 on the listed ISRCs, confirmed by a buyout document', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: ISRC,
      validFrom: '2025-01-01',
      shares: [
        { newArtistPseudonym: 'Seller', percent: '30' },
        { newArtistPseudonym: 'Other', percent: '20' },
      ],
    });
    const seller = s.shares.find((x) => x.percent === '30')?.artistId as string;
    const notBuyout = await approvedDoc(f, 'appendix');
    await expect(
      async () =>
        await f.buyout({
          isrcs: [ISRC],
          sellerArtistId: seller,
          effectiveFrom: '2026-05-01',
          documentId: notBuyout.id,
        }),
    ).rejects.toThrow(/buyout/);
    const doc = await approvedDoc(f, 'buyout');
    await f.buyout({
      isrcs: [ISRC],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: doc.id,
    });
    const after = await f.modules.splits.splitAt(ISRC, '2026-07-01');
    expect(after?.shares.find((x) => x.artistId === seller)?.percent.toFixed()).toBe('0');
    expect(after?.ourShare.toFixed()).toBe('80');
    expect((await f.modules.splits.splitAt(ISRC, '2026-04-01'))?.ourShare.toFixed()).toBe('50');
    // the buyout payment is not a settlement operation: nothing was written there
    expect(await f.modules.settlements.allOperations()).toHaveLength(0);
  });
});
