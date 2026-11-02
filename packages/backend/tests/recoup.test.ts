import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import type { IncomeItem, Position } from '../src/modules/settlements';
import { recoup } from '../src/facade/layers/recoup';

const D = (v: string | number) => new Decimal(v);
const master = (
  id: string,
  artistId: string,
  amount: number,
  month = '2026-07',
  isrc = 'QZTST2600001',
): IncomeItem => ({
  id,
  stream: 'master',
  ownerId: 'O',
  artistId,
  isrc,
  reportMonth: month,
  amount: D(amount),
});
const pub = (id: string, amount: number, month = '2026-06'): IncomeItem => ({
  id,
  stream: 'publishing',
  ownerId: 'O',
  artistId: null,
  isrc: null,
  reportMonth: month,
  amount: D(amount),
});
const pos = (
  id: string,
  artistId: string,
  amount: number,
  kind: Position['scope']['kind'],
  month = '2026-01',
  extra: Partial<Position['scope']> = {},
): Position => ({
  id,
  ownerId: 'O',
  artistId,
  month,
  amount: D(amount),
  scope: { kind, ...extra },
});

describe('scope of recoupment (07 "Охват погашения")', () => {
  it('Artist One: master 500 + publishing 200, advance 300 publishing-only -> 200 recouped, 100 stays and never moves to Artist Two', () => {
    const r = recoup(
      [pos('adv', 'artist-one', 300, 'publishing')],
      [master('m1', 'artist-one', 500), pub('p1', 200), master('m2', 'artist-two', 1000)],
    );
    expect(r[0]?.recouped.toFixed()).toBe('200');
    expect(r[0]?.remaining.toFixed()).toBe('100');
  });

  it('owner publishing recoups advances of any artist of the owner: 1000 - 200 - 500 = 300 left', () => {
    const r = recoup(
      [pos('a', 'artist-one', 200, 'publishing'), pos('b', 'artist-two', 500, 'publishing')],
      [pub('p1', 1000)],
    );
    expect(r.map((x) => x.recouped.toFixed()).sort()).toEqual(['200', '500']);
  });

  it('largest first: publishing 400, advances 200 and 500 -> the 500 one gets 400, the 200 one gets nothing', () => {
    const r = recoup(
      [pos('small', 'artist-one', 200, 'publishing'), pos('large', 'artist-two', 500, 'publishing')],
      [pub('p1', 400)],
    );
    const byId = new Map(r.map((x) => [x.positionId, x]));
    expect(byId.get('large')?.recouped.toFixed()).toBe('400');
    expect(byId.get('small')?.recouped.toFixed()).toBe('0');
  });

  it('master scope recoups only from the same artist; "master artist + owner publishing" takes both', () => {
    const r = recoup(
      [pos('x', 'artist-one', 2000, 'master_publishing')],
      [master('m1', 'artist-one', 700), master('m2', 'artist-two', 999), pub('p1', 200)],
    );
    expect(r[0]?.recouped.toFixed()).toBe('900');
  });

  it('only income after the operation date (by report month) recoups it', () => {
    const r = recoup(
      [pos('x', 'artist-one', 1000, 'any', '2026-07')],
      [master('old', 'artist-one', 300, '2026-06'), master('new', 'artist-one', 100, '2026-07')],
    );
    expect(r[0]?.recouped.toFixed()).toBe('100');
  });

  it('specific ISRCs and exclusions', () => {
    const income = [
      master('a', 'artist-one', 100, '2026-07', 'QZTST2600001'),
      master('b', 'artist-one', 50, '2026-07', 'QZTST2600002'),
    ];
    expect(
      recoup(
        [pos('x', 'artist-one', 1000, 'isrcs', '2026-01', { isrcs: ['QZTST2600002'] })],
        income,
      )[0]?.recouped.toFixed(),
    ).toBe('50');
    expect(
      recoup(
        [pos('x', 'artist-one', 1000, 'any', '2026-01', { excludeIsrcs: ['QZTST2600001'] })],
        income,
      )[0]?.recouped.toFixed(),
    ).toBe('50');
  });

  it('negative income has no recoup capacity', () => {
    expect(
      recoup([pos('x', 'artist-one', 10, 'any')], [master('a', 'artist-one', -5)])[0]?.recouped.toFixed(),
    ).toBe('0');
  });

  it('positions with overlapping scopes never recoup more than the net income in total (D-094)', () => {
    // net income 100: A +100 (X), A -100 (Y), owner publishing +100
    const income = [
      master('x', 'A', 100, '2026-01', 'QZTST2600001'),
      master('y', 'A', -100, '2026-02', 'QZTST2600002'),
      pub('p', 100, '2026-03'),
    ];
    const r = recoup([pos('p1', 'A', 100, 'any'), pos('p2', 'B', 50, 'publishing')], income);
    const total = r.reduce((s, x) => s.add(x.recouped), new Decimal(0));
    expect(total.lte(100)).toBe(true);
    expect(r.find((x) => x.positionId === 'p1')?.recouped.toFixed()).toBe('100');
    expect(r.find((x) => x.positionId === 'p2')?.recouped.toFixed()).toBe('0');
  });

  it('a position that takes nothing does not cancel income in the scope of another one (D-101)', () => {
    // master net 0: X +100, Y -100; the X-only advance still recoups its own ISRC
    const income = [
      master('x', 'A', 100, '2026-01', 'QZTST2600001'),
      master('y', 'A', -100, '2026-02', 'QZTST2600002'),
    ];
    const big = recoup(
      [pos('b', 'A', 150, 'master'), pos('a', 'A', 100, 'isrcs', '2026-01', { isrcs: ['QZTST2600001'] })],
      income,
    );
    expect(big.find((x) => x.positionId === 'b')?.recouped.toFixed()).toBe('0');
    expect(big.find((x) => x.positionId === 'a')?.recouped.toFixed()).toBe('100');
    // the order of sizes does not change the result
    const small = recoup(
      [pos('b', 'A', 50, 'master'), pos('a', 'A', 100, 'isrcs', '2026-01', { isrcs: ['QZTST2600001'] })],
      income,
    );
    expect(small.find((x) => x.positionId === 'a')?.recouped.toFixed()).toBe('100');
    expect(small.find((x) => x.positionId === 'b')?.recouped.toFixed()).toBe('0');
  });
});
