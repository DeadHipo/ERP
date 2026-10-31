import { describe, expect, it } from 'vitest';
import { approvedDoc, newFacade } from './helpers/fixtures';

const ISRC = 'QZTST2600001';

describe('splits (README 5)', () => {
  it('stores only artist and MC shares; our share is the remainder', () => {
    const f = newFacade();
    const s = f.createSplit({
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
    f.close();
  });

  it('the sum must not exceed 100; a share of 0 is allowed', () => {
    const f = newFacade();
    expect(() =>
      f.createSplit({
        isrc: ISRC,
        validFrom: '2020-01-01',
        shares: [
          { newArtistPseudonym: 'A', percent: '60' },
          { newArtistPseudonym: 'B', percent: '40.0001' },
        ],
      }),
    ).toThrow(/exceeds 100/);
    const s = f.createSplit({
      isrc: ISRC,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '0' }],
    });
    expect(s.ourShare).toBe('100');
    f.close();
  });

  it('an unknown artist in a split becomes an artist without owner ("waiting for documents")', () => {
    const f = newFacade();
    const s = f.createSplit({
      isrc: ISRC,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'Newcomer', percent: '50' }],
    });
    const artist = f.modules.owners.getArtist(s.shares[0]?.artistId as string);
    expect(artist.ownerId).toBeNull();
    expect(artist.status).toBe('no_owner');
    f.close();
  });

  it('validity periods of one ISRC never overlap; the split is chosen by the report date', () => {
    const f = newFacade();
    f.createSplit({
      isrc: ISRC,
      validFrom: '2026-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    expect(() =>
      f.createSplit({
        isrc: ISRC,
        validFrom: '2026-06-01',
        shares: [{ newArtistPseudonym: 'B', percent: '40' }],
      }),
    ).toThrow(/overlaps/);
    f.createSplit({
      isrc: ISRC,
      validFrom: '2026-07-01',
      shares: [{ newArtistPseudonym: 'B', percent: '40' }],
    });
    const sp = f.modules.splits;
    expect(sp.splitAt(ISRC, '2026-06-01')?.ourShare.toFixed()).toBe('50');
    expect(sp.splitAt(ISRC, '2026-07-01')?.ourShare.toFixed()).toBe('60');
    expect(sp.splitAt(ISRC, '2025-12-01')).toBeUndefined();
    f.close();
  });

  it('a split change needs a document and closes the previous split at the change date', () => {
    const f = newFacade();
    const first = f.createSplit({
      isrc: ISRC,
      validFrom: '2025-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    const a = first.shares[0]?.artistId as string;
    expect(() =>
      f.changeSplit({
        isrc: ISRC,
        from: '2026-03-01',
        shares: [{ artistId: a, percent: '60' }],
        documentId: '',
      }),
    ).toThrow(/document/);
    const doc = approvedDoc(f, 'appendix');
    f.changeSplit({
      isrc: ISRC,
      from: '2026-03-01',
      shares: [{ artistId: a, percent: '60' }],
      documentId: doc.id,
    });
    const list = f.modules.splits.listSplits({ isrc: ISRC });
    expect(list.map((s) => [s.validFrom, s.validTo, s.ourShare])).toEqual([
      ['2025-01-01', '2026-03-01', '50'],
      ['2026-03-01', null, '40'],
    ]);
    f.close();
  });

  it('a buyout is a split change: the seller share becomes 0 on the listed ISRCs, confirmed by a buyout document', () => {
    const f = newFacade();
    const s = f.createSplit({
      isrc: ISRC,
      validFrom: '2025-01-01',
      shares: [
        { newArtistPseudonym: 'Seller', percent: '30' },
        { newArtistPseudonym: 'Other', percent: '20' },
      ],
    });
    const seller = s.shares.find((x) => x.percent === '30')?.artistId as string;
    const notBuyout = approvedDoc(f, 'appendix');
    expect(() =>
      f.buyout({
        isrcs: [ISRC],
        sellerArtistId: seller,
        effectiveFrom: '2026-05-01',
        documentId: notBuyout.id,
      }),
    ).toThrow(/buyout/);
    const doc = approvedDoc(f, 'buyout');
    f.buyout({ isrcs: [ISRC], sellerArtistId: seller, effectiveFrom: '2026-05-01', documentId: doc.id });
    const after = f.modules.splits.splitAt(ISRC, '2026-07-01');
    expect(after?.shares.find((x) => x.artistId === seller)?.percent.toFixed()).toBe('0');
    expect(after?.ourShare.toFixed()).toBe('80');
    expect(f.modules.splits.splitAt(ISRC, '2026-04-01')?.ourShare.toFixed()).toBe('50');
    // the buyout payment is not a settlement operation: nothing was written there
    expect(f.modules.settlements.allOperations()).toHaveLength(0);
    f.close();
  });
});
