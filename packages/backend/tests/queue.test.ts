import { describe, expect, it } from 'vitest';
import { Decimal, ZERO } from '../src/shared/money';
import { calculate, reconcile } from '../src/facade/calculation';
import { cQueue, type QueueGroup } from '../src/facade/queue';
import { C_REASONS } from '@erp/shared/api-responses';
import { assumptionDoc, confirmedOwner, unconfirmedOwner, approvedDoc, writeB17 } from './helpers/fixtures';
import { ACC2, Case, I } from './helpers/golden-case';

// The C queue (D-141): groups per reason keyed by what the operator fixes, and the invariant that the queue and the
// reconciliation count the very same items. Synthetic data only.

async function world() {
  const c = await Case.start();
  await c.person('A', 'L', 'M');
  for (let n = 1; n <= 6; n++) await c.track(I(n));
  // G19: a row without a document
  await c.split(I(1), [['A', '50']], { doc: null });
  // G10a: a row with its own assumption document
  const q1 = await assumptionDoc(c.f, null, 'Q1: less other participants');
  await c.split(I(2), [['L', '20', q1.id]]);
  // G08c: an unmapped label string (the row itself is confirmed)
  await c.split(I(3), [['M', '50']]);
  // an owner without contract, and a pseudonym without owner
  const u = await unconfirmedOwner(c.f, 'Unconfirmed U', ['Pseud U']);
  await c.f.createSplit({
    isrc: I(4),
    validFrom: '2020-01-01',
    validTo: null,
    shares: [{ artistId: (u.artists[0] as { id: string }).id, percent: '40' }],
    documentId: c.appendix,
  });
  const orphan = await c.f.modules.owners.createArtist({ pseudonym: 'Pseud Orphan', ownerId: null });
  await c.f.createSplit({
    isrc: I(5),
    validFrom: '2020-01-01',
    validTo: null,
    shares: [{ artistId: orphan.id, percent: '30' }],
    documentId: c.appendix,
  });
  await c.load('2026-03', [
    { isrc: I(1), net: '100' },
    { isrc: I(2), net: '100' },
    { isrc: I(3), net: '100', label: 'Mystery Records' },
    { isrc: I(4), net: '100' },
    { isrc: I(5), net: '100' },
    { isrc: '', net: '2' },
    { isrc: I(9), net: '7' },
  ]);
  await c.load('2026-04', [{ isrc: I(1), net: '200' }], ACC2);
  // publishing: W3 has no terms (G26d), an unknown writer is unmapped
  const { owner } = await confirmedOwner(c.f, 'Owner W3', ['Pseud W3']);
  await c.f.modules.owners.addOwnerAlias(owner.id, 'W3');
  await approvedDoc(c.f, 'contract', owner.id);
  // a holder whose name matches an owner only by sound is ambiguous: the whole line is writer_unmapped
  await c.f.modules.owners.createOwner({ name: 'Ivan Testov', kind: 'person' });
  await c.f.ingestB17(
    await writeB17('Q12026', [
      {
        title: 'T-D',
        writer: 'HOLDER H',
        songwriters: 'W3',
        payable: '100',
        operationType: 'Mechanical',
        period: '1Q26',
      },
      {
        title: 'T-X',
        writer: 'TESTOV, IVAN',
        songwriters: '',
        payable: '30',
        operationType: 'Mechanical',
        period: '1Q26',
      },
    ]),
  );
  const calc = await calculate({ ...c.f.modules, db: c.f.db });
  const ownerNames = new Map((await c.f.modules.owners.listOwners()).map((o) => [o.id, o.name]));
  const queue = (o: Parameters<typeof cQueue>[2] = {}, f: Parameters<typeof cQueue>[1] = {}) =>
    cQueue(calc, f, o, { ownerNames });
  const groups = (reason: (typeof C_REASONS)[number], o = {}) =>
    queue({ reason, ...o }).groups.map((g: QueueGroup) => ({
      kind: g.key.kind,
      id: g.key.id,
      label: g.key.label,
      amount: g.amount.toFixed(),
    }));
  return { c, calc, queue, groups, q1, owner, u, orphan };
}

