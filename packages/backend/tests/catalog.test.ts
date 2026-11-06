import { describe, expect, it } from 'vitest';
import { ACC1, ACC2, Case, I } from './helpers/golden-case';
import { calculate } from '../src/facade/calculation';
import { cutByOperator, deriveIsrc, type Observation } from '../src/facade/catalog';
import { labelsViewer } from '../src/facade/viewer';

// The label history of an ISRC (D-172, plan «этап4_онбординг.md» §1.5, §3, §6): navigation, never money. Synthetic
// data only.

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));

// ---------------------------------------------------------------- the derivation rules (pure)

const A = 'label-a';
const B = 'label-b';
const C = 'label-c';
const obs = (labelId: string, months: string[], loadedAt = '2026-01-01T00:00:00Z'): Observation[] =>
  months.map((month) => ({ month, labelId, loadedAt }));
const starts = (entries: [string, string][]) => new Map(entries);

describe('deriveIsrc: the runs by month (FIX-1)', () => {
  it('a move in month M with a tail on the old account: two intervals from M, the tail counted once', () => {
    const d = deriveIsrc([...obs(A, ['2025-05', '2025-06', '2025-07', '2025-09']), ...obs(B, ['2025-08', '2025-09'])], starts([[A, '2024-01'], [B, '2025-08']]));
    expect(d.intervals).toEqual([
      { labelId: A, validFrom: '2025-05-01', validTo: '2025-08-01' },
      { labelId: B, validFrom: '2025-08-01', validTo: null },
    ]);
    expect(d.tails).toEqual([{ month: '2025-09', labelId: A }]);
    expect([d.returned, d.ties]).toEqual([0, 0]);
  });

  it('a late first sale on the new account: the boundary is clamped to the start of the new account', () => {
    // last on A 2025-06, the account of B starts 2025-08, the first sale on B is 2025-11
    const d = deriveIsrc([...obs(A, ['2025-05', '2025-06']), ...obs(B, ['2025-11'])], starts([[A, '2024-01'], [B, '2025-08']]));
    expect(d.intervals.map((i) => [i.labelId, i.validFrom, i.validTo])).toEqual([
      [A, '2025-05-01', '2025-08-01'],
      [B, '2025-08-01', null],
    ]);
    expect(d.boundaries).toEqual([{ fromLabelId: A, toLabelId: B, firstMonth: '2025-11', boundary: '2025-08' }]);
  });

  it('months without observations between last_A and start_B: the boundary is start_B; last_A + 1 when B started earlier', () => {
    const gap = deriveIsrc([...obs(A, ['2025-01']), ...obs(B, ['2025-06'])], starts([[A, '2024-01'], [B, '2025-04']]));
    expect(gap.intervals[1]?.validFrom).toBe('2025-04-01');
    const early = deriveIsrc([...obs(A, ['2025-01', '2025-03']), ...obs(B, ['2025-06'])], starts([[A, '2024-01'], [B, '2024-06']]));
    expect(early.intervals[1]?.validFrom).toBe('2025-04-01');
  });

  it('two new labels in one month: the later loaded file wins, then the smaller label id (ties)', () => {
    const later = deriveIsrc([...obs(B, ['2025-03'], '2026-01-01T00:00:00Z'), ...obs(C, ['2025-03'], '2026-02-01T00:00:00Z')], starts([]));
    expect(later.intervals.map((i) => i.labelId)).toEqual([C]);
    expect(later.ties).toBe(1);
    expect(later.tails).toEqual([{ month: '2025-03', labelId: B }]);
    const same = deriveIsrc([...obs(C, ['2025-03']), ...obs(B, ['2025-03'])], starts([]));
    expect(same.intervals.map((i) => i.labelId)).toEqual([B]);
  });

  it('A → B → A without B after the return: three intervals', () => {
    const d = deriveIsrc([...obs(A, ['2025-01', '2025-02', '2025-06']), ...obs(B, ['2025-03', '2025-04'])], starts([[A, '2024-01'], [B, '2025-03']]));
    expect(d.intervals.map((i) => [i.labelId, i.validFrom, i.validTo])).toEqual([
      [A, '2025-01-01', '2025-03-01'],
      [B, '2025-03-01', '2025-05-01'],
      [A, '2025-05-01', null],
    ]);
    expect(d.returned).toBe(1);
    expect(d.tails).toEqual([]);
  });

  it('the operator months are cut out: shortened or split, never moved', () => {
    const derived = [
      { labelId: A, validFrom: '2025-01-01', validTo: '2025-08-01' },
      { labelId: B, validFrom: '2025-08-01', validTo: null },
    ];
    expect(cutByOperator(derived, [{ validFrom: '2025-03-01', validTo: '2025-05-01' }])).toEqual([
      { labelId: A, validFrom: '2025-01-01', validTo: '2025-03-01' },
      { labelId: A, validFrom: '2025-05-01', validTo: '2025-08-01' },
      { labelId: B, validFrom: '2025-08-01', validTo: null },
    ]);
    expect(cutByOperator(derived, [{ validFrom: '2025-06-01', validTo: null }])).toEqual([
      { labelId: A, validFrom: '2025-01-01', validTo: '2025-06-01' },
    ]);
  });
});

