/**
 * Stage 4 loader: shared kit (context, in-memory model of splits and documents, log writer).
 *
 * Every step reads JSON from <repo>/data/mvp-load, works through the facade (the same validation as the API) and is
 * idempotent: it skips what already exists, found by a stable marker (`mvp:<step>:<key>` in the `note` of a split,
 * participation or operation comment) or by alias / title. In a dry run nothing is written: the same code runs against an
 * in-memory model that is updated as if every action had succeeded, so later steps of `all` see the earlier ones.
 * Amounts and percents are decimal strings (Decimal), never floats. No personal data is printed.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Decimal } from '../../src/shared/money';
import { assertDate, monthOf, monthStart } from '../../src/shared/dates';
import { normalizeName } from '../../src/shared/identifiers';
import { openFacade, type Facade } from '../../src/facade';
import { connectSources } from '../../src/connect-sources';
import type { DocumentKind } from '../../src/modules/owners';

export const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
export const LOAD_DIR = join(ROOT, 'data', 'mvp-load');
export const LOG_DIR = join(LOAD_DIR, 'log');

export const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(LOAD_DIR, rel), 'utf8')) as T;
export const hasFile = (rel: string): boolean => existsSync(join(LOAD_DIR, rel));

/** A JSON number (a percent such as 16.666666) as an exact decimal string with at most 6 decimals. */
export const pct = (n: number | string): string => new Decimal(String(n)).toDecimalPlaces(6).toFixed();
export const floorMonth = (d: string): string => monthStart(monthOf(assertDate(d)));
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- log

export class Log {
  private lines: string[] = [];
  readonly counts = new Map<string, number>();
  constructor(
    readonly step: string,
    readonly apply: boolean,
  ) {}
  h(title: string) {
    this.lines.push('', `## ${title}`, '');
  }
  p(line: string) {
    this.lines.push(line);
  }
  bullet(line: string) {
    this.lines.push(`- ${line}`);
  }
  /** Counts an event; the first `keep` details per kind are written, the rest only counted. */
  private detailCount = new Map<string, number>();
  event(kind: string, detail: string, keep = 100000) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    const n = (this.detailCount.get(kind) ?? 0) + 1;
    this.detailCount.set(kind, n);
    if (n <= keep) this.lines.push(`- [${kind}] ${detail}`);
    else if (n === keep + 1) this.lines.push(`- [${kind}] ... further details of this kind are only counted`);
  }
  count(kind: string, n = 1) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + n);
  }
  summary(): string {
    return [...this.counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
  }
  write(): string {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(LOG_DIR, `${this.step}-${stamp}.md`);
    const head = [
      ...(this.apply ? [] : ['DRY RUN (nothing was written)', '']),
      `# MVP load, step ${this.step}${this.apply ? ' (APPLIED)' : ''}`,
      '',
      `Generated ${new Date().toISOString()}`,
      '',
      '## Counts',
      '',
      ...[...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `- ${k}: ${v}`),
    ];
    writeFileSync(file, [...head, ...this.lines, ''].join('\n'));
    return file;
  }
}

// ---------------------------------------------------------------- model of splits

export interface RowRec {
  artistId: string;
  percent: string;
  docId: string | null;
}
export interface SplitRec {
  id: string;
  isrc: string;
  from: string;
  to: string | null;
  docId: string | null;
  note: string | null;
  rows: RowRec[];
}
const covers = (s: Pick<SplitRec, 'from' | 'to'>, d: string) => s.from <= d && (s.to === null || d < s.to);
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string | null }) =>
  a.from < (b.to ?? '9999-12-31') && b.from < (a.to ?? '9999-12-31');
export const isEmptyPeriod = (s: Pick<SplitRec, 'from' | 'to'>) => s.to !== null && s.to <= s.from;

