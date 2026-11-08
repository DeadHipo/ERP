import { describe, expect, it } from 'vitest';
import { cutListSchema, cutSchema, cutStateSchema, ownerCutsSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { approvedDoc } from './helpers/fixtures';
import { labelsViewer } from '../src/facade/viewer';
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
  const p1 = await f.createOperation({ direction: 'out', amount: '30', ownerId: owner, date: '2026-08-20', comment: 'P1', migration: true, labelId: zero });
  const a1 = await f.createOperation({ direction: 'out', amount: '40', artistId: c.id('S1'), date: '2026-08-25', scope: { kind: 'any' }, documentId: basis.id, comment: 'A1', labelId: zero });
  await f.attachPaymentProof(a1.id, { fileRef: 'dummy://a1.pdf' });
  return { c, f, zero, owner, p1 };
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

  it('stage 2: a payout made after the cut and attributed to it settles the position there, and is paid once', async () => {
    const { c, f, zero, owner } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-12-01' }, 'tester');
    const before = (await f.ownerBalance(owner)).total.payable;
    // S2 was owed 20 at C1: a migrated payout of 20 to S2 in November, attributed to C1
    const pay = await f.createOperation({ direction: 'out', amount: '20', ownerId: owner, artistId: c.id('S2'), date: '2026-11-05', comment: 'to C1', migration: true, labelId: zero, cutId: c1.id });
    expect(pay.cutId).toBe(c1.id);
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80' }); // S2 settled
    expect(balances(await f.cutState(c2.id, { all: true }))).toEqual({ S1: '110', S2: '5', '': '0' }); // 20 + 5 − 20
    expect((await f.ownerBalance(owner)).total.payable.toFixed()).toBe(before.minus(20).toFixed()); // once
    // a cut of another label is refused; a cut with an attributed operation is not deleted
    await expect(
      f.createOperation({ direction: 'out', amount: '1', ownerId: owner, date: '2026-11-05', comment: 'x', migration: true, labelId: f.testLabels.Echo8, cutId: c1.id }),
    ).rejects.toMatchObject({ code: 'cut_label_mismatch' });
    await expect(f.deleteCut(c1.id)).rejects.toMatchObject({ code: 'cut_in_use' });
    // taken back: by its date again (after both cuts)
    await f.setOperationCut(pay.id, null);
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80', S2: '20' });
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '110', S2: '5' });
  });

  it('stage 2: an operation of the history attributed to a later cut leaves the earlier one', async () => {
    const { f, zero, p1 } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-10-10' }, 'tester');
    await f.setOperationCut(p1.id, c2.id);
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '110', S2: '20' }); // P1 30 no longer in C1
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '110', S2: '25' });
    await expect(f.setOperationCut(p1.id, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('stage 2: a transfer moves a balance past the cut as a pair; deactivating one deactivates both', async () => {
    const { c, f, zero, owner } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-12-01' }, 'tester');
    const before = (await f.ownerBalance(owner)).total.payable;
    const basis = await approvedDoc(f, 'adjustment_basis', owner);
    await expect(f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S1'), amount: '0', documentId: basis.id })).rejects.toMatchObject({ code: 'transfer_zero' });
    const t = await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S1'), amount: '80', documentId: basis.id });
    expect([t.atCut.date, t.after.date]).toEqual(['2026-09-11', '2026-09-11']); // the day after the cut
    expect([t.atCut.kind, t.atCut.amountCents, t.atCut.cutId, t.after.amountCents, t.after.cutId]).toEqual(['adjustment', 8000, c1.id, -8000, null]);
    expect(t.atCut.externalRef).toBe(t.after.externalRef);
    expect(balances(await f.cutState(c1.id))).toEqual({ S2: '20' }); // S1 settled at C1
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '110', S2: '25' }); // both rows inside C2: nothing changed there
    expect((await f.ownerBalance(owner)).total.payable.toFixed()).toBe(before.toFixed()); // + 80 − 80
    // the date of a cut with attributed operations stays; a row of a transfer keeps its label
    await expect(f.updateCut(c1.id, { cutDate: '2026-09-20' })).rejects.toMatchObject({ code: 'cut_in_use' });
    expect((await f.updateCut(c1.id, { name: 'C1 renamed' })).name).toBe('C1 renamed');
    await expect(f.setOperationLabel(t.after.id, f.testLabels.Echo8, 'x')).rejects.toMatchObject({ code: 'cut_transfer_pair' });
    // a row of a transfer keeps its cut
    await expect(f.setOperationCut(t.atCut.id, null)).rejects.toMatchObject({ code: 'cut_transfer_pair' });
    await expect(f.setOperationCut(t.after.id, c2.id)).rejects.toMatchObject({ code: 'cut_transfer_pair' });
    await f.deactivateOperation(t.after.id, 'mistake');
    const ops = await f.modules.settlements.listOperations({ ownerId: owner });
    expect(ops.filter((o) => o.externalRef === t.atCut.externalRef).map((o) => o.active)).toEqual([false, false]);
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80', S2: '20' });
  });

  it('stage 2: a cut between the cut and the transfer holds both rows; a label change takes the operation out of its cut', async () => {
    const { c, f, zero, owner, p1 } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-09-11', masterTo: '2026-09-01' }, 'tester');
    const basis = await approvedDoc(f, 'adjustment_basis', owner);
    await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S2'), amount: '20', documentId: basis.id });
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80' });
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '80', S2: '20' }); // + 20 − 20: as without the transfer
    await f.setOperationCut(p1.id, c1.id);
    await f.setOperationLabel(p1.id, f.testLabels.Echo8, 'moved');
    expect((await f.modules.settlements.getOperation(p1.id)).cutId).toBeNull();
  });

  it('stage 2: a negative position (the owner owes) is carried past the cut as a debt', async () => {
    const { c, f, zero, owner } = await world();
    const adj = await approvedDoc(f, 'adjustment_basis', owner);
    // an adjustment of 100 against S2 on 2026-09-01: S2 20 − 100 = −80 at C1; S1 110 − P1 30 = 80
    await f.createOperation({ kind: 'adjustment', direction: 'in', amount: '100', ownerId: owner, artistId: c.id('S2'), date: '2026-09-01', documentId: adj.id, comment: 'debt', labelId: zero });
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-10-10' }, 'tester');
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80', S2: '-80' });
    const before = (await f.ownerBalance(owner)).total.payable;
    await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S2'), amount: '-80', documentId: adj.id });
    expect(balances(await f.cutState(c1.id))).toEqual({ S1: '80' }); // S2 settled at the cut
    expect(balances(await f.cutState(c2.id))).toEqual({ S1: '110', S2: '-75' }); // the debt lives on: 25 − 100
    expect((await f.ownerBalance(owner)).total.payable.toFixed()).toBe(before.toFixed());
  });

  it('stage 3: the signal lists the cuts with a position not at zero; nothing without cuts', async () => {
    const { c, f, zero, owner } = await world();
    expect((await f.signals({}, zero)).cutsUnsettled).toEqual([]);
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const sg = await f.signals({}, zero);
    expect(sg.cutsUnsettled).toEqual([{ cutId: c1.id, labelId: zero, name: 'C1', cutDate: '2026-09-10', unsettled: 2 }]);
    expect(sg.counts.cutsUnsettled).toBe(1);
    expect((await f.signals({}, f.testLabels.Echo8)).cutsUnsettled).toEqual([]); // another label's cuts are not its
    expect((await f.overview()).signals.find((x) => x.name === 'cutsUnsettled')?.count).toBe(1);
    // S1 80 and S2 20 carried past the cut: settled, the signal is gone
    const adj = await approvedDoc(f, 'adjustment_basis', owner);
    await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S1'), amount: '80', documentId: adj.id });
    await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S2'), amount: '20', documentId: adj.id });
    expect((await f.signals({}, zero)).cutsUnsettled).toEqual([]);
  });

  it("stage 3: the owner's cuts: positions, the operations of the cut and the movement between the states", async () => {
    const { c, f, zero, owner } = await world();
    const c1 = await f.createCut({ labelId: zero, name: 'C1', cutDate: '2026-09-10' }, 'tester');
    const c2 = await f.createCut({ labelId: zero, name: 'C2', cutDate: '2026-10-10' }, 'tester');
    const adj = await approvedDoc(f, 'adjustment_basis', owner);
    const t = await f.transferAtCut(c1.id, { ownerId: owner, artistId: c.id('S2'), amount: '20', documentId: adj.id });
    const r = await f.ownerCuts(owner);
    expect(ownerCutsSchema.safeParse(json(r)).success).toBe(true);
    expect(r.labels.map((l) => l.labelId)).toEqual([zero]);
    const [s1, s2] = r.labels[0]?.cuts ?? [];
    const pos = (ps: { pseudonym: string | null; balance: { toFixed(): string } }[]) => Object.fromEntries(ps.map((p) => [p.pseudonym ?? '', p.balance.toFixed()]));
    const mv = (m: Record<string, { toFixed(): string }> | undefined) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, v.toFixed()]));
    expect([s1?.cut.id, s2?.cut.id]).toEqual([c1.id, c2.id]);
    expect(pos(s1?.positions ?? [])).toEqual({ S1: '80', S2: '0', '': '0' });
    expect([s1?.unsettled, s1?.operations.map((o) => o.id)]).toEqual([1, [t.atCut.id]]);
    // to C1: earned 150 + 20, A1 recoups 40, P1 paid 30, the transfer row −20 → payable 80 (the rest −40 −20)
    expect(mv(s1?.movement)).toEqual({ earned: '170', paid: '30', adsCharged: '0', payable: '80', other: '-60' });
    // C1 → C2: September 30 + 5 earned, the give-back row + 20
    expect(mv(s2?.movement)).toEqual({ earned: '35', paid: '0', adsCharged: '0', payable: '55', other: '20' });
    expect(pos(s2?.positions ?? [])).toEqual({ S1: '110', S2: '25', '': '0' });
    expect(mv(r.labels[0]?.after.movement)).toEqual({ earned: '0', paid: '0', adsCharged: '0', payable: '0', other: '0' });
    // a label with a cut but nothing of the owner in it: no section
    await f.createCut({ labelId: f.testLabels.Echo8, name: 'E1', cutDate: '2026-09-10' }, 'tester');
    expect((await f.ownerCuts(owner)).labels.map((l) => l.labelId)).toEqual([zero]);
    expect((await f.ownerCuts(owner, f.testLabels.Echo8)).labels).toEqual([]);
    // a viewer of Echo8 alone does not see this owner (404, as the owner card)
    await expect(f.ownerCuts(owner, f.testLabels.Echo8, labelsViewer([f.testLabels.Echo8]))).rejects.toMatchObject({ statusCode: 404 });
  });
});
