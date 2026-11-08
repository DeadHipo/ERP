import { describe, expect, it } from 'vitest';
import { cutListSchema, cutSchema, cutStateSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { approvedDoc } from './helpers/fixtures';
import { cutOperationsBy, type CutBounds } from '../src/facade/as-of';

// The cuts (D-198): the state of a label's book at a moment, cumulative, per position (D-181). A cut is a view of the
// very balance cut by its bounds; it changes neither `calculate()` nor the total payable. Synthetic names only; every
// expected number is hand-computed.

/**
 * One owner O with two pseudonyms S1 (I(1) 50 %) and S2 (I(2) 50 %), book 0to8. Files: 2026-07 (I1 100, I2 40 → S1
 * 50, S2 20), 2026-08 (I1 200 → S1 100), 2026-09 (I1 60, I2 10 → S1 30, S2 5). Operations: a migrated payout 30 of
 * 2026-08-20 without a pseudonym (P1, shared to the largest positive position), an advance 40 to S1 of 2026-08-25 (A1,
 * recouped from S1's income).
 */
async function world() {
  const c = await Case.start();
  const f = c.f;
  const zero = f.testLabels['0to8'];
  await c.person('S1');
  await c.second('S2', 'S1');
  await c.track(I(1));
  await c.track(I(2));
  await c.split(I(1), [['S1', '50']]);
  await c.split(I(2), [['S2', '50']]);
  await c.load('2026-07', [{ isrc: I(1), net: '100' }, { isrc: I(2), net: '40' }]);
  await c.load('2026-08', [{ isrc: I(1), net: '200' }]);
  await c.load('2026-09', [{ isrc: I(1), net: '60' }, { isrc: I(2), net: '10' }]);
  const owner = c.owners.get('S1') as string;
  const basis = await approvedDoc(f, 'advance_basis', owner);
  await f.createOperation({ direction: 'out', amount: '30', ownerId: owner, date: '2026-08-20', comment: 'P1', migration: true, labelId: zero });
  const a1 = await f.createOperation({ direction: 'out', amount: '40', artistId: c.id('S1'), date: '2026-08-25', scope: { kind: 'any' }, documentId: basis.id, comment: 'A1', labelId: zero });
  await f.attachPaymentProof(a1.id, { fileRef: 'dummy://a1.pdf' });
  return { c, f, zero, owner };
}

const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
const balances = (s: { items: { pseudonym: string | null; balance: { toFixed(): string } }[] }) =>
  Object.fromEntries(s.items.map((i) => [i.pseudonym ?? '', i.balance.toFixed()]));

describe('the cuts (D-198): a label book at a moment', () => {
  it('the bounds default to the month of the date; the state per position is the balance of the book as of the cut', async () => {
    const { c, f, zero, owner } = await world();
    const before = await f.ownerBalance(owner);
    const c1 = await f.createCut({ labelId: zero, name: 'До сентября', cutDate: '2026-09-10' }, 'tester');
    expect(cutSchema.safeParse(json(c1)).success).toBe(true);
    expect([c1.masterTo, c1.publishingTo, c1.adsTo, c1.createdBy]).toEqual(['2026-09-01', '2026-09-01', '2026-09-01', 'tester']);

    const s1 = await f.cutState(c1.id);
    expect(cutStateSchema.safeParse(json(s1)).success).toBe(true);
    // 07 + 08: S1 50 + 100 − A1 40 = 110, less P1 30 (the largest positive position) = 80; S2 20
    expect(balances(s1)).toEqual({ S1: '80', S2: '20' });
    expect([s1.total.toFixed(), s1.unsettled]).toEqual(['100', 2]);
    // the same number as the balance asOf the last month inside (no operation between 08-31 and 09-10)
    const asOf = (await f.ownerPayables({ label: zero, asOf: '2026-08' })).items.find((i) => i.ownerId === owner);
    expect(asOf?.payable.toFixed()).toBe('100');

    // a later cut: September inside, S1 + 30, S2 + 5
    const c2 = await f.createCut({ labelId: zero, name: 'До октября', cutDate: '2026-10-10' }, 'tester');
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '110', S2: '25' });
    // a custom Believe bound: September outside again
    await f.updateCut(c2.id, { masterTo: '2026-09-17' });
    expect((await f.getCut(c2.id)).masterTo).toBe('2026-09-01'); // floored to the first day
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '80', S2: '20' });

    // a cut is a view: the balance of now is unchanged
    const after = await f.ownerBalance(owner);
    expect(after.total.payable.toFixed()).toBe(before.total.payable.toFixed());
    expect(cutListSchema.safeParse(json({ items: await f.listCuts(zero) })).success).toBe(true);
    expect((await f.listCuts(zero)).map((x) => x.name)).toEqual(['До сентября', 'До октября']);
    void c;
  });

  it('the cuts of a label are cumulative; names are unique; a cut without operations is deleted', async () => {
    const { f, zero } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'A', cutDate: '2026-09-10' }, 'tester');
    await expect(f.createCut({ labelId: zero, name: 'A', cutDate: '2026-10-10' }, 'tester')).rejects.toMatchObject({ code: 'cut_name_taken' });
    await expect(f.createCut({ labelId: zero, name: 'B', cutDate: '2026-09-10' }, 'tester')).rejects.toMatchObject({ code: 'cut_order' });
    // a later cut with an earlier Believe bound
    await expect(f.createCut({ labelId: zero, name: 'B', cutDate: '2026-10-10', masterTo: '2026-08-01' }, 'tester')).rejects.toMatchObject({ code: 'cut_order' });
    const c2 = await f.createCut({ labelId: zero, name: 'B', cutDate: '2026-10-10' }, 'tester');
    await expect(f.updateCut(c1.id, { masterTo: '2026-11-01' })).rejects.toMatchObject({ code: 'cut_order' });
    await expect(f.updateCut(c2.id, { name: 'A' })).rejects.toMatchObject({ code: 'cut_name_taken' });
    expect((await f.updateCut(c2.id, { name: 'B2', comment: ' итог ' })).comment).toBe('итог');
    await expect(f.createCut({ labelId: 'nope', name: 'X', cutDate: '2026-10-10' }, 'tester')).rejects.toMatchObject({ statusCode: 404 });
    expect((await f.deleteCut(c1.id)).id).toBe(c1.id);
    await expect(f.getCut(c1.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await f.listCuts(zero)).map((x) => x.name)).toEqual(['B2']);
  });

  it('an operation attributed to a cut is inside it and every later cut, whatever its date', () => {
    const dates: Record<string, string> = { c1: '2026-09-10', c2: '2026-10-10' };
    const bounds = (date: string): CutBounds => ({ masterTo: '2026-09-01', publishingTo: '2026-09-01', adsTo: '2026-09-01', date, cutDateOf: (id) => dates[id] });
    const ops = [
      { id: 'plain-before', date: '2026-09-01', cutId: null },
      { id: 'plain-after', date: '2026-11-05', cutId: null },
      { id: 'to-c1', date: '2026-11-05', cutId: 'c1' },
      { id: 'to-c2', date: '2026-08-01', cutId: 'c2' },
    ];
    expect(cutOperationsBy(ops, bounds('2026-09-10')).map((o) => o.id)).toEqual(['plain-before', 'to-c1']);
    expect(cutOperationsBy(ops, bounds('2026-10-10')).map((o) => o.id)).toEqual(['plain-before', 'to-c1', 'to-c2']);
  });
});
