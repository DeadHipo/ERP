import { describe, expect, it } from 'vitest';
import { ZERO } from '../src/shared/money';
import { calculate, reconcile } from '../src/facade/calculation';
import { MASTER_LAYERS, type NamedLayer } from '../src/facade/layers';
import { approvedDoc, assumptionDoc, confirmedOwner, writeB17 } from './helpers/fixtures';
import { ACC1, ACC2, Case, I, single, UPC } from './helpers/golden-case';

// The master golden cases of docs/agents/12_golden_cases.md, end to end on the private stack: every expected number
// is the hand-computed decimal string of 12 §"Master cases"; every case also runs the checks of 12 §"Checks every
// master case also asserts" (reconciliation identity, discrepancy 0, explain sums to the unit, owner balances).
// Synthetic data only.

describe('golden master cases (12 §Master cases), end to end', () => {
  it('G01: row A 50', async () => {
    const c = await single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50' });
    expect(await c.row()).toMatchObject({ A: '100', B: '50', C: '0', ours: '50', byLabel: { '0to8': '50' } });
    await c.verify();
  });

  it('G02: rows 16.6 × 3', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B', 'C');
      await c.split(I(1), [
        ['A', '16.6'],
        ['B', '16.6'],
        ['C', '16.6'],
      ]);
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '16.6', B: '16.6', C: '16.6' });
    expect(await c.row()).toMatchObject({ B: '49.8', C: '0', ours: '50.2' });
    await c.verify();
  });

  it('G03a: floor title entered scaled', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B');
      await c.split(I(1), [
        ['A', '33.333333'],
        ['B', '16.666667'],
      ]);
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '33.333333', B: '16.666667' });
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G03b: two MCs from the artist pool', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B', 'M1', 'M2');
      await c.split(I(1), [
        ['A', '25'],
        ['B', '25'],
      ]);
      await c.part(I(1), 'M1', '13', 'net', 'artist_pool');
      await c.part(I(1), 'M2', '13', 'net', 'artist_pool');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '12', B: '12', M1: '13', M2: '13' });
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G03c: MALAME rows as entered', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B', 'C');
      await c.split(I(1), [
        ['A', '29.761905'],
        ['B', '10.119048'],
        ['C', '10.119047'],
      ]);
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '29.761905', B: '10.119048', C: '10.119047' });
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G04: remixer off the top', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B', 'R');
      await c.split(I(1), [
        ['A', '25'],
        ['B', '25'],
      ]);
      await c.part(I(1), 'R', '15', 'net', 'top');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ R: '15', A: '21.25', B: '21.25' });
    expect(await c.row()).toMatchObject({ B: '57.5', C: '0', ours: '42.5' });
    await c.verify();
  });

  for (const [g, a, ng, b, ours] of [
    ['G05a', '50', '25', '75', '25'],
    ['G05b', '70', '15', '85', '15'],
  ] as const) {
    it(`${g}: NoGhost sublabel half (row A ${a})`, async () => {
      const c = await single(
        async (c) => {
          await c.person('A');
          await c.company('NG');
          await c.sublabel('NoGhost Records', '0to8', 'NG');
          await c.split(I(1), [['A', a]]);
        },
        '100',
        'NoGhost Records',
      );
      expect((await c.amounts(I(1))).amounts).toEqual({ A: a, NG: ng });
      expect(await c.row()).toMatchObject({ B: b, C: '0', ours, byLabel: { '0to8': ours } });
      await c.verify();
    });
  }

  it('G06 / G07: label owners as rows', async () => {
    const c = await Case.start();
    await c.company('RX');
    await c.company('LL');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['RX', '66.6']]);
    await c.split(I(2), [['LL', '25']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1))).amounts).toEqual({ RX: '66.6' });
    expect(await c.row()).toMatchObject({ B: '66.6', C: '0', ours: '33.4' });
    await c.load('2026-04', [{ isrc: I(2), net: '100' }]);
    expect((await c.amounts(I(2), '2026-04')).amounts).toEqual({ LL: '25' });
    expect(await c.row('2026-04')).toMatchObject({ B: '25', C: '0', ours: '75' });
    await c.verify();
  });

  it('G08a: Ahh Music is an alias of 0to8', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.f.modules.labels.addAlias(await c.labelId('0to8'), 'Ahh Music');
        await c.split(I(1), [['A', '50']]);
      },
      '100',
      'Ahh Music',
    );
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50', byLabel: { '0to8': '50' } });
    await c.verify();
  });

  it('G08b: Echo8 is its own label of record', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.split(I(1), [['A', '50']]);
      },
      '100',
      'Echo8',
    );
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50', byLabel: { Echo8: '50' } });
    await c.verify();
  });

  it('G08b (D-130, D-169): one owner, an Echo8 unit and a 0to8 unit: the balance shows B and C per book', async () => {
    const c = await Case.start();
    await c.person('A');
    for (const n of [1, 2, 3]) await c.track(I(n));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']], { doc: null }); // no document: C split_unconfirmed
    await c.split(I(3), [['A', '50']]);
    // R6 (D-169): the book is the label of the file. The Echo8 unit comes in the file of the Echo8 account; the
    // unmapped string sits in the 0to8 file, so its money is in the 0to8 book (no longer '?')
    await c.load('2026-03', [
      { isrc: I(2), net: '60', label: 'Test Label' },
      { isrc: I(3), net: '40', label: 'Mystery Records' },
    ]);
    await c.load('2026-03', [{ isrc: I(1), net: '100', label: 'Echo8' }], ACC2);
    const b = await c.balance('A');
    const byLabel = Object.fromEntries(
      Object.entries(b.byLabel).map(([k, v]) => [k, [v.earned.toFixed(), v.waiting.toFixed()]]),
    );
    expect(byLabel).toEqual({ Echo8: ['50', '0'], '0to8': ['20', '30'] });
    expect([b.total.earned.toFixed(), b.total.waiting.toFixed()]).toEqual(['70', '30']);
    await c.verify();
  });

  it('G08c (E15): an unmapped label string', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.split(I(1), [['A', '50']]);
      },
      '100',
      'Mystery Records',
    );
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50' });
    expect(await c.row()).toMatchObject({ B: '50', C: '50', ours: '0', breakdown: { label_unmapped: '50' } });
    const s = await c.f.signals();
    expect(s.labelUnmapped.map((x) => [x.labelName, x.net.toFixed()])).toEqual([['Mystery Records', '100']]);
    await c.verify();
  });

  it('G09 (M9, M52): partial and full buy-out, dates floored to the month', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    const buy = await approvedDoc(c.f, 'buyout');
    await c.f.changeSplit({
      isrc: I(1),
      from: '2026-03-15',
      shares: [{ artistId: c.id('A'), percent: '25' }],
      documentId: buy.id,
    });
    await c.f.buyout({
      isrcs: [I(1)],
      sellerArtistId: c.id('A'),
      effectiveFrom: '2026-05-10',
      documentId: buy.id,
    });
    for (const m of ['2026-02', '2026-03', '2026-05']) await c.load(m, [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-02')).amounts).toEqual({ A: '50' });
    expect((await c.row('2026-02')).ours).toBe('50');
    expect((await c.amounts(I(1), '2026-03')).amounts).toEqual({ A: '25' });
    expect((await c.row('2026-03')).ours).toBe('75');
    expect((await c.amounts(I(1), '2026-05')).amounts).toEqual({});
    expect((await c.row('2026-05')).ours).toBe('100');
    await c.verify();
  });

  it('G10a / G10b (Q1, E22): a row with its own assumption document, before and after a buy-out of A', async () => {
    const c = await Case.start();
    await c.person('A', 'L', 'D');
    await c.track(I(1));
    const q1 = await assumptionDoc(c.f, null, 'Q1: less other participants');
    await c.split(I(1), [
      ['A', '23'],
      ['L', '20', q1.id],
      ['D', '7'],
    ]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ A: '23', L: '20', D: '7' });
    expect(a.reasons).toEqual({ A: null, L: 'assumption', D: null });
    expect(await c.row()).toMatchObject({ B: '30', C: '20', ours: '50', breakdown: { assumption: '20' } });
    const s = await c.f.signals();
    expect(s.assumptions.map((x) => [x.documentId, x.basis, x.amount.toFixed()])).toEqual([
      [q1.id, 'document', '20'],
    ]);
    await c.f.buyout({
      isrcs: [I(1)],
      sellerArtistId: c.id('A'),
      effectiveFrom: '2026-05-01',
      documentId: (await approvedDoc(c.f, 'buyout')).id,
    });
    await c.load('2026-05', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-05')).amounts).toEqual({ L: '20', D: '7' });
    expect(await c.row('2026-05')).toMatchObject({ B: '7', C: '20', ours: '73' });
    await c.verify();
  });

  it('G11: A&R (bucket, label_share) 15', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'P');
      await c.split(I(1), [['A', '50']]);
      await c.part(I(1), 'P', '15', 'bucket', 'label_share');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50', P: '7.5' });
    expect(await c.row()).toMatchObject({ B: '57.5', C: '0', ours: '42.5' });
    await c.verify();
  });

  it('G12: beat 10 % of the artist share', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'E');
      await c.split(I(1), [['A', '50']]);
      await c.part(I(1), 'E', '10', 'bucket', 'artist_share', { from: 'A' });
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '45', E: '5' });
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G13 (M10): an assignment from 2026-06-01', async () => {
    const c = await Case.start();
    await c.person('A', 'A2');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    const assign = await approvedDoc(c.f, 'other');
    await c.f.changeSplit({
      isrc: I(1),
      from: '2026-06-01',
      shares: [{ artistId: c.id('A2'), percent: '50' }],
      documentId: assign.id,
    });
    await c.load('2026-05', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-06', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-05')).amounts).toEqual({ A: '50' });
    expect((await c.amounts(I(1), '2026-06')).amounts).toEqual({ A2: '50' });
    expect((await c.row('2026-05')).ours).toBe('50');
    expect((await c.row('2026-06')).ours).toBe('50');
    await c.verify();
  });

  it('G14 (M25, M36): a participation valid 2026-01-01 … 2026-04-01', async () => {
    const c = await Case.start();
    await c.person('A', 'P');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.part(I(1), 'P', '15', 'bucket', 'label_share', {
      validFrom: '2026-01-01',
      validTo: '2026-04-01',
    });
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-04', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-03')).amounts).toEqual({ A: '50', P: '7.5' });
    expect((await c.row('2026-03')).ours).toBe('42.5');
    expect((await c.amounts(I(1), '2026-04')).amounts).toEqual({ A: '50' });
    expect((await c.row('2026-04')).ours).toBe('50');
    await c.verify();
  });

  async function noGhostTop(net: string) {
    return single(
      async (c) => {
        await c.person('A', 'B', 'R');
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
        await c.split(I(1), [
          ['A', '25'],
          ['B', '25'],
        ]);
        await c.part(I(1), 'R', '15', 'net', 'top');
      },
      net,
      'NoGhost Records',
    );
  }

  it('G15 (E1, M26): a negative unit', async () => {
    const c = await noGhostTop('-100');
    expect((await c.amounts(I(1))).amounts).toEqual({ R: '-15', A: '-21.25', B: '-21.25', NG: '-21.25' });
    expect(await c.row()).toMatchObject({ A: '-100', B: '-78.75', C: '0', ours: '-21.25' });
    await c.verify();
  });

  it('G16 (E2): a zero unit', async () => {
    const c = await noGhostTop('0');
    expect((await c.amounts(I(1))).amounts).toEqual({ R: '0', A: '0', B: '0', NG: '0' });
    expect(await c.row()).toMatchObject({ A: '0', B: '0', C: '0', ours: '0' });
    await c.verify();
  });

  it('G17 (M28, E25): a sale to Duetti from 2026-06-01', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.company('DU');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    const sale = await approvedDoc(c.f, 'contract');
    await c.f.changeSplit({
      isrc: I(1),
      from: '2026-06-01',
      shares: [{ artistId: c.id('DU'), percent: '100' }],
      documentId: sale.id,
    });
    await c.load('2026-05', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-06', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-05')).amounts).toEqual({ A: '50' });
    expect((await c.row('2026-05')).ours).toBe('50');
    expect((await c.amounts(I(1), '2026-06')).amounts).toEqual({ DU: '100' });
    expect((await c.row('2026-06')).ours).toBe('0');
    await c.verify();
  });

  async function g18(withE: boolean) {
    return single(
      async (c) => {
        await c.person('A', 'B', 'R', 'M', 'P', 'E');
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
        await c.split(I(1), [
          ['A', '25'],
          ['B', '25'],
        ]);
        await c.part(I(1), 'R', '15', 'net', 'top');
        await c.part(I(1), 'M', '13', 'net', 'artist_pool');
        await c.part(I(1), 'P', '10', 'bucket', 'label_share');
        if (withE) await c.part(I(1), 'E', '10', 'bucket', 'artist_share', { from: 'A' });
      },
      '100',
      'NoGhost Records',
    );
  }

  it('G18 (E18, Q11): every layer on one unit', async () => {
    const c = await g18(false);
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ R: '15', A: '14.75', B: '14.75', M: '13', P: '4.25', NG: '19.125' });
    expect([a.reasons.P, a.reasons.NG]).toEqual(['assumption', 'assumption']);
    expect(await c.row()).toMatchObject({
      B: '57.5',
      C: '23.375',
      ours: '19.125',
      breakdown: { assumption: '23.375' },
    });
    const s = await c.f.signals();
    expect(s.assumptions.map((x) => x.basis).sort()).toEqual(['q11', 'q11']);
    await c.verify();
  });

  it('G18b: plus E 10 of A after the pool carve', async () => {
    const c = await g18(true);
    expect((await c.amounts(I(1))).amounts).toEqual({
      R: '15',
      A: '13.275',
      B: '14.75',
      M: '13',
      E: '1.475',
      P: '4.25',
      NG: '19.125',
    });
    expect(await c.row()).toMatchObject({ B: '57.5', C: '23.375', ours: '19.125' });
    await c.verify();
  });

  it('G19 (E12): a row without document, an approved participation', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'P');
      await c.split(I(1), [['A', '50']], { doc: null });
      await c.part(I(1), 'P', '10', 'bucket', 'label_share');
    });
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ A: '50', P: '5' });
    expect(a.reasons).toEqual({ A: 'split_unconfirmed', P: null });
    expect(await c.row()).toMatchObject({
      B: '5',
      C: '50',
      ours: '45',
      breakdown: { split_unconfirmed: '50' },
    });
    await c.verify();
  });

  it('G20 (Q12): an Echo8 sublabel under an assumption rule', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.company('QQ');
        const q12 = await assumptionDoc(c.f, null, 'Q12: the half rule for other imprints');
        await c.sublabel('qaraqshy records', 'Echo8', 'QQ', { doc: q12.id });
        await c.split(I(1), [['A', '50']]);
      },
      '100',
      'qaraqshy records',
    );
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ A: '50', QQ: '25' });
    expect(a.reasons.QQ).toBe('assumption');
    expect(await c.row()).toMatchObject({ B: '50', C: '25', ours: '25', byLabel: { Echo8: '25' } });
    await c.verify();
  });

  it('G21 (R1, D-029): a sublabel on an ISRC without split', async () => {
    const c = await single(
      async (c) => {
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
      },
      '100',
      'NoGhost Records',
    );
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ NG: '50' });
    expect(a.reasons.NG).toBe('assumption');
    expect(await c.row()).toMatchObject({ B: '0', C: '50', ours: '50', noSplit: '50' });
    await c.verify();
  });

  it('G21b (D-136): signals for a sublabel without a rule in force and for a rule recipient that is a row', async () => {
    const c = await Case.start();
    await c.person('A', 'R');
    await c.company('NG');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [
      ['A', '40'],
      ['R', '10'],
    ]);
    await c.split(I(2), [['A', '50']]);
    // rule starts 2026-06: March is a sublabel month without a rule; June on ISRC 1 pays R twice (row + rule)
    const labels = c.f.modules.labels;
    const l = await labels.createLabel({
      name: 'NoGhost Records',
      kind: 'sublabel',
      ownLabelId: await c.labelId('0to8'),
    });
    await labels.addAlias(l.id, 'NoGhost Records');
    await labels.setRule({
      labelId: l.id,
      percent: '50',
      recipientArtistId: c.id('R'),
      validFrom: '2026-06-01',
      documentId: (await approvedDoc(c.f, 'contract')).id,
    });
    const rows = [
      { isrc: I(1), net: '100', label: 'NoGhost Records' },
      { isrc: I(2), net: '40', label: 'NoGhost Records' },
    ];
    await c.load('2026-03', rows);
    await c.load('2026-06', rows);
    const s = await c.f.signals();
    expect(s.sublabelWithoutRule.map((x) => [x.label, x.month, x.net.toFixed()])).toEqual([
      ['NoGhost Records', '2026-03', '140'],
    ]);
    expect(s.ruleRecipientIsRow.map((x) => [x.isrc, x.pseudonym, x.month])).toEqual([[I(1), 'R', '2026-06']]);
    expect(s.twoRowsOneOwner).toEqual([]);
    const only = await c.f.signals({ from: '2026-06', to: '2026-06' });
    expect(only.sublabelWithoutRule).toEqual([]);
    await c.verify();
  });

  it('G21c (D-136): two split rows of one ISRC belong to pseudonyms of one owner', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.second('A2', 'A');
    await c.track(I(1));
    await c.split(I(1), [
      ['A', '30'],
      ['A2', '20'],
    ]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    const s = await c.f.signals();
    expect(s.twoRowsOneOwner.map((x) => [x.isrc, x.month, x.pseudonyms])).toEqual([
      [I(1), '2026-03', ['A', 'A2']],
    ]);
    expect(s.sublabelWithoutRule).toEqual([]);
    expect(s.ruleRecipientIsRow).toEqual([]);
    await c.verify();
  });

  it('G22 (E3): the pool is smaller than the carve: shortfall 10', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'P');
      await c.split(I(1), [['A', '10']]);
      await c.part(I(1), 'P', '20', 'net', 'artist_pool');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '0', P: '10' });
    expect(await c.row()).toMatchObject({ B: '10', C: '0', ours: '90' });
    const s = await c.f.signals();
    expect(s.unfunded.map((x) => [x.isrc, x.missing.toFixed(), x.why])).toEqual([
      [I(1), '10', 'bucket_short'],
    ]);
    // the recipient and the bucket of the participation tell identical rows apart (D-150)
    expect(s.unfunded[0]).toMatchObject({ pseudonym: 'P', fundedFrom: 'artist_pool', salesMonth: '2026-03' });
    expect(s.unfunded[0]?.artistId).toBeTruthy();
    await c.verify();
  });

  it('G23 (E16, E24): the row-or-participation rule and the top cap are refused at entry', async () => {
    const c = await Case.start();
    await c.person('A', 'P', 'R1', 'R2');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await expect(c.part(I(1), 'A', '10', 'net', 'top')).rejects.toMatchObject({
      code: 'double_participation',
    });
    await c.part(I(1), 'P', '10', 'bucket', 'label_share');
    await expect(
      c.f.changeSplit({
        isrc: I(1),
        from: '2026-06-01',
        shares: [
          { artistId: c.id('A'), percent: '50' },
          { artistId: c.id('P'), percent: '10' },
        ],
        documentId: c.appendix,
      }),
    ).rejects.toMatchObject({ code: 'double_participation' });
    await c.part(I(1), 'R1', '60', 'net', 'top');
    await expect(c.part(I(1), 'R2', '60', 'net', 'top')).rejects.toMatchObject({ code: 'top_above_100' });
  });

  it('G24 (E9): one ISRC with two UPCs', async () => {
    const c = await Case.start();
    await c.person('A', 'P');
    await c.track(I(1), '1111111111111');
    await c.track(I(1), '2222222222222');
    await c.split(I(1), [['A', '50']]);
    await c.part(I(1), 'P', '10', 'bucket', 'label_share');
    await c.load('2026-03', [
      { isrc: I(1), net: '100', upc: '1111111111111' },
      { isrc: I(1), net: '50', upc: '2222222222222' },
    ]);
    expect((await c.amounts(I(1), '2026-03', '1111111111111')).amounts).toEqual({ A: '50', P: '5' });
    expect((await c.amounts(I(1), '2026-03', '2222222222222')).amounts).toEqual({ A: '25', P: '2.5' });
    expect(await c.row()).toMatchObject({ B: '82.5', C: '0', ours: '67.5' });
    expect((await c.balance('A')).total.earned.toFixed()).toBe('75');
    await c.verify();
  });

  it('G25 (M52): a participation entered mid-month starts at the month start', async () => {
    const c = await Case.start();
    await c.person('A', 'P');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    const p = await c.part(I(1), 'P', '15', 'bucket', 'label_share', { validFrom: '2026-03-15' });
    expect(p.validFrom).toBe('2026-03-01');
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50', P: '7.5' });
    await c.verify();
  });

  async function advance(c: Case, name: string, amount: string, scope: object, date = '2026-03-01') {
    const basis = await approvedDoc(c.f, 'advance_basis', c.owners.get(name));
    const op = await c.f.createOperation({ labelId: c.f.testLabels['0to8'],
      direction: 'out',
      amount,
      artistId: c.id(name),
      date,
      scope: scope as never,
      documentId: basis.id,
      comment: 'advance',
    });
    await c.f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    return op;
  }
  const migrationPayout = (c: Case, name: string, amount: string, date = '2026-04-01') =>
    c.f.createOperation({ labelId: c.f.testLabels['0to8'],
      direction: 'out',
      amount,
      ownerId: c.owners.get(name) as string,
      date,
      comment: 'migration',
      migration: true,
    });

  for (const [g, april, earned, recouped, remaining, payable] of [
    ['G27', '100', '15', '10', '0', '5'],
    ['G27b', '-100', '0', '0', '10', '0'],
  ] as const) {
    it(`${g} (M19, E21): an advance on a participation pseudonym recoups only its own income`, async () => {
      const c = await Case.start();
      await c.person('A', 'P');
      await c.track(I(1));
      await c.split(I(1), [['A', '50']]);
      await c.part(I(1), 'P', '15', 'bucket', 'label_share');
      await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
      await c.load('2026-04', [{ isrc: I(1), net: april }]);
      await advance(c, 'P', '10', { kind: 'any' });
      const b = await c.balance('P');
      expect(
        [b.total.earned, b.total.recouped, b.positions[0]?.remaining, b.total.payable].map((x) =>
          x?.toFixed(),
        ),
      ).toEqual([earned, recouped, remaining, payable]);
      expect((await c.balance('A')).total.recouped.toFixed()).toBe('0');
      await c.verify();
    });
  }

  it('G28 (M27): migration payouts; a negative payable is shown as 0', async () => {
    const c = await single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
    });
    await migrationPayout(c, 'A', '30');
    expect((await c.balance('A')).total.payable.toFixed()).toBe('20');
    await migrationPayout(c, 'A', '40');
    const b = await c.balance('A');
    expect([b.total.payable.toFixed(), b.total.payableShown.toFixed()]).toEqual(['-20', '0']);
    expect(b.total.payableNegative).toBe(true);
    await c.verify();
  });

  it('G29 (Q10, E21): an advance on the sublabel pseudonym', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
        await c.split(I(1), [['A', '50']]);
      },
      '100',
      'NoGhost Records',
    );
    await advance(c, 'NG', '50', { kind: 'any' });
    const b = await c.balance('NG');
    expect(
      [b.total.earned, b.total.recouped, b.positions[0]?.remaining, b.total.payable].map((x) => x?.toFixed()),
    ).toEqual(['25', '25', '25', '0']);
    await c.verify();
  });

  it('G30 (D-023, D-035): the perimeter', async () => {
    const c = await Case.start();
    await c.load('2026-03', [
      { isrc: '', net: '2' },
      { isrc: I(9), net: '7' },
    ]);
    expect(await c.row()).toMatchObject({
      A: '9',
      B: '0',
      C: '9',
      ours: '0',
      breakdown: { no_isrc: '2', unknown_pair: '7' },
    });
    await c.verify();
  });

  it('G31 (E4): rows 100 and a sublabel: NG 0 emitted', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
        await c.split(I(1), [['A', '100']]);
      },
      '100',
      'NoGhost Records',
    );
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '100', NG: '0' });
    expect(await c.row()).toMatchObject({ B: '100', C: '0', ours: '0' });
    await c.verify();
  });

  it('G32 (E24): rows 100 after a top 15', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'R');
      await c.split(I(1), [['A', '100']]);
      await c.part(I(1), 'R', '15', 'net', 'top');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ R: '15', A: '85' });
    expect(await c.row()).toMatchObject({ B: '100', C: '0', ours: '0' });
    await c.verify();
  });

  it('G33: reconciliation per account', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }], ACC1);
    await c.load('2026-03', [{ isrc: I(2), net: '50', label: 'Echo8' }], ACC2);
    expect(await c.row('2026-03', ACC1)).toMatchObject({
      A: '100',
      B: '50',
      ours: '50',
      byLabel: { '0to8': '50' },
    });
    expect(await c.row('2026-03', ACC2)).toMatchObject({
      A: '50',
      B: '25',
      ours: '25',
      byLabel: { Echo8: '25' },
    });
    const rows = await c.f.reconciliation();
    expect(rows.map((r) => [r.account, r.fileTotal?.toFixed()])).toEqual([
      [ACC1, '100'],
      [ACC2, '50'],
    ]);
    await c.verify();
  });

  it('G34 (exactness): a non-terminating pro rata of the pool', async () => {
    const c = await single(async (c) => {
      await c.ordered('A', 'B', 'C');
      await c.person('M');
      await c.split(I(1), [
        ['A', '16.6'],
        ['B', '16.6'],
        ['C', '16.6'],
      ]);
      await c.part(I(1), 'M', '13', 'net', 'artist_pool');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({
      A: '12.266666666666',
      B: '12.266666666667',
      C: '12.266666666667',
      M: '13',
    });
    expect(await c.row()).toMatchObject({ B: '49.8', C: '0', ours: '50.2' });
    await c.verify();
  });

  it('G35: two label-share carves from one base', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'P1', 'P2');
      await c.split(I(1), [['A', '50']]);
      await c.part(I(1), 'P1', '10', 'bucket', 'label_share');
      await c.part(I(1), 'P2', '15', 'bucket', 'label_share');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50', P1: '5', P2: '7.5' });
    expect(await c.row()).toMatchObject({ B: '62.5', C: '0', ours: '37.5' });
    await c.verify();
  });

  it('G36 (M35, Q6): the settlement 15 % of net paid by the label', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B', 'S');
      await c.split(I(1), [
        ['A', '25'],
        ['B', '25'],
      ]);
      await c.part(I(1), 'S', '15', 'net', 'label_share');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '25', B: '25', S: '15' });
    expect(await c.row()).toMatchObject({ B: '65', C: '0', ours: '35' });
    await c.verify();
  });

  it('G37 (E3 on the label share): a label-share carve above the label share', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'P');
      await c.split(I(1), [['A', '50']]);
      await c.part(I(1), 'P', '70', 'net', 'label_share');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50', P: '50' });
    expect(await c.row()).toMatchObject({ B: '100', C: '0', ours: '0' });
    expect((await c.f.signals()).unfunded.map((x) => x.missing.toFixed())).toEqual(['20']);
    await c.verify();
  });

  it('G38 (E14): the label string decides per month', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.company('NG');
    await c.sublabel('NoGhost Records', '0to8', 'NG');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100', label: 'NoGhost Records' }]);
    await c.load('2026-04', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-03')).amounts).toEqual({ A: '50', NG: '25' });
    expect((await c.row('2026-03')).ours).toBe('25');
    expect((await c.amounts(I(1), '2026-04')).amounts).toEqual({ A: '50' });
    expect((await c.row('2026-04')).ours).toBe('50');
    await c.verify();
  });

  it('G39 (E20): a retroactive top after a payout', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'R');
      await c.split(I(1), [['A', '50']]);
    });
    await migrationPayout(c, 'A', '50');
    await c.part(I(1), 'R', '15', 'net', 'top', { validFrom: '2026-01-01' });
    const b = await c.balance('A');
    expect(
      [b.total.earned, b.total.paid, b.total.payable, b.total.payableShown].map((x) => x.toFixed()),
    ).toEqual(['42.5', '50', '-7.5', '0']);
    await c.verify();
  });

  it('G40 (E13, E11): one ISRC in both accounts under Echo8, an unknown pair in the second', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100', label: 'Echo8' }], ACC1);
    await c.load(
      '2026-03',
      [
        { isrc: I(1), net: '50', label: 'Echo8' },
        { isrc: I(9), net: '7', label: 'Echo8' },
      ],
      ACC2,
    );
    expect(await c.row('2026-03', ACC1)).toMatchObject({
      A: '100',
      B: '50',
      ours: '50',
      byLabel: { Echo8: '50' },
    });
    expect(await c.row('2026-03', ACC2)).toMatchObject({
      A: '57',
      B: '25',
      C: '7',
      ours: '25',
      byLabel: { Echo8: '25' },
      breakdown: { unknown_pair: '7' },
    });
    expect((await c.balance('A')).total.earned.toFixed()).toBe('75');
    await c.verify();
  });

  it('G41 (E5): an all-zero split keeps the sublabel rule as B', async () => {
    const c = await single(
      async (c) => {
        await c.person('A');
        await c.company('NG');
        await c.sublabel('NoGhost Records', '0to8', 'NG');
        await c.split(I(1), [['A', '0']]);
      },
      '100',
      'NoGhost Records',
    );
    const a = await c.amounts(I(1));
    expect(a.amounts).toEqual({ NG: '50' });
    expect(a.reasons.NG).toBeNull();
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50', noSplit: '0' });
    await c.verify();
  });

  it('G42 (MVP 16): a brand pseudonym linked to the track takes nothing without a row', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.company('0to8');
    await c.track(I(1), UPC, ['0to8']);
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1))).amounts).toEqual({ A: '50' });
    expect(await c.row()).toMatchObject({ B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G44 (scale-down exactness): three pool carves of 13 on a pool of 10', async () => {
    const c = await single(async (c) => {
      await c.person('A');
      await c.ordered('M1', 'M2', 'M3');
      await c.split(I(1), [['A', '10']]);
      for (const m of ['M1', 'M2', 'M3']) await c.part(I(1), m, '13', 'net', 'artist_pool');
    });
    expect((await c.amounts(I(1))).amounts).toEqual({
      A: '0',
      M1: '3.333333333334',
      M2: '3.333333333333',
      M3: '3.333333333333',
    });
    expect(await c.row()).toMatchObject({ B: '10', C: '0', ours: '90' });
    const missing = (await c.f.signals()).unfunded.reduce((s, x) => s.add(x.missing), ZERO);
    expect(missing.toFixed()).toBe('29');
    await c.verify();
  });

  it('G45 (M35, M33, owner decision 6; D-137): the settlement share before its start goes to the paid artist', async () => {
    const c = await Case.start();
    await c.person('A', 'S');
    await c.track(I(1));
    // legacy registry rows before the settlement window, the window from 2026-02-01
    await c.split(
      I(1),
      [
        ['A', '35'],
        ['S', '15'],
      ],
      { to: '2026-02-01' },
    );
    await c.split(I(1), [['A', '35']], { from: '2026-02-01' });
    const settlement = (await approvedDoc(c.f, 'contract')).id;
    await c.part(I(1), 'S', '15', 'net', 'label_share', { validFrom: '2026-02-01', doc: settlement });
    // the loader step settlement-prestart: from the first report month, S's row removed and its 15 added to A
    const decision = (await approvedDoc(c.f, 'other')).id;
    await c.f.changeSplit({
      isrc: I(1),
      from: '2026-01-01',
      shares: [{ artistId: c.id('A'), percent: '50' }],
      documentId: decision,
    });
    await c.load('2026-01', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-01')).amounts).toEqual({ A: '50' });
    expect(await c.row('2026-01')).toMatchObject({ A: '100', B: '50', C: '0', ours: '50' });
    expect((await c.amounts(I(1), '2026-03')).amounts).toEqual({ A: '35', S: '15' });
    expect(await c.row('2026-03')).toMatchObject({ A: '100', B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  it('G47 (M35, M33, owner decision 6; D-138): the settlement share before its start goes to the co-artists pro rata', async () => {
    const c = await Case.start();
    await c.person('A', 'B', 'S');
    await c.track(I(1));
    // legacy registry rows under one appendix before the settlement window, the window from 2026-02-01
    await c.split(
      I(1),
      [
        ['A', '17.5'],
        ['B', '17.5'],
        ['S', '15'],
      ],
      { to: '2026-02-01' },
    );
    await c.split(
      I(1),
      [
        ['A', '17.5'],
        ['B', '17.5'],
      ],
      { from: '2026-02-01' },
    );
    const settlement = (await approvedDoc(c.f, 'contract')).id;
    await c.part(I(1), 'S', '15', 'net', 'label_share', { validFrom: '2026-02-01', doc: settlement });
    // the loader step settlement-prestart (D-138): S's 15 spread over A and B pro rata to 17.5 : 17.5
    const decision = (await approvedDoc(c.f, 'other')).id;
    await c.f.changeSplit({
      isrc: I(1),
      from: '2026-01-01',
      shares: [
        { artistId: c.id('A'), percent: '25' },
        { artistId: c.id('B'), percent: '25' },
      ],
      documentId: decision,
    });
    await c.load('2026-01', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-02', [{ isrc: I(1), net: '100' }]);
    expect((await c.amounts(I(1), '2026-01')).amounts).toEqual({ A: '25', B: '25' });
    expect(await c.row('2026-01')).toMatchObject({ A: '100', B: '50', C: '0', ours: '50' });
    expect((await c.amounts(I(1), '2026-02')).amounts).toEqual({ A: '17.5', B: '17.5', S: '15' });
    expect(await c.row('2026-02')).toMatchObject({ A: '100', B: '50', C: '0', ours: '50' });
    await c.verify();
  });

  describe('G46 (M13, M43; D-137): a Main carve "16.66 % (8.33 %/8.33 %)" from the first month', () => {
    async function world(entry: 'per_source' | 'pool') {
      const c = await Case.start();
      await c.person('A', 'B', 'M1', 'M2');
      await c.track(I(1));
      await c.split(I(1), [
        ['A', '25'],
        ['B', '25'],
      ]);
      for (const m of ['M1', 'M2'])
        if (entry === 'per_source')
          for (const src of ['A', 'B'])
            await c.part(I(1), m, '16.66', 'bucket', 'artist_share', { from: src, validFrom: '2026-01-01' });
        else await c.part(I(1), m, '8.33', 'net', 'artist_pool', { validFrom: '2026-01-01' });
      await c.load('2026-01', [{ isrc: I(1), net: '100' }]);
      await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
      return c;
    }
    for (const entry of ['per_source', 'pool'] as const)
      it(`entered ${entry === 'pool' ? 'as pool participations of net (the D-137 loader)' : 'per source artist (12 as stated)'}`, async () => {
        const c = await world(entry);
        for (const month of ['2026-01', '2026-03']) {
          expect((await c.amounts(I(1), month)).amounts).toEqual({
            A: '16.67',
            B: '16.67',
            M1: '8.33',
            M2: '8.33',
          });
          expect(await c.row(month)).toMatchObject({ A: '100', B: '50', C: '0', ours: '50' });
        }
        await c.verify();
      });
  });

  describe('G43 (M19, M20): scopes of recoupment, each from payable 80', () => {
    async function base() {
      const c = await single(async (c) => {
        await c.person('A');
        await c.track(I(2));
        await c.split(I(1), [['A', '50']]);
      });
      const owner = c.owners.get('A') as string;
      await c.f.modules.owners.addOwnerAlias(owner, 'OWNER, A');
      await c.f.modules.publishing.setTerms({
        ownerId: owner,
        percent: '50',
        validFrom: '2020-01-01',
        documentId: (await approvedDoc(c.f, 'contract', owner)).id,
      });
      await c.f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '60' }]), c.f.testLabels['0to8']);
      expect((await c.balance('A')).total.payable.toFixed()).toBe('80');
      return c;
    }
    it('(i) an advance 40 scope publishing: recouped 30, remaining 10, payable 50', async () => {
      const c = await base();
      await advance(c, 'A', '40', { kind: 'publishing' }, '2026-01-01');
      const b = await c.balance('A');
      expect([b.total.recouped, b.positions[0]?.remaining, b.total.payable].map((x) => x?.toFixed())).toEqual(
        ['30', '10', '50'],
      );
      await c.verify();
    });
    it('(ii) an advance 40 scope isrcs [another ISRC]: recouped 0, payable 80', async () => {
      const c = await base();
      await advance(c, 'A', '40', { kind: 'isrcs', isrcs: [I(2)] }, '2026-01-01');
      const b = await c.balance('A');
      expect([b.total.recouped, b.total.payable].map((x) => x.toFixed())).toEqual(['0', '80']);
      await c.verify();
    });
    it('(iii) a migration payout 20 without scope: paid 20, payable 60', async () => {
      const c = await base();
      await migrationPayout(c, 'A', '20');
      const b = await c.balance('A');
      expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['20', '60']);
      await c.verify();
    });
  });

  describe('G48 (S31 k4, 10 §5): a deduction is a position, a credit adds to the balance', () => {
    async function base() {
      const c = await single(async (c) => {
        await c.person('A');
        await c.split(I(1), [['A', '50']]);
      });
      expect((await c.balance('A')).total.payable.toFixed()).toBe('50');
      return c;
    }
    const deduction = async (c: Case, amount: string, basis: { id: string }) =>
      c.f.createOperation({ labelId: c.f.testLabels['0to8'],
        direction: 'in',
        amount,
        artistId: c.id('A'),
        date: '2026-03-01',
        documentId: basis.id,
        comment: 'deduction',
      });
    it('a deduction 10 on an unapproved basis waits; approved it recoups 10 and payable is 40', async () => {
      const c = await base();
      const o = c.f.modules.owners;
      const draft = await o.createDocument({
        kind: 'adjustment_basis',
        title: 'Adjustment',
        fileRef: 'dummy://a.pdf',
        ownerId: c.owners.get('A') as string,
        requiresApproval: true,
      });
      await deduction(c, '10', draft);
      let b = await c.balance('A');
      expect([b.total.recouped, b.total.payable].map((x) => x.toFixed())).toEqual(['0', '50']);
      expect(b.pendingOperations).toHaveLength(1);
      await o.approveDocument(draft.id, 'manager');
      b = await c.balance('A');
      expect([b.total.recouped, b.total.payable].map((x) => x.toFixed())).toEqual(['10', '40']);
      expect(b.pendingOperations).toHaveLength(0);
      expect(b.positions.map((p) => [p.amount, p.recouped, p.remaining].map((x) => x.toFixed()))).toEqual([
        ['10', '10', '0'],
      ]);
      await c.verify();
    });
    it('a credit -5 adds 5: credits 5, payable 45', async () => {
      const c = await base();
      const basis = await approvedDoc(c.f, 'adjustment_basis', c.owners.get('A'));
      await deduction(c, '10', basis);
      await deduction(c, '-5', basis);
      const b = await c.balance('A');
      expect([b.total.recouped, b.total.credits, b.total.payable].map((x) => x.toFixed())).toEqual([
        '10',
        '5',
        '45',
      ]);
      await c.verify();
    });
    it('a deduction 70 above the income 50: recouped 50, remaining 20, payable 0', async () => {
      const c = await base();
      await deduction(c, '70', await approvedDoc(c.f, 'adjustment_basis', c.owners.get('A')));
      const b = await c.balance('A');
      expect(
        [b.total.recouped, b.positions[0]?.remaining, b.total.payable].map((x) => x?.toFixed()),
      ).toEqual(['50', '20', '0']);
      await c.verify();
    });
  });

  describe('G49 (S31 k4, S22): deactivate and return of a payout', () => {
    async function base() {
      const c = await single(async (c) => {
        await c.person('A');
        await c.split(I(1), [['A', '50']]);
      });
      return c;
    }
    it('a migration payout 30 then deactivated: payable 20, then 50 again', async () => {
      const c = await base();
      const op = await migrationPayout(c, 'A', '30');
      expect((await c.balance('A')).total.payable.toFixed()).toBe('20');
      const off = await c.f.modules.settlements.deactivate(op.id, 'entered twice');
      expect(off.active).toBe(false);
      const b = await c.balance('A');
      expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['0', '50']);
      await c.verify();
    });
    it('a button payout without proof does not count; deactivated (transfer failed) it unblocks', async () => {
      const c = await base();
      const op = await c.f.createPayout(c.owners.get('A') as string, { labelId: c.f.testLabels['0to8'] });
      expect(op.amountCents).toBe(5000);
      let b = await c.balance('A');
      expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['0', '50']);
      expect(b.blockingPayouts).toEqual([op.id]);
      await c.f.modules.settlements.deactivate(op.id, 'transfer failed', { transferFailed: true });
      b = await c.balance('A');
      expect([b.total.payable.toFixed(), b.blockingPayouts.length, b.payout.allowed]).toEqual(['50', 0, true]);
    });
    it('deduction 10, credit -5, deactivated deduction: 40, 45, 55; payout 55 with proof: 0; return: 55', async () => {
      const c = await base();
      const basis = await approvedDoc(c.f, 'adjustment_basis', c.owners.get('A'));
      const make = (amount: string) =>
        c.f.createOperation({ labelId: c.f.testLabels['0to8'],
          direction: 'in',
          amount,
          artistId: c.id('A'),
          date: '2026-03-01',
          documentId: basis.id,
          comment: 'adjustment',
        });
      const ded = await make('10');
      const payable = async () => (await c.balance('A')).total.payable.toFixed();
      expect(await payable()).toBe('40');
      await make('-5');
      expect(await payable()).toBe('45');
      await c.f.modules.settlements.deactivate(ded.id, 'entered by mistake');
      expect(await payable()).toBe('55');
      const payout = await c.f.createPayout(c.owners.get('A') as string, { labelId: c.f.testLabels['0to8'] });
      expect(payout.amountCents).toBe(5500);
      await c.f.attachPaymentProof(payout.id, { fileRef: 'dummy://proof.pdf' });
      let b = await c.balance('A');
      expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['55', '0']);
      const ret = await c.f.returnPayout(payout.id, {
        fileRef: 'dummy://return.pdf',
        date: payout.date,
        comment: 'bounced',
      });
      expect([ret.meaning, ret.amountCents]).toEqual(['return', -5500]);
      b = await c.balance('A');
      expect([b.total.paid, b.total.returns, b.total.payable].map((x) => x.toFixed())).toEqual([
        '55',
        '55',
        '55',
      ]);
      await c.verify();
    });
  });
});

