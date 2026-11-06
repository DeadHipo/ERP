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
  labelId: null,
});
const pub = (id: string, amount: number, month = '2026-06'): IncomeItem => ({
  id,
  stream: 'publishing',
  ownerId: 'O',
  artistId: null,
  isrc: null,
  reportMonth: month,
  amount: D(amount),
  labelId: null,
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
  labelId: null,
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

/** The recoup before D-173, verbatim in substance: the reference for «without forgivenesses nothing changes». */
function recoupBefore(positions: Position[], income: IncomeItem[]) {
  const capacity = new Map(income.map((i) => [i.id, i.amount]));
  const ordered = [...income].sort((a, b) =>
    a.reportMonth < b.reportMonth ? -1 : a.reportMonth > b.reportMonth ? 1 : a.id < b.id ? -1 : 1,
  );
  const byLargest = [...positions].sort(
    (a, b) => b.amount.cmp(a.amount) || (a.month ?? '').localeCompare(b.month ?? '') || a.id.localeCompare(b.id),
  );
  const eligible = (p: Position, i: IncomeItem) => {
    if (i.ownerId !== p.ownerId || (p.month !== null && i.reportMonth < p.month)) return false;
    if (i.isrc && p.scope.excludeIsrcs?.includes(i.isrc)) return false;
    const k = p.scope.kind;
    if (i.stream === 'publishing') return k === 'any' || k === 'publishing' || k === 'master_publishing';
    if (i.artistId !== p.artistId) return false;
    if (p.labelId !== null && i.labelId !== p.labelId) return false;
    if (k === 'isrcs') return i.isrc !== null && (p.scope.isrcs ?? []).includes(i.isrc);
    return k === 'any' || k === 'master' || k === 'master_publishing';
  };
  return byLargest.map((p) => {
    const inScope = ordered.filter((i) => eligible(p, i));
    const net = inScope.reduce((s, i) => s.add(capacity.get(i.id) as Decimal), D(0));
    let left = Decimal.min(p.amount, Decimal.max(net, 0));
    const caps = inScope.map((i) => capacity.get(i.id) as Decimal);
    const negatives = caps.reduce((s, c) => (c.lt(0) ? s.sub(c) : s), D(0));
    const positives = caps.reduce((s, c) => (c.gt(0) ? s.add(c) : s), D(0));
    let offsetPos = left.gt(0) ? Decimal.min(negatives, positives) : D(0);
    let offsetNeg = offsetPos;
    for (const i of inScope) {
      const cap = capacity.get(i.id) as Decimal;
      if (cap.gt(0) && offsetPos.gt(0)) {
        const take = Decimal.min(cap, offsetPos);
        capacity.set(i.id, cap.sub(take));
        offsetPos = offsetPos.sub(take);
      } else if (cap.lt(0) && offsetNeg.gt(0)) {
        const cover = Decimal.min(cap.neg(), offsetNeg);
        capacity.set(i.id, cap.add(cover));
        offsetNeg = offsetNeg.sub(cover);
      }
    }
    const consumed: { itemId: string; amount: string }[] = [];
    let recouped = D(0);
    for (const i of inScope) {
      if (left.lte(0)) break;
      const cap = capacity.get(i.id) as Decimal;
      if (cap.lte(0)) continue;
      const take = Decimal.min(cap, left);
      capacity.set(i.id, cap.sub(take));
      left = left.sub(take);
      recouped = recouped.add(take);
      consumed.push({ itemId: i.id, amount: take.toFixed() });
    }
    return { positionId: p.id, recouped: recouped.toFixed(), remaining: p.amount.sub(recouped).toFixed(), consumed };
  });
}

describe('the forgiveness of an advance (D-173 §3.1)', () => {
  const forgiven = (p: Position, ...f: [string, number][]): Position => ({
    ...p,
    forgiven: f.map(([month, amount]) => ({ month, amount: D(amount) })),
  });
  const view = (r: ReturnType<typeof recoup>[number] | undefined) =>
    [r?.recouped, r?.forgiven, r?.remaining].map((x) => x?.toFixed());
  /** amount = recouped + forgiven + remaining, remaining ≥ 0, for every result. */
  const holds = (rs: ReturnType<typeof recoup>) => {
    for (const r of rs) {
      expect(r.recouped.add(r.forgiven).add(r.remaining).toFixed(), r.positionId).toBe(r.amount.toFixed());
      expect(r.remaining.gte(0) && r.forgiven.gte(0), r.positionId).toBe(true);
    }
  };
  const adv = pos('adv', 'A', 100, 'any', '2026-01');

  it('G58: the income before the date is recouped as before; from the date the capacity is amount − recouped − forgiven', () => {
    // step 2: only the 2026-02 income; the forgiveness 30 of 2026-04 leaves 20 unrecouped, the recoup is unchanged
    const before = [master('m02', 'A', 50, '2026-02')];
    expect(view(recoup([adv], before)[0])).toEqual(['50', '0', '50']);
    const step2 = recoup([forgiven(adv, ['2026-04', 30])], before);
    expect(view(step2[0])).toEqual(['50', '30', '20']);
    expect(step2[0]?.consumed).toEqual(recoup([adv], before)[0]?.consumed);
    // step 3: the 2026-04 income 50 is recouped up to 100 − 50 − 30 = 20; 30 of it is free
    const step3 = recoup([forgiven(adv, ['2026-04', 30])], [...before, master('m04', 'A', 50, '2026-04')]);
    expect(view(step3[0])).toEqual(['70', '30', '0']);
    expect(step3[0]?.consumed.map((c) => [c.itemId, c.amount.toFixed()])).toEqual([['m02', '50'], ['m04', '20']]);
    holds(step3);
  });

  it('G58b: income of a month before the date that comes later recoups first; the forgiveness is clamped at 0', () => {
    const r = recoup(
      [forgiven(adv, ['2026-04', 30])],
      [master('m02', 'A', 50, '2026-02'), master('m04', 'A', 50, '2026-04'), master('m03', 'A', 50, '2026-03')],
    );
    expect(view(r[0])).toEqual(['100', '0', '0']);
    holds(r);
  });

  it('several forgivenesses, two of one month in their order: each takes effect from its month', () => {
    const income = ['2026-02', '2026-03', '2026-04', '2026-05'].map((m) => master(`m${m}`, 'A', 30, m));
    const r = recoup([forgiven(adv, ['2026-03', 10], ['2026-04', 20])], income);
    expect(view(r[0])).toEqual(['70', '30', '0']);
    const same = recoup([forgiven(adv, ['2026-04', 15], ['2026-04', 15])], income);
    // 02 and 03 take 60; from 04 the capacity is 100 − 60 − 30 = 10
    expect(view(same[0])).toEqual(['70', '30', '0']);
    holds([...r, ...same]);
  });

  it('a forgiveness after every income takes effect at the end: no income is freed, the rest is forgiven', () => {
    const r = recoup([forgiven(adv, ['2026-09', 80])], [master('m02', 'A', 50, '2026-02')]);
    expect(view(r[0])).toEqual(['50', '50', '0']);
    holds(r);
  });

  it('a fully forgiven advance takes nothing', () => {
    const r = recoup([forgiven(adv, ['2026-01', 100])], [master('m02', 'A', 50, '2026-02'), pub('p', 40, '2026-03')]);
    expect(view(r[0])).toEqual(['0', '100', '0']);
    expect(r[0]?.consumed).toEqual([]);
  });

  it('FIX-1 (D-101): a forgiven advance that takes nothing nets nothing, the smaller ISRC position keeps its 100', () => {
    const income = [
      master('x', 'A', 100, '2026-01', 'QZTST2600001'),
      master('y', 'A', -100, '2026-02', 'QZTST2600002'),
      master('z', 'A', 50, '2026-03', 'QZTST2600003'),
    ];
    const small = pos('a', 'A', 100, 'isrcs', '2026-01', { isrcs: ['QZTST2600001'] });
    // without the forgiveness the advance 150 nets X against Y and takes Z: the ISRC position gets nothing
    const plain = recoup([pos('b', 'A', 150, 'master'), small], income);
    expect(plain.find((x) => x.positionId === 'b')?.recouped.toFixed()).toBe('50');
    expect(plain.find((x) => x.positionId === 'a')?.recouped.toFixed()).toBe('0');
    // forgiven in full: the advance takes nothing, so it changes nothing for the others (as if absent)
    const r = recoup([forgiven(pos('b', 'A', 150, 'master'), ['2026-01', 150]), small], income);
    expect(view(r.find((x) => x.positionId === 'b'))).toEqual(['0', '150', '0']);
    expect(r.find((x) => x.positionId === 'a')?.recouped.toFixed()).toBe('100');
    expect(r.find((x) => x.positionId === 'a')?.recouped.toFixed()).toBe(recoup([small], income)[0]?.recouped.toFixed());
    holds(r);
  });

  it('without forgivenesses the result is the one before D-173 (seeded random positions and income)', () => {
    let seed = 173;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    const kinds: Position['scope']['kind'][] = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'];
    for (let round = 0; round < 200; round++) {
      const income: IncomeItem[] = [];
      for (let k = 0; k < 8; k++) {
        const amount = rnd(2000) - 600;
        const month = months[rnd(5)] as string;
        income.push(
          rnd(4) === 0
            ? pub(`p${k}`, amount / 100, month)
            : { ...master(`m${k}`, rnd(2) ? 'A' : 'B', amount / 100, month, `QZTST260000${rnd(3) + 1}`), labelId: rnd(3) === 0 ? null : rnd(2) ? 'L1' : 'L2' },
        );
      }
      const positions: Position[] = [];
      for (let k = 0; k < 4; k++) {
        const kind = kinds[rnd(5)] as Position['scope']['kind'];
        const p = pos(`q${k}`, rnd(2) ? 'A' : 'B', (rnd(3000) + 1) / 100, kind, rnd(3) ? (months[rnd(5)] as string) : '2026-01',
          kind === 'isrcs' ? { isrcs: [`QZTST260000${rnd(3) + 1}`] } : {});
        // some deductions (no date) and some positions under a label
        if (rnd(4) === 0) p.month = null;
        if (rnd(3) === 0) p.labelId = rnd(2) ? 'L1' : 'L2';
        positions.push(p);
      }
      const now = recoup(positions, income).map((r) => ({
        positionId: r.positionId,
        recouped: r.recouped.toFixed(),
        remaining: r.remaining.toFixed(),
        consumed: r.consumed.map((c) => ({ itemId: c.itemId, amount: c.amount.toFixed() })),
      }));
      expect(now, `round ${round}`).toEqual(recoupBefore(positions, income));
      for (const r of recoup(positions, income)) expect(r.forgiven.toFixed()).toBe('0');
      // and with a random forgiveness on every position the identity holds
      const withF = recoup(
        positions.map((p) => forgiven(p, [months[rnd(5)] as string, (rnd(2000) + 1) / 100])),
        income,
      );
      holds(withF);
    }
  });
});
