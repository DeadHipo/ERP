import { describe, expect, it } from 'vitest';
import { spreadAlbumLines, type SourceUnit } from '../src/modules/sources';
import { Case, I, UPC, UPC_NO_TRACKS } from './helpers/golden-case';

// D-209 (the owner's decision on D-035): a line of a release without an ISRC (an album download) is spread over the
// tracks of its release, in proportion to what each earned up to and including the line's month; then by the splits.

const P = 1_000_000_000_000n; // one dollar in pico
const unit = (isrc: string, month: string, dollars: bigint | number, upc = 'R1'): SourceUnit => ({
  source: 'believe',
  account: 'acc',
  isrc,
  upc,
  reportingMonth: month,
  salesMonth: month,
  labelName: 'L',
  labelId: 'book',
  netPico: BigInt(dollars) * P,
});

describe('the album lines (D-209): the pure spread', () => {
  it('weights are the cumulative net of the tracks up to the line month; the share joins the track unit of the same key', () => {
    const tracks = [unit('A', '2026-03', 30), unit('B', '2026-03', 10), unit('B', '2026-04', 50)];
    const out = spreadAlbumLines([...tracks, unit('', '2026-03', 8), unit('', '2026-04', 3)], tracks);
    const net = (isrc: string, m: string) => out.filter((u) => u.isrc === isrc && u.reportingMonth === m).reduce((s, u) => s + u.netPico, 0n);
    // 03: 30 : 10 → 6 and 2 (joined to the units of 03); 04: 30 : 60 → 1 and 2 (A has no unit of 04: a new one)
    expect([net('A', '2026-03'), net('B', '2026-03'), net('A', '2026-04'), net('B', '2026-04')]).toEqual([36n * P, 12n * P, 1n * P, 52n * P]);
    expect(out.filter((u) => u.isrc === '')).toEqual([]);
    expect(out.reduce((s, u) => s + u.netPico, 0n)).toBe((30n + 10n + 50n + 8n + 3n) * P);
  });

  it('exact to the pico: the rest goes to the largest weight; a total ≤ 0 is spread equally; a release without a track stays', () => {
    const tracks = [unit('A', '2026-03', 1), unit('B', '2026-03', 2), unit('C', '2026-03', 3, 'R2'), unit('D', '2026-03', -3, 'R2')];
    const out = spreadAlbumLines([unit('', '2026-03', 1), unit('', '2026-03', 1, 'R2'), unit('', '2026-03', 5, 'R3')], tracks);
    const by = Object.fromEntries(out.map((u) => [`${u.upc}:${u.isrc}`, u.netPico]));
    // R1 1 : 2 → 333333333333 and 666666666667 (the rest of 1 pico to B); R2 3 + −3 = 0 → equally; R3 has no track
    expect(by).toEqual({ 'R1:A': 333333333333n, 'R1:B': 666666666667n, 'R2:C': P / 2n, 'R2:D': P / 2n, 'R3:': 5n * P });
  });
});

describe('the album lines (D-209): end to end', () => {
  it('an album line of a release goes to its tracks, then by their splits; the owner balance over the reach equals the full one', async () => {
    const c = await Case.start();
    await c.person('A', 'B');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['B', '50']]);
    await c.load('2026-03', [
      { isrc: I(1), net: '30' },
      { isrc: I(2), net: '10' },
      { isrc: '', upc: UPC, net: '8' },
    ]);
    await c.load('2026-04', [
      { isrc: I(2), net: '50' },
      { isrc: '', upc: UPC, net: '3' },
    ]);
    // 03: the album 8 → I(1) 6, I(2) 2; 04: weights 30 : 60 → I(1) 1, I(2) 2
    // A: 50 % of (30 + 6 + 1) = 18.5; B: 50 % of (10 + 2 + 50 + 2) = 32; nothing waits without an ISRC
    expect((await c.balance('A')).total.earned.toFixed()).toBe('18.5');
    expect((await c.balance('B')).total.earned.toFixed()).toBe('32');
    // A = B + C + ours per month: 03 = 48 (the album inside), 04 = 53
    expect(await c.row('2026-03')).toMatchObject({ A: '48', B: '24', C: '0', ours: '24' });
    expect(await c.row('2026-04')).toMatchObject({ A: '53', B: '26.5', C: '0', ours: '26.5' });
    await c.verify();
  });
  // D-257: the card of a release runs no calculation; its tracks come from the pairs (ISRC, UPC) of the files, where
  // an album line is a pair without an ISRC. The card must name the ISRCs the units gave (the album line spread over
  // the tracks), and a release that has only such a line stays unknown.
  it('the card of a release with an album line names its tracks only; a release of an album line alone is 404', async () => {
    const c = await Case.start();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    await c.person('A');
    await c.track(I(1));
    await c.track(I(3)); // registered, never earned: on the card under «all», no units
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [
      { isrc: I(1), net: '30' },
      { isrc: I(2), net: '10' }, // not registered: known from the report only
      { isrc: '', upc: UPC, net: '8' },
      { isrc: '', net: '5' }, // an album line of a release without a track (`UPC_NO_TRACKS`)
    ]);
    for (const [name, label, idle] of [['all', undefined, [I(3)]], ['0to8', zero, []]] as const) {
      const rows = await f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'isrc' }, label);
      // the units: the album 8 spread 30 : 10 → I(1) 36, I(2) 12; no row without an ISRC
      expect(rows.rows.map((r) => [r.isrc, r.sums.net.toFixed()]), name).toEqual([[I(1), '36'], [I(2), '12']]);
      const card = await f.release(UPC, label);
      // the ISRCs of the units and the visible tracks without units (under a label a track in no file of it is not visible)
      expect(card.tracks.map((t) => t.isrc), name).toEqual([...rows.rows.map((r) => r.isrc as string), ...idle].sort());
      expect(card.tracks.map((t) => t.isrc), name).not.toContain('');
      // the release of the album line alone: money waits as `no_isrc`, no card (no track, no pair with an ISRC, no registry row)
      await expect(f.release(UPC_NO_TRACKS, label), name).rejects.toThrow(/not found/i);
      await expect(f.release(UPC_NO_TRACKS, label), name).rejects.toMatchObject({ statusCode: 404 });
    }
  });
});
