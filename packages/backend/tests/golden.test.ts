import { describe, expect, it } from 'vitest';
import { Decimal, ZERO } from '../src/shared/money';
import { calculate, reconcile } from '../src/facade/calculation';
import { MASTER_LAYERS, type NamedLayer } from '../src/facade/layers';
import type { FundedFrom, ParticipationBase } from '../src/modules/splits';
import {
  approvedAppendix,
  approvedDoc,
  assumptionDoc,
  confirmedOwner,
  newFacade,
  writeB17,
  writeBelieve,
  type TestFacade,
} from './helpers/fixtures';

// The master golden cases of docs/agents/12_golden_cases.md, end to end on the private stack: every expected number
// is the hand-computed decimal string of 12 §"Master cases"; every case also runs the checks of 12 §"Checks every
// master case also asserts" (reconciliation identity, discrepancy 0, explain sums to the unit, owner balances).
// Synthetic data only.

const UPC = '1234567890123';
const I = (n: number) => `QZTST26000${String(n).padStart(2, '0')}`;
const ACC1 = '1052428';
const ACC2 = '1055956';

interface UnitView {
  account: string;
  upc: string;
  reportingMonth: string;
  net: Decimal;
  labelShare: Decimal;
  ours: Decimal;
  allocations: {
    artistId: string;
    amount: Decimal;
    category: string;
    reason: string | null;
    layer: string;
  }[];
  layers: { layer: string; labelShare: Decimal; allocations: { amount: Decimal }[] }[];
}

class Case {
  f!: TestFacade;
  appendix!: string;
  readonly ids = new Map<string, string>();
  readonly names = new Map<string, string>();
  readonly owners = new Map<string, string>();
  readonly isrcs = new Set<string>();
  readonly files: { account: string; month: string }[] = [];

