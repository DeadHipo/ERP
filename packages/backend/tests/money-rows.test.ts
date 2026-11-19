import { beforeAll, describe, expect, it } from 'vitest';
import { Decimal, ZERO } from '../src/shared/money';
import { calculate, type UnitResult } from '../src/facade/calculation';
import { sumUnits, type Sums } from '../src/facade/aggregates';
import type { MasterRow } from '../src/facade/money';
import type { SnapshotFilter } from '../src/modules/sources';
import { ACC2, Case, I, UPC, UPC_NO_TRACKS } from './helpers/golden-case';
import { testStack } from './helpers/test-sources';

// `masterRows` (D-247): the master money of a release or of a list of ISRCs as rows. The money must be, character for
// character, the money of the answers it replaces: `release(upc, label).tracks` / `.months` (gone with D-257: the
// fixed numbers `EXPECTED_RELEASE`, checked against them while they existed) and `trackSummary({ isrcs, label }).items`. Compared as JSON strings of the money fields; a row whose sums are all zero
// with no C reason is dropped on both sides (the old answers list tracks without units, the new one has no such row).
// Synthetic data only.

const UPC2 = '1234567890124';

/**
 * Two labels (the files of account 1 are the book of 0to8, of account 2 the book of Echo8). The release `UPC` has
 * I(1) (A 50, confirmed), I(2) (B 30 without a document: `split_unconfirmed`), I(3) (no split: `no_split`) and I(4),
 * a registered track that never earned. The April line of I(2) carries a label string that maps to no label
 * (`label_unmapped`); the April file of 0to8 also has a line without an ISRC (`no_isrc`). Echo8 has its own units on I(1), I(2) (March) and I(3) (May). I(5) is another release.
 */
async function world() {
  const c = await Case.start();
  await c.person('A', 'B');
  for (const n of [1, 2, 3, 4]) await c.track(I(n));
  await c.track(I(5), UPC2);
  await c.split(I(1), [['A', '50']]);
  await c.split(I(2), [['B', '30']], { doc: null });
  await c.split(I(5), []);
  await c.load('2026-03', [
    { isrc: I(1), net: '100' },
    { isrc: I(2), net: '50' },
    { isrc: I(3), net: '20' },
    { isrc: I(5), net: '10', upc: UPC2 },
  ]);
  await c.load('2026-04', [
    { isrc: I(1), net: '200' },
    { isrc: I(2), net: '40', label: 'Unknown Imprint' },
    { isrc: '', net: '7' }, // a line without an ISRC on a release without tracks (`UPC_NO_TRACKS`): C `no_isrc`, not a track
  ]);
  await c.load('2026-03', [
    { isrc: I(1), net: '60', label: 'Echo8' },
    { isrc: I(2), net: '30', label: 'Echo8' },
  ], ACC2);
  await c.load('2026-05', [{ isrc: I(3), net: '8', label: 'Echo8' }], ACC2);
  return { c, f: c.f, zero: c.f.testLabels['0to8'], echo: c.f.testLabels.Echo8 };
}

type World = Awaited<ReturnType<typeof world>>;

/** The money fields of a row, in one fixed order (the reasons keep the order `sumUnits` gave them). */
const money = (s: Sums) => ({ net: s.net, B: s.B, C: s.C, ours: s.ours, cByReason: s.cByReason });
const moneyText = (s: Sums) => JSON.stringify(money(s));
const isZero = (s: Sums) => [s.net, s.B, s.C, s.ours].every((x) => x.isZero()) && Object.keys(s.cByReason).length === 0;

/** `key → JSON` of the non-zero rows of the new answer; `months` rides along where the grain has it. */
const rowsText = (rows: MasterRow[], key: (r: MasterRow) => string) =>
  rows.filter((r) => !isZero(r.sums)).map((r) => [key(r), JSON.stringify({ ...money(r.sums), ...(r.months ? { months: r.months } : {}) })]);
/** The same of an old answer (its rows carry the sums flat). */
const oldText = <T extends Sums>(items: T[], key: (x: T) => string, months?: (x: T) => unknown) =>
  items.filter((x) => !isZero(x)).map((x) => [key(x), JSON.stringify({ ...money(x), ...(months ? { months: months(x) } : {}) })]);

const isrcOf = (r: MasterRow) => r.isrc as string;
const monthOf = (r: MasterRow) => r.month as string;