// ---------------------------------------------------------------- the stack

/**
 * 0to8 = account 1 (files 2026-01, -02, -03, -05), Echo8 = account 2 (files 2026-03, -04, -05).
 * I(1): 0to8 in 01, 02; Echo8 in 03, 04, 05; a tail on 0to8 in 05. I(2): 0to8 in 01; the first sale on Echo8 in 05
 * (the account starts in 03: the boundary is 03). I(3): 0to8 only.
 */
async function world() {
  const c = await Case.start();
  const f = c.f;
  await c.person('PA');
  for (const n of [1, 2, 3]) await c.track(I(n));
  await c.split(I(1), [['PA', '50']]);
  await c.load('2026-01', [{ isrc: I(1), net: '10' }, { isrc: I(2), net: '7' }, { isrc: I(3), net: '1' }]);
  await c.load('2026-02', [{ isrc: I(1), net: '10' }, { isrc: I(3), net: '1' }]);
  await c.load('2026-03', [{ isrc: I(3), net: '1' }]);
  await c.load('2026-05', [{ isrc: I(1), net: '2' }]);
  await c.load('2026-03', [{ isrc: I(1), net: '20', label: 'Echo8' }], ACC2);
  await c.load('2026-04', [{ isrc: I(1), net: '20', label: 'Echo8' }], ACC2);
  await c.load('2026-05', [{ isrc: I(1), net: '20', label: 'Echo8' }, { isrc: I(2), net: '5', label: 'Echo8' }], ACC2);
  return { c, f, zero: f.testLabels['0to8'], echo: f.testLabels.Echo8 };
}

type World = Awaited<ReturnType<typeof world>>;
const money = async ({ f }: World) => {
  // the overview without `signals` and `calculatedAt` (FIX-7): the signals change on purpose
  const overview = JSON.stringify(await f.overview(), (k, v: unknown) => (k === 'signals' || k === 'calculatedAt' ? undefined : v));
  return text({ calc: await calculate({ ...f.modules, db: f.db }), overview });
};
const intervals = async ({ f }: World, isrc: string) =>
  (await f.trackLabels(isrc)).map((r) => [r.labelName, r.validFrom, r.validTo, r.source]);

