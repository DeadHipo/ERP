/**
 * The seed toolkit of the e2e scenarios: a case builder like `tests/helpers/golden-case.ts` (which imports vitest, so
 * the minimal needed parts are copied here) with the naming of docs/agents/19_golden_screens.md §1. Synthetic data only.
 */
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Facade } from '../../src/facade';
import { BELIEVE_COLUMNS } from '../../src/modules/sources';
import type { DocumentKind } from '../../src/modules/owners';
import type { FundedFrom, ParticipationBase } from '../../src/modules/splits';
import { account, B17_FILE_NAME, isrc, ownerName, pseudonym, type CaseKeys, upc } from './keys';

export type Scope = { kind: 'any' | 'publishing' | 'master' | 'master_publishing' } | { kind: 'isrcs'; isrcs: string[] };

export interface BelieveRow {
  /** ISRC index j (1..9), or the full ISRC text in `isrc` (an empty string is a line without ISRC). */
  j?: number;
  isrc?: string;
  /** UPC index (default j). */
  upc?: number;
  net: string;
  label?: string;
  artist?: string;
}

export interface B17Line {
  writer: string;
  title: string;
  payable: string;
  period: string;
  songwriters?: string;
  operationType?: string;
}

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

function believeCsv(month: string, rows: { isrc: string; upc: string; net: string; label: string; artist: string }[]) {
  const lines = [BELIEVE_COLUMNS.map(q).join(';')];
  const rm = `${month.replace('-', '/')}/01`;
  for (const r of rows) {
    const rec: Record<string, string> = {
      'Reporting month': rm,
      'Sales Month': rm,
      Platform: 'Spotify',
      'Country / Region': 'Brazil',
      'Label Name': r.label,
      'Artist Name': r.artist,
      'Release title': 'Synthetic Release',
      'Track title': 'Synthetic Track',
      UPC: r.upc,
      ISRC: r.isrc,
      'Release Catalog nb': 'CAT001',
      'Streaming Subscription Type': 'Premium',
      'Release type': 'Music Release',
      'Sales Type': 'Stream',
      Quantity: '1',
      'Client Payment Currency': 'USD',
      'Unit Price': '0.004',
      'Mechanical Fee': '0',
      'Gross Revenue': r.net,
      'Client share rate': '0.85',
      'Net Revenue': r.net,
    };
    lines.push(BELIEVE_COLUMNS.map((c) => q(rec[c] ?? '')).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The whole seed: the facade, the scratch directory, the keys, the B17 lines collected across scenarios. */
export class Seed {
  readonly keys: Record<string, Record<string, CaseKeys>> = {};
  readonly shared: Record<string, string> = {};
  readonly b17Lines: B17Line[] = [];
  readonly stats = new Map<string, { files: number; units: number }>();
  private reportSeq = 0;
  private readonly cases = new Map<string, Sc>();

  constructor(
    readonly f: Facade,
    readonly dataDir: string,
    readonly tmpDir: string,
  ) {}

  /** The case builder of scenario `nn`, case `k` (one per pair). */
  sc(nn: number, k = 1): Sc {
    const key = `${nn}/${k}`;
    let c = this.cases.get(key);
    if (!c) {
      c = new Sc(this, nn, k);
      this.cases.set(key, c);
    }
    return c;
  }

  /** A pseudonym of the shared seed (`NG`, `QQ`, `0to8`). */
  sharedArtist(name: string): string | undefined {
    return this.shared[`artist:${name}`];
  }

  nextReportId(): string {
    return String(9_700_000 + ++this.reportSeq);
  }

  async writeBelieveFile(month: string, acct: string, rows: Parameters<typeof believeCsv>[1]) {
    const fileName = `${this.nextReportId()}_${acct}_${month}-01_${month}-01.csv`;
    mkdirSync(this.tmpDir, { recursive: true });
    const path = join(this.tmpDir, fileName);
    writeFileSync(path, believeCsv(month, rows));
    return { path, fileName };
  }

  /** The one B17 statement of the seed, loaded last (after every owner and alias exists). */
  async loadB17(): Promise<{ lines: number }> {
    if (this.b17Lines.length === 0) return { lines: 0 };
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Cover').addRow(['Statement', 'Synthetic']);
    const ws = wb.addWorksheet('Detail');
    ws.addRow([
      'Period',
      'asset title',
      'rights-holder name',
      'work identifier',
      'songwriters',
      'operation type',
      'retailer / service',
      'country',
      'net amount',
      'Withholding',
      'Total Payable',
    ]);
    for (const r of this.b17Lines) {
      ws.addRow([
        r.period,
        r.title,
        r.writer,
        'W-' + r.title.length,
        r.songwriters ?? '',
        r.operationType ?? 'Performance',
        'Spotify',
        'US',
        Number(r.payable),
        0,
        r.payable,
      ]);
    }
    mkdirSync(this.tmpDir, { recursive: true });
    const path = join(this.tmpDir, B17_FILE_NAME);
    await wb.xlsx.writeFile(path);
    await this.f.ingestB17({ path, fileName: B17_FILE_NAME });
    return { lines: this.b17Lines.length };
  }
}

/** One golden case of one scenario: owners, pseudonyms, tracks, rules, files named per 19 §1. */
export class Sc {
  readonly keys: CaseKeys;
  private readonly ids = new Map<string, string>();
  private readonly ownerIds = new Map<string, string>();
  private appendixId: string | undefined;

  constructor(
    readonly g: Seed,
    readonly nn: number,
    readonly k: number,
  ) {
    this.keys = {
      isrcs: [],
      upcs: [],
      accounts: [],
      names: {},
      owners: {},
      artists: {},
      documents: {},
      splits: {},
      participations: {},
      labels: {},
      labelRules: {},
      b17: {},
      extra: {},
    };
    const scen = (g.keys[`S${String(nn).padStart(2, '0')}`] ??= {});
    scen[`k${k}`] = this.keys;
    this.g.stats.set(this.scenarioId, this.g.stats.get(this.scenarioId) ?? { files: 0, units: 0 });
  }

  get f(): Facade {
    return this.g.f;
  }
  get scenarioId(): string {
    return `S${String(this.nn).padStart(2, '0')}`;
  }
  isrc = (j: number) => isrc(this.nn, this.k, j);
  upc = (j: number) => upc(this.nn, this.k, j);
  account = (a = 0) => account(this.nn, this.k, a);
  pseud = (letter: string) => pseudonym(letter, this.nn, this.k);
  /** Pseudonym id by letter; the shared `NG`, `QQ`, `0to8` fall back to the shared seed. */
  id(letter: string): string {
    const id = this.ids.get(letter) ?? this.g.sharedArtist(letter);
    if (!id) throw new Error(`unknown pseudonym ${letter} in S${this.nn}/${this.k}`);
    return id;
  }
  owner(letter: string): string {
    const id = this.ownerIds.get(letter);
    if (!id) throw new Error(`unknown owner ${letter} in S${this.nn}/${this.k}`);
    return id;
  }
  private register(letter: string, name: string, artistId: string, ownerId: string) {
    this.ids.set(letter, artistId);
    this.ownerIds.set(letter, ownerId);
    this.keys.names[letter] = name;
    this.keys.artists[letter] = artistId;
    this.keys.owners[letter] = ownerId;
  }

  // ---- owners and pseudonyms ----

  /** A confirmed owner (approved contract) with the given pseudonyms; `ownerLetter` names the owner. */
  async confirmed(ownerLetter: string, pseudLetters: string[], opts: { aliases?: string[] } = {}) {
    const o = this.f.modules.owners;
    const owner = await o.createOwner({ name: ownerName(ownerLetter, this.nn, this.k), kind: 'person' });
    const artists: { id: string }[] = [];
    for (const l of pseudLetters) artists.push(await o.createArtist({ pseudonym: this.pseud(l), ownerId: owner.id }));
    const doc = await o.createDocument({
      kind: 'contract',
      title: `Contract ${owner.name}`,
      fileRef: `dummy://contract-${this.nn}${this.k}${ownerLetter}.pdf`,
      ownerId: owner.id,
      requiresApproval: true,
    });
    await o.approveDocument(doc.id, 'manager');
    await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: artists.map((a) => a.id) });
    for (const a of opts.aliases ?? []) await o.addOwnerAlias(owner.id, a);
    this.ownerIds.set(ownerLetter, owner.id);
    this.keys.owners[ownerLetter] = owner.id;
    this.keys.documents[`contract:${ownerLetter}`] = doc.id;
    pseudLetters.forEach((l, i) => this.register(l, this.pseud(l), (artists[i] as { id: string }).id, owner.id));
    return owner;
  }
  /** Confirmed person owners, one per letter, owner named like the pseudonym. */
  async person(...letters: string[]) {
    for (const l of letters) await this.confirmed(l, [l]);
  }
  /** A second pseudonym of the same owner as `of`. */
  async second(letter: string, of: string) {
    const ownerId = this.owner(of);
    const artist = await this.f.modules.owners.createArtist({ pseudonym: this.pseud(letter), ownerId });
    this.register(letter, this.pseud(letter), artist.id, ownerId);
  }
  /** A person owner without a contract: nothing of it is confirmed. */
  async unconfirmed(ownerLetter: string, pseudLetters: string[] = [ownerLetter]) {
    const o = this.f.modules.owners;
    const owner = await o.createOwner({ name: ownerName(ownerLetter, this.nn, this.k), kind: 'person' });
    this.ownerIds.set(ownerLetter, owner.id);
    this.keys.owners[ownerLetter] = owner.id;
    for (const l of pseudLetters) {
      const a = await o.createArtist({ pseudonym: this.pseud(l), ownerId: owner.id });
      this.register(l, this.pseud(l), a.id, owner.id);
    }
    return owner;
  }
  /** A pseudonym without an owner. `key` is the letter in the keys; `text` the pseudonym (default `pseud(key)`). */
  async orphan(key: string, text = this.pseud(key)) {
    const a = await this.f.modules.owners.createArtist({ pseudonym: text, ownerId: null });
    this.ids.set(key, a.id);
    this.keys.names[key] = text;
    this.keys.artists[key] = a.id;
    return a;
  }
  /** A confirmed owner of kind label with one pseudonym (a company, sublabel recipient, buyer). */
  async company(letter: string) {
    const o = this.f.modules.owners;
    const name = this.pseud(letter);
    const owner = await o.createOwner({ name: `Company ${name}`, kind: 'label' });
    const artist = await o.createArtist({ pseudonym: name, ownerId: owner.id });
    const doc = await o.createDocument({
      kind: 'contract',
      title: `Contract Company ${name}`,
      fileRef: `dummy://contract-company-${name}.pdf`,
      ownerId: owner.id,
      requiresApproval: false,
    });
    await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
    this.register(letter, name, artist.id, owner.id);
    return owner;
  }
  /** Confirmed persons whose artist ids ascend in the order of the letters (the residue tie-break is by id). */
  async ordered(...letters: string[]) {
    const o = this.f.modules.owners;
    const made: { owner: string; artist: string }[] = [];
    for (let i = 0; i < letters.length; i++) {
      const owner = await o.createOwner({ name: `tmp-owner-${this.nn}${this.k}-${i}`, kind: 'person' });
      const artist = await o.createArtist({ pseudonym: `tmp-pseud-${this.nn}${this.k}-${i}`, ownerId: owner.id });
      const doc = await o.createDocument({
        kind: 'contract',
        title: `Contract ${this.nn}${this.k} ordered ${i}`,
        fileRef: `dummy://contract-ordered-${this.nn}${this.k}${i}.pdf`,
        ownerId: owner.id,
        requiresApproval: true,
      });
      await o.approveDocument(doc.id, 'manager');
      await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
      made.push({ owner: owner.id, artist: artist.id });
    }
    made.sort((a, b) => (a.artist < b.artist ? -1 : 1));
    // The names are given after the sort: the letter order is the id order. Direct SQL: this is seed-only.
    for (let i = 0; i < letters.length; i++) {
      const l = letters[i] as string;
      const m = made[i] as { owner: string; artist: string };
      const pn = this.pseud(l);
      const on = ownerName(l, this.nn, this.k);
      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      await this.f.db.query('UPDATE owners.artists SET pseudonym = $1, pseudonym_norm = $2 WHERE id = $3', [pn, norm(pn), m.artist]);
      await this.f.db.query('UPDATE owners.owners SET name = $1, name_norm = $2 WHERE id = $3', [on, norm(on), m.owner]);
      await this.f.db.query('DELETE FROM owners.owner_aliases WHERE owner_id = $1', [m.owner]);
      await this.f.db.query('INSERT INTO owners.owner_aliases (owner_id, alias, alias_norm) VALUES ($1, $2, $3)', [m.owner, on, norm(on)]);
      this.register(l, pn, m.artist, m.owner);
    }
  }

  // ---- documents ----

  async getAppendix(): Promise<string> {
    if (!this.appendixId) {
      const o = this.f.modules.owners;
      const d = await o.createDocument({
        kind: 'appendix',
        title: `Appendix ${this.nn}${this.k}`,
        fileRef: `dummy://appendix-${this.nn}${this.k}.pdf`,
        ownerId: null,
        requiresApproval: true,
      });
      await o.approveDocument(d.id, 'manager');
      this.appendixId = d.id;
      this.keys.documents.appendix = d.id;
    }
    return this.appendixId;
  }
  /** A document that needs no approval step (approved at once), registered in the keys under `name`. */
  async doc(kind: Exclude<DocumentKind, 'assumption'>, name: string, ownerLetter?: string): Promise<string> {
    const d = await this.f.modules.owners.createDocument({
      kind,
      title: `${name} ${this.nn}${this.k}`,
      fileRef: `dummy://${kind}-${this.nn}${this.k}-${name}.pdf`,
      ownerId: ownerLetter ? this.owner(ownerLetter) : null,
      requiresApproval: false,
    });
    this.keys.documents[name] = d.id;
    return d.id;
  }
  /** A council decision: the file is attached, it is never approved. */
  async assumption(name: string, title: string): Promise<string> {
    const d = await this.f.modules.owners.createDocument({
      kind: 'assumption',
      title,
      fileRef: 'dummy://assumption.pdf',
      ownerId: null,
      requiresApproval: true,
    });
    this.keys.documents[name] = d.id;
    return d.id;
  }

  // ---- tracks, splits, participations ----

  async track(j: number, opts: { upc?: number; artists?: string[] } = {}) {
    const i = this.isrc(j);
    const u = this.upc(opts.upc ?? j);
    await this.f.modules.owners.createTrack({
      title: i,
      isrc: i,
      upc: u,
      artistIds: (opts.artists ?? []).map((a) => this.id(a)),
    });
    if (!this.keys.isrcs.includes(i)) this.keys.isrcs.push(i);
    if (!this.keys.upcs.includes(u)) this.keys.upcs.push(u);
  }
  async split(
    j: number,
    shares: [string, string, string?][],
    o: { from?: string; to?: string; doc?: string | null } = {},
  ) {
    const i = this.isrc(j);
    const s = await this.f.createSplit({
      isrc: i,
      validFrom: o.from ?? '2020-01-01',
      validTo: o.to ?? null,
      shares: shares.map(([n, percent, documentId]) => ({ artistId: this.id(n), percent, documentId })),
      documentId: o.doc === undefined ? await this.getAppendix() : o.doc,
    });
    (this.keys.splits[i] ??= []).push((s as { id: string }).id);
    return s;
  }
  async part(
    j: number,
    letter: string,
    percent: string,
    base: ParticipationBase,
    fundedFrom: FundedFrom,
    o: { from?: string; validFrom?: string; validTo?: string; doc?: string | null; key?: string } = {},
  ) {
    const p = await this.f.createParticipation({
      isrc: this.isrc(j),
      artistId: this.id(letter),
      percent,
      base,
      fundedFrom,
      fromArtistId: o.from ? this.id(o.from) : null,
      validFrom: o.validFrom ?? '2020-01-01',
      validTo: o.validTo ?? null,
      documentId: o.doc === undefined ? await this.getAppendix() : o.doc,
    });
    this.keys.participations[o.key ?? letter] = (p as { id: string }).id;
    return p;
  }

  // ---- labels ----

  async labelId(name: string): Promise<string> {
    const l = (await this.f.modules.labels.listLabels()).find((x) => x.name === name);
    if (!l) throw new Error(`no label ${name}`);
    return l.id;
  }
  /** A sublabel of an own label with its alias (the string = its name) and a rule of `percent` to a pseudonym. */
  async sublabel(
    name: string,
    own: '0to8' | 'Echo8',
    recipient: string,
    o: { percent?: string; doc?: string; validFrom?: string } = {},
  ) {
    const labels = this.f.modules.labels;
    const l = await labels.createLabel({ name, kind: 'sublabel', ownLabelId: await this.labelId(own) });
    await labels.addAlias(l.id, name);
    const doc = o.doc ?? (await this.doc('contract', `rule-contract:${name}`));
    const rule = await labels.setRule({
      labelId: l.id,
      percent: o.percent ?? '50',
      recipientArtistId: this.id(recipient),
      validFrom: o.validFrom ?? '2020-01-01',
      documentId: doc,
    });
    this.keys.labels[name] = l.id;
    this.keys.labelRules[name] = (rule as { id: string }).id;
    return { label: l, rule };
  }

  // ---- Believe files, operations, B17 ----

  /** One Believe file (account + month) with the rows; rows default to label `Test Label`. */
  async load(month: string, rows: BelieveRow[], a = 0) {
    const acct = this.account(a);
    const csv = rows.map((r) => {
      const i = r.isrc ?? this.isrc(r.j ?? 1);
      const u = this.upc(r.upc ?? r.j ?? 1);
      if (r.isrc === undefined || r.isrc !== '') {
        if (!this.keys.isrcs.includes(i)) this.keys.isrcs.push(i);
      }
      if (!this.keys.upcs.includes(u)) this.keys.upcs.push(u);
      return { isrc: i, upc: u, net: r.net, label: r.label ?? 'Test Label', artist: r.artist ?? 'Synthetic Artist' };
    });
    const file = await this.g.writeBelieveFile(month, acct, csv);
    await this.f.ingestBelieve(file);
    if (!this.keys.accounts.includes(acct)) this.keys.accounts.push(acct);
    const st = this.g.stats.get(this.scenarioId) as { files: number; units: number };
    st.files += 1;
    st.units += rows.length;
  }

  /** An advance: out, with scope, an approved basis and a payment proof (as in the golden tests). */
  async advance(letter: string, amount: string, scope: Scope, date = '2026-03-01') {
    const o = this.f.modules.owners;
    const basis = await o.createDocument({
      kind: 'advance_basis',
      title: `Advance basis ${this.nn}${this.k}`,
      fileRef: `dummy://advance-basis-${this.nn}${this.k}.pdf`,
      ownerId: this.owner(letter),
      requiresApproval: false,
    });
    const op = await this.f.createOperation({
      direction: 'out',
      amount,
      artistId: this.id(letter),
      date,
      scope: scope as never,
      documentId: basis.id,
      comment: 'advance',
    });
    await this.f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    this.keys.documents['advance-basis'] = basis.id;
    this.keys.extra['advance-operation'] = op.id;
    return op;
  }
  async migrationPayout(letter: string, amount: string, date = '2026-04-01') {
    const op = await this.f.createOperation({
      direction: 'out',
      amount,
      ownerId: this.owner(letter),
      date,
      comment: 'migration',
      migration: true,
    });
    (this.keys.extra['migration-operations'] ??= '');
    this.keys.extra['migration-operations'] += (this.keys.extra['migration-operations'] ? ',' : '') + op.id;
    return op;
  }
  /** Adds a line to the one B17 statement (loaded last). */
  b17(line: B17Line) {
    this.g.b17Lines.push(line);
    this.keys.b17[line.title] = {
      writer: line.writer,
      payable: line.payable,
      period: line.period,
      songwriters: line.songwriters ?? '',
      operationType: line.operationType ?? 'Performance',
    };
  }
}

/** A single-ISRC case: track j1, `setup`, then the default unit (net 100, `Test Label`) of 2026-03 in account 0. */
export async function single(
  sc: Sc,
  setup: () => Promise<void>,
  net = '100',
  label = 'Test Label',
  opts: { track?: boolean } = {},
) {
  if (opts.track !== false) await sc.track(1);
  await setup();
  await sc.load('2026-03', [{ j: 1, net, label }]);
}
