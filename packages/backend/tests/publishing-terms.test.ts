import { describe, expect, it } from 'vitest';
import { calculate } from '../src/facade/calculation';
import { approvedDoc, newFacade, writeB17 } from './helpers/fixtures';

async function accruals(f: Awaited<ReturnType<typeof newFacade>>) {
  return (await calculate({ ...f.modules, db: f.db })).publishing;
}

// Publishing terms by operation type (D-128, part 1: the module). Synthetic data only.

async function setup() {
  const f = await newFacade();
  const owner = await f.modules.owners.createOwner({ name: 'Terms Owner', kind: 'person' });
  await f.ingestB17(
    await writeB17('Q22026', [
      { writer: 'Typed Writer', title: 'S1', payable: '100', operationType: 'Mechanical' },
      { writer: 'Typed Writer', title: 'S2', payable: '100', operationType: 'Performance' },
    ]), f.testLabels['0to8'],
  );
  const w = (await f.modules.publishing.listWriters()).find((x) => x.displayName === 'Typed Writer')!;
  await f.modules.publishing.mapWriter(w.writerNorm, owner.id, 'manual');
  return { f, owner, p: f.modules.publishing };
}

describe('publishing terms by operation type (D-128)', () => {
  it('a typed term wins for its type, the untyped one applies to the others, the result carries the percent', async () => {
    const { f, owner, p } = await setup();
    const doc = await approvedDoc(f, 'contract', owner.id);
    await p.setTerms({ ownerId: owner.id, percent: '50', validFrom: '2020-01-01', documentId: doc.id });
    const typed = await p.setTerms({
      ownerId: owner.id,
      percent: '70',
      validFrom: '2020-01-01',
      documentId: doc.id,
      operationType: 'Mechanical',
    });
    expect(typed?.operationType).toBe('Mechanical');
    const acc = await accruals(f);
    const mech = acc.find((a) => a.workTitle === 'S1')!;
    const perf = acc.find((a) => a.workTitle === 'S2')!;
    expect(mech.percent.toFixed()).toBe('70');
    expect(perf.percent.toFixed()).toBe('50');
    expect((await p.termsOf([owner.id])).map((t) => t.operationType ?? '').sort()).toEqual([
      '',
      'Mechanical',
    ]);
  });

  it('only a typed term: other types fall back to the default 50 percent', async () => {
    const { f, owner, p } = await setup();
    await p.setTerms({
      ownerId: owner.id,
      percent: '10',
      validFrom: '2020-01-01',
      operationType: 'Mechanical',
    });
    const acc = await accruals(f);
    expect(acc.find((a) => a.workTitle === 'S1')?.percent.toFixed()).toBe('10');
    const perf = acc.find((a) => a.workTitle === 'S2')!;
    expect(perf.reason).toBe('owner_unconfirmed');
    expect(perf.percent.toFixed()).toBe('50');
  });

  it('overlap is refused within a type and allowed across types', async () => {
    const { owner, p } = await setup();
    await p.setTerms({ ownerId: owner.id, percent: '50', validFrom: '2026-01-01' });
    await p.setTerms({
      ownerId: owner.id,
      percent: '60',
      validFrom: '2026-01-01',
      operationType: 'Mechanical',
    });
    await expect(
      p.setTerms({ ownerId: owner.id, percent: '55', validFrom: '2025-06-01' }),
    ).rejects.toMatchObject({ code: 'terms_overlap' });
    await expect(
      p.setTerms({ ownerId: owner.id, percent: '65', validFrom: '2025-06-01', operationType: 'Mechanical' }),
    ).rejects.toMatchObject({ code: 'terms_overlap' });
    await p.setTerms({
      ownerId: owner.id,
      percent: '40',
      validFrom: '2025-06-01',
      operationType: 'Performance',
    });
  });

  it('a new term closes only the open term of its own type', async () => {
    const { f, owner, p } = await setup();
    const doc = await approvedDoc(f, 'contract', owner.id);
    await p.setTerms({ ownerId: owner.id, percent: '50', validFrom: '2020-01-01' });
    await p.setTerms({
      ownerId: owner.id,
      percent: '60',
      validFrom: '2020-01-01',
      operationType: 'Mechanical',
    });
    await expect(
      p.setTerms({ ownerId: owner.id, percent: '70', validFrom: '2026-04-01', operationType: 'Mechanical' }),
    ).rejects.toMatchObject({ code: 'document_required' });
    await p.setTerms({
      ownerId: owner.id,
      percent: '70',
      validFrom: '2026-04-01',
      operationType: 'Mechanical',
      documentId: doc.id,
    });
    const terms = await p.termsOf([owner.id]);
    expect(terms.find((t) => t.operationType === null)?.validTo).toBeNull();
    const mech = terms.filter((t) => t.operationType === 'Mechanical');
    expect(mech.find((t) => t.percent === '60')?.validTo).toBe('2026-04-01');
    expect(mech.find((t) => t.percent === '70')?.validTo).toBeNull();
    // Q2 2026: report month June, after the change.
    expect((await accruals(f)).find((a) => a.workTitle === 'S1')?.percent.toFixed()).toBe('70');
  });

  it('an empty operation type is refused', async () => {
    const { owner, p } = await setup();
    await expect(
      p.setTerms({ ownerId: owner.id, percent: '50', validFrom: '2020-01-01', operationType: ' ' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});

describe('a statement under a label (D-169)', () => {
  it('the grouped lines carry the label of their statement; assignStatementLabel marks only a statement without one', async () => {
    const f = await newFacade();
    const p = f.modules.publishing;
    const [zero, echo] = [f.testLabels['0to8'], f.testLabels.Echo8];
    await f.ingestB17(await writeB17('Q12026', [{ writer: 'Label Writer', title: 'L1', payable: '10', period: '1Q26' }]), zero);
    // the module alone loads a statement without a label (the history before D-169)
    const bare = await p.ingestB17({
      ...(await writeB17('Q22026', [{ writer: 'Label Writer', title: 'L2', payable: '20' }])),
    });
    expect(bare.labelId).toBeNull();
    const labels = async () => (await p.snapshotForCalculation()).lines.map((l) => [l.period, l.labelId]);
    expect(await labels()).toEqual([['2026-Q1', zero], ['2026-Q2', null]]);
    expect((await p.activeStatements()).map((s) => [s.periods, s.labelId])).toEqual([[['2026-Q1'], zero], [['2026-Q2'], null]]);
    expect((await accruals(f)).map((a) => [a.period, a.labelId])).toEqual([['2026-Q1', zero], ['2026-Q2', null]]);
    // the label of a statement without one is set and the grouped lines follow it; a label is never changed
    expect(await p.assignStatementLabel(bare.id, echo)).toBe('assigned');
    expect(await labels()).toEqual([['2026-Q1', zero], ['2026-Q2', echo]]);
    expect(await p.assignStatementLabel(bare.id, zero)).toBe('already_done');
    const first = (await p.activeStatements())[0]?.id as string;
    expect(await p.assignStatementLabel(first, echo)).toBe('already_done');
    expect(await labels()).toEqual([['2026-Q1', zero], ['2026-Q2', echo]]);
    // with `refresh: false` (the script) the grouped lines wait for one refreshLinesByKey()
    const q3 = await p.ingestB17({ ...(await writeB17('Q32026', [{ writer: 'Label Writer', title: 'L3', payable: '5', period: '3Q26' }])) });
    expect(await p.assignStatementLabel(q3.id, echo, { refresh: false })).toBe('assigned');
    expect((await labels()).at(-1)).toEqual(['2026-Q3', null]);
    await p.refreshLinesByKey();
    expect((await labels()).at(-1)).toEqual(['2026-Q3', echo]);
    await expect(p.assignStatementLabel('no-such-statement', echo)).rejects.toMatchObject({ code: 'not_found' });
  });
});
