import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import type { Sums } from '../src/facade/aggregates';
import type { MasterRow } from '../src/facade/money';
import {
  addSums,
  canonText,
  chunksOf,
  diffPairs,
  describeError,
  diffTotals,
  emptyRunReasons,
  exitCodeOf,
  failedOf,
  isZero,
  median,
  moneyText,
  newPairs,
  oldPairs,
  withinThreshold,
} from '../scripts/lib/master-rows-compare';

// The pure rules of `scripts/check-master-rows.ts` (D-249), on synthetic objects: no storage.

const d = (x: string) => new Decimal(x);
const sums = (net: string, B: string, C: string, ours: string, cByReason: Record<string, string> = {}): Sums => ({
  net: d(net),
  B: d(B),
  C: d(C),
  ours: d(ours),
  cByReason: Object.fromEntries(Object.entries(cByReason).map(([k, v]) => [k, d(v)])) as Sums['cByReason'],
});
const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const I3 = 'QZTST2600003';
const months = { from: '2026-03', to: '2026-04', count: 2 };

describe('check-master-rows: the comparison rules (D-249)', () => {
  it('the money text is the fixed fields; a zero row has zero sums and no reason', () => {
    expect(moneyText(sums('100', '50', '0', '50'))).toBe('{"net":"100","B":"50","C":"0","ours":"50","cByReason":{}}');
    expect(isZero(sums('0', '0', '0', '0'))).toBe(true);
    expect(isZero(sums('0', '0', '0', '0', { no_split: '0' }))).toBe(false);
    expect(isZero(sums('0.000000000001', '0', '0', '0'))).toBe(false);
  });

  it('equal answers: zero rows are dropped on both sides, months ride along where asked', () => {
    const rows: MasterRow[] = [
      { isrc: I1, sums: sums('100', '50', '0', '50'), months },
      { isrc: I2, sums: sums('20', '0', '20', '0', { no_split: '20' }), months },
    ];
    const old = [
      { isrc: I1, title: 'x', ...sums('100', '50', '0', '50'), months },
      { isrc: I2, title: 'y', ...sums('20', '0', '20', '0', { no_split: '20' }), months },
      { isrc: I3, title: 'z', ...sums('0', '0', '0', '0'), months: { from: null, to: null, count: 0 } },
    ];
    expect(diffPairs(oldPairs(old, (x) => x.isrc, (x) => x.months), newPairs(rows, (r) => r.isrc as string, { months: true }))).toEqual([]);
    // without the months on both sides: the money alone
    expect(diffPairs(oldPairs(old, (x) => x.isrc), newPairs(rows, (r) => r.isrc as string, { months: false }))).toEqual([]);
    expect(diffPairs(oldPairs(old, (x) => x.isrc), newPairs(rows, (r) => r.isrc as string, { months: true }))).toHaveLength(2);
    expect(diffTotals(old, sums('120', '50', '20', '50', { no_split: '20' }))).toEqual([]);
  });

  it('a key of one side, another amount, another month range, a repeated key and another order are differences', () => {
    const a = moneyText(sums('1', '1', '0', '0'));
    const b = moneyText(sums('1', '0', '0', '1'));
    expect(diffPairs([[I1, a]], [])).toEqual([{ key: I1, old: a, new: null }]);
    expect(diffPairs([], [[I1, a]])).toEqual([{ key: I1, old: null, new: a }]);
    expect(diffPairs([[I1, a], [I2, a]], [[I1, a], [I2, b]])).toEqual([{ key: I2, old: a, new: b }]);
    expect(diffPairs([[I1, a], [I1, a]], [[I1, a]])).toEqual([{ key: `${I1} (twice in old)`, old: a, new: null }]);
    expect(diffPairs([[I1, a], [I2, a]], [[I2, a], [I1, a]])).toEqual([{ key: '(order of the rows)', old: null, new: null }]);
    const row: MasterRow = { isrc: I1, sums: sums('1', '1', '0', '0'), months: { from: '2026-03', to: '2026-05', count: 2 } };
    expect(diffPairs(oldPairs([{ isrc: I1, ...sums('1', '1', '0', '0'), months }], (x) => x.isrc, (x) => x.months), newPairs([row], (r) => r.isrc as string, { months: true }))).toHaveLength(1);
    // the text is exact: 1.10 of one side and 1.1 of the other are the same Decimal text, 1.1 and 1.100000000001 are not
    expect(diffPairs([[I1, moneyText(sums('1.10', '0', '0', '1.10'))]], [[I1, moneyText(sums('1.1', '0', '0', '1.1'))]])).toEqual([]);
    expect(diffPairs([[I1, moneyText(sums('1.1', '0', '0', '1.1'))]], [[I1, moneyText(sums('1.100000000001', '0', '0', '1.1'))]])).toHaveLength(1);
  });

  it('the totals are the old rows added exactly, whatever the order of the reasons', () => {
    const rows = [sums('0.1', '0', '0.1', '0', { no_split: '0.1' }), sums('0.2', '0', '0.2', '0', { split_unconfirmed: '0.15', no_split: '0.05' })];
    const total = addSums(rows);
    expect(canonText(total)).toBe('{"net":"0.3","B":"0","C":"0.3","ours":"0","cByReason":{"no_split":"0.15","split_unconfirmed":"0.15"}}');
    expect(diffTotals(rows, sums('0.3', '0', '0.3', '0', { split_unconfirmed: '0.15', no_split: '0.15' }))).toEqual([]);
    const off = diffTotals(rows, sums('0.3', '0', '0.3', '0', { split_unconfirmed: '0.15', no_split: '0.150000000001' }));
    expect(off.map((x) => x.key)).toEqual(['totals']);
    expect(diffTotals([], sums('0', '0', '0', '0'))).toEqual([]);
  });

  it('the median, the threshold and the exit code', () => {
    expect(median([5, 1, 4, 2, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
    // new ≤ 1.2 × old
    expect(withinThreshold(10_000, 12_000)).toBe(true);
    expect(withinThreshold(10_000, 12_001)).toBe(false);
    // or new − old ≤ 0.3 s
    expect(withinThreshold(100, 400)).toBe(true);
    expect(withinThreshold(100, 401)).toBe(false);
    expect(withinThreshold(500, 100)).toBe(true);
    const none = { differences: 0, newOnlyFailures: 0, notCompared: 0, timingsOutside: 0 };
    expect(exitCodeOf(none)).toBe(0);
    expect(exitCodeOf({ ...none, differences: 1 })).toBe(2);
    expect(exitCodeOf({ ...none, differences: 1, timingsOutside: 2, notCompared: 1 })).toBe(2);
    expect(exitCodeOf({ ...none, timingsOutside: 1 })).toBe(3);
    // only the new answer failed: a difference; both sides (or the old one) failed: not compared
    expect(exitCodeOf({ ...none, newOnlyFailures: 1, notCompared: 3 })).toBe(2);
    expect(exitCodeOf({ ...none, notCompared: 1, timingsOutside: 1 })).toBe(1);
  });

  it('an empty selection is not a green run', () => {
    const full = { labels: 2, allIsrcRows: 10 };
    expect(emptyRunReasons(full)).toEqual([]);
    expect(emptyRunReasons({ ...full, labels: 0 })).toEqual(['no own label']);
    expect(emptyRunReasons({ ...full, allIsrcRows: 0 })).toEqual(['no row for every ISRC under «all»']);
    // D-257: the releases are not compared with the old answer any more, so none compared is no reason
    expect(emptyRunReasons({ labels: 0, allIsrcRows: 0 })).toHaveLength(2);
    // the comparison under «all» failed: counted as a failure, not as an empty selection
    expect(emptyRunReasons({ ...full, allIsrcRows: null })).toEqual([]);
  });

  it('an error is described by its class and the ClickHouse code, never by its message', () => {
    // what the client throws when the HTTP layer of the server answers (not parsed into a ClickHouseError)
    const form = new Error("Poco::Exception. Code: 1000, e.code() = 0, HTML Form Exception: Field value too long (version 1.2.3), query: SELECT secret FROM t WHERE isrc IN ['QZTST2600001']");
    expect(describeError(form)).toBe('Error (Poco::Exception, code 1000, HTML Form Exception: Field value too long)');
    // a parsed server error: its code and type, not its text
    const parsed = Object.assign(new Error("Unknown identifier 'QZTST2600001' in query SELECT secret"), { code: '47', type: 'UNKNOWN_IDENTIFIER' });
    expect(describeError(parsed)).toBe('Error (code 47, UNKNOWN_IDENTIFIER)');
    class NotFoundError extends Error {
      override name = 'NotFoundError';
    }
    expect(describeError(new NotFoundError('Release 1234567890123 of Some Title not found'))).toBe('NotFoundError');
    expect(describeError(Object.assign(new Error('x'), { name: 'a name with QZTST2600001' }))).toBe('Error');
    expect(describeError('text')).toBe('error');
    for (const e of [form, parsed]) expect(describeError(e)).not.toMatch(/secret|QZTST/);
  });

  it('a failed comparison: the side, and whether both sides failed the same way', () => {
    expect(failedOf(undefined, undefined)).toBeUndefined();
    expect(failedOf('E1', undefined)).toEqual({ side: 'old', same: false, old: 'E1' });
    expect(failedOf(undefined, 'E1')).toEqual({ side: 'new', same: false, new: 'E1' });
    expect(failedOf('E1', 'E1')).toEqual({ side: 'both', same: true, old: 'E1', new: 'E1' });
    expect(failedOf('E1', 'E2')).toEqual({ side: 'both', same: false, old: 'E1', new: 'E2' });
  });

  it('a list is cut into chunks in order, the last one shorter', () => {
    const list = Array.from({ length: 1201 }, (_, i) => `QZTST26${String(i).padStart(5, '0')}`);
    const cut = chunksOf(list, 500);
    expect(cut.map((c) => c.length)).toEqual([500, 500, 201]);
    expect(cut.flat()).toEqual(list);
    expect(chunksOf(list.slice(0, 500), 500).map((c) => c.length)).toEqual([500]);
    expect(chunksOf([], 500)).toEqual([]);
    expect(() => chunksOf(list, 0)).toThrow();
  });
});