export class SplitModel {
  byIsrc = new Map<string, SplitRec[]>();
  private seq = 0;
  fakeId() {
    return `dry:split:${++this.seq}`;
  }
  add(rec: SplitRec) {
    const list = this.byIsrc.get(rec.isrc) ?? [];
    list.push(rec);
    list.sort((a, b) => a.from.localeCompare(b.from));
    this.byIsrc.set(rec.isrc, list);
  }
  of(isrc: string): SplitRec[] {
    return this.byIsrc.get(isrc) ?? [];
  }
  inForce(isrc: string, date: string): SplitRec | undefined {
    return this.of(isrc).find((s) => covers(s, date));
  }
  /** Same checks as the splits module: shares sum <= 100, no overlap. Throws like the service would. */
  checkRows(rows: { percent: string }[]) {
    const total = rows.reduce((t, r) => t.add(r.percent), new Decimal(0));
    if (total.gt(100)) throw new Error(`Sum of artist shares ${total.toFixed()} exceeds 100`);
  }
  create(rec: SplitRec) {
    this.checkRows(rec.rows);
    for (const o of this.of(rec.isrc))
      if (overlaps(o, rec)) throw new Error(`Split period overlaps an existing split of ${rec.isrc} from ${o.from}`);
    this.add(rec);
  }
  /** Mirror of splits.changeSplit: closes the split in force at `from`, the new one lasts to the old end. */
  change(isrc: string, from: string, rows: RowRec[], docId: string | null, note: string | null, id: string): SplitRec {
    this.checkRows(rows);
    const list = this.of(isrc);
    const cur = list.find((s) => covers(s, from));
    let to: string | null;
    if (cur) {
      to = cur.to;
      cur.to = from;
    } else {
      to = list.map((s) => s.from).filter((d) => d > from).sort()[0] ?? null;
    }
    const rec: SplitRec = { id, isrc, from, to, docId, note, rows };
    this.add(rec);
    return rec;
  }
  hasNote(isrc: string, marker: string): boolean {
    return this.of(isrc).some((s) => s.note === marker);
  }
}

// ---------------------------------------------------------------- context

export interface Opts {
  apply: boolean;
  /** `all` runs steps in one process; the context (and the dry-run model) is shared. */
}

export type Facade_ = Facade;

interface ArtistInfo {
  id: string;
  pseudonym: string;
  ownerId: string | null;
}

export class Ctx {
  readonly apply: boolean;
  readonly f: Facade;
  readonly stack: ReturnType<typeof connectSources>;
  readonly model = new SplitModel();
  private fake = 0;
  // caches (filled by load())
  artistsById = new Map<string, ArtistInfo>();
  /** every artist id (merged ones too) -> the surviving artist id */
  canonArtist = new Map<string, string>();
  artistsByNorm = new Map<string, Set<string>>();
  ownersByNorm = new Map<string, { id: string; kind: 'label' | 'person'; name: string }[]>();
  docs = new Map<string, string>(); // `${kind}|${title}|${ownerId}` -> id
  docStatus = new Map<string, { attached: boolean; approved: boolean }>();
  /** owners whose contract document is approved (status confirmed) (to resolve ambiguous pseudonyms) */
  contractOwners = new Set<string>();
  /** ambiguous pseudonym -> chosen artist id, logged once per name */
  resolvedByContract = new Map<string, string>();
  trackPairs = new Set<string>();
  tracksByIsrc = new Map<string, { id: string; upc: string | null; title: string; note: string | null }[]>();
  tracksByUpc = new Map<string, string[]>();
  opMarkers = new Set<string>();
  participations: {
    id: string;
    isrc: string;
    artistId: string;
    fromArtistId: string | null;
    fundedFrom: string;
    validFrom: string;
    validTo: string | null;
    note: string | null;
  }[] = [];
  labelsCache = new Map<string, string>(); // lower name -> id
  loaded = false;
  log!: Log;

  constructor(apply: boolean) {
    this.apply = apply;
    this.stack = connectSources(join(ROOT, 'data', 'mvp-load', 'files', 'sources'));
    this.f = openFacade({
      db: this.stack.db,
      dataDir: join(ROOT, 'data', 'mvp-load'),
      payoutThresholdCents: 0,
      sources: this.stack.sources,
    });
    // Performance only: the facade reads the whole artist index (~25k rows) several times per write; the loader keeps
    // it for the run and drops it when it creates an artist or an owner itself (the facade write paths never use its status).
    const owners = this.f.modules.owners;
    const read = owners.artistIndex.bind(owners);
    let cached: ReturnType<typeof read> | null = null;
    owners.artistIndex = () => (cached ??= read().catch((e: unknown) => {
      cached = null;
      throw e;
    }));
    this.dropIndex = () => {
      cached = null;
    };
  }
  dropIndex: () => void = () => undefined;
  get owners() {
    return this.f.modules.owners;
  }
  get splits() {
    return this.f.modules.splits;
  }
  get labels() {
    return this.f.modules.labels;
  }
  get settlements() {
    return this.f.modules.settlements;
  }
  get publishing() {
    return this.f.modules.publishing;
  }
  fakeId(kind: string) {
    return `dry:${kind}:${++this.fake}`;
  }
  async close() {
    await this.stack.close();
  }

