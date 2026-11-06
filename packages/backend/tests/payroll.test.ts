import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import { parseCsv } from '../src/shared/csv';
import { Readable } from 'node:stream';
import { ACC2, Case, I } from './helpers/golden-case';
import { approvedAppendix, approvedDoc, newFacade, writeB17 } from './helpers/fixtures';
import { csvText, payrollSheet, type Payroll, type PayrollSheet } from '../src/facade/payroll';
import { labelsViewer } from '../src/facade/viewer';

// The payroll of a label (D-173 §1.4, `GET /owners/payroll`): one calculation, the cut asOf, the view of the label;
// the rows of an owner add up to its total and to `byArea` of the area; json and csv carry the same table. Synthetic
// names only.

/**
 * A: rows A 50 on I(1) (0to8) and A2 (A's second pseudonym) 40 on I(2) (0to8), publishing 50 % of a Q1 statement
 * under 0to8 (40); B: row 30 on I(3) (0to8) confirmed by a label decision; W: a row 20 on I(4) (0to8) without a
 * document (waits); E: row 50 on I(5) of the Echo8 account (another book). Operations under 0to8: an advance of 30 on A
 * (2026-02), a buyout of 100 (A), a write-off of 5 (A's publishing), an adjustment −12.34 (A), a migrated payout of 7
 * (B); an ad of 4 on I(1). After 2026-04: a 2026-05 file (I(1) 100) and an adjustment of −1 (A) dated 2026-05-10.
 */
async function world(threshold = 0) {
  const c = new Case();
  c.f = await newFacade(threshold);
  c.appendix = (await approvedAppendix(c.f)).id;
  const f = c.f;
  const zero = f.testLabels['0to8'];
  const echo = f.testLabels.Echo8;
  await c.person('A', 'W', 'E');
  await c.second('A2', 'A');
  // B: an owner confirmed by an approved label decision under 0to8 (no contract)
  const o = f.modules.owners;
  const ownerB = await o.createOwner({ name: 'Owner B', kind: 'person' });
  const b = await o.createArtist({ pseudonym: 'B', ownerId: ownerB.id });
  c.ids.set('B', b.id);
  c.names.set(b.id, 'B');
  c.owners.set('B', ownerB.id);
  const decision = await o.createDocument({ kind: 'label_decision', title: 'Decision B', fileRef: 'dummy://b.pdf', ownerId: ownerB.id, requiresApproval: true, labelId: zero });
  await o.approveDocument(decision.id, 'Operator');
  await o.createContract({ ownerId: ownerB.id, documentId: decision.id, artistIds: [b.id], number: 'LD-1' });
  for (const n of [1, 2, 3, 4, 5]) await c.track(I(n));
  await c.split(I(1), [['A', '50']]);
  await c.split(I(2), [['A2', '40']]);
  await c.split(I(3), [['B', '30']]);
  await c.split(I(4), [['W', '20']], { doc: null });
  await c.split(I(5), [['E', '50']]);
  await c.load('2026-03', [
    { isrc: I(1), net: '100' },
    { isrc: I(2), net: '100' },
    { isrc: I(3), net: '100' },
    { isrc: I(4), net: '100' },
  ]);
  await c.load('2026-03', [{ isrc: I(5), net: '100', label: 'Echo8' }], ACC2);
  const a = c.owners.get('A') as string;
  await o.addOwnerAlias(a, 'OWNER, A');
  await f.setPublishingTerms({ ownerId: a, percent: '50', validFrom: '2020-01-01', documentId: (await approvedDoc(f, 'contract', a)).id });
  await f.ingestB17(await writeB17('Q12026', [{ writer: 'OWNER, A', title: 'Song', payable: '80', period: '1Q26' }]), zero);
  const basis = await approvedDoc(f, 'advance_basis', a);
  const adv = await f.createOperation({ labelId: zero, direction: 'out', amount: '30', artistId: c.id('A'), date: '2026-02-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance' });
  await f.attachPaymentProof(adv.id, { fileRef: 'dummy://proof.pdf' });
  const buyout = await f.createOperation({ kind: 'buyout', direction: 'out', amount: '100', ownerId: a, date: '2026-04-01', documentId: (await approvedDoc(f, 'buyout', a)).id, comment: 'buyout', labelId: zero });
  await f.attachPaymentProof(buyout.id, { fileRef: 'dummy://buyout-proof.pdf' });
  const adj = await approvedDoc(f, 'adjustment_basis', a);
  await f.createOperation({ kind: 'writeoff', direction: 'in', amount: '5', ownerId: a, date: '2026-04-02', documentId: adj.id, comment: 'write-off', labelId: zero });
  await f.createOperation({ kind: 'adjustment', direction: 'in', amount: '-12.34', ownerId: a, date: '2026-04-03', documentId: adj.id, comment: 'adjustment', labelId: zero });
  await f.createOperation({ direction: 'out', amount: '7', ownerId: ownerB.id, date: '2026-04-04', comment: 'paid outside', migration: true, labelId: zero });
  await f.createAds([{ isrc: I(1), month: '2026-03', amount: '4', labelId: zero }]);
  return { c, f, zero, echo, a, b: ownerB.id, buyout: buyout.id, adj: adj.id };
}