  static async start() {
    const c = new Case();
    c.f = await newFacade();
    c.appendix = (await approvedAppendix(c.f)).id;
    return c;
  }
  private register(name: string, artistId: string, ownerId: string) {
    this.ids.set(name, artistId);
    this.names.set(artistId, name);
    this.owners.set(name, ownerId);
  }
  id(name: string) {
    const id = this.ids.get(name);
    if (!id) throw new Error(`unknown pseudonym ${name}`);
    return id;
  }
  /** Confirmed person owners, one per pseudonym. */
  async person(...names: string[]) {
    for (const n of names) {
      const { owner, artists } = await confirmedOwner(this.f, `Owner ${n}`, [n]);
      this.register(n, (artists[0] as { id: string }).id, owner.id);
    }
  }
  /** A second pseudonym of the same owner as `of`. */
  async second(name: string, of: string) {
    const ownerId = this.owners.get(of) as string;
    const artist = await this.f.modules.owners.createArtist({ pseudonym: name, ownerId });
    this.register(name, artist.id, ownerId);
  }
  /** Confirmed persons whose artist ids are in the order of the names (the residue tie-break is by id). */
  async ordered(...names: string[]) {
    const made: { id: string; owner: string }[] = [];
    for (let i = 0; i < names.length; i++) {
      const { owner, artists } = await confirmedOwner(this.f, `Owner ordered ${i}`, [`Ordered ${i}`]);
      made.push({ id: (artists[0] as { id: string }).id, owner: owner.id });
    }
    made.sort((a, b) => (a.id < b.id ? -1 : 1));
    names.forEach((n, i) =>
      this.register(n, (made[i] as { id: string }).id, (made[i] as { owner: string }).owner),
    );
  }
  /** A confirmed owner of kind label with one pseudonym (a company, sublabel, buyer). */
  async company(name: string) {
    const o = this.f.modules.owners;
    const owner = await o.createOwner({ name: `Company ${name}`, kind: 'label' });
    const artist = await o.createArtist({ pseudonym: name, ownerId: owner.id });
    const doc = await approvedDoc(this.f, 'contract', owner.id);
    await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
    this.register(name, artist.id, owner.id);
  }
  async track(isrc: string, upc = UPC, artists: string[] = []) {
    await this.f.modules.owners.createTrack({
      title: isrc,
      isrc,
      upc,
      artistIds: artists.map((a) => this.id(a)),
    });
    this.isrcs.add(isrc);
  }
  async split(
    isrc: string,
    shares: [string, string, string?][],
    o: { from?: string; to?: string; doc?: string | null } = {},
  ) {
    return this.f.createSplit({
      isrc,
      validFrom: o.from ?? '2020-01-01',
      validTo: o.to ?? null,
      shares: shares.map(([n, percent, documentId]) => ({ artistId: this.id(n), percent, documentId })),
      documentId: o.doc === undefined ? this.appendix : o.doc,
    });
  }
  async part(
    isrc: string,
    name: string,
    percent: string,
    base: ParticipationBase,
    fundedFrom: FundedFrom,
    o: { from?: string; validFrom?: string; validTo?: string; doc?: string | null } = {},
  ) {
    return this.f.createParticipation({
      isrc,
      artistId: this.id(name),
      percent,
      base,
      fundedFrom,
      fromArtistId: o.from ? this.id(o.from) : null,
      validFrom: o.validFrom ?? '2020-01-01',
      validTo: o.validTo ?? null,
      documentId: o.doc === undefined ? this.appendix : o.doc,
    });
  }
  async labelId(name: string) {
    const l = (await this.f.modules.labels.listLabels()).find((x) => x.name === name);
    if (!l) throw new Error(`no label ${name}`);
    return l.id;
  }
  /** A sublabel of an own label with its alias and a rule of `percent` to a pseudonym. */
  async sublabel(name: string, own: string, recipient: string, o: { percent?: string; doc?: string } = {}) {
    const labels = this.f.modules.labels;
    const l = await labels.createLabel({ name, kind: 'sublabel', ownLabelId: await this.labelId(own) });
    await labels.addAlias(l.id, name);
    await labels.setRule({
      labelId: l.id,
      percent: o.percent ?? '50',
      recipientArtistId: this.id(recipient),
      validFrom: '2020-01-01',
      documentId: o.doc ?? (await approvedDoc(this.f, 'contract')).id,
    });
  }
  /** One Believe file per call. */
  async load(
    month: string,
    rows: { isrc: string; net: string; upc?: string; label?: string }[],
    account = ACC1,
  ) {
    await this.f.ingestBelieve(
      writeBelieve(
        month,
        rows.map((r) => ({
          isrc: r.isrc,
          upc: r.upc ?? UPC,
          net: r.net,
          labelName: r.label ?? 'Test Label',
        })),
        { account },
      ),
    );
    this.files.push({ account, month });
  }
  async units(isrc: string, month = '2026-03', upc = UPC): Promise<UnitView[]> {
    const e = await this.f.explainTrack(isrc);
    return (e.units as unknown as UnitView[]).filter((u) => u.reportingMonth === month && u.upc === upc);
  }
  /** Amount per pseudonym name on the units of one ISRC and month (summed), with the reasons. */
  async amounts(isrc: string, month = '2026-03', upc = UPC) {
    const out: Record<string, string> = {};
    const reasons: Record<string, string | null> = {};
    const sums = new Map<string, Decimal>();
    for (const u of await this.units(isrc, month, upc))
      for (const a of u.allocations) {
        const n = this.names.get(a.artistId) ?? a.artistId;
        sums.set(n, (sums.get(n) ?? ZERO).add(a.amount));
        reasons[n] = a.reason;
      }
    for (const [n, v] of sums) out[n] = v.toFixed();
    return { amounts: out, reasons };
  }
  async row(month = '2026-03', account = ACC1) {
    const r = (await this.f.reconciliation({ from: month, to: month })).find(
      (x) => x.source === 'believe' && x.account === account,
    );
    if (!r) throw new Error(`no reconciliation row ${account} ${month}`);
    return {
      A: r.A_received.toFixed(),
      B: r.B_notOurs.toFixed(),
      C: r.C_waiting.toFixed(),
      ours: r.ourShare.toFixed(),
      byLabel: Object.fromEntries(Object.entries(r.ourShareByLabel).map(([k, v]) => [k, v.toFixed()])),
      breakdown: Object.fromEntries(
        Object.entries(r.C_breakdown).map(([k, v]) => [k, (v as Decimal).toFixed()]),
      ),
      noSplit: r.ourShareNoSplit.toFixed(),
    };
  }
  async balance(name: string) {
    return this.f.ownerBalance(this.owners.get(name) as string);
  }