  /** Reads the database once; later actions keep the caches current (in a dry run as if they had succeeded). */
  async load() {
    if (this.loaded) return;
    const [idx, owners, docs, tracks, splits, parts, ops, labels] = await Promise.all([
      this.owners.artistIndex(),
      this.owners.listOwners(),
      this.owners.listDocuments(),
      this.owners.listTracks(),
      this.splits.listSplits(),
      this.splits.listParticipations(),
      this.settlements.allOperations(),
      this.labels.listLabels(),
    ]);
    for (const [key, a] of idx) {
      this.canonArtist.set(key, a.id);
      if (key !== a.id) continue;
      this.artistsById.set(a.id, { id: a.id, pseudonym: a.pseudonym, ownerId: a.ownerId });
      this.addArtistNorm(a.pseudonym, a.id);
    }
    for (const o of owners) {
      this.addOwner(o.id, o.name, o.kind, o.aliases);
      if (o.status === 'confirmed') this.contractOwners.add(o.id);
    }
    for (const d of docs) {
      this.docs.set(`${d.kind}|${d.title}|${d.ownerId ?? ''}`, d.id);
      this.docStatus.set(d.id, { attached: d.fileRef !== null, approved: d.approvedAt !== null });
    }
    for (const t of tracks) {
      if (t.isrc) {
        const l = this.tracksByIsrc.get(t.isrc) ?? [];
        l.push({ id: t.id, upc: t.upc, title: t.title, note: t.note });
        this.tracksByIsrc.set(t.isrc, l);
        if (t.upc) this.trackPairs.add(`${t.isrc}|${t.upc}`);
      }
      if (t.upc && t.isrc) this.tracksByUpc.set(t.upc, [...(this.tracksByUpc.get(t.upc) ?? []), t.isrc]);
    }
    for (const s of splits)
      this.model.add({
        id: s.id,
        isrc: s.isrc,
        from: s.validFrom,
        to: s.validTo,
        docId: s.documentId,
        note: s.note,
        rows: s.shares.map((r) => ({ artistId: r.artistId, percent: r.percent, docId: r.documentId })),
      });
    this.participations = parts.map((p) => ({
      id: p.id,
      isrc: p.isrc,
      artistId: p.artistId,
      fromArtistId: p.fromArtistId ?? null,
      fundedFrom: p.fundedFrom,
      validFrom: p.validFrom,
      validTo: p.validTo,
      note: p.note,
    }));
    for (const o of ops) {
      const tok = o.comment.split(/\s+/)[0];
      if (tok?.startsWith('mvp:')) this.opMarkers.add(tok);
    }
    for (const l of labels) this.labelsCache.set(l.name.toLowerCase(), l.id);
    this.loaded = true;
  }

  private addArtistNorm(pseudonym: string, id: string) {
    const n = normalizeName(pseudonym);
    const set = this.artistsByNorm.get(n) ?? new Set<string>();
    set.add(id);
    this.artistsByNorm.set(n, set);
  }
  private addOwner(id: string, name: string, kind: 'label' | 'person', aliases: string[] = []) {
    for (const n of new Set([name, ...aliases].map(normalizeName))) {
      const l = this.ownersByNorm.get(n) ?? [];
      if (!l.some((x) => x.id === id)) l.push({ id, kind, name });
      this.ownersByNorm.set(n, l);
    }
  }

  // ------------------------------------------------------------ artists