describe('G50 (D-168): the label as a book', () => {
  it('one owner under both labels: an advance without a label, an advance of Echo8, a payout under 0to8', async () => {
    const c = await Case.start();
    const f = c.f;
    await c.person('A');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']]);
    // two files of one month in two accounts (D-169): I(1) in the 0to8 account, I(2) in the Echo8 account
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-03', [{ isrc: I(2), net: '60', label: 'Echo8' }], ACC2);
    const owner = c.owners.get('A') as string;
    const basis = await approvedDoc(f, 'advance_basis', owner);
    // the advance without a label (migrated: the history before the split) is recouped from any income, I(1) first
    await f.createOperation({ direction: 'out', amount: '40', artistId: c.id('A'), date: '2026-03-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance', migration: true });
    const echo = await f.createOperation({ direction: 'out', amount: '10', artistId: c.id('A'), date: '2026-03-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance Echo8', labelId: f.testLabels.Echo8 });
    await f.attachPaymentProof(echo.id, { fileRef: 'dummy://proof.pdf' });
    const books = async () => {
      const b = await c.balance('A');
      return {
        total: [b.total.earned, b.total.recouped, b.total.paid, b.total.payable].map((x) => x.toFixed()),
        ...Object.fromEntries(Object.entries(b.byLabel).map(([k, x]) => [k, [x.earned, x.recouped, x.paid, x.payable].map((v) => v.toFixed())])),
      };
    };
    expect(await books()).toEqual({ total: ['80', '50', '0', '30'], '0to8': ['50', '40', '0', '10'], Echo8: ['30', '10', '0', '20'] });
    const p = await f.createPayout(owner, { labelId: f.testLabels['0to8'] });
    expect([p.amountCents, p.labelId]).toEqual([1000, f.testLabels['0to8']]);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof-2.pdf' });
    expect(await books()).toEqual({ total: ['80', '50', '10', '20'], '0to8': ['50', '40', '10', '0'], Echo8: ['30', '10', '0', '20'] });
    await c.verify();
  });
});

