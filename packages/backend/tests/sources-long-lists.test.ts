import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { byteCompare, createBelieveColumnar, LIST_CHUNK, listChunks } from '../src/modules/sources';
import type { Sums } from '../src/facade/aggregates';
import type { MasterRow } from '../src/facade/money';
import { believeReport, writeReport, type Spec } from './helpers/believe-csv';
import { Case } from './helpers/golden-case';
import { createIsolatedSources } from './helpers/sources-stack';
import { clickhouseUp, postgresUp } from './helpers/stack';

// D-258: a list of ISRCs / UPCs / label strings longer than one form field of the ClickHouse HTTP interface
// (131 072 bytes as encoded in the URL, about 6 200 ISRCs) goes in chunks, and the answer is the one a single query would give. Synthetic data only.

const A = '9999001';
const B = '9999002';
const isrc = (n: number) => `QZTST26${String(n).padStart(5, '0')}`;
const bulkIsrc = (n: number) => `QZTST28${String(n).padStart(5, '0')}`;
const upc = (n: number) => `36173800${String(n).padStart(5, '0')}`;
const bulkUpc = (n: number) => `36173810${String(n).padStart(5, '0')}`;
const albumUpc = (n: number) => `36173820${String(n).padStart(5, '0')}`;
/** 12 000 ISRCs that are in no file: with the real ones, a list longer than one form field. */
const ABSENT = Array.from({ length: 12_000 }, (_, n) => `QZTST27${String(n).padStart(5, '0')}`);
const BULK = 9_000;
const ALBUMS = 8_000;

