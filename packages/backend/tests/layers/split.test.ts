import { describe, expect, it } from 'vitest';
import { run, unit, type World } from './world';

const rows = (...s: [string, string, string?][]): World['splits'] => ({ QZTST2600001: [{ shares: s }] });

describe('layer 4: split (M1, M2, M3a, M6, M7, M9, M10, M28)', () => {
  it('G01: A 50 → ours 50', () => {
    const o = run({ splits: rows(['A', '50']) }, unit('100'));
    expect([o.amount('A'), o.B, o.C, o.ours]).toEqual(['50', '50', '0', '50']);
  });
  it('G02: 16.6 × 3 → ours 50.2', () => {
    const o = run({ splits: rows(['A', '16.6'], ['B', '16.6'], ['C', '16.6']) }, unit('100'));
    expect([o.amount('A'), o.amount('B'), o.amount('C'), o.B, o.ours]).toEqual(['16.6', '16.6', '16.6', '49.8', '50.2']);
  });
  it('G03a: floor title entered scaled 33.333333 / 16.666667', () => {
    const o = run({ splits: rows(['A', '33.333333'], ['B', '16.666667']) }, unit('100'));
    expect([o.amount('A'), o.amount('B'), o.B, o.ours]).toEqual(['33.333333', '16.666667', '50', '50']);
  });
  it('G03c: MALAME rows as entered, nothing rescales them', () => {
    const o = run({ splits: rows(['A', '29.761905'], ['B', '10.119048'], ['C', '10.119047']) }, unit('100'));
    expect([o.amount('A'), o.amount('B'), o.amount('C'), o.B, o.ours]).toEqual([
      '29.761905',
      '10.119048',
      '10.119047',
      '50',
      '50',
    ]);
  });
  it('G06 / G07: a label owner as a row (RX 66.6, LL 25)', () => {
    expect(run({ splits: rows(['RX', '66.6']) }, unit('100')).ours).toBe('33.4');
    expect(run({ splits: rows(['LL', '25']) }, unit('100')).ours).toBe('75');
  });
  it('G09: buy-outs by period (a 0 row is skipped)', () => {
    const w: World = {
      splits: {
        QZTST2600001: [
          { from: '2020-01-01', to: '2026-03-01', shares: [['A', '50']] },
          { from: '2026-03-01', to: '2026-05-01', shares: [['A', '25']] },
          { from: '2026-05-01', shares: [['A', '0']] },
        ],
      },
    };
    const feb = run(w, unit('100', { reportingMonth: '2026-02' }));
    const mar = run(w, unit('100', { reportingMonth: '2026-03' }));
    const may = run(w, unit('100', { reportingMonth: '2026-05' }));
    expect([feb.amount('A'), feb.ours, mar.amount('A'), mar.ours, may.amount('A'), may.ours]).toEqual([
      '50',
      '50',
      '25',
      '75',
      undefined,
      '100',
    ]);
    expect(may.state.status).toBe('allocated');
  });
  it('G13 / G17: an assignment and a sale from 2026-06', () => {
    const w: World = {
      splits: {
        QZTST2600001: [
          { to: '2026-06-01', shares: [['A', '50']] },
          { from: '2026-06-01', shares: [['DU', '100']] },
        ],
      },
    };
    const may = run(w, unit('100', { reportingMonth: '2026-05' }));
    const jun = run(w, unit('100', { reportingMonth: '2026-06' }));
    expect([may.amount('A'), may.ours, jun.amount('DU'), jun.ours]).toEqual(['50', '50', '100', '0']);
  });
  it('G41: an all-zero split has no row; the label share is the whole net, status allocated', () => {
    const o = run({ splits: rows(['A', '0']) }, unit('100', { labelName: 'NoGhost Records' }));
    expect([o.amount('A'), o.state.status, o.amount('NG'), o.reason('NG'), o.ours]).toEqual([
      undefined,
      'allocated',
      '50',
      null,
      '50',
    ]);
  });
  it('no split: status no_split, the label share is the scaled net (D-029)', () => {
    const o = run({}, unit('100'));
    expect([o.state.status, o.ours]).toEqual(['no_split', '100']);
  });
  it('a row document overrides the split document for that row only', () => {
    const o = run({ splits: { QZTST2600001: [{ doc: 'no', shares: [['A', '20', 'ok'], ['B', '30']] }] } }, unit('100'));
    expect([o.reason('A'), o.reason('B')]).toEqual([null, 'split_unconfirmed']);
  });
  it('G42: a brand pseudonym linked to the track without a row takes nothing', () => {
    const o = run({ splits: rows(['A', '50']), owners: { '0to8': 'o-label' } }, unit('100'));
    expect([o.amount('A'), o.amount('0to8'), o.ours]).toEqual(['50', undefined, '50']);
  });
  it('a merged pseudonym is paid under the surviving id', () => {
    const o = run({ splits: rows(['old', '40']), merged: { old: 'A' } }, unit('100'));
    expect([o.amount('A'), o.state.rows[0]?.ownerId]).toEqual(['40', 'o-A']);
  });
});