describe('G51, G52 (D-169): the book of a unit is the label of its file', () => {
  it('G51: a foreign «Echo8» line in the 0to8 account sits in the 0to8 book; the string still leads to Echo8', async () => {
    const c = await single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
    }, '100', 'Echo8');
    const f = c.f;
    const zero = f.testLabels['0to8'];
    const echo = f.testLabels.Echo8;
    const r = (await f.reconciliation()).find((x) => x.account === ACC1 && x.month === '2026-03');
    expect(r && Object.fromEntries(Object.entries(r.byLabel).map(([k, b]) => [k, [b.A_received, b.B_notOurs, b.ourShare].map((x) => x.toFixed())]))).toEqual({
      '0to8': ['100', '50', '50'],
    });
    // the reference invariant: ourShareByLabel stays by the label string
    expect(await c.row()).toMatchObject({ A: '100', B: '50', ours: '50', byLabel: { Echo8: '50' } });
    const [m] = (await f.trackMoney(I(1))).months;
    expect(m && [m.bookLabelId, m.bookLabelName, m.ourLabelName, m.labelName]).toEqual([zero, '0to8', 'Echo8', 'Echo8']);
    const s = await f.signals();
    expect(s.labelOutsideAccount.map((x) => [x.account, x.labelName, x.ourLabelName, x.accountLabelName, x.net.toFixed()])).toEqual([
      [ACC1, 'Echo8', 'Echo8', '0to8', '100'],
    ]);
    expect(s.counts.labelOutsideAccount).toBe(1);
    const a = c.owners.get('A') as string;
    expect(Object.keys((await f.ownerBalance(a)).byLabel)).toEqual(['0to8']);
    const underEcho = await f.ownerBalance(a, {}, echo);
    expect([underEcho.total.earned.toFixed(), underEcho.total.payable.toFixed()]).toEqual(['0', '0']);
    expect((await f.ownerBalance(a, {}, zero)).total.earned.toFixed()).toBe('50');
    await c.verify();
  });

  /** A: row A 50 on I(1); an advance 100 under 0to8 of 2026-03; I(1) earns 120 in the 0to8 account, 80 in the Echo8 one. */
  async function moved(echoMonth: string) {
    const c = await Case.start();
    const f = c.f;
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    const owner = c.owners.get('A') as string;
    const basis = await approvedDoc(f, 'advance_basis', owner);
    const adv = await f.createOperation({ direction: 'out', amount: '100', artistId: c.id('A'), date: '2026-03-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance 0to8', labelId: f.testLabels['0to8'] });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://proof.pdf' });
    await c.load('2026-03', [{ isrc: I(1), net: '120' }]);
    await c.load(echoMonth, [{ isrc: I(1), net: '80', label: 'Echo8' }], ACC2);
    const b = await c.balance('A');
    expect({
      total: [b.total.earned, b.total.recouped, b.total.payable].map((x) => x.toFixed()),
      ...Object.fromEntries(Object.entries(b.byLabel).map(([k, x]) => [k, [x.earned, x.recouped, x.payable].map((v) => v.toFixed())])),
    }).toEqual({ total: ['100', '60', '40'], '0to8': ['60', '60', '0'], Echo8: ['40', '0', '40'] });
    expect(b.positions.map((p) => [p.recouped.toFixed(), p.remaining.toFixed()])).toEqual([['60', '40']]);
    await c.verify();
  }

  it('G52: an ISRC moved from the 0to8 account to the Echo8 one: the 0to8 advance is recouped from the 0to8 income only', async () => {
    await moved('2026-04');
  });

  it('G52, the same month: both accounts report the ISRC in one month: two income items, the same books', async () => {
    await moved('2026-03');
  });
});