/** The length of a list as the field of the URL the client sends (`param_x=['a','b']`, form-encoded). */
const fieldSize = (list: string[]) => {
  const escaped = list.map((v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`);
  return new URLSearchParams([['p', `[${escaped.join(',')}]`]]).toString().length - 2;
};

const text = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));

describe('long lists: the chunks of a list (pure)', () => {
  it('a list within the size goes as it is; a longer one is cut into sorted distinct chunks', () => {
    expect(listChunks(['b', 'a', 'a'], 3)).toBeUndefined();
    expect(listChunks([], 3)).toBeUndefined();
    expect(listChunks(['d', 'b', 'a', 'c'], 3)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(listChunks(['b', 'b', 'a', 'a'], 3)).toEqual([['a', 'b']]);
    expect(listChunks(['b', 'b', 'b', 'b'], 3)).toEqual([['b']]);
    const many = Array.from({ length: LIST_CHUNK }, (_, n) => String(n));
    expect(listChunks(many)).toBeUndefined();
    expect(listChunks([...many, 'x'])?.map((c) => c.length)).toEqual([LIST_CHUNK, 1]);
    // a few very long values: cut by bytes, well under the field limit
    const long = Array.from({ length: 10 }, (_, n) => `${n}`.padEnd(30_000, 'x'));
    const chunks = listChunks(long) as string[][];
    expect(chunks.flat()).toEqual(long);
    expect(chunks.every((c) => fieldSize(c) <= 100_000)).toBe(true);
    // the size is the field as it travels in the URL: a Cyrillic letter is 6 bytes there, a quote or a comma 3
    const cyrillic = Array.from({ length: LIST_CHUNK }, (_, n) => `Лейбл, которого нет: «${String(n).padStart(4, '0')}» и 'ко'`);
    expect(cyrillic.reduce((n, v) => n + Buffer.byteLength(v) + 3, 0)).toBeLessThan(100_000);
    expect(fieldSize(cyrillic)).toBeGreaterThan(131_072);
    const cut = listChunks(cyrillic) as string[][];
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.flat()).toEqual([...cyrillic].sort(byteCompare));
    expect(cut.every((c) => fieldSize(c) <= 100_000)).toBe(true);
    // ISRCs: 21 bytes each in the URL, a thousand of them a fifth of the size
    expect(fieldSize(many.map((_, n) => `QZTST27${String(n).padStart(5, '0')}`))).toBe(21 * LIST_CHUNK + 3);
  });

  it('compares as ClickHouse compares a String: by the bytes of UTF-8', () => {
    const values = ['', 'a', 'A', 'ab', 'Z', 'é', 'я', '\u{1F600}', '�', '', 'a\u{1F600}', 'a�', '0', '~'];
    const bytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
    for (const a of values) for (const b of values) expect(Math.sign(byteCompare(a, b)), `${a} ${b}`).toBe(bytes(a, b));
  });
});

describe.runIf(postgresUp && clickhouseUp)('long lists to ClickHouse go in chunks (D-258)', () => {
  let iso: Awaited<ReturnType<typeof createIsolatedSources>>;
  let ids: string[];
  let queries = 0;
  /** The same databases with a list cut at three values: every list of the small files goes in chunks. */
  let small: ReturnType<typeof createBelieveColumnar>;

  beforeAll(async () => {
    iso = await createIsolatedSources();
    const dir = join(iso.storageDir, 'in');
    mkdirSync(dir, { recursive: true });
    const s = iso.service;
    // 40 tracks on 8 releases, two label strings, three sales months, amounts with a fraction and below zero; the
    // releases 0 and 1 have an album line (no ISRC) in both files of account A
    const rows = (month: number, shift: number): Spec[] => [
      ...Array.from({ length: 40 }, (_, n): Spec[] => [
        {
          isrc: isrc(n),
          upc: upc(n % 8),
          net: `${n + shift}.${String(n * 7 + month).padStart(3, '0')}`,
          labelName: n % 5 === 0 ? 'Echo8' : 'Test Label',
          artist: `Artist ${n % 6}`,
          track: `Track ${n} of ${month}`,
          salesMonth: `2026/0${1 + (n % 3)}/01`,
        },
        // the same ISRC on a second release, and a negative line
        ...(n % 4 === 0 ? [{ isrc: isrc(n), upc: upc(7 - (n % 8)), net: `-0.${String(n + 1).padStart(2, '0')}5`, track: `Track ${n} again` }] : []),
      ]).flat(),
      { isrc: '', upc: upc(0), net: '9.000000000001', salesType: 'Download' },
      { isrc: '', upc: upc(1), net: '3.3', salesType: 'Download' },
    ];
    await s.ingestBelieve({ ...writeReport(dir, A, '2026-07', believeReport(rows(7, 0), { month: '2026-07' })), labelId: 'label-a' });
    await s.ingestBelieve({ ...writeReport(dir, A, '2026-08', believeReport(rows(8, 3), { month: '2026-08' })), labelId: 'label-a' });
    await s.ingestBelieve({ ...writeReport(dir, B, '2026-08', believeReport(rows(8, 11).slice(0, 30), { month: '2026-08' })), labelId: 'label-b' });
    // the bulk file: 9 000 tracks, each on its own release, and 8 000 album lines: 200 on releases of those tracks,
    // the rest on releases without a track
    const bulk: Spec[] = [
      ...Array.from({ length: BULK }, (_, n): Spec => ({ isrc: bulkIsrc(n), upc: bulkUpc(n), net: `0.${String(n + 1).padStart(6, '0')}` })),
      ...Array.from({ length: ALBUMS }, (_, n): Spec => ({ isrc: '', upc: n < 200 ? bulkUpc(n) : albumUpc(n), net: '1.5', salesType: 'Download' })),
    ];
    await s.ingestBelieve({ ...writeReport(dir, A, '2026-09', believeReport(bulk, { month: '2026-09' })), labelId: 'label-a' });
    ids = (await iso.registry.loaded()).map((f) => f.id);
    const counting = new Proxy(iso.ch, {
      get(target, name) {
        const v = Reflect.get(target, name) as unknown;
        if (name === 'query') queries += 1;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as ClickHouseClient;
    small = createBelieveColumnar(counting, { database: iso.database, stageDatabase: iso.stageDatabase }, { listChunk: 3 });
  }, 300_000);
  afterAll(() => iso.close());

  const smallIsrcs = Array.from({ length: 40 }, (_, n) => isrc(n));
  const smallUpcs = Array.from({ length: 8 }, (_, n) => upc(n));
  const shuffled = <T>(list: T[]) => list.map((v, i) => [v, (i * 7919) % 101] as const).sort((a, b) => a[1] - b[1]).map(([v]) => v);

  it('a list longer than a form field: the units of 12 000 ISRCs, of 17 000 UPCs', async () => {
    const c = iso.columnar;
    const whole = await c.units(ids);
    expect(whole.length).toBeGreaterThan(BULK + ALBUMS);
    // ISRCs: the answer of one query without a list, filtered here (the order is the query's own)
    const wanted = [...ABSENT, ...smallIsrcs.slice(0, 25), ...Array.from({ length: BULK }, (_, n) => bulkIsrc(n)).filter((_, n) => n % 3 === 0)];
    const set = new Set(wanted);
    const some = await c.units(ids, { isrcs: shuffled(wanted) });
    expect(some.length).toBeGreaterThan(3_000);
    expect(text(some)).toBe(text(whole.filter((u) => set.has(u.isrc))));
    // UPCs
    const upcs = [...smallUpcs.slice(2), ...Array.from({ length: BULK }, (_, n) => bulkUpc(n)), ...Array.from({ length: ALBUMS }, (_, n) => albumUpc(n))];
    const upcSet = new Set(upcs);
    expect(text(await c.units(ids, { upcs: shuffled(upcs) }))).toBe(text(whole.filter((u) => upcSet.has(u.upc))));
    // both lists long, with a month range
    const both = await c.units(ids, { isrcs: wanted, upcs, from: '2026-08', to: '2026-09' });
    expect(both.length).toBeGreaterThan(3_000);
    expect(text(both)).toBe(text(whole.filter((u) => set.has(u.isrc) && upcSet.has(u.upc) && u.reportingMonth >= '2026-08')));
  }, 300_000);

  it('a list longer than a form field: the snapshot of 12 000 ISRCs and the second read by 17 000 UPCs', async () => {
    const s = iso.service;
    // no list: the second read (the releases of the album lines) asks 8 000 UPCs
    const whole = await s.snapshot();
    expect(whole.units.length).toBeGreaterThan(BULK + ALBUMS - 200);
    // the 200 album lines on releases with one track went to that track
    expect(whole.units.filter((u) => u.isrc === '' && u.upc.startsWith('36173810'))).toEqual([]);
    const wanted = [...ABSENT, ...smallIsrcs, ...Array.from({ length: BULK }, (_, n) => bulkIsrc(n))];
    const set = new Set(wanted);
    const narrowed = await s.snapshot({ isrcs: wanted });
    expect(narrowed.files).toEqual(whole.files);
    // a narrowed read is the same ISRCs of the whole read (D-161, D-211): the same units, the same order
    expect(text(narrowed.units)).toBe(text(whole.units.filter((u) => set.has(u.isrc))));
    expect(text(await s.units({ isrcs: wanted, labelIds: ['label-b'] }))).toBe(text((await s.units({ labelIds: ['label-b'] })).filter((u) => set.has(u.isrc))));
    // and a short list of the ISRCs that are really there
    const short = smallIsrcs.slice(0, 12);
    expect(text((await s.snapshot({ isrcs: [...ABSENT, ...short] })).units)).toBe(text((await s.snapshot({ isrcs: short })).units));
  }, 300_000);

  it('a list longer than a form field: the names, the nets, the pairs', async () => {
    const s = iso.service;
    const c = iso.columnar;
    const wanted = [...ABSENT, ...smallIsrcs.slice(5)];
    const set = new Set(wanted);
    const sortedEntries = <V>(m: Map<string, V>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const names = await s.pairAttributes({ isrcs: wanted });
    expect(names.size).toBeGreaterThan(35);
    expect(text(sortedEntries(names))).toBe(text(sortedEntries(await s.pairAttributes()).filter(([k]) => set.has(k.split('|')[0] as string))));
    expect(text(sortedEntries(names))).toBe(text(sortedEntries(await s.pairAttributes({ isrcs: smallIsrcs.slice(5) }))));
    expect(text(sortedEntries(await s.pairAttributes({ isrcs: wanted, labelIds: ['label-b'] })))).toBe(
      text(sortedEntries(await s.pairAttributes({ isrcs: smallIsrcs.slice(5), labelIds: ['label-b'] }))),
    );
    const manyUpcs = [...smallUpcs.slice(1), ...Array.from({ length: 12_000 }, (_, n) => albumUpc(20_000 + n))];
    expect(text(sortedEntries(await s.pairAttributes({ upcs: manyUpcs })))).toBe(text(sortedEntries(await s.pairAttributes({ upcs: smallUpcs.slice(1) }))));
    expect(text(await s.netByIsrc(wanted))).toBe(text(await s.netByIsrc(smallIsrcs.slice(5))));
    expect(text(await c.isrcFilePairs(ids, wanted))).toBe(text(await c.isrcFilePairs(ids, smallIsrcs.slice(5))));
    expect(text(await c.isrcsOfUpcs(ids, manyUpcs))).toBe(text(await c.isrcsOfUpcs(ids, smallUpcs.slice(1))));
    const byUpc = (rows: { upc: string }[]) => [...rows].sort((a, b) => (a.upc < b.upc ? -1 : 1));
    expect(text(byUpc(await c.netByUpc(ids, { isrcs: wanted })))).toBe(text(byUpc(await c.netByUpc(ids, { isrcs: smallIsrcs.slice(5) }))));
    expect(text(byUpc(await c.netByUpc(ids, { upcs: manyUpcs })))).toBe(text(byUpc(await c.netByUpc(ids, { upcs: smallUpcs.slice(1) }))));
    const labels = ['Echo8', ...Array.from({ length: 6_000 }, (_, n) => `No Such Imprint Of The Long List ${n}`)];
    expect(text(await c.isrcsOfLabelStrings(ids, labels))).toBe(text(await c.isrcsOfLabelStrings(ids, ['Echo8'])));
    // a thousand label strings within the count, 190 KB as a field of the URL (Cyrillic, punctuation): cut by size
    const cyrillic = ['Echo8', ...Array.from({ length: LIST_CHUNK - 1 }, (_, n) => `Лейбл, которого нет: «${String(n).padStart(4, '0')}» и 'ко'`)];
    expect(text(await c.isrcsOfLabelStrings(ids, cyrillic))).toBe(text(await c.isrcsOfLabelStrings(ids, ['Echo8'])));
  }, 300_000);

  it('in chunks = in one query: the same JSON, the same order (a list cut at three values)', async () => {
    const one = iso.columnar;
    // only the small files: the lists stay under the size of the real columnar, so it asks one query
    const files = ids.slice(0, 3);
    const some = shuffled(smallIsrcs).slice(0, 31);
    const lists: { isrcs?: string[]; upcs?: string[]; from?: string; to?: string; basis?: 'report' | 'sales' }[] = [
      { isrcs: smallIsrcs },
      { isrcs: some },
      { isrcs: [...some, ...some, 'QZTST2799999', ''] },
      { upcs: shuffled(smallUpcs) },
      { upcs: [...smallUpcs.slice(0, 5), 'no such upc', ...smallUpcs.slice(0, 5)] },
      { isrcs: some, upcs: shuffled(smallUpcs).slice(0, 6) },
      { isrcs: some, upcs: smallUpcs.slice(0, 2) },
      { isrcs: some.slice(0, 2), upcs: smallUpcs },
      { isrcs: some, upcs: smallUpcs, from: '2026-08', to: '2026-08' },
      { isrcs: some, basis: 'sales', from: '2026-02', to: '2026-03' },
      { isrcs: ['', ...some.slice(0, 5)], upcs: smallUpcs },
    ];
    const byPair = <T extends { isrc: string; upc: string }>(rows: T[]) => [...rows].sort((a, b) => (`${a.isrc}|${a.upc}` < `${b.isrc}|${b.upc}` ? -1 : 1));
    const byUpc = <T extends { upc: string }>(rows: T[]) => [...rows].sort((a, b) => (a.upc < b.upc ? -1 : 1));
    for (const filter of lists) {
      const at = text(filter);
      const before = queries;
      const units = await small.units(files, filter);
      expect(queries - before, at).toBeGreaterThan(1);
      expect(units.length, at).toBeGreaterThan(0);
      expect(text(units), at).toBe(text(await one.units(files, filter)));
      // no ORDER BY in these two queries: the rows are compared in key order
      const nets = await small.netByUpc(files, filter);
      expect(nets.length, at).toBeGreaterThan(0);
      expect(text(byUpc(nets)), at).toBe(text(byUpc(await one.netByUpc(files, filter))));
      const { isrcs, upcs } = filter;
      expect(text(byPair(await small.pairNames(files, { isrcs, upcs }))), at).toBe(text(byPair(await one.pairNames(files, { isrcs, upcs }))));
      if (isrcs) {
        expect(text(await small.netByIsrc(files, isrcs)), at).toBe(text(await one.netByIsrc(files, isrcs)));
        expect(text(await small.isrcFilePairs(files, isrcs)), at).toBe(text(await one.isrcFilePairs(files, isrcs)));
      }
      if (upcs) expect(text(await small.isrcsOfUpcs(files, upcs)), at).toBe(text(await one.isrcsOfUpcs(files, upcs)));
    }
    const labels = ['Test Label', 'Echo8', 'No Such', 'Another', 'Echo8'];
    expect(text(await small.isrcsOfLabelStrings(files, labels))).toBe(text(await one.isrcsOfLabelStrings(files, labels)));
    expect((await small.isrcsOfLabelStrings(files, labels)).length).toBe(41); // 40 tracks and the album lines' ''
  }, 300_000);

  it('the size itself: three values are one query as before, four are two; an empty list asks nothing', async () => {
    const files = ids.slice(0, 3);
    const count = async (fn: () => Promise<unknown>) => {
      const before = queries;
      await fn();
      return queries - before;
    };
    const three = smallIsrcs.slice(0, 3);
    const four = smallIsrcs.slice(0, 4);
    expect(await count(() => small.units(files, { isrcs: three }))).toBe(1);
    expect(await count(() => small.units(files, { isrcs: four }))).toBe(2);
    // four values, three of them distinct: one chunk
    expect(await count(() => small.units(files, { isrcs: [...three, three[0] as string] }))).toBe(1);
    expect(await count(() => small.units(files, { isrcs: four, upcs: smallUpcs.slice(0, 4) }))).toBe(4);
    expect(await count(() => small.units(files, { isrcs: [] }))).toBe(0);
    expect(await small.units(files, { isrcs: four, upcs: [] })).toEqual([]);
    expect(await small.pairNames(files, { isrcs: four, upcs: [] })).toEqual([]);
    expect(await count(() => small.netByIsrc(files, three))).toBe(1);
    expect(await count(() => small.netByIsrc(files, four))).toBe(2);
    expect(await count(() => small.pairNames(files, { isrcs: three }))).toBe(1);
    expect(await count(() => small.pairNames(files, { isrcs: four }))).toBe(2);
    expect(await count(() => small.isrcsOfUpcs(files, smallUpcs.slice(0, 3)))).toBe(1);
    expect(await count(() => small.isrcsOfUpcs(files, smallUpcs.slice(0, 4)))).toBe(2);
    expect(await count(() => small.isrcsOfUpcs(files))).toBe(1);
    expect(await count(() => small.isrcFilePairs(files))).toBe(1);
    // the real size: a thousand values are one query
    const thousand = [...smallIsrcs, ...ABSENT.slice(0, LIST_CHUNK - smallIsrcs.length)];
    const real = createBelieveColumnar(
      new Proxy(iso.ch, {
        get(target, name) {
          const v = Reflect.get(target, name) as unknown;
          if (name === 'query') queries += 1;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }) as ClickHouseClient,
      { database: iso.database, stageDatabase: iso.stageDatabase },
    );
    expect(await count(() => real.units(files, { isrcs: thousand }))).toBe(1);
    expect(await count(() => real.units(files, { isrcs: [...thousand, ABSENT[5_000] as string] }))).toBe(2);
    expect(text(await real.units(files, { isrcs: [...thousand, ABSENT[5_000] as string] }))).toBe(text(await real.units(files, { isrcs: thousand })));
  }, 300_000);
});

describe.runIf(postgresUp && clickhouseUp)('a book of more than 10 000 ISRCs under its label (D-258, the failure of D-249)', () => {
  const money = (s: Sums) => ({ net: s.net, B: s.B, C: s.C, ours: s.ours, cByReason: s.cByReason });
  const isZero = (s: Sums) => [s.net, s.B, s.C, s.ours].every((x) => x.isZero()) && Object.keys(s.cByReason).length === 0;

  it('`masterRows` without a list and `trackSummary` answer, with the same money', async () => {
    const c = await Case.start();
    await c.person('A');
    const N = 10_500;
    const big = (n: number) => `QZTST29${String(n).padStart(5, '0')}`;
    // three registered tracks (the rest of the book is `unknown_pair`: 10 500 tracks through the facade take minutes)
    for (const n of [0, 1, 2]) await c.track(big(n), `36173830${String(n).padStart(5, '0')}`);
    await c.split(big(0), [['A', '50']]);
    await c.split(big(1), []);
    // every track on its own release (the second read asks every UPC of the units read), one of them with an album line
    await c.load('2026-03', [
      ...Array.from({ length: N }, (_, n) => ({ isrc: big(n), upc: `36173830${String(n).padStart(5, '0')}`, net: `${(n % 9) + 1}.25` })),
      { isrc: '', upc: '3617383000000', net: '4' },
    ]);
    await c.load('2026-03', [{ isrc: big(0), upc: '3617383000000', net: '60', label: 'Echo8' }], '1055956');
    const label = c.f.testLabels['0to8'];
    const old = await c.f.trackSummary({ label });
    const now = await c.f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, label);
    expect(now.rows.length).toBe(N);
    // the rule of `tests/money-rows.test.ts`: the money fields as JSON, the rows without money dropped on both sides
    expect(now.rows.filter((r: MasterRow) => !isZero(r.sums)).map((r) => [r.isrc, JSON.stringify({ ...money(r.sums), months: r.months })])).toEqual(
      old.items.filter((x) => !isZero(x)).map((x) => [x.isrc, JSON.stringify({ ...money(x), months: x.months })]),
    );
    // counted by hand: the first track is 1.25 + the album line 4 of its release, A has 50 %
    expect(JSON.stringify(money((now.rows[0] as MasterRow).sums))).toBe(JSON.stringify({ net: '5.25', B: '2.625', C: '0', ours: '2.625', cByReason: {} }));
    expect(JSON.stringify(money((now.rows[1] as MasterRow).sums))).toBe(JSON.stringify({ net: '2.25', B: '0', C: '0', ours: '2.25', cByReason: {} }));
    expect(JSON.stringify(money((now.rows[2] as MasterRow).sums))).toBe(JSON.stringify({ net: '3.25', B: '0', C: '3.25', ours: '0', cByReason: { no_split: '3.25' } }));
    // «all» has no list at all: the same rows plus the other book
    const all = await c.f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' });
    expect(all.rows.length).toBe(N);
    expect((all.rows[0] as MasterRow).sums.net.toFixed()).toBe('65.25');
    expect(JSON.stringify(money((now.rows[3] as MasterRow).sums))).toBe(JSON.stringify({ net: '4.25', B: '0', C: '4.25', ours: '0', cByReason: { unknown_pair: '4.25' } }));
  }, 600_000);
});