/** Every snapshot read of the facade while `fn` runs (the filter the sources got). */
async function readsOf<T>(fn: () => Promise<T>): Promise<{ answer: T; filters: SnapshotFilter[] }> {
  const service = (await testStack()).service;
  const saved = service.snapshot;
  const original = service.snapshot.bind(service);
  const filters: SnapshotFilter[] = [];
  service.snapshot = (filter: SnapshotFilter = {}) => {
    filters.push(filter);
    return original(filter);
  };
  try {
    return { answer: await fn(), filters };
  } finally {
    service.snapshot = saved;
  }
}

// Counted by hand in the world above. 0to8: I(1) 100 + 200 (A 50 %), I(2) 50 (B 30 % waits) + 40 (B 30 % waits, the
// label share of an unmapped string waits), I(3) 20 without a split. Echo8: I(1) 60, I(2) 30, I(3) 8 in May.
const m = (net: string, B: string, C: string, ours: string, cByReason: Record<string, string>, months?: [string, string, number]) =>
  JSON.stringify({ net, B, C, ours, cByReason, ...(months ? { months: { from: months[0], to: months[1], count: months[2] } } : {}) });
const EXPECTED_RELEASE = {
  all: {
    isrc: [
      [I(1), m('360', '180', '0', '180', {}, ['2026-03', '2026-04', 2])],
      [I(2), m('120', '0', '64', '56', { split_unconfirmed: '36', label_unmapped: '28' }, ['2026-03', '2026-04', 2])],
      [I(3), m('28', '0', '28', '0', { no_split: '28' }, ['2026-03', '2026-05', 2])],
    ],
    month: [
      ['2026-03', m('260', '80', '44', '136', { split_unconfirmed: '24', no_split: '20' })],
      ['2026-04', m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' })],
      ['2026-05', m('8', '0', '8', '0', { no_split: '8' })],
    ],
    totals: m('508', '180', '92', '236', { split_unconfirmed: '36', label_unmapped: '28', no_split: '28' }),
  },
  '0to8': {
    isrc: [
      [I(1), m('300', '150', '0', '150', {}, ['2026-03', '2026-04', 2])],
      [I(2), m('90', '0', '55', '35', { split_unconfirmed: '27', label_unmapped: '28' }, ['2026-03', '2026-04', 2])],
      [I(3), m('20', '0', '20', '0', { no_split: '20' }, ['2026-03', '2026-03', 1])],
    ],
    month: [
      ['2026-03', m('170', '50', '35', '85', { split_unconfirmed: '15', no_split: '20' })],
      ['2026-04', m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' })],
    ],
    totals: m('410', '150', '75', '185', { split_unconfirmed: '27', label_unmapped: '28', no_split: '20' }),
  },
  Echo8: {
    isrc: [
      [I(1), m('60', '30', '0', '30', {}, ['2026-03', '2026-03', 1])],
      [I(2), m('30', '0', '9', '21', { split_unconfirmed: '9' }, ['2026-03', '2026-03', 1])],
      [I(3), m('8', '0', '8', '0', { no_split: '8' }, ['2026-05', '2026-05', 1])],
    ],
    month: [
      ['2026-03', m('90', '30', '9', '51', { split_unconfirmed: '9' })],
      ['2026-05', m('8', '0', '8', '0', { no_split: '8' })],
    ],
    totals: m('98', '30', '17', '51', { split_unconfirmed: '9', no_split: '8' }),
  },
};

describe('masterRows: the master money as rows (D-247)', () => {
  let w: World;
  let labels: [string, string | undefined][];
  beforeAll(async () => {
    w = await world();
    labels = [['all', undefined], ['0to8', w.zero], ['Echo8', w.echo]];
  });

  // D-257: `release()` gives no money any more, so the equality with it became the fixed numbers below (`EXPECTED_RELEASE`,
  // unchanged since D-247). What is left to compare with the card: the tracks it names and the units it does not read.
  it('the card of a release reads no units and names the tracks the units of the book gave (D-257)', async () => {
    const { f } = w;
    // what `release(UPC, label).tracks` listed before D-257: the ISRCs of the units of the book and the visible tracks
    const TRACKS: Record<string, string[]> = { all: [I(1), I(2), I(3), I(4)], '0to8': [I(1), I(2), I(3)], Echo8: [I(1), I(2), I(3)] };
    for (const [name, label] of labels) {
      const card = await readsOf(() => f.release(UPC, label));
      expect(card.filters, name).toEqual([]);
      expect(card.answer.tracks.map((t) => t.isrc), name).toEqual(TRACKS[name]);
      expect(card.answer.tracks.map((t) => Object.keys(t)), name).toEqual(card.answer.tracks.map(() => ['isrc', 'title', 'artists']));
      expect(Object.keys(card.answer), name).toEqual(['upc', 'title', 'artistName', 'artists', 'tracks', 'coverUrl', 'registry']);
      const byIsrc = await readsOf(() => f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'isrc' }, label));
      const byMonth = await f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'month' }, label);
      // the read the old card made: the lines of the UPC, under a label of its files
      expect(byIsrc.filters, name).toEqual([{ upcs: [UPC], ...(label ? { labelIds: [label] } : {}) }]);
      // every row of money is a track of the card; I(4) never earned: on the card under «all», without a row
      for (const isrc of byIsrc.answer.rows.map(isrcOf)) expect(card.answer.tracks.map((t) => t.isrc), name).toContain(isrc);
      expect(byIsrc.answer.rows.map(isrcOf), name).not.toContain(I(4));
      expect(moneyText(byMonth.totals), name).toBe(moneyText(byIsrc.answer.totals));
    }
  });

  it('a release only in the files of another label is unknown under a label, as before (D-257)', async () => {
    const { f } = w;
    // `UPC2` (I(5)) is in a file of 0to8 only: a manager of Echo8 gets 404, 0to8 and «all» get the card
    await expect(f.release(UPC2, w.echo)).rejects.toThrow(/not found/i);
    expect((await f.release(UPC2, w.zero)).tracks.map((t) => t.isrc)).toEqual([I(5)]);
    expect((await f.release(UPC2)).tracks.map((t) => t.isrc)).toEqual([I(5)]);
    // a release of nobody
    await expect(f.release('0000000000000')).rejects.toThrow(/not found/i);
  });

  it('a release: the fixed numbers of this world', async () => {
    const { f } = w;
    const got: Record<string, unknown> = {};
    for (const [name, label] of labels) {
      const byIsrc = await f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'isrc' }, label);
      const byMonth = await f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'month' }, label);
      got[name] = { isrc: rowsText(byIsrc.rows, isrcOf), month: rowsText(byMonth.rows, monthOf), totals: moneyText(byIsrc.totals) };
    }
    expect(got).toEqual(EXPECTED_RELEASE);
  });

  it('a list of ISRCs, and no list, under a label and under «all», is `trackSummary().items` with its months', async () => {
    const { f } = w;
    const lists: (string[] | undefined)[] = [undefined, [I(1), I(2), I(3), I(4), I(5)], [I(3), I(1)], [I(2), I(2)], [I(4)], [I(5)]];
    for (const [name, label] of labels)
      for (const isrcs of lists) {
        const at = `${name} ${isrcs?.join(',') ?? 'no list'}`;
        const old = await readsOf(() => f.trackSummary({ ...(isrcs ? { isrcs: isrcs.join(',') } : {}), ...(label ? { label } : {}) }));
        const now = await readsOf(() => f.masterRows({ scope: { kind: 'isrcs', ...(isrcs ? { isrcs } : {}) }, grain: 'isrc' }, label));
        expect(rowsText(now.answer.rows, isrcOf), at).toEqual(oldText(old.answer.items, (i) => i.isrc, (i) => i.months));
        // the same read, unless the list is empty under the label: then nothing is calculated
        if (now.filters.length > 0) expect(now.filters, at).toEqual(old.filters);
        else expect(now.answer.rows, at).toEqual([]);
        // sorted by ISRC, no row without units
        expect(now.answer.rows.map(isrcOf), at).toEqual([...now.answer.rows.map(isrcOf)].sort());
        expect(now.answer.rows.every((r) => r.months !== undefined && r.months.count > 0 && r.month === undefined), at).toBe(true);
      }
    // the worlds differ: «all» has the units of both books, a label only its own
    const all = await f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' });
    const echo = await f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, w.echo);
    expect(all.rows.map((r) => [r.isrc, r.sums.net.toFixed(), r.months])).toEqual([
      [I(1), '360', { from: '2026-03', to: '2026-04', count: 2 }],
      [I(2), '120', { from: '2026-03', to: '2026-04', count: 2 }],
      [I(3), '28', { from: '2026-03', to: '2026-05', count: 2 }],
      [I(5), '10', { from: '2026-03', to: '2026-03', count: 1 }],
    ]);
    expect(echo.rows.map((r) => [r.isrc, r.sums.net.toFixed(), r.months?.count])).toEqual([[I(1), '60', 1], [I(2), '30', 1], [I(3), '8', 1]]);
  });

  it('a period is the report month: one month of a list is `trackSummary({ isrcs, month })`', async () => {
    const { f } = w;
    for (const [name, label] of labels)
      for (const month of ['2026-03', '2026-04', '2026-05', '2026-06']) {
        const isrcs = [I(1), I(2), I(3)];
        const old = await f.trackSummary({ isrcs: isrcs.join(','), month, ...(label ? { label } : {}) });
        const now = await f.masterRows({ scope: { kind: 'isrcs', isrcs }, grain: 'isrc', period: { from: month, to: month } }, label);
        expect(rowsText(now.rows, isrcOf), `${name} ${month}`).toEqual(oldText(old.items, (i) => i.isrc, (i) => i.months));
      }
    // open bounds; a release takes the period too
    const from = await f.masterRows({ scope: { kind: 'isrcs' }, grain: 'month', period: { from: '2026-04' } });
    expect(from.rows.map((r) => [r.month, r.sums.net.toFixed()])).toEqual([['2026-04', '240'], ['2026-05', '8']]);
    const to = await f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'month', period: { to: '2026-03' } });
    expect(to.rows.map((r) => [r.month, r.sums.net.toFixed()])).toEqual([['2026-03', '260']]);
    await expect(f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc', period: { from: '2026-4' } })).rejects.toThrow();
  });

  it('the totals are `sumUnits` of the very units of the rows', async () => {
    const { f } = w;
    const calc = await calculate({ ...f.modules, db: f.db });
    const scopes: [string, Parameters<typeof f.masterRows>[0]['scope'], (u: UnitResult) => boolean][] = [
      ['release', { kind: 'release', upc: UPC }, (u) => u.upc === UPC],
      ['no list', { kind: 'isrcs' }, () => true],
      ['list', { kind: 'isrcs', isrcs: [I(2), I(5)] }, (u) => u.isrc === I(2) || u.isrc === I(5)],
    ];
    for (const [name, label] of labels)
      for (const [what, scope, pick] of scopes) {
        const units = calc.units.filter((u) => u.isrc !== '' && pick(u) && (label === undefined || u.bookLabelId === label));
        expect(units.length, `${name} ${what}`).toBeGreaterThan(0);
        for (const grain of ['isrc', 'month', 'isrc,month'] as const) {
          const { totals } = await f.masterRows({ scope, grain }, label);
          expect(moneyText(totals), `${name} ${what} ${grain}`).toBe(moneyText(sumUnits(calc, units)));
        }
      }
  });

  it('the rows by ISRC and month, added up per ISRC, are the rows by ISRC (and per month, the rows by month)', async () => {
    const { f } = w;
    /** A canonical text of sums: the reasons sorted (adding rows up may meet them in another order). */
    const canon = (s: Sums) =>
      JSON.stringify([s.net, s.B, s.C, s.ours, Object.entries(s.cByReason).sort(([a], [b]) => (a < b ? -1 : 1))].map((x) => (x instanceof Decimal ? x.toFixed() : x.map(([k, v]) => [k, v.toFixed()]))));
    const add = (rows: MasterRow[], key: (r: MasterRow) => string) => {
      const out = new Map<string, Sums>();
      for (const r of rows) {
        const s = out.get(key(r)) ?? { net: ZERO, B: ZERO, C: ZERO, ours: ZERO, cByReason: {} };
        const cByReason = { ...s.cByReason };
        for (const [k, v] of Object.entries(r.sums.cByReason) as [keyof Sums['cByReason'], Decimal][]) cByReason[k] = (cByReason[k] ?? ZERO).add(v);
        out.set(key(r), { net: s.net.add(r.sums.net), B: s.B.add(r.sums.B), C: s.C.add(r.sums.C), ours: s.ours.add(r.sums.ours), cByReason });
      }
      return [...out.entries()].map(([k, s]) => [k, canon(s)]);
    };
    const scopes = [{ kind: 'release', upc: UPC }, { kind: 'isrcs' }, { kind: 'isrcs', isrcs: [I(1), I(3)] }] as const;
    for (const [name, label] of labels)
      for (const scope of scopes) {
        const q = { scope: scope.kind === 'isrcs' && 'isrcs' in scope ? { kind: 'isrcs' as const, isrcs: [...scope.isrcs] } : scope };
        const pairs = await f.masterRows({ ...q, grain: 'isrc,month' }, label);
        const byIsrc = await f.masterRows({ ...q, grain: 'isrc' }, label);
        const byMonth = await f.masterRows({ ...q, grain: 'month' }, label);
        const at = `${name} ${JSON.stringify(scope)}`;
        expect(pairs.rows.length, at).toBeGreaterThan(0);
        expect(pairs.rows.every((r) => r.isrc !== undefined && r.month !== undefined && r.months === undefined), at).toBe(true);
        // sorted by ISRC, then by month
        const keys = pairs.rows.map((r) => `${r.isrc} ${r.month}`);
        expect(keys, at).toEqual([...keys].sort());
        expect(new Set(keys).size, at).toBe(keys.length);
        expect(add(pairs.rows, isrcOf), at).toEqual(byIsrc.rows.map((r) => [r.isrc, canon(r.sums)]));
        expect(add(pairs.rows, monthOf).sort(), at).toEqual(byMonth.rows.map((r) => [r.month, canon(r.sums)]));
        expect(byMonth.rows.every((r) => r.isrc === undefined && r.months === undefined), at).toBe(true);
        // the months of a row by ISRC are those of its pairs
        for (const r of byIsrc.rows) {
          const ms = pairs.rows.filter((p) => p.isrc === r.isrc).map(monthOf);
          expect(r.months, at).toEqual({ from: ms[0], to: ms.at(-1), count: ms.length });
        }
      }
  });

  it('a line without an ISRC is not a row: no `isrc: \'\'`, not in the totals, its release has no rows', async () => {
    const { f } = w;
    const calc = await calculate({ ...f.modules, db: f.db });
    // the unit exists in the calculation and waits as `no_isrc`
    const blank = calc.units.filter((u) => u.isrc === '');
    expect(blank.map((u) => [u.upc, u.reportingMonth, u.net.toFixed(), u.bookLabelId])).toEqual([[UPC_NO_TRACKS, '2026-04', '7', w.zero]]);
    expect(moneyText(sumUnits(calc, blank))).toBe('{"net":"7","B":"0","C":"7","ours":"0","cByReason":{"no_isrc":"7"}}');
    const ZEROS = '{"net":"0","B":"0","C":"0","ours":"0","cByReason":{}}';
    for (const [name, label] of labels) {
      const mine = (u: UnitResult) => label === undefined || u.bookLabelId === label;
      const withIsrc = calc.units.filter((u) => u.isrc !== '' && mine(u));
      for (const grain of ['isrc', 'month', 'isrc,month'] as const) {
        const all = await f.masterRows({ scope: { kind: 'isrcs' }, grain }, label);
        const at = `${name} ${grain}`;
        if (grain !== 'month') expect(all.rows.map(isrcOf), at).not.toContain('');
        expect(moneyText(all.totals), at).toBe(moneyText(sumUnits(calc, withIsrc)));
        expect(JSON.stringify(all.totals.cByReason), at).not.toContain('no_isrc');
        expect(JSON.stringify(all.rows), at).not.toContain('no_isrc');
        // its release: the card does not exist (404), the money has no rows and zero totals
        const rel = await f.masterRows({ scope: { kind: 'release', upc: UPC_NO_TRACKS }, grain }, label);
        expect([rel.rows, moneyText(rel.totals)], at).toEqual([[], ZEROS]);
      }
      await expect(f.release(UPC_NO_TRACKS, label), name).rejects.toMatchObject({ statusCode: 404 });
      // the old summary has no such row either, and the rows are still its rows
      const old = await f.trackSummary(label ? { label } : {});
      expect(old.items.map((i) => i.isrc), name).not.toContain('');
      const now = await f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, label);
      expect(rowsText(now.rows, isrcOf), name).toEqual(oldText(old.items, (i) => i.isrc, (i) => i.months));
    }
    // April of 0to8 by month: 200 of I(1) + 40 of I(2), without the 7 of the line without an ISRC
    const april = await f.masterRows({ scope: { kind: 'isrcs' }, grain: 'month', period: { from: '2026-04', to: '2026-04' } }, w.zero);
    expect(april.rows.map((r) => [r.month, moneyText(r.sums)])).toEqual([['2026-04', m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' })]]);
  });

  it('a release takes the period under a label too: the fixed numbers of this world', async () => {
    const { f } = w;
    const rel = (grain: 'isrc' | 'month', period: { from?: string; to?: string }, label?: string) =>
      f.masterRows({ scope: { kind: 'release', upc: UPC }, grain, period }, label);
    const shown = (r: Awaited<ReturnType<typeof rel>>, key: (x: MasterRow) => string) => ({ rows: rowsText(r.rows, key), totals: moneyText(r.totals) });
    // 0to8 from April: I(1) 200 (A 50 %), I(2) 40 under the unmapped string (B 30 % waits, the label share waits)
    expect(shown(await rel('isrc', { from: '2026-04' }, w.zero), isrcOf)).toEqual({
      rows: [
        [I(1), m('200', '100', '0', '100', {}, ['2026-04', '2026-04', 1])],
        [I(2), m('40', '0', '40', '0', { split_unconfirmed: '12', label_unmapped: '28' }, ['2026-04', '2026-04', 1])],
      ],
      totals: m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' }),
    });
    // Echo8 from April: only I(3) of May, without a split
    expect(shown(await rel('month', { from: '2026-04' }, w.echo), monthOf)).toEqual({
      rows: [['2026-05', m('8', '0', '8', '0', { no_split: '8' })]],
      totals: m('8', '0', '8', '0', { no_split: '8' }),
    });
    // Echo8 up to March: I(1) 60 (A 50 %), I(2) 30 (B 30 % waits)
    expect(shown(await rel('isrc', { to: '2026-03' }, w.echo), isrcOf)).toEqual({
      rows: [
        [I(1), m('60', '30', '0', '30', {}, ['2026-03', '2026-03', 1])],
        [I(2), m('30', '0', '9', '21', { split_unconfirmed: '9' }, ['2026-03', '2026-03', 1])],
      ],
      totals: m('90', '30', '9', '51', { split_unconfirmed: '9' }),
    });
    // «all», from April to April: both books, Echo8 has nothing in April
    expect(shown(await rel('month', { from: '2026-04', to: '2026-04' }), monthOf)).toEqual({
      rows: [['2026-04', m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' })]],
      totals: m('240', '100', '40', '100', { split_unconfirmed: '12', label_unmapped: '28' }),
    });
    // 0to8 from May: nothing
    expect(shown(await rel('isrc', { from: '2026-05' }, w.zero), isrcOf)).toEqual({ rows: [], totals: m('0', '0', '0', '0', {}) });
  });

  it('an empty list is nothing, without a calculation; an ISRC is checked; an unknown release has no rows', async () => {
    const { f } = w;
    for (const [name, label] of labels) {
      const empty = await readsOf(() => f.masterRows({ scope: { kind: 'isrcs', isrcs: [] }, grain: 'isrc' }, label));
      expect(empty.filters, name).toEqual([]);
      expect([empty.answer.rows, moneyText(empty.answer.totals)], name).toEqual([[], '{"net":"0","B":"0","C":"0","ours":"0","cByReason":{}}']);
    }
    // I(5) is not of Echo8: the list is empty under it, so nothing is read
    const other = await readsOf(() => f.masterRows({ scope: { kind: 'isrcs', isrcs: [I(5)] }, grain: 'isrc' }, w.echo));
    expect([other.filters, other.answer.rows]).toEqual([[], []]);
    await expect(f.masterRows({ scope: { kind: 'isrcs', isrcs: ['not-an-isrc'] }, grain: 'isrc' })).rejects.toThrow();
    const none = await f.masterRows({ scope: { kind: 'release', upc: '0000000000000' }, grain: 'isrc' });
    expect([none.rows, moneyText(none.totals)]).toEqual([[], '{"net":"0","B":"0","C":"0","ours":"0","cByReason":{}}']);
    await expect(f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, '00000000-0000-4000-8000-00000000dead')).rejects.toThrow();
  });
});

