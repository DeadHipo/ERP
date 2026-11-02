import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/shared/money';
import { exactAfterEveryLayer, I1, I2, run, unit, type PartSpec, type World } from './world';

const rows = (...s: [string, string, string?][]): World['splits'] => ({ [I1]: [{ shares: s }] });
const totalMissing = (o: ReturnType<typeof run>) =>
  o.state.shortfalls.reduce((s, x) => s.add(x.missing), new Decimal(0)).toFixed();

describe('layer 5: carves (pool, artist share, label share, sublabel)', () => {
  it('G03b: two MCs 13 + 13 from the pool 50 pro rata', () => {
    const o = run(
      {
        splits: rows(['A', '25'], ['B', '25']),
        parts: [
          { artist: 'M1', percent: '13', funded: 'artist_pool' },
          { artist: 'M2', percent: '13', funded: 'artist_pool' },
        ],
      },
      unit('100'),
    );
    expect(['A', 'B', 'M1', 'M2'].map(o.amount)).toEqual(['12', '12', '13', '13']);
    expect([o.B, o.ours]).toEqual(['50', '50']);
  });
  it('G05a / G05b: the sublabel half of the label share', () => {
    const a = run({ splits: rows(['A', '50']) }, unit('100', { labelName: 'NoGhost Records' }));
    expect([a.amount('A'), a.amount('NG'), a.B, a.ours]).toEqual(['50', '25', '75', '25']);
    const b = run({ splits: rows(['A', '70']) }, unit('100', { labelName: 'NoGhost Records' }));
    expect([b.amount('NG'), b.B, b.ours]).toEqual(['15', '85', '15']);
  });
  it('G11: (bucket, label_share) 15 of the label share 50', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ artist: 'P', percent: '15', funded: 'label_share', base: 'bucket' }] }, unit('100'));
    expect([o.amount('P'), o.B, o.ours]).toEqual(['7.5', '57.5', '42.5']);
  });
  it('G12: (bucket, artist_share of A) 10', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ artist: 'E', percent: '10', funded: 'artist_share', from: 'A' }] }, unit('100'));
    expect([o.amount('E'), o.amount('A'), o.B, o.ours]).toEqual(['5', '45', '50', '50']);
  });
  it('G14: a participation valid 2026-01-01 … 2026-04-01', () => {
    const w: World = {
      splits: rows(['A', '50']),
      parts: [{ artist: 'P', percent: '15', funded: 'label_share', base: 'bucket', validFrom: '2026-01-01', validTo: '2026-04-01' }],
    };
    const mar = run(w, unit('100', { reportingMonth: '2026-03' }));
    const apr = run(w, unit('100', { reportingMonth: '2026-04' }));
    expect([mar.amount('P'), mar.ours, apr.amount('P'), apr.ours]).toEqual(['7.5', '42.5', undefined, '50']);
  });
  it('G15 (E1): a negative unit through top, rows and sublabel', () => {
    const o = run(
      { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] },
      unit('-100', { labelName: 'NoGhost Records' }),
    );
    expect(['R', 'A', 'B', 'NG'].map(o.amount)).toEqual(['-15', '-21.25', '-21.25', '-21.25']);
    expect([o.B, o.C, o.ours]).toEqual(['-78.75', '0', '-21.25']);
  });
  it('G16 (E2): a zero unit emits zero allocations', () => {
    const o = run(
      { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] },
      unit('0', { labelName: 'NoGhost Records' }),
    );
    expect(['R', 'A', 'B', 'NG'].map(o.amount)).toEqual(['0', '0', '0', '0']);
    expect([o.B, o.C, o.ours, o.state.shortfalls.length]).toEqual(['0', '0', '0', 0]);
  });
  const g18: PartSpec[] = [
    { artist: 'R', percent: '15', funded: 'top' },
    { artist: 'M', percent: '13', funded: 'artist_pool' },
    { artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' },
  ];
  it('G18 (E18, Q11): every kind on one unit', () => {
    const o = run({ splits: rows(['A', '25'], ['B', '25']), parts: g18 }, unit('100', { labelName: 'NoGhost Records' }));
    expect(['R', 'A', 'B', 'M', 'P', 'NG'].map(o.amount)).toEqual(['15', '14.75', '14.75', '13', '4.25', '19.125']);
    expect([o.reason('P'), o.reason('NG'), o.B, o.C, o.ours]).toEqual(['assumption', 'assumption', '57.5', '23.375', '19.125']);
  });
  it('G18b: plus E 10 of A after the pool carve', () => {
    const o = run(
      {
        splits: rows(['A', '25'], ['B', '25']),
        parts: [...g18, { artist: 'E', percent: '10', funded: 'artist_share', from: 'A' }],
      },
      unit('100', { labelName: 'NoGhost Records' }),
    );
    expect(['E', 'A', 'B', 'P', 'NG'].map(o.amount)).toEqual(['1.475', '13.275', '14.75', '4.25', '19.125']);
    expect([o.B, o.ours]).toEqual(['57.5', '19.125']);
  });
  it('G22 (E3): a pool smaller than the carve: P takes the pool, shortfall 10', () => {
    const o = run({ splits: rows(['A', '10']), parts: [{ artist: 'P', percent: '20', funded: 'artist_pool' }] }, unit('100'));
    expect([o.amount('P'), o.amount('A'), o.B, o.ours, totalMissing(o)]).toEqual(['10', '0', '10', '90', '10']);
    expect(o.state.shortfalls[0]?.why).toBe('bucket_short');
  });
  it('G24 (E9): two UPCs of one ISRC are two units', () => {
    const w: World = {
      splits: rows(['A', '50']),
      parts: [{ artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' }],
      pairs: [`${I1}|1`, `${I1}|2`],
    };
    const u1 = run(w, unit('100', { upc: '1' }));
    const u2 = run(w, unit('50', { upc: '2' }));
    expect([u1.amount('A'), u1.amount('P'), u1.ours, u2.amount('A'), u2.amount('P'), u2.ours]).toEqual([
      '50',
      '5',
      '45',
      '25',
      '2.5',
      '22.5',
    ]);
  });
  it('G31 (E4): rows 100 and a sublabel: NG 0 is emitted', () => {
    const o = run({ splits: rows(['A', '100']) }, unit('100', { labelName: 'NoGhost Records' }));
    expect([o.amount('A'), o.amount('NG'), o.B, o.ours]).toEqual(['100', '0', '100', '0']);
  });
  it('G34: a non-terminating pro rata, residue to the largest row (tie: first by id)', () => {
    const o = run(
      {
        splits: rows(['A', '16.6'], ['B', '16.6'], ['C', '16.6']),
        parts: [{ artist: 'M', percent: '13', funded: 'artist_pool' }],
      },
      unit('100'),
    );
    expect(['A', 'B', 'C', 'M'].map(o.amount)).toEqual(['12.266666666666', '12.266666666667', '12.266666666667', '13']);
    expect([o.B, o.ours]).toEqual(['49.8', '50.2']);
  });
  it('G35: two label-share carves share one base', () => {
    const w = (order: PartSpec[]) => run({ splits: rows(['A', '50']), parts: order }, unit('100'));
    const p1: PartSpec = { artist: 'P1', percent: '10', funded: 'label_share', base: 'bucket' };
    const p2: PartSpec = { artist: 'P2', percent: '15', funded: 'label_share', base: 'bucket' };
    for (const o of [w([p1, p2]), w([p2, p1])])
      expect([o.amount('P1'), o.amount('P2'), o.B, o.ours]).toEqual(['5', '7.5', '62.5', '37.5']);
  });
  it('G36 (Q6): the settlement 15 of net paid from the label share', () => {
    const o = run(
      { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'S', percent: '15', funded: 'label_share', base: 'net' }] },
      unit('100'),
    );
    expect([o.amount('S'), o.amount('A'), o.B, o.ours]).toEqual(['15', '25', '65', '35']);
  });
  it('G37: a label-share carve above the label share takes it all, shortfall 20', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ artist: 'P', percent: '70', funded: 'label_share', base: 'net' }] }, unit('100'));
    expect([o.amount('P'), o.B, o.ours, totalMissing(o)]).toEqual(['50', '100', '0', '20']);
  });
  it('G44 (scale-down exactness): three pool carves of 13 on a pool of 10', () => {
    const o = run(
      {
        splits: rows(['A', '10']),
        parts: ['M1', 'M2', 'M3'].map((m): PartSpec => ({ artist: m, percent: '13', funded: 'artist_pool' })),
      },
      unit('100'),
    );
    expect(['M1', 'M2', 'M3', 'A'].map(o.amount)).toEqual(['3.333333333334', '3.333333333333', '3.333333333333', '0']);
    expect([o.B, o.ours, totalMissing(o)]).toEqual(['10', '90', '29']);
  });
  it('artist-share carves above 100 % of one row are scaled down to the row', () => {
    const o = run(
      {
        splits: rows(['A', '33.333333']),
        parts: [
          { artist: 'E1', percent: '70', funded: 'artist_share', from: 'A' },
          { artist: 'E2', percent: '60', funded: 'artist_share', from: 'A' },
        ],
      },
      unit('77.777777777777'),
    );
    expect(o.amount('A')).toBe('0');
    expect(exactAfterEveryLayer(o, new Decimal('77.777777777777'))).toBeNull();
    expect(o.state.shortfalls.every((s) => s.why === 'bucket_short')).toBe(true);
  });
  it('an artist-share carve without its source row: 0 and a shortfall', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ artist: 'E', percent: '10', funded: 'artist_share', from: 'X' }] }, unit('100'));
    expect([o.amount('E'), o.amount('A'), o.ours, o.state.shortfalls[0]?.why]).toEqual(['0', '50', '50', 'no_source_row']);
  });
  it('a participation of another ISRC does not apply', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ isrc: I2, artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' }] }, unit('100'));
    expect([o.amount('P'), o.ours]).toEqual([undefined, '50']);
  });
  it('the sublabel never runs on an unmapped string', () => {
    const o = run({ splits: rows(['A', '50']) }, unit('100', { labelName: 'Unknown Imprint' }));
    expect([o.amount('NG'), o.C]).toEqual([undefined, '50']);
  });
});
