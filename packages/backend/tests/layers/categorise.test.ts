import { describe, expect, it } from 'vitest';
import { I1, run, unit, type World } from './world';

const rows = (...s: [string, string, string?][]): World['splits'] => ({ [I1]: [{ shares: s }] });

describe('layer 6: categorise (D-057)', () => {
  it('G10a (Q1): a row with its own assumption document is C assumption', () => {
    const o = run({ splits: rows(['A', '23'], ['L', '20', 'assume'], ['D', '7']) }, unit('100'));
    expect([o.reason('A'), o.reason('L'), o.reason('D'), o.B, o.C, o.ours]).toEqual([
      null,
      'assumption',
      null,
      '30',
      '20',
      '50',
    ]);
    expect(o.state.rows.find((r) => r.artistId === 'L')?.assumption).toBe('document');
  });
  it('G10b: after the buy-out of A: D 7 B, L 20 C, ours 73', () => {
    const o = run({ splits: rows(['L', '20', 'assume'], ['D', '7']) }, unit('100'));
    expect([o.B, o.C, o.ours]).toEqual(['7', '20', '73']);
  });
  it('G19 (E12): a row without document is split_unconfirmed; an approved participation is B', () => {
    const o = run(
      {
        splits: { [I1]: [{ doc: null, shares: [['A', '50']] }] },
        parts: [{ artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' }],
      },
      unit('100'),
    );
    expect([o.reason('A'), o.amount('P'), o.reason('P'), o.B, o.C, o.ours]).toEqual([
      'split_unconfirmed',
      '5',
      null,
      '5',
      '50',
      '45',
    ]);
  });
  it('a participation without an approved document is rule_unconfirmed', () => {
    const o = run(
      {
        splits: rows(['A', '50']),
        parts: [{ artist: 'P', percent: '10', funded: 'label_share', base: 'bucket', doc: 'no' }],
      },
      unit('100'),
    );
    expect(o.reason('P')).toBe('rule_unconfirmed');
    // D-232: the sublabel rule model removed (a sublabel rule without an approved document)
  });
  // D-232: the sublabel rule model removed (G20 (Q12): an Echo8 sublabel under an assumption rule)
  it('G21 (D-175): on a unit without a split the whole label share waits in C no_split', () => {
    // D-232: the sublabel rule model removed (no sublabel carve, R1 is gone); NoGhost Records is an alias of 0to8
    const o = run({}, unit('100', { labelName: 'NoGhost Records' }));
    expect([o.amount('NG'), o.B, o.C, o.ours, o.state.status, o.state.labelShareCategory]).toEqual([undefined, '0', '100', '0', 'no_split', 'no_split']);
    expect(o.state.rows).toEqual([]);
  });
  // D-232: the sublabel rule model removed (Q11 marked the label-share carves and the sublabel allocation)
  it('a pseudonym without owner, an unconfirmed owner', () => {
    const o = run(
      { splits: rows(['A', '20'], ['B', '30']), owners: { A: null }, unconfirmed: ['o-B'] },
      unit('100'),
    );
    expect([o.reason('A'), o.reason('B'), o.C, o.ours]).toEqual([
      'artist_without_owner',
      'owner_unconfirmed',
      '50',
      '50',
    ]);
  });
  it('the document reason comes before the owner reasons', () => {
    const o = run(
      { splits: { [I1]: [{ doc: 'no', shares: [['A', '20']] }] }, owners: { A: null } },
      unit('100'),
    );
    expect(o.reason('A')).toBe('split_unconfirmed');
  });
});