  /** Canonical artist id of a known id (merged artists follow), or undefined. */
  knownArtist(id: string | null | undefined): ArtistInfo | undefined {
    if (!id) return undefined;
    return this.artistsById.get(this.canonArtist.get(id) ?? id);
  }
  /** Exact normalised pseudonym: one artist, none, or ambiguous (several). */
  findArtists(pseudonym: string): string[] {
    return [...(this.artistsByNorm.get(normalizeName(pseudonym)) ?? [])];
  }
  /** Id of the artist for a JSON reference: the given id if it exists, else the unique pseudonym match. */
  resolveArtist(ref: { artistId?: string | null; pseudonym: string }): {
    id?: string;
    status: 'ok' | 'none' | 'ambiguous';
  } {
    const known = this.knownArtist(ref.artistId);
    if (known) return { id: known.id, status: 'ok' };
    const found = this.findArtists(ref.pseudonym);
    if (found.length === 1) return { id: found[0] as string, status: 'ok' };
    if (found.length > 1) {
      // assumption: exactly one candidate whose owner has an approved contract is the artist meant
      const withContract = found.filter((a) => {
        const o = this.artistsById.get(a)?.ownerId;
        return o && this.contractOwners.has(o);
      });
      if (withContract.length === 1) {
        const id = withContract[0] as string;
        const key = normalizeName(ref.pseudonym);
        if (!this.resolvedByContract.has(key)) {
          this.resolvedByContract.set(key, id);
          this.log?.event(
            'resolved_by_contract_assumption',
            `"${ref.pseudonym}": ${found.length} candidate artists, one owner with an approved contract -> artist ${id}`,
          );
        }
        return { id, status: 'ok' };
      }
    }
    return { status: found.length === 0 ? 'none' : 'ambiguous' };
  }
  async createArtist(pseudonym: string, origin: string, ownerId: string | null = null): Promise<string> {
    let id: string;
    if (this.apply) id = (await this.owners.createArtist({ pseudonym, ownerId, origin })).id;
    else id = this.fakeId('artist');
    this.dropIndex();
    this.artistsById.set(id, { id, pseudonym, ownerId });
    this.canonArtist.set(id, id);
    this.addArtistNorm(pseudonym, id);
    this.log.count('artists_created');
    return id;
  }
  /** The artist for a name, created without an owner when none exists. Ambiguous names return undefined. */
  async artistOrCreate(
    ref: { artistId?: string | null; pseudonym: string },
    origin: string,
  ): Promise<string | undefined> {
    const r = this.resolveArtist(ref);
    if (r.status === 'ok') return r.id;
    if (r.status === 'ambiguous') return undefined;
    return this.createArtist(ref.pseudonym, origin);
  }
  ownerOfArtist(artistId: string): string | null {
    return this.artistsById.get(artistId)?.ownerId ?? null;
  }

  // ------------------------------------------------------------ owners

  findOwner(name: string, kind?: 'label' | 'person'): { id: string; kind: 'label' | 'person'; name: string } | undefined {
    return (this.ownersByNorm.get(normalizeName(name)) ?? []).find((o) => !kind || o.kind === kind);
  }
  async createOwner(name: string, kind: 'label' | 'person', origin: string): Promise<string> {
    let id: string;
    if (this.apply) id = (await this.owners.createOwner({ name, kind, origin })).id;
    else id = this.fakeId('owner');
    this.dropIndex();
    this.addOwner(id, name, kind);
    this.log.count('owners_created');
    return id;
  }
  /** An owner of a kind with one pseudonym of the same name (the recipient of a label rule, a buyer). */
  async ownerWithPseudonym(name: string, kind: 'label' | 'person', origin: string): Promise<{ ownerId: string; artistId: string }> {
    const ownerId = this.findOwner(name, kind)?.id ?? (await this.createOwner(name, kind, origin));
    const mine = this.findArtists(name).find((a) => this.artistsById.get(a)?.ownerId === ownerId);
    if (mine) return { ownerId, artistId: mine };
    const artistId = await this.createArtist(name, origin, ownerId);
    return { ownerId, artistId };
  }

  // ------------------------------------------------------------ documents