describe('G54 (D-169): the label of an advertising record is its payer', () => {
  it('an ad paid by 0to8 on an ISRC whose income that month is in the Echo8 account charges the 0to8 book', async () => {
    const c = await Case.start();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100', label: 'Echo8' }], ACC2);
    const { created } = await f.createAds([{ isrc: I(1), month: '2026-03', amount: '10', labelId: zero }]);
    const b = await c.balance('A');
    expect(Object.fromEntries(Object.entries(b.byLabel).map(([k, x]) => [k, [x.earned, x.adsCharged, x.payable].map((v) => v.toFixed())]))).toEqual({
      '0to8': ['0', '10', '-10'],
      Echo8: ['50', '0', '50'],
    });
    expect([b.total.earned, b.total.adsCharged, b.total.payable].map((v) => v.toFixed())).toEqual(['50', '10', '40']);
    expect(b.ads.map((x) => [x.labelId, x.amount.toFixed()])).toEqual([[zero, '10']]);
    const s = await f.signals();
    expect(s.adOutsideBook.map((x) => [x.adId, x.isrc, x.month, x.amount.toFixed(), x.payerLabelName, x.bookLabelName])).toEqual([
      [created[0]?.id, I(1), '2026-03', '10', '0to8', 'Echo8'],
    ]);
    expect([s.counts.adOutsideBook, s.counts.adsWithoutLabel]).toEqual([1, 0]);
    await expect(f.createAds([{ isrc: I(1), month: '2026-03', amount: '10' }])).rejects.toMatchObject({ code: 'label_required' });
    await c.verify();
  });
});

