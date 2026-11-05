import { expect } from 'vitest';
import { Decimal, ZERO } from '../../src/shared/money';
import type { FundedFrom, ParticipationBase } from '../../src/modules/splits';
import {
  approvedAppendix,
  approvedDoc,
  confirmedOwner,
  newFacade,
  writeBelieve,
  type TestFacade,
} from './fixtures';

// The case builder of the golden tests (docs/agents/12_golden_cases.md): a facade on the private stack with named
// owners, pseudonyms, tracks, splits and one Believe/B17 load per call. Shared by golden.test.ts and the e2e seed
// scenarios (scripts/e2e). Synthetic data only.
export const UPC = '1234567890123';
export const I = (n: number) => `QZTST26000${String(n).padStart(2, '0')}`;
export const ACC1 = '1052428';
export const ACC2 = '1055956';

export interface UnitView {
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

export class Case {
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
      account === ACC2 ? this.f.testLabels.Echo8 : this.f.testLabels['0to8'], // D-169: the label of the account
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
    const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO).toFixed();
    for (const r of await this.f.reconciliation()) {
      expect(r.discrepancy.toFixed(), `discrepancy ${r.account} ${r.month}`).toBe('0');
      expect(r.B_notOurs.add(r.C_waiting).add(r.ourShare).toFixed()).toBe(r.A_received.toFixed());
      if (r.fileDiscrepancy !== null) expect(r.fileDiscrepancy.toFixed()).toBe('0');
      // the label books of the row add up to the row (D-168); a Believe row is the book of its files' label (D-169)
      const books = Object.values(r.byLabel);
      if (r.source === 'believe') expect(books.length, `one book of ${r.account} ${r.month}`).toBeLessThanOrEqual(1);
      expect(sum(books.map((b) => b.A_received)), `Σ byLabel A ${r.account} ${r.month}`).toBe(r.A_received.toFixed());
      expect(sum(books.map((b) => b.B_notOurs))).toBe(r.B_notOurs.toFixed());
      expect(sum(books.map((b) => b.C_waiting))).toBe(r.C_waiting.toFixed());
      expect(sum(books.map((b) => b.ourShare))).toBe(r.ourShare.toFixed());
      expect(sum(books.map((b) => b.ourShareNoSplit))).toBe(r.ourShareNoSplit.toFixed());
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
      const b = await this.f.ownerBalance(owner);
      // the books of every label, «without a label» included, add up to the total, field by field (D-168)
      const books = Object.values(b.byLabel);
      for (const k of ['earned', 'waiting', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'payable'] as const)
        expect(sum(books.map((x) => x[k])), `Σ books ${k} of ${name}`).toBe(b.total[k].toFixed());
      for (const a of b.artists) {
        const rows = Object.values(a.byLabel);
        for (const k of ['earned', 'waiting', 'recouped', 'unrecouped', 'recoupedFromMaster'] as const)
          expect(sum(rows.map((x) => x[k])), `Σ books ${k} of ${a.pseudonym}`).toBe(a[k].toFixed());
      }
      if (o.skipOwners?.includes(name)) continue;
      expect(b.total.earned.toFixed(), `earned of ${name}`).toBe((earned.get(owner) ?? ZERO).toFixed());
      expect(b.total.waiting.toFixed(), `waiting of ${name}`).toBe((waiting.get(owner) ?? ZERO).toFixed());
    }
  }
}

/** A case with one ISRC (I(1)) known and the default unit 100 of 2026-03 loaded after `setup`. */
export async function single(setup: (c: Case) => Promise<void>, net = '100', label = 'Test Label') {
  const c = await Case.start();
  await c.track(I(1));
  await setup(c);
  await c.load('2026-03', [{ isrc: I(1), net, label }]);
  return c;
}