describe('the label history on the stack (D-172)', () => {
  it('money never changes: calculate() and the overview without signals are byte for byte the same after every edit', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    const before = await money(w);
    const s0 = await f.signals();
    expect(s0.catalogOutsideAccount).toEqual([]);
    expect(s0.tracksWithoutLabel.map((t) => t.isrc)).toEqual([I(1), I(2), I(3)]);

    await f.deriveTrackLabels({ apply: true });
    expect(await money(w)).toBe(before);
    await f.setTrackLabel(I(3), { labelId: echo, from: '2026-02-15' });
    expect(await money(w)).toBe(before);
    await f.setTrackLabel(I(3), { labelId: zero, from: '2026-02-01', to: '2026-03-01' });
    expect(await money(w)).toBe(before);

    // the signals change as expected: the tail of I(1) on account 1 in 2026-05; the operator gave I(3) back to files
    const s1 = await f.signals();
    expect(s1.catalogOutsideAccount.map((x) => ({ ...x, net: x.net.toFixed() }))).toEqual([
      { isrc: I(1), account: ACC1, bookLabelId: zero, catalogLabelId: echo, firstMonth: '2026-05', lastMonth: '2026-05', units: 1, net: '2' },
    ]);
    expect(s1.tracksWithoutLabel).toEqual([]);
    const counts = new Map((await f.overview()).signals.map((x) => [x.name, x.count]));
    expect([counts.get('catalogOutsideAccount'), counts.get('tracksWithoutLabel')]).toEqual([1, 0]);
  });

  it('derives the runs from the loaded files; a second run changes nothing', async () => {
    const w = await world();
    const { f } = w;
    const dry = await f.deriveTrackLabels();
    expect(dry).toMatchObject({ isrcs: 3, intervals: { one: 1, two: 2, threeOrMore: 0 }, tails: { isrcs: 1, observations: 1 }, inserted: 5, deleted: 0, applied: false });
    expect(await f.trackLabels(I(1))).toEqual([]);
    expect(dry.boundaries.map((b) => [b.firstMonth, b.boundary, b.isrcs])).toEqual([
      ['2026-03', '2026-03', 1],
      ['2026-05', '2026-03', 1],
    ]);
    await f.deriveTrackLabels({ apply: true });
    expect(await intervals(w, I(1))).toEqual([
      ['0to8', '2026-01-01', '2026-03-01', 'files'],
      ['Echo8', '2026-03-01', null, 'files'],
    ]);
    expect(await intervals(w, I(2))).toEqual([
      ['0to8', '2026-01-01', '2026-03-01', 'files'],
      ['Echo8', '2026-03-01', null, 'files'],
    ]);
    expect(await intervals(w, I(3))).toEqual([['0to8', '2026-01-01', null, 'files']]);
    expect(await f.deriveTrackLabels({ apply: true })).toMatchObject({ changedIsrcs: 0, unchangedIsrcs: 3, inserted: 0, deleted: 0 });
  });

  it('an operator interval wins only its months: it cuts the derived one, the files keep the rest; replace, close, shrink', async () => {
    const w = await world();
    const { f, echo, zero } = w;
    await f.deriveTrackLabels({ apply: true });
    // in the middle of the 0to8 run of I(3): the derived interval is split in two (M52: the 15th floors to the 1st)
    await f.setTrackLabel(I(3), { labelId: echo, from: '2026-02-15', to: '2026-03-20', note: 'synthetic' });
    expect(await intervals(w, I(3))).toEqual([
      ['0to8', '2026-01-01', '2026-02-01', 'files'],
      ['Echo8', '2026-02-01', '2026-03-01', 'operator'],
      ['0to8', '2026-03-01', null, 'files'],
    ]);
    // a derivation does not touch it, the other months stay derived
    expect(await f.deriveTrackLabels({ apply: true })).toMatchObject({ changedIsrcs: 0, withOperator: 1 });
    // the same from replaces it: another label from its first month, open
    await f.setTrackLabel(I(3), { labelId: zero, from: '2026-02-01' });
    expect(await intervals(w, I(3))).toEqual([
      ['0to8', '2026-01-01', '2026-02-01', 'files'],
      ['0to8', '2026-02-01', null, 'operator'],
    ]);
    // closed through `to`: the months after it go back to the files
    const closed = await f.setTrackLabel(I(3), { labelId: zero, from: '2026-02-01', to: '2026-03-01' });
    expect(closed.map((r) => [r.labelName, r.validFrom, r.validTo, r.source])).toEqual([
      ['0to8', '2026-01-01', '2026-02-01', 'files'],
      ['0to8', '2026-02-01', '2026-03-01', 'operator'],
      ['0to8', '2026-03-01', null, 'files'],
    ]);
    expect(closed.find((r) => r.source === 'operator')?.note).toBe('synthetic');
  });

  it('refusals: catalog_same_label, catalog_overlap with details.interval, empty_period, not an own label', async () => {
    const w = await world();
    const { f, echo, zero } = w;
    await f.setTrackLabel(I(2), { labelId: echo, from: '2026-02-01', to: '2026-04-01' });
    await expect(f.setTrackLabel(I(2), { labelId: echo, from: '2026-02-10', to: '2026-04-01' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'catalog_same_label',
    });
    await expect(f.setTrackLabel(I(2), { labelId: zero, from: '2026-03-01' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'catalog_overlap',
      details: { interval: { labelId: echo, validFrom: '2026-02-01', validTo: '2026-04-01' } },
    });
    await expect(f.setTrackLabel(I(2), { labelId: zero, from: '2026-05-10', to: '2026-05-31' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'empty_period',
    });
    const sub = await f.modules.labels.createLabel({ name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: zero });
    await expect(f.setTrackLabel(I(2), { labelId: sub.id, from: '2026-05-01' })).rejects.toMatchObject({ code: 'label_not_own' });
    await expect(f.setTrackLabel(I(2), { labelId: 'no-such-label', from: '2026-05-01' })).rejects.toMatchObject({ statusCode: 404 });
    // nothing was left by the refusals
    expect((await f.trackLabels(I(2))).map((r) => r.source)).toEqual(['files', 'operator', 'files']);
  });

  it('a viewer of a label sets only its label and touches only intervals of its labels', async () => {
    const w = await world();
    const { f, echo, zero } = w;
    await f.deriveTrackLabels({ apply: true });
    const vEcho = labelsViewer([echo]);
    // another label
    await expect(f.setTrackLabel(I(1), { labelId: zero, from: '2026-06-01' }, vEcho)).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    // months of a 0to8 interval
    await expect(f.setTrackLabel(I(1), { labelId: echo, from: '2026-01-01', to: '2026-03-01' }, vEcho)).rejects.toMatchObject({ code: 'label_forbidden' });
    // months of its own interval pass
    const ok = await f.setTrackLabel(I(1), { labelId: echo, from: '2026-04-01', to: '2026-05-01' }, vEcho);
    expect(ok.filter((r) => r.source === 'operator').map((r) => r.validFrom)).toEqual(['2026-04-01']);
  });

  it('the catalog under a label: the files of the label and the ISRCs of its open interval; catalog=current only the latter', async () => {
    const w = await world();
    const { f, echo } = w;
    await f.deriveTrackLabels({ apply: true });
    const all = await f.trackCatalog({ label: echo });
    expect(all.items.map((i) => [i.isrc, i.catalogLabelName, i.catalogFrom])).toEqual([
      [I(1), 'Echo8', '2026-03-01'],
      [I(2), 'Echo8', '2026-03-01'],
    ]);
    // I(3) moves to Echo8 by the operator: in the catalog of Echo8 although no Echo8 file has it
    await f.setTrackLabel(I(3), { labelId: echo, from: '2026-04-01' });
    expect((await f.trackCatalog({ label: echo })).items.map((i) => i.isrc)).toEqual([I(1), I(2), I(3)]);
    expect((await f.trackCatalog({ label: f.testLabels['0to8'], catalog: 'current' })).items.map((i) => i.isrc)).toEqual([]);
    expect((await f.trackCatalog({ label: echo, catalog: 'current' })).items.map((i) => i.isrc)).toEqual([I(1), I(2), I(3)]);
    expect((await f.trackCatalog()).items.find((i) => i.isrc === I(3))).toMatchObject({ catalogLabelId: echo, catalogFrom: '2026-04-01' });
  });
});
