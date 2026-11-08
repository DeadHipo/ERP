import { describe, expect, it } from 'vitest';
import { payoutSnapshotSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { approvedDoc, writeB17 } from './helpers/fixtures';
import { OWNER_POSITION } from '../src/facade/balance';

// D-181: the position per pseudonym (the owner's rule «ники не сальдируются»): the owner is paid Σ of the positive
// positions of its pseudonyms (and of its own position without a pseudonym); a negative one never offsets a positive
// one. The formula (`payable`) stays the net of every position; `payableShown` is what is paid and what the gate reads.
// A payout of the button records what it took from which position (`allocation`); a payout without one is shared to
// the positive positions, the largest first. Hand-computed, synthetic names.

/** Owner O with pseudonyms P (I(1) 50 %) and N; adjustments under 0to8 (D-205, before: the start of D-174): P +50, N −30; a unit I(1) 100 of 2026-03 → P earns 50. */
async function world() {
  const c = await Case.start();
  const f = c.f;
  const zero = f.testLabels['0to8'];
  await c.person('P');
  await c.second('N', 'P');
  await c.track(I(1));
  await c.split(I(1), [['P', '50']]);
  // an adjustment lowers the position by its amount (D-173): −50 gives P +50, +30 gives N −30
  const owner = c.owners.get('P') as string;
  const basis = await approvedDoc(f, 'adjustment_basis', owner);
  for (const [nick, amount] of [['P', '-50.00'], ['N', '30.00']] as const)
    await f.createOperation({ kind: 'adjustment', direction: 'in', amount, ownerId: owner, artistId: c.id(nick), date: '2026-02-28', documentId: basis.id, comment: 'opening position', labelId: zero });
  await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
  return { c, f, zero, owner: c.owners.get('P') as string };
}

describe('the position per pseudonym (D-181)', () => {
  it('a negative pseudonym does not offset a positive one: payable is the net, payableShown Σ of the positive positions, the gate pays the latter', async () => {
    const { c, f, owner, zero } = await world();
    const b = await f.ownerBalance(owner);
    expect(b.total.adjustments.toFixed()).toBe('20');
    expect(b.total.earned.toFixed()).toBe('50');
    expect(b.total.payable.toFixed()).toBe('70'); // 20 + 50: the formula, the net of the positions
    const p = b.artists.find((a) => a.pseudonym === 'P') as (typeof b.artists)[number];
    const n = b.artists.find((a) => a.pseudonym === 'N') as (typeof b.artists)[number];
    expect(p.position.toFixed()).toBe('100'); // 50 opening + 50 earned
    expect(n.position.toFixed()).toBe('-30');
    expect(n.positionNegative).toBe(true);
    expect(b.total.payableShown.toFixed()).toBe('100'); // only the positive position
    expect(b.total.payableNegative).toBe(true);
    expect(b.total.ownerPosition.toFixed()).toBe('0');
    expect(b.byLabel['0to8']?.payableShown.toFixed()).toBe('100');
    expect(b.byLabel['0to8']?.byArea.master.payableShown.toFixed()).toBe('100');
    expect(b.byLabel['0to8']?.byArea.publishing.payableShown.toFixed()).toBe('0');
    expect(p.byLabel['0to8']?.positionByArea.master.toFixed()).toBe('100');
    await c.verify();
    // the gate: the amount is the shown one, not the net
    const under = await f.ownerBalance(owner, {}, zero);
    expect(under.payout).toMatchObject({ allowed: true, amountCents: 10000 });
    // the payroll: the pseudonym rows carry their position, the total row Σ of the positive ones
    const pr = await f.payroll(zero);
    const rows = pr.rows.filter((r) => r.ownerId === owner);
    expect(rows.find((r) => r.pseudonym === 'P')?.payable?.toFixed()).toBe('100');
    expect(rows.find((r) => r.pseudonym === 'N')?.payable?.toFixed()).toBe('-30');
    expect(rows.find((r) => r.pseudonym === 'N')?.payableShown?.toFixed()).toBe('0');
    const total = rows.find((r) => r.rowKind === 'total') as (typeof rows)[number];
    expect(total.payable?.toFixed()).toBe('70');
    expect(total.payableShown?.toFixed()).toBe('100');
    expect(total.gate).toMatchObject({ allowed: true, amountCents: 10000 });
  });

  it('the button pays the positive positions and records what it took from which one; the negative one stays', async () => {
    const { c, f, owner, zero } = await world();
    const op = await f.createPayout(owner, { labelId: zero });
    expect(op.amountCents).toBe(10000);
    expect(op.allocation).toEqual({ [c.id('P')]: 10000 });
    const snap = payoutSnapshotSchema.parse(JSON.parse(JSON.stringify(await f.operationSnapshot(op.id))));
    expect(snap.allocation).toEqual({ [c.id('P')]: 10000 });
    expect(snap.payoutByArtist).toEqual([{ key: c.id('P'), label: 'P', net: '100', shareOfPayout: '100' }]);
    await f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    const b = await f.ownerBalance(owner);
    expect(b.total.paid.toFixed()).toBe('100');
    expect(b.total.payable.toFixed()).toBe('-30');
    expect(b.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('0');
    expect(b.artists.find((a) => a.pseudonym === 'N')?.position.toFixed()).toBe('-30');
    expect(b.total.payableShown.toFixed()).toBe('0');
    expect((await f.ownerBalance(owner, {}, zero)).payout).toMatchObject({ allowed: false, reason: 'nothing_to_pay' });
    await c.verify();
    // N earns later: its own income lifts its own position first (the minus is not forgiven, only outweighed)
    await c.track(I(2));
    await c.split(I(2), [['N', '50']]);
    await c.load('2026-04', [{ isrc: I(2), net: '80' }]);
    const b2 = await f.ownerBalance(owner);
    expect(b2.artists.find((a) => a.pseudonym === 'N')?.position.toFixed()).toBe('10'); // −30 + 40
    expect(b2.total.payableShown.toFixed()).toBe('10');
    expect(b2.total.payableNegative).toBe(false);
  });

  it('the owner’s own position: publishing and a payout of the area «all» take and give through it; a return goes back to its pseudonym', async () => {
    const { c, f, owner, zero } = await world();
    // the owner is a writer of a B17 line (the publishing of the owner has no pseudonym)
    await f.modules.owners.addOwnerAlias(owner, 'WRITER, P');
    const doc = await approvedDoc(f, 'contract', owner);
    await f.modules.publishing.setTerms({ ownerId: owner, percent: '50', validFrom: '2020-01-01', documentId: doc.id });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'WRITER, P', title: 'W', payable: '40' }]), zero);
    const b = await f.ownerBalance(owner);
    expect(b.total.ownerPosition.toFixed()).toBe('20'); // the author part 40 × 50 %
    expect(b.byLabel['0to8']?.byArea.publishing.ownerPosition.toFixed()).toBe('20');
    expect(b.total.payableShown.toFixed()).toBe('120'); // P 100 + the owner's own 20; N −30 stays out
    expect(b.total.payable.toFixed()).toBe('90');
    await c.verify();
    const op = await f.createPayout(owner, { labelId: zero, area: 'all' });
    expect(op.amountCents).toBe(12000);
    expect(op.allocation).toEqual({ [c.id('P')]: 10000, [OWNER_POSITION]: 2000 });
    await f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    const after = await f.ownerBalance(owner);
    expect(after.total.ownerPosition.toFixed()).toBe('0');
    expect(after.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('0');
    expect(after.total.payableShown.toFixed()).toBe('0');
    // a return of the payout: the money comes back to the positions by the allocation of the payout
    const ret = await f.returnPayout(op.id, { date: '2030-01-05', fileRef: 'dummy://return.pdf', comment: 'bank rejected' });
    expect(ret.kind).toBe('return');
    const back = await f.ownerBalance(owner);
    expect(back.total.returns.toFixed()).toBe('120');
    expect(back.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('100');
    expect(back.total.ownerPosition.toFixed()).toBe('20');
    expect(back.total.payableShown.toFixed()).toBe('120');
    await c.verify();
  });

  it('a payout without an allocation and without a pseudonym is shared to the positive positions, the largest first', async () => {
    const { c, f, owner, zero } = await world();
    // a payout recorded without the button's allocation (the shape of a payout before D-181), with a proof so that it counts
    const op = await f.modules.settlements.recordPayout({ ownerId: owner, amountCents: 3000, date: '2026-04-01', comment: 'old button', labelId: zero, snapshot: {} });
    await f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    const b = await f.ownerBalance(owner);
    expect(b.total.paid.toFixed()).toBe('30');
    expect(b.total.ownerPosition.toFixed()).toBe('0'); // −30 shared away
    expect(b.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('70'); // 100 − 30
    expect(b.artists.find((a) => a.pseudonym === 'N')?.position.toFixed()).toBe('-30');
    expect(b.total.payableShown.toFixed()).toBe('70');
    await c.verify();
    // a second pseudonym with a positive position: the larger takes first, the rest goes to the next
    await c.second('Q', 'P');
    await c.track(I(3));
    await c.split(I(3), [['Q', '50']]);
    await c.load('2026-04', [{ isrc: I(3), net: '40' }]); // Q earns 20
    const op2 = await f.modules.settlements.recordPayout({ ownerId: owner, amountCents: 8500, date: '2026-05-01', comment: 'old button 2', labelId: zero, snapshot: {} });
    await f.attachPaymentProof(op2.id, { fileRef: 'dummy://proof-2.pdf' });
    const b2 = await f.ownerBalance(owner);
    // P 70, Q 20 before; 85 shared: P takes 70, Q 15 → P 0, Q 5
    expect(b2.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('0');
    expect(b2.artists.find((a) => a.pseudonym === 'Q')?.position.toFixed()).toBe('5');
    expect(b2.total.ownerPosition.toFixed()).toBe('0');
    expect(b2.total.payableShown.toFixed()).toBe('5');
    expect(b2.total.payable.toFixed()).toBe('-25'); // 70 + 20 − 85 − 30
    await c.verify();
  });

  it('a migrated payout with a pseudonym reduces that pseudonym only', async () => {
    const { c, f, owner, zero } = await world();
    await f.createOperation({ direction: 'out', amount: '40', ownerId: owner, artistId: c.id('N'), date: '2026-04-01', comment: 'paid to N in the history', migration: true, labelId: zero });
    const b = await f.ownerBalance(owner);
    expect(b.artists.find((a) => a.pseudonym === 'N')?.position.toFixed()).toBe('-70');
    expect(b.artists.find((a) => a.pseudonym === 'P')?.position.toFixed()).toBe('100');
    expect(b.total.payableShown.toFixed()).toBe('100');
    expect(b.total.payable.toFixed()).toBe('30');
    await c.verify();
  });
});