const json = (p: Payroll) => JSON.parse(JSON.stringify(p)) as Record<string, unknown> & { rows: Record<string, unknown>[] };
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), new Decimal(0)).toFixed();

async function readCsv(text: string): Promise<string[][]> {
  const rows: string[][] = [];
  for await (const r of parseCsv(Readable.from([Buffer.from(text)]))) rows.push(r);
  return rows;
}

describe('the payroll of a label (D-173)', () => {
  it('rows, sheets and totals of the master area; the rows of an owner add up to its total and to byArea', async () => {
    const { c, f, zero, a, b } = await world();
    const p = await f.payroll(zero, { area: 'master' });
    expect([p.label.name, p.area, p.asOf]).toEqual(['0to8', 'master', null]);
    const rowsOf = (owner: string) => p.rows.filter((r) => r.ownerId === owner);
    // A: two pseudonym rows, the owner row, the total row
    expect(rowsOf(a).map((r) => [r.rowKind, r.pseudonym])).toEqual([['pseudonym', 'A'], ['pseudonym', 'A2'], ['owner', null], ['total', null]]);
    const [rowA, rowA2, ownerA, totalA] = rowsOf(a);
    // A earns 50 (I1) and A2 40 (I2) master; the advance of 30 is recouped from A's income first (2026-03 master, A's own)
    expect([rowA?.earned, rowA?.recouped, rowA?.unrecouped, rowA?.adsCharged].map((x) => x?.toFixed())).toEqual(['50', '30', '0', '4']);
    expect([rowA2?.earned, rowA2?.recouped].map((x) => x?.toFixed())).toEqual(['40', '0']);
    // the owner row: master area → no publishing; the operations of the master area (buyout, adjustment)
    expect([ownerA?.earned, ownerA?.buyouts, ownerA?.adjustments, ownerA?.writtenOff].map((x) => x?.toFixed())).toEqual(['0', '100', '12.34', '0']);
    const bal = await f.ownerBalance(a, {}, zero);
    const area = bal.total.byArea.master;
    for (const k of ['earned', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'buyouts', 'writtenOff', 'adjustments'] as const) {
      expect(sum(rowsOf(a).filter((r) => r.rowKind !== 'total').map((r) => r[k])), k).toBe(totalA?.[k].toFixed());
      expect(totalA?.[k].toFixed(), k).toBe(area[k].toFixed());
    }
    expect(totalA?.payable?.toFixed()).toBe(area.payable.toFixed());
    // master 90 − recouped 30 − ad 4 + adjustment 12.34 = 68.34
    expect(totalA?.payable?.toFixed()).toBe('68.34');
    expect(totalA?.gate).toEqual({ allowed: true, reason: null, amountCents: 6834, blockedByOtherLabel: false });
    // B: confirmed by a label decision, no contract: the column «by decision»; the migrated payout of 7 under master
    const totalB = rowsOf(b).find((r) => r.rowKind === 'total');
    expect([totalB?.byDecision, totalB?.contract?.documentKind, totalB?.contract?.number, totalB?.contract?.approvedBy]).toEqual([true, 'label_decision', 'LD-1', 'Operator']);
    expect([totalB?.earned.toFixed(), totalB?.paid.toFixed(), totalB?.payable?.toFixed()]).toEqual(['30', '7', '23']);
    expect([totalA?.byDecision, totalA?.contract?.documentKind]).toEqual([false, 'contract']);
    // W waits (split_unconfirmed) in the waiting sheet; E is of another book
    expect(p.waiting.map((w) => [c.names.get(w.ownerId) ?? w.ownerName, w.reason, w.amount.toFixed(), w.paidAlready.toFixed()])).toEqual([['Owner W', 'split_unconfirmed', '20', '0']]);
    expect(p.rows.some((r) => r.ownerName === 'Owner E')).toBe(false);
    expect(p.buyouts.map((x) => [x.ownerId, x.amount.toFixed(), x.counted])).toEqual([[a, '100', true]]);
    // control: A = B + C + ours of the 0to8 book by account and month; Σ B = Σ earned of the total rows
    expect(p.control.map((x) => [x.source, x.month, x.A.toFixed(), x.B.toFixed(), x.C.toFixed(), x.ours.toFixed(), x.discrepancy.toFixed()])).toEqual([
      ['believe', '2026-03', '400', '120', '20', '260', '0'],
    ]);
    expect([p.totals.bookB.toFixed(), p.totals.reconciliationB.toFixed(), p.totals.bookBMatches]).toEqual(['120', '120', true]);
    expect(p.totals.payable.toFixed()).toBe(sum(p.rows.filter((r) => r.rowKind === 'total').map((r) => r.payable as Decimal)));
    await c.verify();
  });

  it('the publishing and all areas: Σ areas of the total rows = the book', async () => {
    const { f, zero, a } = await world();
    const pub = await f.payroll(zero, { area: 'publishing' });
    const all = await f.payroll(zero, { area: 'all' });
    const master = await f.payroll(zero, {});
    expect(pub.rows.some((r) => r.rowKind === 'pseudonym')).toBe(false);
    const totalOf = (p: Payroll) => p.rows.find((r) => r.ownerId === a && r.rowKind === 'total');
    // publishing: 40 earned, write-off 5: payable 35
    expect([totalOf(pub)?.earned.toFixed(), totalOf(pub)?.writtenOff.toFixed(), totalOf(pub)?.payable?.toFixed()]).toEqual(['40', '5', '35']);
    for (const k of ['earned', 'recouped', 'adsCharged', 'paid', 'buyouts', 'writtenOff', 'adjustments'] as const)
      expect(totalOf(master)?.[k].add(totalOf(pub)?.[k] as Decimal).toFixed(), k).toBe(totalOf(all)?.[k].toFixed());
    expect(totalOf(all)?.payable?.toFixed()).toBe((await f.ownerBalance(a, {}, zero)).total.payable.toFixed());
    expect([pub.control.map((x) => x.source), pub.totals.bookBMatches, all.totals.bookBMatches]).toEqual([['b17'], true, true]);
  });

  it('asOf excludes the later operations and files', async () => {
    const { c, f, zero, a, adj } = await world();
    const before = JSON.stringify({ ...json(await f.payroll(zero, { area: 'all' })), calculatedAt: null, asOf: null });
    await c.load('2026-05', [{ isrc: I(1), net: '100' }]);
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '20' }]), zero);
    await f.createOperation({ kind: 'adjustment', direction: 'in', amount: '-1', ownerId: a, date: '2026-05-10', documentId: adj, comment: 'late', labelId: zero });
    const now = await f.payroll(zero, { area: 'all' });
    expect(now.rows.find((r) => r.ownerId === a && r.rowKind === 'total')?.adjustments.toFixed()).toBe('13.34');
    const cut = await f.payroll(zero, { area: 'all', asOf: '2026-04' });
    expect(cut.asOf).toBe('2026-04');
    expect(JSON.stringify({ ...json(cut), calculatedAt: null, asOf: null })).toBe(before);
  });

  it('csv parse-back equals json, sheet by sheet', async () => {
    const { f, zero } = await world();
    const p = await f.payroll(zero, { area: 'all' });
    for (const sheet of ['payroll', 'waiting', 'buyouts', 'control'] as PayrollSheet[]) {
      const { text, fileName } = await f.payrollCsv(zero, { area: 'all', sheet });
      expect(fileName).toBe(`payroll_0to8_all_all_${sheet}.csv`);
      expect(text.startsWith('﻿"')).toBe(true);
      const parsed = await readCsv(text.slice(1));
      const t = payrollSheet(JSON.parse(JSON.stringify(p)) as Payroll, sheet);
      const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));
      expect(parsed[0], sheet).toEqual(t.header);
      expect(parsed.slice(1), sheet).toEqual(t.rows.map((r) => r.map(asText)));
    }
    // quoting: a field with `;` and `"` survives
    const q = csvText(['a', 'b'], [['x;"y"', new Decimal('1.50')]]);
    expect(q).toBe('﻿"a";"b"\r\n"x;""y""";"1.5"\r\n');
    expect(await readCsv(q.slice(1))).toEqual([['a', 'b'], ['x;"y"', '1.5']]);
  });

  it('the gate: a payout blocked by another label shows no amount; below the threshold; a manager under its own label', async () => {
    const { c, f, zero, echo, a } = await world();
    // a payout of A under Echo8 without proof blocks A everywhere; under 0to8 it shows no amount
    await c.load('2026-04', [{ isrc: I(1), net: '100' }], ACC2);
    const pay = await f.createPayout(a, { labelId: echo, area: 'all' });
    const totalA = (await f.payroll(zero, { area: 'all' })).rows.find((r) => r.ownerId === a && r.rowKind === 'total');
    expect(totalA?.gate).toEqual({ allowed: false, reason: 'payout_blocked', amountCents: null, blockedByOtherLabel: true });
    const underEcho = (await f.payroll(echo, { area: 'all' })).rows.find((r) => r.ownerId === a && r.rowKind === 'total');
    expect(underEcho?.gate?.blockedByOtherLabel).toBe(false);
    expect(underEcho?.gate?.amountCents).not.toBeNull();
    await f.attachPaymentProof(pay.id, { fileRef: 'dummy://proof-echo.pdf' });
    const b = c.owners.get('B') as string;
    const gateB = async (g: typeof f) => (await g.payroll(zero, {})).rows.find((r) => r.ownerId === b && r.rowKind === 'total');
    expect([(await gateB(f))?.gate?.reason, (await gateB(f))?.belowThreshold]).toEqual([null, false]);
    // a manager of 0to8: its label answers, another 403 label_forbidden; no label 400
    await expect(f.payroll(zero, {}, labelsViewer([zero]))).resolves.toMatchObject({ label: { id: zero } });
    await expect(f.payroll(echo, {}, labelsViewer([zero]))).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    await expect(f.payroll(undefined, {})).rejects.toMatchObject({ statusCode: 400, code: 'label_required' });
    // with a threshold of 50.00, B (payable 23) is below it (a new facade: the store is emptied)
    const high = await world(5000);
    const totalB = (await high.f.payroll(high.zero, {})).rows.find((r) => r.ownerId === high.b && r.rowKind === 'total');
    expect([totalB?.gate?.reason, totalB?.gate?.amountCents, totalB?.belowThreshold]).toEqual(['below_threshold', 2300, true]);
  });
});
