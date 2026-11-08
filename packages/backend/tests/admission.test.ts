import { describe, expect, it } from 'vitest';
import { admissionListSchema, balanceSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { approvedDoc, confirmedOwner, newFacade } from './helpers/fixtures';
import { labelsViewer } from '../src/facade/viewer';
import { payoutGate } from '../src/facade/payout-gate';

// The admission to the payout (D-176, the owner's module 17): the payee and the channel, the holds, the answers «pay»
// to the first payout, the threshold of the contract; the gate in the order contract → start → nothing to pay →
// threshold → hold → payout without a proof → no payee → needs an answer → ready. The checks «no payee» and «needs an
// answer» act once the organization has entered its first payee row. Synthetic names only.

/** A: a split of 50 % on I(1), 100 of 2026-03 → payable 50; B: another confirmed owner, no income. */
async function world(threshold = 0) {
  const c = await Case.start();
  c.f = await newFacade(threshold);
  const { approvedAppendix } = await import('./helpers/fixtures');
  c.appendix = (await approvedAppendix(c.f)).id;
  await c.person('A', 'B');
  await c.track(I(1));
  await c.split(I(1), [['A', '50']]);
  await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
  const f = c.f;
  const zero = f.testLabels['0to8'];
  const echo = f.testLabels.Echo8;
  const a = c.owners.get('A') as string;
  const b = c.owners.get('B') as string;
  return { c, f, zero, echo, a, b };
}

describe('the admission (D-176): the gate', () => {
  it('the pure gate: the order of the checks, the contract threshold, the answer for the exact amount', () => {
    const base = { confirmed: true, confirmedAny: true, blocking: [] as string[], payableCents: 5000, thresholdCents: 1000 };
    const adm = { active: true, thresholdCents: null, hasPayee: true, held: false, hadPayout: true, answeredCents: [] as number[] };
    expect(payoutGate(base)).toEqual({ allowed: true, reason: null, amountCents: 5000 });
    expect(payoutGate({ ...base, admission: adm })).toEqual({ allowed: true, reason: null, amountCents: 5000 });
    expect(payoutGate({ ...base, admission: { ...adm, thresholdCents: 6000 } }).reason).toBe('below_threshold');
    expect(payoutGate({ ...base, admission: { ...adm, held: true, hasPayee: false }, blocking: ['x'] }).reason).toBe('hold');
    expect(payoutGate({ ...base, admission: { ...adm, hasPayee: false }, blocking: ['x'] }).reason).toBe('payout_blocked');
    expect(payoutGate({ ...base, admission: { ...adm, hasPayee: false } }).reason).toBe('no_payee');
    expect(payoutGate({ ...base, admission: { ...adm, hadPayout: false } }).reason).toBe('needs_answer');
    expect(payoutGate({ ...base, admission: { ...adm, hadPayout: false, answeredCents: [4999] } }).reason).toBe('needs_answer');
    expect(payoutGate({ ...base, admission: { ...adm, hadPayout: false, answeredCents: [5000] } }).allowed).toBe(true);
    // an inactive admission (no payee row in the organization) keeps the old checks only
    expect(payoutGate({ ...base, admission: { ...adm, active: false, hasPayee: false, hadPayout: false } }).allowed).toBe(true);
    expect(payoutGate({ ...base, payableCents: 0, admission: { ...adm, held: true } }).reason).toBe('nothing_to_pay');
    expect(payoutGate({ ...base, confirmed: false, admission: { ...adm, held: true } }).reason).toBe('no_contract_for_label');
  });

  it('without a payee row the world pays as before; the first payee turns no_payee and needs_answer on; an answer for the amount lets the first payout through', async () => {
    const { f, zero, a, b } = await world();
    expect((await f.ownerBalance(a, {}, zero)).payout).toEqual({ allowed: true, reason: null, amountCents: 5000 });
    expect((await f.ownerBalance(a, {}, zero)).admission).toMatchObject({ active: false, payee: null, holds: [], answers: [], hadPayout: false, thresholdCents: null });
    // the first payee of the organization (of B): A has none now
    const pb = await f.setPayee({ ownerId: b, channel: 'easystaff', basis: 'test', validFrom: '2026-01-01' });
    expect([pb.channel, pb.active, pb.payeeRef]).toEqual(['easystaff', true, null]);
    expect((await f.ownerBalance(a, {}, zero)).payout).toEqual({ allowed: false, reason: 'no_payee', amountCents: 5000 });
    await expect(f.createPayout(a, { labelId: zero })).rejects.toMatchObject({ code: 'no_payee' });
    const pa = await f.setPayee({ ownerId: a, channel: 'tipalti', payeeRef: '103', basis: 'the owner\'s decision', validFrom: '2026-10-18', source: 'test:1' });
    expect((await f.ownerBalance(a, {}, zero)).payout).toEqual({ allowed: false, reason: 'needs_answer', amountCents: 5000 });
    await expect(f.createPayout(a, { labelId: zero })).rejects.toMatchObject({ code: 'needs_answer', details: { amountCents: 5000 } });
    // an answer for another amount does not count; for the exact amount it does
    await f.createAnswer({ ownerId: a, due: '49.99', decision: 'pay', why: 'wrong amount', about: 'first payout', answeredBy: 'tester' });
    expect((await f.ownerBalance(a, {}, zero)).payout.reason).toBe('needs_answer');
    const ans = await f.createAnswer({ ownerId: a, labelId: zero, due: '50', decision: 'pay', why: 'the history is regular', about: 'first payout', answeredBy: 'tester' });
    expect([ans.dueCents, ans.labelId, ans.active]).toEqual([5000, zero, true]);
    const bal = await f.ownerBalance(a, {}, zero);
    expect(bal.payout).toEqual({ allowed: true, reason: null, amountCents: 5000 });
    expect(bal.admission?.payee?.id).toBe(pa.id);
    expect(bal.admission?.answers.map((x) => x.dueCents)).toEqual([4999, 5000]);
    expect(balanceSchema.safeParse(JSON.parse(JSON.stringify(bal))).success).toBe(true);
    // the payables and the payroll answer the same gate
    expect((await f.ownerPayables({ label: zero })).items.find((i) => i.ownerId === a)?.payout.reason).toBeNull();
    expect((await f.ownerPayables({})).items.find((i) => i.ownerId === b)?.payout.reason).toBe('nothing_to_pay');
    const row = (await f.payroll(zero, { area: 'master' })).rows.find((r) => r.ownerId === a && r.rowKind === 'total');
    expect(row?.gate).toMatchObject({ allowed: true, reason: null });
    // the payout goes; the second payout needs no answer any more (the owner had one)
    const op = await f.createPayout(a, { labelId: zero });
    expect(op.amountCents).toBe(5000);
    expect((await f.ownerBalance(a, {}, zero)).admission?.hadPayout).toBe(true);
    // a replaced payee: the previous one is deactivated with the reason «replaced»
    const pa2 = await f.setPayee({ ownerId: a, channel: 'easystaff', basis: 'moved', validFrom: '2026-11-01' });
    const list = await f.listAdmission({ ownerId: a, active: false });
    expect(list.payees.map((p) => [p.id === pa2.id, p.active, p.deactivatedReason])).toEqual([[false, false, 'replaced'], [true, true, null]]);
    await expect(f.deactivatePayee(pa.id, 'again')).rejects.toMatchObject({ code: 'already_inactive' });
    const off = await f.deactivatePayee(pa2.id, 'left');
    expect([off.active, off.deactivatedReason]).toEqual([false, 'left']);
    expect((await f.ownerBalance(a, {}, zero)).admission?.payee).toBeNull();
  });

  it('a hold closes the payout before a blocked payout and before the payee check; a hold of another book does not; a dispute informs unless it blocks; release', async () => {
    const { f, zero, echo, a } = await world();
    await f.setPayee({ ownerId: a, channel: 'tipalti', payeeRef: '1', basis: 'b', validFrom: '2026-01-01' });
    await f.createAnswer({ ownerId: a, due: '50', decision: 'pay', why: 'ok', about: 'first payout', answeredBy: 't' });
    const other = await f.createHold({ ownerId: a, labelId: echo, kind: 'decision', reason: 'echo only', since: '2026-10-19' });
    expect([other.labelId, other.blocks, other.status]).toEqual([echo, true, 'active']);
    expect((await f.ownerBalance(a, {}, zero)).payout.allowed).toBe(true);
    const dispute = await f.createHold({ ownerId: a, kind: 'dispute', reason: 'a payout outside the start?', amount: '2450.49', period: '2026-10', since: '2026-10-19', source: 'history_exceptions.json:H-1' });
    expect([dispute.blocks, dispute.amountCents, dispute.period]).toEqual([false, 245049, '2026-10']);
    expect((await f.ownerBalance(a, {}, zero)).payout.allowed).toBe(true);
    const hold = await f.createHold({ ownerId: a, kind: 'artist_request', reason: 'the artist asked to wait until 2027', releaseWhen: 'the artist asks', reviewOn: '2027-01-10', since: '2026-10-16' });
    expect((await f.ownerBalance(a, {}, zero)).payout).toEqual({ allowed: false, reason: 'hold', amountCents: 5000 });
    expect((await f.ownerBalance(a)).payout.reason).toBe('hold'); // without a view every book counts
    await expect(f.createPayout(a, { labelId: zero })).rejects.toMatchObject({ code: 'hold' });
    const listed = await f.listAdmission({ labelId: zero });
    expect(admissionListSchema.safeParse(JSON.parse(JSON.stringify(listed))).success).toBe(true);
    expect(listed.holds.map((h) => h.id).sort()).toEqual([dispute.id, hold.id].sort()); // the Echo8 hold is not of the 0to8 book
    expect((await f.listAdmission({})).holds).toHaveLength(3);
    const released = await f.releaseHold(hold.id, 'the artist came back');
    expect([released.status, released.releasedReason, released.releasedAt !== null]).toEqual(['released', 'the artist came back', true]);
    await expect(f.releaseHold(hold.id, 'again')).rejects.toMatchObject({ code: 'already_released' });
    expect((await f.ownerBalance(a, {}, zero)).payout.allowed).toBe(true);
    expect((await f.listAdmission({ labelId: zero })).holds.map((h) => h.id)).toEqual([dispute.id]);
    expect((await f.listAdmission({ labelId: zero, active: false })).holds).toHaveLength(2);
    // a blocking dispute closes the payout too
    const blocking = await f.createHold({ ownerId: a, kind: 'dispute', blocks: true, reason: 'a double payout', since: '2026-10-19' });
    expect((await f.ownerBalance(a, {}, zero)).payout.reason).toBe('hold');
    await f.releaseHold(blocking.id, 'explained');
    // refusals
    await expect(f.createHold({ ownerId: 'no-such-owner', kind: 'decision', reason: 'x', since: '2026-01-01' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.createHold({ ownerId: a, kind: 'decision', reason: 'x', since: '2026-13-01' })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(f.createHold({ ownerId: a, labelId: 'no-such-label', kind: 'decision', reason: 'x', since: '2026-01-01' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.createAnswer({ ownerId: a, due: '0', decision: 'pay', why: 'x', about: '', answeredBy: 't' })).rejects.toMatchObject({ code: 'amount_invalid' });
    await expect(f.releaseHold('no-such-hold', 'x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('the threshold of the contract wins over the default; the answer is deactivated with a reason; a manager lists its label only', async () => {
    const { f, zero, a } = await world(1000);
    const [contract] = (await f.modules.owners.approvedContracts()).filter((c) => c.ownerId === a);
    expect(contract?.payoutThresholdCents).toBeNull();
    const set = await f.setContractThreshold(contract?.id as string, 6000);
    expect(set).toEqual({ id: contract?.id, ownerId: a, payoutThresholdCents: 6000 });
    expect((await f.ownerBalance(a, {}, zero)).payout).toEqual({ allowed: false, reason: 'below_threshold', amountCents: 5000 });
    expect((await f.ownerBalance(a, {}, zero)).admission?.thresholdCents).toBe(6000);
    await f.setContractThreshold(contract?.id as string, 2500);
    expect((await f.ownerBalance(a, {}, zero)).payout.allowed).toBe(true);
    await f.setContractThreshold(contract?.id as string, null);
    expect((await f.ownerBalance(a, {}, zero)).admission?.thresholdCents).toBeNull();
    await expect(f.setContractThreshold(contract?.id as string, -1)).rejects.toMatchObject({ code: 'threshold_invalid' });
    await expect(f.setContractThreshold('no-such-contract', 1)).rejects.toMatchObject({ statusCode: 404 });
    // a contract created with a threshold
    const { owner, artists } = await confirmedOwner(f, 'Threshold Owner Synth', ['Threshold Synth']);
    const doc = await approvedDoc(f, 'contract', owner.id);
    const made = await f.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [(artists[0] as { id: string }).id], payoutThresholdCents: 100 });
    expect(made.payoutThresholdCents).toBe(100);
    // answers
    const ans = await f.createAnswer({ ownerId: a, due: '50', decision: 'pay_task', why: 'with a task', about: 'договор', answeredBy: 't' });
    const off = await f.deactivateAnswer(ans.id, 'withdrawn');
    expect([off.active, off.deactivatedReason]).toEqual([false, 'withdrawn']);
    await expect(f.deactivateAnswer(ans.id, 'again')).rejects.toMatchObject({ code: 'already_inactive' });
    expect((await f.listAdmission({ ownerId: a })).answers).toEqual([]);
    expect((await f.listAdmission({ ownerId: a, active: false })).answers).toHaveLength(1);
    // the viewer (D-171): a manager names one of its labels
    const echoViewer = labelsViewer([f.testLabels.Echo8]);
    await expect(f.listAdmission({}, echoViewer)).rejects.toMatchObject({ code: 'label_required' });
    await expect(f.listAdmission({ labelId: zero }, echoViewer)).rejects.toMatchObject({ code: 'label_forbidden' });
    expect((await f.listAdmission({ labelId: f.testLabels.Echo8 }, echoViewer)).payees).toEqual([]);
  });
});