describe('G55 (D-169): a B17 statement sits in the book of its label', () => {
  it('a statement under Echo8 for an owner whose only contract is 0to8: the publishing money is in the Echo8 book, closed by no_contract_for_label', async () => {
    const c = await Case.start();
    const f = c.f;
    const [zero, echo] = [f.testLabels['0to8'], f.testLabels.Echo8];
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    const owner = c.owners.get('A') as string;
    const [contractDoc] = await f.modules.owners.listDocuments({ ownerId: owner, kind: 'contract' });
    await f.setDocumentLabel(contractDoc?.id as string, zero);
    await f.modules.owners.addOwnerAlias(owner, 'OWNER, A');
    await f.setPublishingTerms({ ownerId: owner, percent: '50', validFrom: '2020-01-01', documentId: contractDoc?.id as string });
    const r = await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '60' }]), echo);
    await f.resolveWriters();
    expect(r.statement.labelId).toBe(echo);
    const b = await c.balance('A');
    expect(Object.fromEntries(Object.entries(b.byLabel).map(([k, x]) => [k, [x.earned, x.payable].map((v) => v.toFixed())]))).toEqual({
      '0to8': ['50', '50'],
      Echo8: ['30', '30'],
    });
    expect([b.total.earned, b.total.payable].map((v) => v.toFixed())).toEqual(['80', '80']);
    // the view under Echo8 is the Echo8 book with its publishing line; under 0to8 no B17 line is seen
    const underEcho = await f.ownerBalance(owner, {}, echo);
    expect([underEcho.confirmed, underEcho.payout.reason, underEcho.total.payable.toFixed()]).toEqual([false, 'no_contract_for_label', '30']);
    expect(underEcho.publishing.map((p) => [p.period, p.amount.toFixed(), p.category])).toEqual([['2026-Q2', '30', 'B']]);
    const underZero = await f.ownerBalance(owner, {}, zero);
    expect([underZero.payout.reason, underZero.total.payable.toFixed(), underZero.publishing.length]).toEqual([null, '50', 0]);
    await expect(f.createPayout(owner, { labelId: echo })).rejects.toMatchObject({ code: 'no_contract_for_label' });
    // the reconciliation row of B17 is the one book Echo8
    const row = (await f.reconciliation()).find((x) => x.source === 'b17');
    expect(Object.keys(row?.byLabel ?? {})).toEqual(['Echo8']);
    const s = await f.signals();
    expect(s.counts.statementsWithoutLabel).toBe(0);
    await c.verify();
  });
});