  /** 12 §"Checks every master case also asserts". */
  async verify(o: { skipOwners?: string[] } = {}) {
    for (const r of await this.f.reconciliation()) {
      expect(r.discrepancy.toFixed(), `discrepancy ${r.account} ${r.month}`).toBe('0');
      expect(r.B_notOurs.add(r.C_waiting).add(r.ourShare).toFixed()).toBe(r.A_received.toFixed());
      if (r.fileDiscrepancy !== null) expect(r.fileDiscrepancy.toFixed()).toBe('0');
    }
    const earned = new Map<string, Decimal>();
    const waiting = new Map<string, Decimal>();
    for (const isrc of this.isrcs) {
      const e = await this.f.explainTrack(isrc);
      for (const u of e.units as unknown as UnitView[]) {
        const last = u.layers.at(-1);
        expect(last?.layer).toBe('categorise');
        const total = (last?.allocations ?? [])
          .reduce((s, a) => s.add(a.amount), ZERO)
          .add(last?.labelShare ?? ZERO);
        expect(total.toFixed(), `explain ${isrc} ${u.reportingMonth}`).toBe(u.net.toFixed());
        for (const a of u.allocations) {
          const owner = [...this.owners.entries()].find(([n]) => this.ids.get(n) === a.artistId)?.[1];
          if (!owner) continue;
          const m = a.category === 'B' ? earned : waiting;
          m.set(owner, (m.get(owner) ?? ZERO).add(a.amount));
        }
      }
    }
    for (const [name, owner] of this.owners) {
      if (o.skipOwners?.includes(name)) continue;
      const b = await this.f.ownerBalance(owner);
      expect(b.total.earned.toFixed(), `earned of ${name}`).toBe((earned.get(owner) ?? ZERO).toFixed());
      expect(b.total.waiting.toFixed(), `waiting of ${name}`).toBe((waiting.get(owner) ?? ZERO).toFixed());
    }
  }
}

/** A case with one ISRC (I(1)) known and the default unit 100 of 2026-03 loaded after `setup`. */
async function single(setup: (c: Case) => Promise<void>, net = '100', label = 'Test Label') {
  const c = await Case.start();
  await c.track(I(1));
  await setup(c);
  await c.load('2026-03', [{ isrc: I(1), net, label }]);
  return c;
}

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

  it('G08b (D-130): one owner, an Echo8 unit and a 0to8 unit: the balance shows B and C per label of record', async () => {
    const c = await Case.start();
    await c.person('A');
    for (const n of [1, 2, 3]) await c.track(I(n));
    await c.split(I(1), [['A', '50']]);
    await c.split(I(2), [['A', '50']], { doc: null }); // no document: C split_unconfirmed
    await c.split(I(3), [['A', '50']]);
    await c.load('2026-03', [
      { isrc: I(1), net: '100', label: 'Echo8' },
      { isrc: I(2), net: '60', label: 'Test Label' },
      { isrc: I(3), net: '40', label: 'Mystery Records' },
    ]);
    const b = await c.balance('A');
    const byLabel = Object.fromEntries(
      Object.entries(b.byLabel).map(([k, v]) => [k, [v.earned.toFixed(), v.waiting.toFixed()]]),
    );
    expect(byLabel).toEqual({ Echo8: ['50', '0'], '0to8': ['0', '30'], '?': ['20', '0'] });
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
    const op = await c.f.createOperation({
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
    c.f.createOperation({
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
      await c.f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '60' }]));
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
      await c.verify({ skipOwners: ['A'] });
    });
    it('(ii) an advance 40 scope isrcs [another ISRC]: recouped 0, payable 80', async () => {
      const c = await base();
      await advance(c, 'A', '40', { kind: 'isrcs', isrcs: [I(2)] }, '2026-01-01');
      const b = await c.balance('A');
      expect([b.total.recouped, b.total.payable].map((x) => x.toFixed())).toEqual(['0', '80']);
      await c.verify({ skipOwners: ['A'] });
    });
    it('(iii) a migration payout 20 without scope: paid 20, payable 60', async () => {
      const c = await base();
      await migrationPayout(c, 'A', '20');
      const b = await c.balance('A');
      expect([b.total.paid, b.total.payable].map((x) => x.toFixed())).toEqual(['20', '60']);
      await c.verify({ skipOwners: ['A'] });
    });
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
      ),
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
