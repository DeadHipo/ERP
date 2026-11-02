import { describe, expect, it } from 'vitest';
import type { FundedFrom, ParticipationInput } from '../src/modules/splits';
import { approvedDoc, newFacade, type TestFacade } from './helpers/fixtures';

const ISRC = 'QZTST2600001';

async function artist(f: TestFacade, pseudonym: string) {
  return (await f.modules.owners.createArtist({ pseudonym, ownerId: null })).id;
}

describe('participations (D-126)', () => {
  it('creates every kind and reads them back', async () => {
    const f = await newFacade();
    const [a, p, q] = [await artist(f, 'A'), await artist(f, 'P'), await artist(f, 'Q')];
    const mk = (artistId: string, base: 'net' | 'bucket', fundedFrom: FundedFrom, extra: object = {}) =>
      f.createParticipation({
        isrc: ISRC,
        artistId,
        percent: '10',
        base,
        fundedFrom,
        validFrom: '2026-01-01',
        ...extra,
      });
    const top = await mk(p, 'net', 'top');
    const pool = await mk(p, 'net', 'artist_pool');
    const share = await mk(q, 'bucket', 'artist_share', { fromArtistId: a });
    const ls1 = await mk(q, 'bucket', 'label_share');
    const ls2 = await mk(a, 'net', 'label_share');
    expect([top, pool, share, ls1, ls2].map((x) => x.fundedFrom)).toEqual([
      'top',
      'artist_pool',
      'artist_share',
      'label_share',
      'label_share',
    ]);
    expect(share.fromArtistId).toBe(a);
    expect((await f.listParticipations({ isrc: ISRC })).total).toBe(5);
    const byArtist = await f.listParticipations({ artistId: q });
    expect(byArtist.items.map((x) => x.pseudonym)).toEqual(['Q', 'Q']);
  });

  it('D-130: end dates are floored to the month start; a mid-month hand-over gives the month to the successor', async () => {
    const f = await newFacade();
    const [a, b, p1, p2] = [await artist(f, 'A'), await artist(f, 'B'), await artist(f, 'P1'), await artist(f, 'P2')];
    // a split with validTo on the 15th ends at the 1st, and its successor from the 15th starts at the 1st: no overlap
    const s1 = await f.createSplit({
      isrc: ISRC,
      validFrom: '2026-01-10',
      validTo: '2026-05-15',
      shares: [{ artistId: a, percent: '50' }],
    });
    expect([s1.validFrom, s1.validTo]).toEqual(['2026-01-01', '2026-05-01']);
    const s2 = await f.createSplit({ isrc: ISRC, validFrom: '2026-05-15', shares: [{ artistId: b, percent: '50' }] });
    expect(s2.validFrom).toBe('2026-05-01');
    expect((await f.modules.splits.index()).at(ISRC, '2026-05-01')?.splitId).toBe(s2.id);
    // an empty period after flooring is refused
    await expect(
      f.createSplit({ isrc: 'QZTST2600009', validFrom: '2026-07-02', validTo: '2026-07-30', shares: [] }),
    ).rejects.toMatchObject({ code: 'empty_period', statusCode: 400 });
    // P1 (top 15) closed on 2026-06-15, P2 (top 15) from 2026-06-15: June is P2's only
    const x1 = await f.createParticipation({
      isrc: ISRC,
      artistId: p1,
      percent: '15',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-01-01',
    });
    expect((await f.closeParticipation(x1.id, '2026-06-15')).validTo).toBe('2026-06-01');
    const x2 = await f.createParticipation({
      isrc: ISRC,
      artistId: p2,
      percent: '15',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-06-15',
    });
    expect(x2.validFrom).toBe('2026-06-01');
    const idx = await f.modules.splits.index();
    expect(idx.participationsAt(ISRC, '2026-06-01').map((x) => x.artistId)).toEqual([p2]);
    expect(idx.participationsAt(ISRC, '2026-05-01').map((x) => x.artistId)).toEqual([p1]);
  });

  it('D-130: the overlap key includes the source artist (two artist_share from two sources coexist)', async () => {
    const f = await newFacade();
    const [a, b, e] = [await artist(f, 'A'), await artist(f, 'B'), await artist(f, 'E')];
    const share = (from: string) =>
      f.createParticipation({
        isrc: ISRC,
        artistId: e,
        percent: '10',
        base: 'bucket',
        fundedFrom: 'artist_share',
        fromArtistId: from,
        validFrom: '2026-01-01',
      });
    const fromA = await share(a);
    const fromB = await share(b);
    expect([fromA.fromArtistId, fromB.fromArtistId]).toEqual([a, b]);
    await expect(share(a)).rejects.toMatchObject({ code: 'participation_overlap' });
    // the same source in an overlapping later period is refused by the module too
    await expect(
      f.modules.splits.createParticipation({
        isrc: ISRC,
        artistId: e,
        percent: '10',
        base: 'bucket',
        fundedFrom: 'artist_share',
        fromArtistId: b,
        validFrom: '2026-03-01',
      }),
    ).rejects.toMatchObject({ code: 'participation_overlap' });
    const idx = await f.modules.splits.index();
    expect(idx.participationsAt(ISRC, '2026-02-01').map((x) => x.fromArtistId).sort()).toEqual([a, b].sort());
  });

  it('refuses invalid combinations', async () => {
    const f = await newFacade();
    const [a, p] = [await artist(f, 'A'), await artist(f, 'P')];
    const base = { isrc: ISRC, artistId: p, percent: '10', validFrom: '2026-01-01' } as const;
    const bad = [
      { base: 'bucket', fundedFrom: 'top' },
      { base: 'bucket', fundedFrom: 'artist_pool' },
      { base: 'net', fundedFrom: 'artist_share', fromArtistId: a },
      { base: 'bucket', fundedFrom: 'artist_share' },
      { base: 'bucket', fundedFrom: 'artist_share', fromArtistId: p },
      { base: 'bucket', fundedFrom: 'label_share', fromArtistId: a },
      { base: 'net', fundedFrom: 'bogus' },
    ] as const;
    for (const b of bad) await expect(f.createParticipation({ ...base, ...b } as unknown as ParticipationInput)).rejects.toThrow();
    await expect(
      f.createParticipation({ ...base, base: 'net', fundedFrom: 'top', percent: '100.5' }),
    ).rejects.toThrow();
    await expect(
      f.createParticipation({ ...base, base: 'net', fundedFrom: 'top', validTo: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'empty_period' });
    // an end in the start month is floored onto the start: an empty period (D-130)
    await expect(
      f.createParticipation({ ...base, base: 'net', fundedFrom: 'top', validTo: '2026-01-20' }),
    ).rejects.toMatchObject({ code: 'empty_period', statusCode: 400 });
    expect((await f.listParticipations()).total).toBe(0);
  });

  it('refuses an overlap for one (ISRC, recipient, funded_from); other kinds and periods are fine', async () => {
    const f = await newFacade();
    const p = await artist(f, 'P');
    const mk = (fundedFrom: FundedFrom, validFrom: string, validTo?: string) =>
      f.createParticipation({
        isrc: ISRC,
        artistId: p,
        percent: '5',
        base: fundedFrom === 'label_share' ? 'bucket' : 'net',
        fundedFrom,
        validFrom,
        ...(validTo ? { validTo } : {}),
      });
    await mk('top', '2026-01-01', '2026-04-01');
    await expect(mk('top', '2026-03-01')).rejects.toMatchObject({ code: 'participation_overlap' });
    await mk('label_share', '2026-03-01');
    await mk('top', '2026-04-01');
  });

  it('G23: a participation and a split row are never both (both directions)', async () => {
    const f = await newFacade();
    const [a, b] = [await artist(f, 'A'), await artist(f, 'B')];
    await f.createSplit({ isrc: ISRC, validFrom: '2026-01-01', shares: [{ artistId: a, percent: '50' }] });
    await expect(
      f.createParticipation({
        isrc: ISRC,
        artistId: a,
        percent: '10',
        base: 'bucket',
        fundedFrom: 'label_share',
        validFrom: '2026-03-01',
      }),
    ).rejects.toMatchObject({ code: 'double_participation' });
    // another ISRC is fine
    await f.createParticipation({
      isrc: 'QZTST2600002',
      artistId: a,
      percent: '10',
      base: 'bucket',
      fundedFrom: 'label_share',
      validFrom: '2026-03-01',
    });
    // a participation of B from 2026-06, then a split change adding B from 2026-07 is refused
    await f.createParticipation({
      isrc: ISRC,
      artistId: b,
      percent: '10',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-06-01',
    });
    const doc = await approvedDoc(f, 'appendix');
    await expect(
      f.changeSplit({
        isrc: ISRC,
        from: '2026-07-01',
        documentId: doc.id,
        shares: [
          { artistId: a, percent: '40' },
          { artistId: b, percent: '10' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'double_participation' });
    // before the participation started the row is allowed
    await f.changeSplit({
      isrc: ISRC,
      from: '2026-02-01',
      documentId: doc.id,
      shares: [
        { artistId: a, percent: '50' },
        { artistId: b, percent: '0' },
      ],
    });
  });

  it('G23: Σ top above 100 is refused', async () => {
    const f = await newFacade();
    const [p, q, r] = [await artist(f, 'P'), await artist(f, 'Q'), await artist(f, 'R')];
    const top = (artistId: string, percent: string, validFrom = '2026-01-01', validTo?: string) =>
      f.createParticipation({
        isrc: ISRC,
        artistId,
        percent,
        base: 'net',
        fundedFrom: 'top',
        validFrom,
        ...(validTo ? { validTo } : {}),
      });
    await top(p, '60', '2026-01-01', '2026-06-01');
    await expect(top(q, '60')).rejects.toMatchObject({ code: 'top_above_100' });
    await top(q, '40');
    await top(r, '60', '2026-06-01');
  });

  it('closes a participation; it cannot be closed before its start or extended', async () => {
    const f = await newFacade();
    const p = await artist(f, 'P');
    const x = await f.createParticipation({
      isrc: ISRC,
      artistId: p,
      percent: '5',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-03-01',
      validTo: '2026-09-01',
    });
    await expect(f.closeParticipation(x.id, '2026-03-01')).rejects.toMatchObject({ code: 'empty_period' });
    await expect(f.closeParticipation(x.id, '2026-03-20')).rejects.toMatchObject({ code: 'empty_period' });
    await expect(f.closeParticipation(x.id, '2026-12-01')).rejects.toThrow(/earlier/);
    // closed on the 15th: it ends at the 1st, May goes to whoever follows (M52, D-130)
    expect((await f.closeParticipation(x.id, '2026-05-15')).validTo).toBe('2026-05-01');
    const sp = (await f.modules.splits.index()).participationsAt(ISRC, '2026-04-01');
    expect(sp).toHaveLength(1);
    expect((await f.modules.splits.index()).participationsAt(ISRC, '2026-05-01')).toHaveLength(0);
  });

  it('participationsAt orders by funded_from, then validFrom, then id; documentIds include row and participation documents', async () => {
    const f = await newFacade();
    const [a, p, q, r] = [
      await artist(f, 'A'),
      await artist(f, 'P'),
      await artist(f, 'Q'),
      await artist(f, 'R'),
    ];
    const d1 = await approvedDoc(f, 'appendix');
    const d2 = await approvedDoc(f, 'contract');
    const d3 = await approvedDoc(f, 'other');
    await f.createParticipation({
      isrc: ISRC,
      artistId: r,
      percent: '1',
      base: 'bucket',
      fundedFrom: 'label_share',
      validFrom: '2026-01-01',
      documentId: d3.id,
    });
    await f.createParticipation({
      isrc: ISRC,
      artistId: q,
      percent: '2',
      base: 'bucket',
      fundedFrom: 'artist_share',
      fromArtistId: a,
      validFrom: '2026-01-01',
    });
    await f.createParticipation({
      isrc: ISRC,
      artistId: p,
      percent: '3',
      base: 'net',
      fundedFrom: 'artist_pool',
      validFrom: '2026-01-01',
    });
    await f.createParticipation({
      isrc: ISRC,
      artistId: q,
      percent: '4',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-01-01',
    });
    await f.createSplit({
      isrc: 'QZTST2600002',
      validFrom: '2026-01-01',
      shares: [{ artistId: a, percent: '10', documentId: d1.id }],
      documentId: d2.id,
    });
    const idx = await f.modules.splits.index();
    expect(idx.participationsAt(ISRC, '2026-02-01').map((x) => x.fundedFrom)).toEqual([
      'top',
      'artist_pool',
      'artist_share',
      'label_share',
    ]);
    expect(idx.participationsAt(ISRC, '2025-12-01')).toEqual([]);
    expect(idx.documentIds().sort()).toEqual([d1.id, d2.id, d3.id].sort());
  });

  it('a share keeps its own document through createSplit, changeSplit, listSplits and index', async () => {
    const f = await newFacade();
    const [a, b] = [await artist(f, 'A'), await artist(f, 'B')];
    const d1 = await approvedDoc(f, 'appendix');
    const d2 = await approvedDoc(f, 'other');
    const s = await f.createSplit({
      isrc: ISRC,
      validFrom: '2026-01-01',
      shares: [
        { artistId: a, percent: '30', documentId: d1.id },
        { artistId: b, percent: '20' },
      ],
    });
    expect(s.shares.find((x) => x.artistId === a)?.documentId).toBe(d1.id);
    expect(s.shares.find((x) => x.artistId === b)?.documentId).toBeNull();
    const at = (await f.modules.splits.splitAt(ISRC, '2026-02-01'))?.shares;
    expect(at?.find((x) => x.artistId === a)?.documentId).toBe(d1.id);
    const ch = await f.changeSplit({
      isrc: ISRC,
      from: '2026-06-01',
      documentId: d1.id,
      shares: [{ artistId: a, percent: '30', documentId: d2.id }],
    });
    expect(ch.shares[0]?.documentId).toBe(d2.id);
    const listed = await f.listSplits({ isrc: ISRC });
    expect(listed.items.flatMap((i) => i.shares.map((x) => x.documentId))).toContain(d2.id);
    const owners = f.modules.owners;
    const draft = await owners.createDocument({
      kind: 'advance_basis',
      title: 'x',
      fileRef: 'dummy://x',
      ownerId: null,
      requiresApproval: false,
    });
    await expect(
      f.createSplit({
        isrc: 'QZTST2600003',
        validFrom: '2026-01-01',
        shares: [{ artistId: a, percent: '1', documentId: draft.id }],
      }),
    ).rejects.toThrow(/confirmed by/);
  });

  it('G25: the facade floors rule dates to the month start (participation, split, change, buyout)', async () => {
    const f = await newFacade();
    const [a, b, p] = [await artist(f, 'A'), await artist(f, 'B'), await artist(f, 'P')];
    const part = await f.createParticipation({
      isrc: ISRC,
      artistId: p,
      percent: '15',
      base: 'bucket',
      fundedFrom: 'label_share',
      validFrom: '2026-03-15',
      validTo: '2026-08-20',
    });
    expect(part.validFrom).toBe('2026-03-01');
    expect(part.validTo).toBe('2026-08-01'); // the end date is floored too (D-130)
    const s = await f.createSplit({
      isrc: 'QZTST2600002',
      validFrom: '2026-01-20',
      shares: [
        { artistId: a, percent: '50' },
        { artistId: b, percent: '10' },
      ],
    });
    expect(s.validFrom).toBe('2026-01-01');
    const doc = await approvedDoc(f, 'appendix');
    const ch = await f.changeSplit({
      isrc: 'QZTST2600002',
      from: '2026-04-15',
      documentId: doc.id,
      shares: [
        { artistId: a, percent: '40' },
        { artistId: b, percent: '10' },
      ],
    });
    expect(ch.validFrom).toBe('2026-04-01');
    expect((await f.listSplits({ isrc: 'QZTST2600002' })).items.map((i) => [i.validFrom, i.validTo])).toEqual(
      [
        ['2026-01-01', '2026-04-01'],
        ['2026-04-01', null],
      ],
    );
    const bo = await approvedDoc(f, 'buyout');
    const out = await f.buyout({
      isrcs: ['QZTST2600002'],
      sellerArtistId: b,
      effectiveFrom: '2026-03-15',
      documentId: bo.id,
    });
    expect(out[0]?.validFrom).toBe('2026-03-01');
    const idx = await f.modules.splits.index();
    expect(
      idx
        .at('QZTST2600002', '2026-03-01')
        ?.shares.find((x) => x.artistId === b)
        ?.percent.toFixed(),
    ).toBe('0');
    expect(
      idx
        .at('QZTST2600002', '2026-02-28')
        ?.shares.find((x) => x.artistId === b)
        ?.percent.toFixed(),
    ).toBe('10');
  });
});