describe('G56 (D-169): a payout under a label requires an approved contract with that label', () => {
  it('a document without a label opens both labels; a contract of 0to8 does not open Echo8', async () => {
    const c = await Case.start();
    const f = c.f;
    const [zero, echo] = [f.testLabels['0to8'], f.testLabels.Echo8];
    await c.person('A');
    await c.track(I(1));
    await c.track(I(2));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']]);
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-03', [{ isrc: I(2), net: '60', label: 'Echo8' }], ACC2);
    const owner = c.owners.get('A') as string;
    const [contractDoc] = await f.modules.owners.listDocuments({ ownerId: owner, kind: 'contract' });
    const gates = async () =>
      Promise.all([undefined, zero, echo].map(async (l) => {
        const b = await f.ownerBalance(owner, {}, l);
        return [b.confirmed, b.payout.reason, b.total.payable.toFixed()];
      }));
    // the contract document without a label: any label
    expect(contractDoc?.labelId).toBeNull();
    expect(await gates()).toEqual([[true, null, '80'], [true, null, '50'], [true, null, '30']]);
    // the contract of 0to8: Echo8 is closed with its own reason, the money is unchanged
    await f.setDocumentLabel(contractDoc?.id as string, zero);
    expect(await gates()).toEqual([[true, null, '80'], [true, null, '50'], [false, 'no_contract_for_label', '30']]);
    expect((await f.ownerPayables({ label: echo })).items.find((x) => x.ownerId === owner)?.payout.reason).toBe('no_contract_for_label');
    await expect(f.createPayout(owner, { labelId: echo })).rejects.toMatchObject({
      statusCode: 422,
      code: 'no_contract_for_label',
      details: { labelId: echo },
    });
    const basis = await approvedDoc(f, 'advance_basis', owner);
    await expect(
      f.createOperation({ direction: 'out', amount: '5', artistId: c.id('A'), date: '2026-03-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance Echo8', labelId: echo }),
    ).rejects.toMatchObject({ code: 'no_contract_for_label', details: { labelId: echo } });
    // no contract at all stays owner_not_confirmed, under a label too
    await f.modules.owners.attachFile(contractDoc?.id as string, 'dummy://again.pdf'); // re-attaching drops the approval
    expect((await f.ownerBalance(owner, {}, echo)).payout.reason).toBe('owner_not_confirmed');
    await expect(f.createPayout(owner, { labelId: echo })).rejects.toMatchObject({ code: 'owner_not_confirmed' });
    await f.modules.owners.approveDocument(contractDoc?.id as string, 'manager');
    const p = await f.createPayout(owner, { labelId: zero });
    expect([p.amountCents, p.labelId]).toEqual([5000, zero]);
    const total = await c.balance('A');
    expect([total.total.earned, total.total.payable].map((x) => x.toFixed())).toEqual(['80', '80']); // deferred: not paid yet
    await c.verify();
  });
});