  /**
   * A migration document found by (kind, title, owner) or created, attached to a reference and approved (never for
   * kind `assumption`; `approve: false` leaves it attached but not approved). The creation is committed at once.
   */
  async ensureDoc(input: {
    kind: DocumentKind;
    title: string;
    ownerId?: string | null;
    approve: boolean;
    ref: string;
  }): Promise<string> {
    const key = `${input.kind}|${input.title}|${input.ownerId ?? ''}`;
    const hit = this.docs.get(key);
    if (hit) {
      const st = this.docStatus.get(hit);
      if (this.apply && st && !hit.startsWith('dry:')) {
        if (!st.attached) {
          await this.owners.attachFile(hit, input.ref);
          st.attached = true;
        }
        if (input.approve && input.kind !== 'assumption' && !st.approved) {
          await this.owners.approveDocument(hit, 'migration');
          st.approved = true;
        }
      }
      return hit;
    }
    let id: string;
    if (this.apply) {
      const d = await this.owners.createDocument({
        kind: input.kind,
        title: input.title,
        ownerId: input.ownerId ?? null,
        requiresApproval: true,
        migration: true,
      });
      id = d.id;
      await this.owners.attachFile(id, input.ref);
      if (input.approve && input.kind !== 'assumption') await this.owners.approveDocument(id, 'migration');
    } else id = this.fakeId('doc');
    this.docs.set(key, id);
    this.docStatus.set(id, { attached: true, approved: input.approve && input.kind !== 'assumption' });
    this.log.count(`documents_created_${input.kind}`);
    return id;
  }

  // ------------------------------------------------------------ splits

  /** Creates a split (facade) and records it in the model. Throws on a refusal; nothing is recorded then. */
  async createSplit(input: {
    isrc: string;
    from: string;
    rows: { artistId: string; percent: string; docId?: string | null }[];
    docId: string | null;
    note: string;
  }): Promise<SplitRec> {
    const from = floorMonth(input.from);
    const rows: RowRec[] = input.rows.map((r) => ({ artistId: r.artistId, percent: r.percent, docId: r.docId ?? null }));
    const rec: SplitRec = { id: '', isrc: input.isrc, from, to: null, docId: input.docId, note: input.note, rows };
    this.model.checkRows(rows);
    for (const o of this.model.of(input.isrc))
      if (overlaps(o, rec)) throw new Error(`Split period overlaps an existing split of ${input.isrc} from ${o.from}`);
    if (this.apply) {
      const v = await this.f.createSplit({
        isrc: input.isrc,
        validFrom: from,
        shares: rows.map((r) => ({ artistId: r.artistId, percent: r.percent, documentId: r.docId })),
        documentId: input.docId,
        note: input.note,
      });
      rec.id = v.id;
    } else rec.id = this.model.fakeId();
    this.model.add(rec);
    return rec;
  }

  async changeSplit(input: {
    isrc: string;
    from: string;
    rows: { artistId: string; percent: string; docId?: string | null }[];
    docId: string;
    note: string;
  }): Promise<SplitRec> {
    const from = floorMonth(input.from);
    const rows: RowRec[] = input.rows.map((r) => ({ artistId: r.artistId, percent: r.percent, docId: r.docId ?? null }));
    this.model.checkRows(rows);
    let id: string;
    if (this.apply) {
      const v = await this.f.changeSplit({
        isrc: input.isrc,
        from,
        shares: rows.map((r) => ({ artistId: r.artistId, percent: r.percent, documentId: r.docId })),
        documentId: input.docId,
        note: input.note,
      });
      id = v.id;
    } else id = this.model.fakeId();
    return this.model.change(input.isrc, from, rows, input.docId, input.note, id);
  }

  /** Row documents of a re-entered split: a row keeps the document it had (its own, else the old split's). */
  keepRowDocs(
    old: SplitRec | undefined,
    rows: { artistId: string; percent: string }[],
    mode: 'always' | 'same_percent',
  ): { artistId: string; percent: string; docId: string | null }[] {
    return rows.map((r) => {
      const prev = old?.rows.find((x) => x.artistId === r.artistId);
      const keep = prev && (mode === 'always' || new Decimal(prev.percent).eq(r.percent));
      return { artistId: r.artistId, percent: r.percent, docId: keep ? (prev.docId ?? old?.docId ?? null) : null };
    });
  }

  hasParticipationNote(marker: string): boolean {
    return this.participations.some((p) => p.note === marker);
  }
  tx<T>(fn: () => Promise<T>): Promise<T> {
    return this.apply ? this.stack.db.transaction(fn) : fn();
  }
}

export type StepFn = (ctx: Ctx) => Promise<void>;