describe('C queue', () => {
  it('groups per reason, keyed by what the operator fixes', async () => {
    const { c, calc, queue, groups, q1, owner, u, orphan } = await world();
    const splitOf = async (isrc: string) =>
      (await c.f.listSplits({ isrc })).items[0] as unknown as { id: string };

    // G19: the split "50" (month 03) + 100 of month 04 on the same ISRC/split
    const g19 = queue({ reason: 'split_unconfirmed' }).groups;
    expect(g19).toHaveLength(1);
    const g = g19[0] as QueueGroup;
    expect(g.key).toMatchObject({ kind: 'split', id: (await splitOf(I(1))).id });
    expect(g.amount.toFixed()).toBe('150');
    expect(g.ownerId).toBe(c.owners.get('A'));
    expect(g.artistId).toBe(c.id('A'));
    expect(g.pseudonym).toBe('A');
    expect(g.ownerName).toBe('Owner A');
    expect(g.months).toEqual({ from: '2026-03', to: '2026-04' });
    expect(g.isrcs.map((x) => [x.isrc, x.amount.toFixed()])).toEqual([[I(1), '150']]);
    expect(
      queue({ reason: 'split_unconfirmed' }, { from: '2026-03', to: '2026-03' }).groups[0]?.amount.toFixed(),
    ).toBe('50');

    // G10a: the assumption row
    const a = queue({ reason: 'assumption' }).groups;
    expect(a).toHaveLength(1);
    expect(a[0]?.key).toMatchObject({ kind: 'split', id: (await splitOf(I(2))).id });
    expect(a[0]?.amount.toFixed()).toBe('20');
    expect(a[0]?.assumptionBasis).toBe('document');
    expect(a[0]?.documentId).toBe(q1.id);

    // G08c: the label string
    expect(groups('label_unmapped')).toEqual([
      { kind: 'labelString', id: 'Mystery Records', label: 'Mystery Records', amount: '50' },
    ]);

    // G30: the perimeter, keyed by the pair
    expect(groups('no_isrc')).toEqual([
      { kind: 'pair', id: '|1234567890123', label: '(без ISRC) / 1234567890123', amount: '2' },
    ]);
    expect(groups('unknown_pair')).toEqual([
      { kind: 'pair', id: `${I(9)}|1234567890123`, label: `${I(9)} / 1234567890123`, amount: '7' },
    ]);

    // an owner without contract
    expect(groups('owner_unconfirmed')).toEqual([
      { kind: 'owner', id: u.owner.id, label: 'Unconfirmed U', amount: '40' },
    ]);
    // a pseudonym without owner
    expect(groups('artist_without_owner')).toEqual([
      { kind: 'artist', id: orphan.id, label: 'Pseud Orphan', amount: '30' },
    ]);
    // publishing: G26d by owner, an unknown writer by name
    expect(groups('publishing_terms_unconfirmed')).toEqual([
      { kind: 'ownerTerms', id: owner.id, label: 'Owner W3', amount: '50' },
    ]);
    const w = queue({ reason: 'writer_unmapped' }).groups;
    expect(w.map((x) => [x.key.kind, x.key.label, x.amount.toFixed()])).toEqual([
      ['writer', 'TESTOV, IVAN', '30'],
    ]);

    // filters
    expect(queue({ reason: 'split_unconfirmed', ownerId: 'nobody' }).groups).toEqual([]);
    expect(queue({ reason: 'split_unconfirmed', q: 'owner a' }).groups).toHaveLength(1);
    expect(queue({ reason: 'split_unconfirmed', q: 'zzz' }).groups).toEqual([]);
    expect(queue({ reason: 'split_unconfirmed', account: ACC2 }).groups[0]?.amount.toFixed()).toBe('100');
    expect(queue({ reason: 'split_unconfirmed', month: '2026-04' }).groups[0]?.amount.toFixed()).toBe('100');
    // the summary lists every reason with money, largest first
    const s = queue().summary;
    expect(s.map((x) => x.reason)).toContain('writer_unmapped');
    const abs = s.map((x) => x.amount.abs().toNumber());
    expect(abs).toEqual([...abs].sort((x, y) => y - x));
    expect(calc.units.length).toBeGreaterThan(0);
  });

  it('Σ of the queue per reason equals C_breakdown of every reconciliation row', async () => {
    const { calc, queue } = await world();
    const rows = reconcile(calc);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      for (const reason of C_REASONS) {
        const got = queue({ reason, account: r.account, month: r.month }).groups.reduce(
          (s, g) => s.add(g.amount),
          ZERO,
        );
        const want = (r.C_breakdown[reason] as Decimal | undefined) ?? ZERO;
        expect(got.toFixed(), `${r.account} ${r.month} ${reason}`).toBe(want.toFixed());
      }
      const sum = queue({ account: r.account, month: r.month }).summary.reduce(
        (s, x) => s.add(x.amount),
        ZERO,
      );
      expect(sum.toFixed()).toBe(r.C_waiting.toFixed());
    }
    const total = rows.reduce((s, r) => s.add(r.C_waiting), ZERO);
    expect(
      queue()
        .summary.reduce((s, x) => s.add(x.amount), ZERO)
        .toFixed(),
    ).toBe(total.toFixed());
  });

  it('the overview and signals counts come from one calculation', async () => {
    const { c } = await world();
    const o = await c.f.overview();
    expect(o.reconciliation.length).toBeGreaterThanOrEqual(3);
    expect(o.files.believe).toBe(2);
    expect(o.files.b17).toBe(1);
    const s = await c.f.signals();
    expect(Object.fromEntries(o.signals.map((x) => [x.name, x.count]))).toEqual(s.counts);
    expect(s.counts.unallocated).toBe(s.unallocated.pairs.length);
    expect(o.queue.length).toBeGreaterThan(0);
  });
});