describe('G57–G60 (D-173): buyout, forgiveness, write-off and adjustment in the books', () => {
  /** owner A: row A 50 on I(1), unit 100 of 2026-03 in the 0to8 account: earned 50, payable 50. */
  const base = () =>
    single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
    });

  it('G57: a buyout is in the book, neither paid nor in payable, and never blocks the button', async () => {
    const c = await base();
    const f = c.f;
    const owner = c.owners.get('A') as string;
    const zero = f.testLabels['0to8'];
    const doc = await approvedDoc(f, 'buyout', owner);
    const buyout = await f.createOperation({ kind: 'buyout', direction: 'out', amount: '1000', ownerId: owner, date: '2026-04-01', documentId: doc.id, comment: 'buyout', labelId: zero });
    expect([buyout.kind, buyout.area, buyout.labelSource]).toEqual(['buyout', 'master', 'operator']);
    // without its proof the buyout does not count and does not block: the button pays 50.00
    let b = await c.balance('A');
    expect([b.total.buyouts.toFixed(), b.total.payable.toFixed(), b.blockingPayouts.length, b.payout.allowed, b.payout.amountCents]).toEqual(['0', '50', 0, true, 5000]);
    await f.attachPaymentProof(buyout.id, { fileRef: 'dummy://buyout-proof.pdf' });
    b = await c.balance('A');
    expect([b.total.earned, b.total.paid, b.total.buyouts, b.total.payable].map((x) => x.toFixed())).toEqual(['50', '0', '1000', '50']);
    expect([b.byLabel['0to8']?.buyouts.toFixed(), b.total.byArea.master.buyouts.toFixed(), b.blockingPayouts]).toEqual(['1000', '1000', []]);
    await c.verify();
    const payout = await f.createPayout(owner, { labelId: zero });
    expect(payout.amountCents).toBe(5000);
    // control: the same 1 000 as a migrated payout would take payable to −950
    await f.createOperation({ direction: 'out', amount: '1000', ownerId: owner, date: '2026-04-01', comment: 'control', migration: true, labelId: zero });
    b = await c.balance('A');
    expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['1000', '-950']);
  });

  it('G58, G58b: a forgiveness from a date leaves payable at the moment and frees the income after the date', async () => {
    const c = await Case.start();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    await c.person('A');
    await c.track(I(1));
    await c.split(I(1), [['A', '50']]);
    await c.load('2026-02', [{ isrc: I(1), net: '100' }]);
    const owner = c.owners.get('A') as string;
    const basis = await approvedDoc(f, 'advance_basis', owner);
    const adv = await f.createOperation({ labelId: zero, direction: 'out', amount: '100', artistId: c.id('A'), date: '2026-01-01', scope: { kind: 'any' }, documentId: basis.id, comment: 'advance' });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://proof.pdf' });
    const state = async () => {
      const b = await c.balance('A');
      const p = b.positions[0];
      return [b.total.recouped, b.total.forgiven, p?.remaining, b.total.payable].map((x) => x?.toFixed());
    };
    // step 1: recouped 50 of the 2026-02 income
    expect(await state()).toEqual(['50', '0', '50', '0']);
    // step 2: forgiven 30 from 2026-04-10: payable does not move
    const decision = await approvedDoc(f, 'adjustment_basis', owner);
    const forgiveness = await f.forgiveAdvance(adv.id, { amount: '30', date: '2026-04-10', documentId: decision.id, comment: 'forgiven' });
    expect([forgiveness.kind, forgiveness.operationRef, forgiveness.ownerId, forgiveness.artistId, forgiveness.labelId, forgiveness.labelSource]).toEqual([
      'forgiveness', adv.id, owner, c.id('A'), zero, 'payout',
    ]);
    expect(await state()).toEqual(['50', '30', '20', '0']);
    expect((await c.balance('A')).byLabel['0to8']?.forgiven.toFixed()).toBe('30');
    await c.verify();
    // the refusals: above the unrecouped 20, before the advance, not an advance
    await expect(f.forgiveAdvance(adv.id, { amount: '21', date: '2026-04-10', documentId: decision.id, comment: 'more' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'forgiveness_exceeds',
      details: { unrecouped: '20' },
    });
    await expect(f.forgiveAdvance(adv.id, { amount: '5', date: '2025-12-31', documentId: decision.id, comment: 'early' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'forgiveness_before_advance',
    });
    const payout = await f.createOperation({ direction: 'out', amount: '0.01', ownerId: owner, date: '2026-04-01', comment: 'a payout', migration: true, labelId: zero });
    await f.deactivateOperation(payout.id, 'only for the refusal');
    await expect(f.forgiveAdvance(payout.id, { amount: '5', date: '2026-04-10', documentId: decision.id, comment: 'wrong' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'operation_ref_not_advance',
    });
    await expect(f.deactivateOperation(adv.id, 'mistake')).rejects.toMatchObject({ statusCode: 409, code: 'has_forgiveness' });
    // step 3: the 2026-04 income 50: the capacity from 2026-04 is 100 − 50 − 30 = 20, so 30 of it is payable
    await c.load('2026-04', [{ isrc: I(1), net: '100' }]);
    expect(await state()).toEqual(['70', '30', '0', '30']);
    expect((await f.signals()).forgivenessReduced).toEqual([]);
    await c.verify();
    // G58b: the 2026-03 income arrives after the forgiveness: it recoups first, the forgiveness has nothing left
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    expect(await state()).toEqual(['100', '0', '0', '50']);
    const s = await f.signals();
    expect(s.forgivenessReduced.map((x) => [x.operationId, x.ownerId, x.recorded.toFixed(), x.effective.toFixed()])).toEqual([[adv.id, owner, '30', '0']]);
    expect(s.counts.forgivenessReduced).toBe(1);
    await c.verify();
  });

  it('G59: a write-off of publishing is taken off payable, at most the publishing the book has', async () => {
    const c = await base();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    const owner = c.owners.get('A') as string;
    await f.modules.owners.addOwnerAlias(owner, 'OWNER, A');
    await f.modules.publishing.setTerms({ ownerId: owner, percent: '50', validFrom: '2020-01-01', documentId: (await approvedDoc(f, 'contract', owner)).id });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '60' }]), zero);
    const basis = await approvedDoc(f, 'adjustment_basis', owner);
    const writeoff = (amount: string, area?: 'master' | 'publishing') =>
      f.createOperation({ kind: 'writeoff', direction: 'in', amount, ownerId: owner, date: '2026-07-01', documentId: basis.id, comment: 'write-off', labelId: zero, ...(area ? { area } : {}) });
    await expect(writeoff('31')).rejects.toMatchObject({ statusCode: 422, code: 'writeoff_exceeds', details: { available: '30' } });
    await expect(writeoff('5', 'master')).rejects.toMatchObject({ statusCode: 400, code: 'writeoff_area' });
    const op = await writeoff('20');
    expect([op.kind, op.area, op.scope]).toEqual(['writeoff', 'publishing', null]);
    const b = await c.balance('A');
    expect([b.total.earned, b.total.writtenOff, b.total.payable].map((x) => x.toFixed())).toEqual(['80', '20', '60']);
    expect([b.total.byArea.master.earned, b.total.byArea.publishing.earned, b.total.byArea.master.payable, b.total.byArea.publishing.payable].map((x) => x.toFixed())).toEqual([
      '50', '30', '50', '10',
    ]);
    await expect(writeoff('11')).rejects.toMatchObject({ code: 'writeoff_exceeds', details: { available: '10' } });
    // the button of the publishing area pays min(payable of the area 10, payable of the book 60) = 10.00 (D-173 К10)
    expect((await f.ownerBalance(owner, { area: 'publishing' }, zero)).payout.amountCents).toBe(1000);
    const paid = await f.createPayout(owner, { labelId: zero, area: 'publishing' });
    expect([paid.amountCents, paid.area]).toEqual([1000, 'publishing']);
    expect(((await f.modules.settlements.getSnapshot(paid.id)) as { area: string; payoutByArtist: { key: string }[] }).area).toBe('publishing');
    await c.verify();
  });

  it('G60: an adjustment adds to payable with its sign, in its own book only', async () => {
    const c = await base();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    const owner = c.owners.get('A') as string;
    const basis = await approvedDoc(f, 'adjustment_basis', owner);
    const adjust = (amount: string) =>
      f.createOperation({ kind: 'adjustment', direction: 'in', amount, ownerId: owner, date: '2026-10-15', documentId: basis.id, comment: 'adjustment', labelId: zero });
    await adjust('-170.55');
    let b = await c.balance('A');
    expect([b.total.adjustments, b.total.payable].map((x) => x.toFixed())).toEqual(['170.55', '220.55']);
    await adjust('20.55');
    b = await c.balance('A');
    expect([b.total.adjustments, b.total.payable].map((x) => x.toFixed())).toEqual(['150', '200']);
    expect(Object.keys(b.byLabel)).toEqual(['0to8']); // the Echo8 book does not appear
    expect([b.payout.allowed, b.payout.amountCents]).toEqual([true, 20000]);
    // asOf 2026-09: the adjustments of 2026-10-15 are not in the cut, payable 50 (D-173 §3.3)
    expect((await f.ownerBalance(owner, { asOf: '2026-09' })).total.payable.toFixed()).toBe('50');
    await expect(f.createOperation({ kind: 'adjustment', direction: 'in', amount: '1', ownerId: owner, date: '2026-10-15', comment: 'no basis', labelId: zero })).rejects.toMatchObject({
      code: 'document_required',
    });
    await c.verify();
  });
});

