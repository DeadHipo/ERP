import { describe, expect, it } from 'vitest';
import { artistsByIsrc, unionArtists } from '../src/facade/track-artists';

// The pseudonyms of an ISRC for the catalog screens (D-166): split rows, participations and registry links, merged
// ids resolved to the survivor, each pseudonym once, sorted by pseudonym. Pure, synthetic names only.

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const track = (id: string, isrc: string | null) => ({ id, isrc, upc: null, title: id, note: null });
const index = new Map([
  ['a', { id: 'a', pseudonym: 'Zed' }],
  ['b', { id: 'b', pseudonym: 'Alpha' }],
  ['old', { id: 'a', pseudonym: 'Zed' }], // merged into a (D-131)
  ['p', { id: 'p', pseudonym: 'Mid' }],
]);

describe('artistsByIsrc (D-166)', () => {
  it('collects the rows, participations and registry links of an ISRC once each, resolving merged ids', () => {
    const byIsrc = artistsByIsrc({
      tracks: [track('t1', I1), track('t2', I2), track('t3', null)],
      links: [
        { artistId: 'b', trackId: 't1' },
        { artistId: 'p', trackId: 't3' }, // a track without ISRC: no row of the catalog
        { artistId: 'a', trackId: 'missing' },
      ],
      splits: [
        { isrc: I1, shares: [{ artistId: 'old' }, { artistId: 'a' }] },
        { isrc: I1, shares: [{ artistId: 'a' }] },
      ],
      participations: [{ isrc: I1, artistId: 'p' }],
      index,
    });
    expect(byIsrc.get(I1)).toEqual([
      { id: 'b', pseudonym: 'Alpha' },
      { id: 'p', pseudonym: 'Mid' },
      { id: 'a', pseudonym: 'Zed' },
    ]);
    expect(byIsrc.has(I2)).toBe(false);
  });

  it('an id the index does not know keeps its id with «?» (never a crash)', () => {
    const byIsrc = artistsByIsrc({ tracks: [], links: [], splits: [{ isrc: I1, shares: [{ artistId: 'ghost' }] }], participations: [], index });
    expect(byIsrc.get(I1)).toEqual([{ id: 'ghost', pseudonym: '?' }]);
  });

  it('unionArtists merges the pseudonyms of several ISRCs once each, by pseudonym', () => {
    const byIsrc = new Map([
      [I1, [{ id: 'a', pseudonym: 'Zed' }, { id: 'p', pseudonym: 'Mid' }]],
      [I2, [{ id: 'a', pseudonym: 'Zed' }, { id: 'b', pseudonym: 'Alpha' }]],
    ]);
    expect(unionArtists(byIsrc, [I1, I2, 'none'])).toEqual([
      { id: 'b', pseudonym: 'Alpha' },
      { id: 'p', pseudonym: 'Mid' },
      { id: 'a', pseudonym: 'Zed' },
    ]);
    expect(unionArtists(byIsrc, [])).toEqual([]);
  });
});