describe('G61 (D-172): an approved label decision confirms the owner like a contract', () => {
  /**
   * rows A 30, B 20 on I(1); participation P 10 (net, top); unit 100. B's owner is confirmed by a contract whose
   * document is of `kind`; B's row and P's participation cite an approved document of `kind` too.
   */
  async function scenario(kind: 'contract' | 'label_decision') {
    const c = await Case.start();
    const o = c.f.modules.owners;
    await c.person('A', 'P');
    const owner = await o.createOwner({ name: 'Owner B', kind: 'person' });
    const b = await o.createArtist({ pseudonym: 'B', ownerId: owner.id });
    c.ids.set('B', b.id);
    c.names.set(b.id, 'B');
    c.owners.set('B', owner.id);
    const basis = await o.createDocument({ kind, title: `Dummy ${kind} B`, fileRef: 'dummy://b.pdf', ownerId: owner.id, requiresApproval: true });
    await o.createContract({ ownerId: owner.id, documentId: basis.id, artistIds: [b.id] });
    const rowDoc = (await approvedDoc(c.f, kind)).id;
    await c.track(I(1));
    await c.split(I(1), [['A', '30'], ['B', '20', rowDoc]]);
    await c.part(I(1), 'P', '10', 'net', 'top', { doc: rowDoc });
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    return { c, basis: basis.id, owner: owner.id };
  }

  it('the same numbers as a contract: P 10, A 27, B 18 in B; ours 45; before approval B waits as owner_unconfirmed', async () => {
    const decision = await scenario('label_decision');
    const { c } = decision;
    // not approved yet: the row and the participation are confirmed by the approved decision, the owner is not
    expect(await c.amounts(I(1))).toEqual({
      amounts: { P: '10', A: '27', B: '18' },
      reasons: { P: null, A: null, B: 'owner_unconfirmed' },
    });
    expect(await c.row()).toMatchObject({ A: '100', B: '37', C: '18', ours: '45' });
    await c.f.modules.owners.approveDocument(decision.basis, 'manager');
    const after = { amounts: await c.amounts(I(1)), row: await c.row(), balance: await c.balance('B') };
    expect(after.amounts).toEqual({ amounts: { P: '10', A: '27', B: '18' }, reasons: { P: null, A: null, B: null } });
    expect(after.row).toMatchObject({ A: '100', B: '55', C: '0', ours: '45' });
    expect([after.balance.confirmed, after.balance.total.earned.toFixed(), after.balance.total.waiting.toFixed()]).toEqual([true, '18', '0']);
    await c.verify();

    // the contract case: byte for byte the same allocations, reconciliation row and balance of B
    const contract = await scenario('contract');
    await contract.c.f.modules.owners.approveDocument(contract.basis, 'manager');
    const balance = await contract.c.balance('B');
    expect(await contract.c.amounts(I(1))).toEqual(after.amounts);
    expect(await contract.c.row()).toEqual(after.row);
    expect([balance.confirmed, balance.total.earned.toFixed(), balance.total.waiting.toFixed()]).toEqual([true, '18', '0']);
  });
});

describe('signals of 10 §6 without a golden number (M29, D-130)', () => {
  it('tracksWithNote lists a noted track without changing an amount; participantsWithoutOwner carries the amount', async () => {
    let orphan = '';
    const c = await single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
      orphan = (await c.f.modules.owners.createArtist({ pseudonym: 'Orphan D130', ownerId: null })).id;
      await c.f.createParticipation({
        isrc: I(1),
        artistId: orphan,
        percent: '10',
        base: 'bucket',
        fundedFrom: 'label_share',
        validFrom: '2020-01-01',
        documentId: c.appendix,
      });
    });
    const before = await c.amounts(I(1));
    const rowBefore = await c.row();
    const track = (await c.f.modules.owners.listTracks()).find((t) => t.isrc === I(1))!;
    await c.f.modules.owners.setTrackNote(track.id, 'derivative outside the authorisation');
    const s = await c.f.signals();
    expect(s.tracksWithNote).toEqual([
      { trackId: track.id, isrc: I(1), upc: UPC, title: I(1), note: 'derivative outside the authorisation' },
    ]);
    expect(s.participantsWithoutOwner.map((p) => ({ ...p, amount: p.amount.toFixed() }))).toMatchObject([
      { isrc: I(1), artistId: orphan, pseudonym: 'Orphan D130', fundedFrom: 'label_share', amount: '5' },
    ]);
    // the note changes no amount
    expect(await c.amounts(I(1))).toEqual(before);
    expect(await c.row()).toEqual(rowBefore);
    expect(before.amounts).toEqual({ A: '50', [orphan]: '5' });
    await c.verify();
  });
});

describe('a layer that loses money shows as a discrepancy (10 §6)', () => {
  it('a broken split layer that drops a row without returning it to the label share', async () => {
    const c = await single(async (c) => {
      await c.person('A', 'B');
      await c.split(I(1), [
        ['A', '30'],
        ['B', '20'],
      ]);
    });
    const broken: NamedLayer[] = MASTER_LAYERS.map((l) =>
      l.name !== 'split'
        ? l
        : {
            name: 'split',
            run: (s, ctx) => {
              const out = l.run(s, ctx);
              return { ...out, rows: out.rows.slice(0, -1) };
            },
          },
    );
    const modules = { ...c.f.modules, db: c.f.db };
    const good = reconcile(await calculate(modules));
    expect(good.map((r) => r.discrepancy.toFixed())).toEqual(['0']);
    const bad = reconcile(await calculate(modules, [], { layers: broken }));
    expect(bad.map((r) => r.discrepancy.toFixed())).toEqual(['20']);
  });
});

describe('publishing golden cases G26a-e (12 §Publishing cases), end to end', () => {
  const lines = [
    { title: 'T-A', writer: 'HOLDER H', songwriters: 'W1, W2', payable: '100', operationType: 'Mechanical' },
    {
      title: 'T-B',
      writer: 'HOLDER H',
      songwriters: 'W1, W2',
      payable: '100',
      operationType: 'Synchronization',
    },
    { title: 'T-C', writer: 'HOLDER H', songwriters: 'W1, X', payable: '100', operationType: 'Mechanical' },
    { title: 'T-D', writer: 'HOLDER H', songwriters: 'W3', payable: '100', operationType: 'Mechanical' },
  ];
  /** W1 50 (no type); W2 90 (no type) and 50 (Synchronization); W3 has no terms. All owners confirmed. */
  async function world(which: string[]) {
    const c = await Case.start();
    const owner: Record<string, string> = {};
    for (const w of ['W1', 'W2', 'W3']) {
      const { owner: o } = await confirmedOwner(c.f, `Owner ${w}`, [`Pseud ${w}`]);
      await c.f.modules.owners.addOwnerAlias(o.id, w);
      owner[w] = o.id;
    }
    const pub = c.f.modules.publishing;
    const doc = async (w: string) => (await approvedDoc(c.f, 'contract', owner[w] as string)).id;
    await pub.setTerms({
      ownerId: owner.W1 as string,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: await doc('W1'),
    });
    await pub.setTerms({
      ownerId: owner.W2 as string,
      percent: '90',
      validFrom: '2020-01-01',
      documentId: await doc('W2'),
    });
    await pub.setTerms({
      ownerId: owner.W2 as string,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: await doc('W2'),
      operationType: 'Synchronization',
    });
    await c.f.ingestB17(
      await writeB17(
        'Q12026',
        lines.filter((l) => which.includes(l.title)).map((l) => ({ ...l, period: '1Q26' })),
      ), c.f.testLabels['0to8'],
    );
    const calc = await calculate({ ...c.f.modules, db: c.f.db });
    const pick = (title: string) =>
      calc.publishing
        .filter((p) => p.workTitle === title)
        .map((p) => ({
          writer: p.writerName,
          payable: p.payable.toFixed(),
          percent: p.percent.toFixed(),
          author: p.authorAmount.toFixed(),
          label: p.labelAmount.toFixed(),
          category: p.category,
          reason: p.reason,
        }))
        .sort((a, b) => a.writer.localeCompare(b.writer));
    return { c, pick };
  }

  it('G26a: Mechanical, two writers: parts 50 / 50; W1 author 25, W2 author 45 (the untyped 90)', async () => {
    const { pick } = await world(['T-A']);
    expect(pick('T-A')).toEqual([
      { writer: 'W1', payable: '50', percent: '50', author: '25', label: '25', category: 'B', reason: null },
      { writer: 'W2', payable: '50', percent: '90', author: '45', label: '5', category: 'B', reason: null },
    ]);
  });
  it('G26b: Synchronization: the typed 50 wins for W2', async () => {
    const { pick } = await world(['T-B']);
    expect(pick('T-B')).toEqual([
      { writer: 'W1', payable: '50', percent: '50', author: '25', label: '25', category: 'B', reason: null },
      { writer: 'W2', payable: '50', percent: '50', author: '25', label: '25', category: 'B', reason: null },
    ]);
  });
  it('G26c: an external co-writer takes nothing: W1 gets the whole line', async () => {
    const { pick } = await world(['T-C']);
    expect(pick('T-C')).toEqual([
      { writer: 'W1', payable: '100', percent: '50', author: '50', label: '50', category: 'B', reason: null },
    ]);
  });
  it('G26d: a writer without terms: default 50, C publishing_terms_unconfirmed', async () => {
    const { pick } = await world(['T-D']);
    expect(pick('T-D')).toEqual([
      {
        writer: 'W3',
        payable: '100',
        percent: '50',
        author: '50',
        label: '50',
        category: 'C',
        reason: 'publishing_terms_unconfirmed',
      },
    ]);
  });
  it('G26e: the four lines together reconcile: A 400, B 170, C 50, ours 180, discrepancy 0', async () => {
    const { c } = await world(['T-A', 'T-B', 'T-C', 'T-D']);
    const r = (await c.f.reconciliation()).find((x) => x.source === 'b17' && x.account === 'b17');
    expect(r).toBeDefined();
    expect(
      [r?.A_received, r?.B_notOurs, r?.C_waiting, r?.ourShare, r?.discrepancy].map((x) => x?.toFixed()),
    ).toEqual(['400', '170', '50', '180', '0']);
  });
});
