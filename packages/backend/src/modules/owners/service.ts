import { CONTRACT_DOCUMENT_KINDS, DOCUMENT_KINDS, type DocumentKind } from '@erp/shared/document-kinds';
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId, normalizeIsrc, normalizeName, normalizeUpc } from '../../shared/identifiers';
import { assertDate, nowIso } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import type {
  AliasRow,
  ArtistRow,
  ContractArtistRow,
  ContractRow,
  DocumentRow,
  OwnerRow,
  ReleaseRow,
  TrackLabelRow,
  TrackRow,
} from './repository';
import { createOwnersRepository } from './repository';

// The kinds live in `packages/shared/src/document-kinds.ts` (one list for the backend and the frontend, D-172).
export { CONTRACT_DOCUMENT_KINDS, DOCUMENT_KINDS, SPLIT_DOCUMENT_KINDS, type DocumentKind } from '@erp/shared/document-kinds';

export type DocumentStatus = 'not_attached' | 'not_approved' | 'approved';

/** One interval of the label history of an ISRC (D-172): `[validFrom, validTo)`, `validTo` null = open. */
export type TrackLabelView = TrackLabelRow;
export type TrackLabelSource = TrackLabelRow['source'];
/** One row of the release registry of a label (D-172). */
export type ReleaseView = ReleaseRow;
export type ReleaseInput = Omit<ReleaseRow, 'labelId' | 'importedAt' | 'source'>;

/** The PostgreSQL error under a driver or Drizzle wrapper: its SQLSTATE and constraint. */
function pgError(e: unknown): { code?: string; constraint?: string } {
  const err = e as { code?: string; constraint?: string; cause?: unknown };
  if (err?.code) return err;
  return err?.cause ? pgError(err.cause) : {};
}

/** Turns the refusals of the catalog constraints (0018) into the module's errors; anything else is rethrown. */
function catalogRefusal(e: unknown): never {
  const err = pgError(e);
  if (err.code === '23P01' && err.constraint === 'track_labels_no_overlap')
    throw new ConflictError('The interval overlaps another label interval of this ISRC', 'catalog_overlap');
  if (err.code === '23514')
    throw new ValidationError(`The row breaks the rule ${err.constraint ?? ''}: dates from the first of a month, valid_to after valid_from, a UPC of digits`);
  throw e;
}

export interface DocumentView {
  id: string;
  kind: string;
  title: string;
  fileRef: string | null;
  ownerId: string | null;
  requiresApproval: boolean;
  status: DocumentStatus;
  approvedAt: string | null;
  uploadDeadline: string | null;
  migration: boolean;
  createdAt: string;
  /** The own label of the document (D-169); null = any label. The module does not know labels. */
  labelId: string | null;
}

export type OwnerStatus = 'confirmed' | 'waiting_documents';
export type ArtistStatus = 'confirmed' | 'unconfirmed' | 'no_owner';

export interface OwnerView {
  id: string;
  name: string;
  kind: 'label' | 'person';
  ipi: string | null;
  status: OwnerStatus;
  origin: string;
  aliases: string[];
  createdAt: string;
}

export interface ArtistView {
  id: string;
  pseudonym: string;
  ownerId: string | null;
  status: ArtistStatus;
  origin: string;
}

export interface TrackView {
  id: string;
  isrc: string | null;
  upc: string | null;
  title: string;
  /** Free flag shown by the signals page; it moves no money. */
  note: string | null;
}

export interface SimilarRecord {
  id: string;
  name: string;
  matchedBy: string[];
  ownerId?: string | null;
}

/**
 * Status of a document: not attached (no file), not approved (requires manager approval and not approved yet),
 * approved. A document that does not require approval is effective as soon as its file is attached.
 */
export function documentStatus(
  d: Pick<DocumentRow, 'fileRef' | 'requiresApproval' | 'approvedAt'>,
): DocumentStatus {
  if (!d.fileRef) return 'not_attached';
  if (d.requiresApproval && !d.approvedAt) return 'not_approved';
  return 'approved';
}

function toDocumentView(d: DocumentRow): DocumentView {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    fileRef: d.fileRef,
    ownerId: d.ownerId,
    requiresApproval: d.requiresApproval,
    status: documentStatus(d),
    approvedAt: d.approvedAt,
    uploadDeadline: d.uploadDeadline,
    migration: d.migration,
    createdAt: d.createdAt,
    labelId: d.labelId,
  };
}

const toTrackView = (t: TrackRow): TrackView => ({
  id: t.id,
  isrc: t.isrc,
  upc: t.upc,
  title: t.title,
  note: t.note,
});

/**
 * Owners whose contract document is approved. Payout is possible only for them. With `labelId` only the documents of
 * that label or without a label count (D-169: a contract opens its document's label; a document without a label opens
 * every label).
 */
function computeConfirmedOwners(
  contracts: ContractRow[],
  documents: DocumentRow[],
  labelId?: string,
): Set<string> {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const result = new Set<string>();
  for (const c of contracts) if (approvedContractLabel(c, docs, labelId) !== undefined) result.add(c.ownerId);
  return result;
}

/**
 * The one rule of a confirming contract: its document is approved (and, with `labelId`, has that label or none).
 * Returns the document's label (null = any) when the contract confirms, undefined otherwise.
 */
function approvedContractLabel(
  c: ContractRow,
  docs: Map<string, DocumentRow>,
  labelId?: string,
): string | null | undefined {
  const d = docs.get(c.documentId);
  if (!d || documentStatus(d) !== 'approved') return undefined;
  if (labelId !== undefined && d.labelId !== null && d.labelId !== labelId) return undefined;
  return d.labelId;
}

/** Artists listed in an approved contract of their own owner. */
function computeConfirmedArtists(
  contracts: ContractRow[],
  documents: DocumentRow[],
  artists: ArtistRow[],
  links: ContractArtistRow[],
): Set<string> {
  const confirmed = computeConfirmedOwners(contracts, documents);
  const docs = new Map(documents.map((d) => [d.id, d]));
  const approved = contracts.filter((c) => {
    if (!confirmed.has(c.ownerId)) return false;
    const d = docs.get(c.documentId);
    return d !== undefined && documentStatus(d) === 'approved';
  });
  const ownerOfContract = new Map(approved.map((c) => [c.id, c.ownerId]));
  const result = new Set<string>();
  const artistOwner = new Map(artists.map((a) => [a.id, a.ownerId]));
  for (const l of links) {
    if (!ownerOfContract.has(l.contractId)) continue;
    if (artistOwner.get(l.artistId) === ownerOfContract.get(l.contractId)) result.add(l.artistId);
  }
  return result;
}

/** Follows merged_into to the surviving record; an unknown id resolves to itself. */
function resolve(id: string, get: (id: string) => { mergedInto: string | null } | undefined): string {
  let current = id;
  for (let i = 0; i < 50; i++) {
    const row = get(current);
    if (!row || !row.mergedInto) return current;
    current = row.mergedInto;
  }
  throw new ConflictError(`Merge chain too long for ${id}`);
}

async function resolveAsync(
  id: string,
  get: (id: string) => Promise<{ mergedInto: string | null } | undefined>,
): Promise<string> {
  let current = id;
  for (let i = 0; i < 50; i++) {
    const row = await get(current);
    if (!row || !row.mergedInto) return current;
    current = row.mergedInto;
  }
  throw new ConflictError(`Merge chain too long for ${id}`);
}

function aliasesByOwner(rows: AliasRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of rows) {
    const list = map.get(a.ownerId);
    if (list) list.push(a.alias);
    else map.set(a.ownerId, [a.alias]);
  }
  return map;
}

function ownerView(o: OwnerRow, confirmed: Set<string>, aliases: string[]): OwnerView {
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    ipi: o.ipi,
    status: confirmed.has(o.id) ? 'confirmed' : 'waiting_documents',
    origin: o.origin,
    aliases,
    createdAt: o.createdAt,
  };
}

function artistStatus(ownerId: string | null, id: string, confirmed: Set<string>): ArtistStatus {
  if (!ownerId) return 'no_owner';
  return confirmed.has(id) ? 'confirmed' : 'unconfirmed';
}

/**
 * Module 1 on PostgreSQL (schema `owners`). Every method that reads the database is async; reads of several tables
 * run in one snapshot, and check-then-write methods run in one write transaction (they join an outer one).
 */
export function createOwnersService(db: Db, org: OrgScope) {
  const repo = createOwnersRepository(db, org);

  async function requireOwner(id: string): Promise<OwnerRow> {
    const o = await repo.getOwner(id);
    if (!o) throw new NotFoundError('Owner', id);
    return o;
  }

  /** A live owner: merged records cannot receive new artists, documents or contracts. */
  async function requireLiveOwner(id: string): Promise<OwnerRow> {
    const o = await requireOwner(id);
    if (o.mergedInto)
      throw new RuleViolationError(
        `Owner ${id} was merged into ${o.mergedInto}; use the surviving owner`,
        'owner_merged',
      );
    return o;
  }

  const resolveOwner = (id: string) => resolveAsync(id, repo.getOwner);

  /** Owners whose contract document is approved. Payout is possible only for them. */
  async function confirmedOwnerIds(): Promise<Set<string>> {
    const [contracts, documents] = await db.snapshot(() =>
      Promise.all([repo.allContracts(), repo.allDocuments()]),
    );
    return computeConfirmedOwners(contracts, documents);
  }

  /** Artists listed in an approved contract of their own owner. */
  async function confirmedArtistIds(): Promise<Set<string>> {
    const [contracts, documents, artists, links] = await db.snapshot(() =>
      Promise.all([repo.allContracts(), repo.allDocuments(), repo.allArtists(), repo.allContractArtists()]),
    );
    return computeConfirmedArtists(contracts, documents, artists, links);
  }

  /** One owner with its aliases and status, read consistently. */
  async function loadOwnerView(id: string): Promise<OwnerView> {
    return db.snapshot(async () => {
      const [o, confirmed, aliases] = await Promise.all([
        requireOwner(id),
        confirmedOwnerIds(),
        repo.aliasesOf(id),
      ]);
      return ownerView(
        o,
        confirmed,
        aliases.map((a) => a.alias),
      );
    });
  }

  return {
    // ---- owners ----
    async createOwner(input: {
      name: string;
      kind: 'label' | 'person';
      ipi?: string | null;
      aliases?: string[];
      origin?: string;
    }): Promise<OwnerView> {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Owner name is required');
      const id = newId();
      await repo.transaction(async () => {
        await repo.insertOwner({
          id,
          name,
          nameNorm: normalizeName(name),
          kind: input.kind,
          ipi: input.ipi ?? null,
          mergedInto: null,
          createdAt: nowIso(),
          origin: input.origin ?? 'manual',
        });
        for (const alias of [name, ...(input.aliases ?? [])]) {
          await repo.insertAlias({ ownerId: id, alias, aliasNorm: normalizeName(alias) });
        }
      });
      return loadOwnerView(id);
    },

    /** Possible duplicates for the operator: same normalized name or alias. Never merged automatically. */
    async findSimilarOwners(name: string): Promise<SimilarRecord[]> {
      const norm = normalizeName(name);
      const [byNorm, aliasOwnerIds, live, aliases] = await db.snapshot(() =>
        Promise.all([
          repo.ownersByNameNorm(norm),
          repo.ownerIdsByAlias(norm),
          repo.listOwners(),
          repo.allAliases(),
        ]),
      );
      // Live owners only: an alias of a merged record is skipped, as before.
      const ownersById = new Map(live.map((o) => [o.id, o]));
      const byId = new Map<string, SimilarRecord>();
      for (const o of byNorm) byId.set(o.id, { id: o.id, name: o.name, matchedBy: ['name'] });
      for (const ownerId of aliasOwnerIds) {
        const o = ownersById.get(ownerId);
        if (!o || o.mergedInto) continue;
        const rec = byId.get(o.id) ?? { id: o.id, name: o.name, matchedBy: [] };
        if (!rec.matchedBy.includes('alias')) rec.matchedBy.push('alias');
        byId.set(o.id, rec);
      }
      // Same words in another order ("LAST, FIRST" vs "First Last"): shown to the operator, never merged automatically.
      const tokens = (s: string) => normalizeName(s).split(' ').filter(Boolean).sort().join(' ');
      const key = tokens(name);
      if (key.includes(' ')) {
        const aliasesOf = aliasesByOwner(aliases);
        for (const o of live) {
          if (byId.has(o.id)) continue;
          if ([o.name, ...(aliasesOf.get(o.id) ?? [])].some((n) => tokens(n) === key))
            byId.set(o.id, { id: o.id, name: o.name, matchedBy: ['name words'] });
        }
      }
      return [...byId.values()];
    },

    /** Publishing writer lookup: exact normalized alias or IPI. */
    /** Publishing is paid only to a person (08, decision 7): label owners are never candidates. */
    async findOwnersByWriter(name: string, ipi?: string | null): Promise<string[]> {
      const [aliasOwnerIds, all] = await db.snapshot(() =>
        Promise.all([repo.ownerIdsByAlias(normalizeName(name)), repo.allOwners()]),
      );
      const byId = new Map(all.map((o) => [o.id, o]));
      const ids = new Set(aliasOwnerIds.map((id) => resolve(id, (x) => byId.get(x))));
      if (ipi) for (const o of all) if (o.ipi === ipi && !o.mergedInto) ids.add(o.id);
      return [...ids].filter((id) => byId.get(id)?.kind === 'person');
    },

    async ownerKind(id: string): Promise<'label' | 'person'> {
      return (await requireOwner(await resolveOwner(id))).kind;
    },

    async addOwnerAlias(ownerId: string, alias: string): Promise<void> {
      await repo.transaction(async () => {
        await requireLiveOwner(ownerId);
        if (!normalizeName(alias)) throw new ValidationError('Alias is empty');
        await repo.insertAlias({ ownerId, alias, aliasNorm: normalizeName(alias) });
      });
    },

    async listOwners(): Promise<OwnerView[]> {
      const [list, aliases, contracts, documents] = await db.snapshot(() =>
        Promise.all([repo.listOwners(), repo.allAliases(), repo.allContracts(), repo.allDocuments()]),
      );
      const confirmed = computeConfirmedOwners(contracts, documents);
      const aliasesOf = aliasesByOwner(aliases);
      return list.map((o) => ownerView(o, confirmed, aliasesOf.get(o.id) ?? []));
    },

    async getOwner(id: string): Promise<OwnerView> {
      return loadOwnerView(await resolveOwner(id));
    },

    async isOwnerConfirmed(id: string): Promise<boolean> {
      return (await confirmedOwnerIds()).has(await resolveOwner(id));
    },

    /** Confirmed under the own label `labelId`: an approved contract whose document has that label or none (D-169). */
    async isOwnerConfirmedUnder(id: string, labelId: string): Promise<boolean> {
      const [contracts, documents] = await db.snapshot(() =>
        Promise.all([repo.allContracts(), repo.allDocuments()]),
      );
      return computeConfirmedOwners(contracts, documents, labelId).has(await resolveOwner(id));
    },

    /**
     * The approved contracts with the label of their document (null = any label), one entry per owner and label; the
     * facade answers "confirmed under L" from it inside its own snapshot (D-169).
     */
    async confirmedContracts(): Promise<{ ownerId: string; labelId: string | null }[]> {
      const [contracts, documents] = await db.snapshot(() =>
        Promise.all([repo.allContracts(), repo.allDocuments()]),
      );
      const docs = new Map(documents.map((d) => [d.id, d]));
      const seen = new Set<string>();
      const out: { ownerId: string; labelId: string | null }[] = [];
      for (const c of contracts) {
        // the same rule as computeConfirmedOwners, contract by contract
        const labelId = approvedContractLabel(c, docs);
        if (labelId === undefined) continue;
        const key = `${c.ownerId}|${labelId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ownerId: c.ownerId, labelId });
      }
      return out;
    },

    confirmedOwnerIds,

    resolveOwnerId(id: string): Promise<string> {
      return resolveOwner(id);
    },

    /**
     * Reads the owners once and returns a synchronous resolveOwnerId (follows merged_into to the surviving owner,
     * an unknown id resolves to itself, a too long chain throws), for callers that need a sync callback.
     */
    async ownerResolver(): Promise<(id: string) => string> {
      const all = await db.snapshot(() => repo.allOwners());
      const byId = new Map(all.map((o) => [o.id, o]));
      return (id: string) => resolve(id, (x) => byId.get(x));
    },

    // ---- artists ----
    async createArtist(input: {
      pseudonym: string;
      ownerId?: string | null;
      origin?: string;
    }): Promise<ArtistView> {
      const pseudonym = input.pseudonym.trim();
      if (!pseudonym) throw new ValidationError('Pseudonym is required');
      const id = newId();
      await repo.transaction(async () => {
        if (input.ownerId) await requireLiveOwner(input.ownerId);
        await repo.insertArtist({
          id,
          pseudonym,
          pseudonymNorm: normalizeName(pseudonym),
          ownerId: input.ownerId ?? null,
          mergedInto: null,
          createdAt: nowIso(),
          origin: input.origin ?? 'manual',
        });
      });
      return {
        id,
        pseudonym,
        ownerId: input.ownerId ?? null,
        status: input.ownerId ? 'unconfirmed' : 'no_owner',
        origin: input.origin ?? 'manual',
      };
    },

    async findSimilarArtists(pseudonym: string): Promise<SimilarRecord[]> {
      return (await repo.artistsByPseudonymNorm(normalizeName(pseudonym))).map((a) => ({
        id: a.id,
        name: a.pseudonym,
        matchedBy: ['pseudonym'],
        ownerId: a.ownerId,
      }));
    },

    /**
     * An artist without an owner (created from a split, "waiting for documents") gets its owner when documents arrive.
     * Changing an existing owner is not allowed: one artist belongs to exactly one owner (open question 99/11).
     */
    async assignArtistOwner(artistId: string, ownerId: string): Promise<void> {
      await repo.transaction(async () => {
        const a = await repo.getArtist(artistId);
        if (!a) throw new NotFoundError('Artist', artistId);
        await requireLiveOwner(ownerId);
        if (a.mergedInto)
          throw new RuleViolationError('Artist was merged; use the surviving record', 'artist_merged');
        if (a.ownerId && a.ownerId !== ownerId) {
          throw new RuleViolationError(
            'Artist already belongs to another owner; create a separate artist record',
            'artist_owner_fixed',
          );
        }
        await repo.setArtistOwner(artistId, ownerId);
      });
    },

    async listArtistsOfOwner(ownerId: string): Promise<ArtistView[]> {
      const [confirmed, list] = await db.snapshot(() =>
        Promise.all([confirmedArtistIds(), repo.artistsOfOwner(ownerId)]),
      );
      return list.map((a) => ({
        id: a.id,
        pseudonym: a.pseudonym,
        ownerId: a.ownerId,
        status: artistStatus(a.ownerId, a.id, confirmed),
        origin: a.origin,
      }));
    },

    /**
     * Every artist (including merged ones) with its resolved id and resolved owner; used by the facade.
     * Reads the module once (one snapshot); the returned map is a plain in-memory index.
     */
    async artistIndex(): Promise<
      Map<string, { id: string; pseudonym: string; ownerId: string | null; status: ArtistStatus }>
    > {
      const [contracts, documents, all, links, allOwners] = await db.snapshot(() =>
        Promise.all([
          repo.allContracts(),
          repo.allDocuments(),
          repo.allArtists(),
          repo.allContractArtists(),
          repo.allOwners(),
        ]),
      );
      const confirmed = computeConfirmedArtists(contracts, documents, all, links);
      const byId = new Map(all.map((a) => [a.id, a]));
      const ownersById = new Map(allOwners.map((o) => [o.id, o]));
      const result = new Map<
        string,
        { id: string; pseudonym: string; ownerId: string | null; status: ArtistStatus }
      >();
      for (const a of all) {
        const rid = resolve(a.id, (id) => byId.get(id));
        const r = byId.get(rid) ?? a;
        const ownerId = r.ownerId ? resolve(r.ownerId, (id) => ownersById.get(id)) : null;
        result.set(a.id, {
          id: rid,
          pseudonym: r.pseudonym,
          ownerId,
          status: artistStatus(ownerId, rid, confirmed),
        });
      }
      return result;
    },

    async getArtist(id: string): Promise<ArtistView> {
      const [a, confirmed] = await db.snapshot(() => Promise.all([repo.getArtist(id), confirmedArtistIds()]));
      if (!a) throw new NotFoundError('Artist', id);
      return {
        id: a.id,
        pseudonym: a.pseudonym,
        ownerId: a.ownerId,
        status: artistStatus(a.ownerId, a.id, confirmed),
        origin: a.origin,
      };
    },

    // ---- tracks ----
    /** A track may be created before delivery without ISRC/UPC. The pair (ISRC, UPC) is unique. */
    async createTrack(input: {
      title: string;
      isrc?: string | null;
      upc?: string | null;
      artistIds?: string[];
      note?: string | null;
    }): Promise<TrackView> {
      const isrc = input.isrc ? assertIsrc(input.isrc) : null;
      const upc = input.upc ? normalizeUpc(input.upc) || null : null;
      const id = newId();
      const title = input.title.trim() || '(untitled)';
      const note = input.note?.trim() || null;
      await repo.transaction(async () => {
        if (isrc && upc && (await repo.trackByPair(isrc, upc)))
          throw new ConflictError(`Track ${isrc} / ${upc} already exists`, 'duplicate_track');
        await repo.insertTrack({ id, isrc, upc, title, note, createdAt: nowIso() });
        for (const artistId of input.artistIds ?? []) {
          if (!(await repo.getArtist(artistId))) throw new NotFoundError('Artist', artistId);
          await repo.linkArtistTrack(artistId, id);
        }
      });
      return { id, isrc, upc, title, note };
    },

    async setTrackIdentifiers(
      trackId: string,
      isrcRaw: string | null,
      upcRaw: string | null,
    ): Promise<TrackView> {
      return repo.transaction(async () => {
        const t = await repo.getTrack(trackId);
        if (!t) throw new NotFoundError('Track', trackId);
        const isrc = isrcRaw ? assertIsrc(isrcRaw) : null;
        const upc = upcRaw ? normalizeUpc(upcRaw) || null : null;
        const clash = isrc && upc ? await repo.trackByPair(isrc, upc) : undefined;
        if (clash && clash.id !== trackId)
          throw new ConflictError(`Track ${isrc} / ${upc} already exists`, 'duplicate_track');
        await repo.setTrackIds(trackId, isrc, upc);
        return toTrackView({ ...t, isrc, upc });
      });
    },

    /** Sets or clears the free note of a track (null or empty clears it). */
    async setTrackNote(trackId: string, note: string | null): Promise<TrackView> {
      return repo.transaction(async () => {
        const t = await repo.getTrack(trackId);
        if (!t) throw new NotFoundError('Track', trackId);
        const clean = note?.trim() || null;
        await repo.setTrackNote(trackId, clean);
        return toTrackView({ ...t, note: clean });
      });
    },

    /** Informational link: shows which artist a track belongs to. It never decides who gets paid. */
    async linkArtistTrack(artistId: string, trackId: string): Promise<void> {
      await repo.transaction(async () => {
        if (!(await repo.getArtist(artistId))) throw new NotFoundError('Artist', artistId);
        if (!(await repo.getTrack(trackId))) throw new NotFoundError('Track', trackId);
        await repo.linkArtistTrack(artistId, trackId);
      });
    },

    async tracksOfArtists(artistIds: string[]): Promise<{ artistId: string; track: TrackView }[]> {
      return (await repo.tracksOfArtists(artistIds)).map((r) => ({
        artistId: r.artistId,
        track: toTrackView(r.track),
      }));
    },

    /** The artist → track links of the registry (every one, or those of the given tracks); resolved by the facade (D-166). */
    async artistLinks(filter: { trackIds?: string[] } = {}): Promise<{ artistId: string; trackId: string }[]> {
      return (await repo.artistLinksOfTracks(filter.trackIds)).map((l) => ({ artistId: l.artistId, trackId: l.trackId }));
    },

    async listTracks(filter: { isrcs?: string[] } = {}): Promise<TrackView[]> {
      return (await repo.allTracks(filter.isrcs)).map(toTrackView);
    },

    /** Set of "ISRC|UPC" keys known in module 1. */
    async knownPairs(filter: { isrcs?: string[] } = {}): Promise<Set<string>> {
      return new Set((await repo.knownPairs(filter.isrcs)).map((p) => `${p.isrc}|${p.upc}`));
    },

    // ---- documents ----
    async createDocument(input: {
      kind: DocumentKind;
      title: string;
      fileRef?: string | null;
      ownerId?: string | null;
      requiresApproval: boolean;
      uploadDeadline?: string | null;
      migration?: boolean;
      /** The own label (D-169); the facade checks it, the module stores it. */
      labelId?: string | null;
    }): Promise<DocumentView> {
      if (!DOCUMENT_KINDS.includes(input.kind))
        throw new ValidationError(`Unknown document kind ${input.kind}`);
      const id = newId();
      return repo.transaction(async () => {
        if (input.ownerId) await requireLiveOwner(input.ownerId);
        if (input.uploadDeadline) assertDate(input.uploadDeadline);
        await repo.insertDocument({
          id,
          kind: input.kind,
          title: input.title.trim() || input.kind,
          fileRef: input.fileRef ?? null,
          ownerId: input.ownerId ?? null,
          requiresApproval: input.requiresApproval,
          approvedAt: null,
          approvedBy: null,
          uploadDeadline: input.uploadDeadline ?? null,
          migration: input.migration ?? false,
          createdAt: nowIso(),
          labelId: input.labelId ?? null,
        });
        return this.getDocument(id);
      });
    },

    async getDocument(id: string): Promise<DocumentView> {
      const d = await repo.getDocument(id);
      if (!d) throw new NotFoundError('Document', id);
      return toDocumentView(d);
    },

    async listDocuments(
      filter:
        | string
        | {
            ownerId?: string;
            status?: DocumentStatus;
            kind?: string;
            q?: string;
            limit?: number;
            /** The documents of the label and those without a label (D-169). */
            labelId?: string;
          } = {},
    ): Promise<DocumentView[]> {
      const f = typeof filter === 'string' ? { ownerId: filter } : filter;
      return (await repo.listDocuments(f)).map(toDocumentView);
    },

    /** Sets or clears (null = any label) the own label of a document; only this field (D-169). */
    async setDocumentLabel(id: string, labelId: string | null): Promise<DocumentView> {
      return repo.transaction(async () => {
        await this.getDocument(id);
        await repo.updateDocument(id, { labelId });
        return this.getDocument(id);
      });
    },

    /**
     * The global search (N10): live owners (name or alias), pseudonyms, tracks (an exact ISRC / UPC first), documents
     * (title). `kinds` restricts what is read; at most `limit` per kind. Statuses are those of the lists.
     */
    async search(q: string, limit: number, kinds: ReadonlySet<string>) {
      const needle = q.trim();
      const none = needle === '';
      const [ownerRows, artistRows, trackRows, docRows, confirmedOwners, confirmedArtists] =
        await db.snapshot(() =>
          Promise.all([
            kinds.has('owners') && !none ? repo.searchOwners(needle, limit) : [],
            kinds.has('artists') && !none ? repo.searchArtists(needle, limit) : [],
            kinds.has('tracks') && !none
              ? repo.searchTracks(needle, normalizeIsrc(needle), normalizeUpc(needle), limit)
              : [],
            kinds.has('documents') && !none ? repo.searchDocuments(needle, limit) : [],
            kinds.has('owners') && !none ? confirmedOwnerIds() : new Set<string>(),
            kinds.has('artists') && !none ? confirmedArtistIds() : new Set<string>(),
          ]),
        );
      return {
        owners: ownerRows.map((o) => ({
          id: o.id,
          name: o.name,
          status: (confirmedOwners.has(o.id) ? 'confirmed' : 'waiting_documents') as OwnerView['status'],
          kind: o.kind,
        })),
        artists: artistRows.map((a) => ({
          id: a.id,
          pseudonym: a.pseudonym,
          ownerId: a.ownerId,
          status: artistStatus(a.ownerId, a.id, confirmedArtists),
        })),
        tracks: trackRows.map((t) => ({ isrc: t.isrc, upc: t.upc, title: t.title })),
        documents: docRows.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          status: documentStatus(d),
        })),
      };
    },

    async documentStatuses(ids: string[]): Promise<Map<string, DocumentStatus>> {
      return new Map((await repo.documentsByIds([...new Set(ids)])).map((d) => [d.id, documentStatus(d)]));
    },

    /** Status and kind of each document (the facade's categorisation needs the kind `assumption`, D-127). */
    async documentInfo(ids: string[]): Promise<Map<string, { status: DocumentStatus; kind: string }>> {
      return new Map(
        (await repo.documentsByIds([...new Set(ids)])).map((d) => [
          d.id,
          { status: documentStatus(d), kind: d.kind },
        ]),
      );
    },

    async attachFile(id: string, fileRef: string): Promise<DocumentView> {
      if (!fileRef.trim()) throw new ValidationError('File reference is required');
      return repo.transaction(async () => {
        await this.getDocument(id);
        // A new file has not been reviewed: a previous approval does not carry over to it.
        await repo.updateDocument(id, { fileRef: fileRef.trim(), approvedAt: null, approvedBy: null });
        return this.getDocument(id);
      });
    },

    /** Manager approval. A document without a file cannot be approved; approving twice keeps the first approval. */
    async approveDocument(id: string, by: string): Promise<DocumentView> {
      return repo.transaction(async () => {
        const d = await this.getDocument(id);
        if (d.kind === 'assumption')
          throw new RuleViolationError(
            'A document of kind assumption is never approved',
            'assumption_not_approvable',
          );
        if (d.status === 'not_attached')
          throw new RuleViolationError(
            'Attach the file before approving the document',
            'document_not_attached',
          );
        if (d.approvedAt) return d;
        await repo.updateDocument(id, { approvedAt: nowIso(), approvedBy: by });
        return this.getDocument(id);
      });
    },

    // ---- contracts ----
    /** A contract is concluded with the owner; it confirms the owner and the listed pseudonyms (artists). */
    async createContract(input: {
      ownerId: string;
      documentId: string;
      number?: string | null;
      artistIds: string[];
    }): Promise<{
      id: string;
      ownerId: string;
      documentId: string;
      number: string | null;
      artistIds: string[];
    }> {
      return repo.transaction(async () => {
        await requireLiveOwner(input.ownerId);
        const doc = await this.getDocument(input.documentId);
        // A label decision confirms the owner exactly like a contract (D-172).
        if (!(CONTRACT_DOCUMENT_KINDS as readonly string[]).includes(doc.kind))
          throw new ValidationError('A contract must reference a document of kind "contract" or "label_decision"');
        // The owner is confirmed only by its own document.
        if (doc.ownerId && doc.ownerId !== input.ownerId)
          throw new RuleViolationError(
            'The contract document belongs to another owner',
            'document_owner_mismatch',
          );
        const id = newId();
        if (!doc.ownerId) await repo.updateDocument(doc.id, { ownerId: input.ownerId });
        await repo.insertContract({
          id,
          ownerId: input.ownerId,
          documentId: input.documentId,
          number: input.number ?? null,
          createdAt: nowIso(),
        });
        if (new Set(input.artistIds).size !== input.artistIds.length)
          throw new ValidationError('An artist is listed twice');
        for (const artistId of input.artistIds) {
          const a = await repo.getArtist(artistId);
          if (!a) throw new NotFoundError('Artist', artistId);
          if (a.mergedInto)
            throw new RuleViolationError('Artist was merged; use the surviving record', 'artist_merged');
          if (a.ownerId === null) await repo.setArtistOwner(artistId, input.ownerId);
          else if (a.ownerId !== input.ownerId) {
            throw new RuleViolationError(
              `Artist ${a.pseudonym} belongs to another owner`,
              'artist_owner_fixed',
            );
          }
          await repo.linkContractArtist(id, artistId);
        }
        return {
          id,
          ownerId: input.ownerId,
          documentId: input.documentId,
          number: input.number ?? null,
          artistIds: input.artistIds,
        };
      });
    },

    /** Every contract → pseudonym link with the contract's owner (the artists list counts the contracts naming a pseudonym, D-167). */
    async contractLinks(): Promise<{ contractId: string; ownerId: string; artistId: string }[]> {
      const [list, links] = await db.snapshot(() => Promise.all([repo.allContracts(), repo.allContractArtists()]));
      const ownerOf = new Map(list.map((c) => [c.id, c.ownerId]));
      return links
        .filter((l) => ownerOf.has(l.contractId))
        .map((l) => ({ contractId: l.contractId, ownerId: ownerOf.get(l.contractId) as string, artistId: l.artistId }));
    },

    async contractsOfOwner(
      ownerId: string,
    ): Promise<{ id: string; number: string | null; documentId: string; artistIds: string[] }[]> {
      return db.snapshot(async () => {
        const list = await repo.contractsOfOwner(ownerId);
        const links = await repo.contractArtistsOf(list.map((c) => c.id));
        return list.map((c) => ({
          id: c.id,
          number: c.number,
          documentId: c.documentId,
          artistIds: links.filter((l) => l.contractId === c.id).map((l) => l.artistId),
        }));
      });
    },

    // ---- merge ----
    /**
     * Merges an owner created without documents (e.g. an unknown publishing writer) into the confirmed original.
     * The merged record survives with merged_into set; references to it resolve to the original.
     */
    async mergeOwners(fromId: string, intoId: string, reason: string): Promise<void> {
      if (fromId === intoId) throw new ValidationError('Cannot merge an owner into itself');
      await repo.transaction(async () => {
        const fromOwner = await requireLiveOwner(fromId);
        const intoOwner = await requireLiveOwner(intoId);
        // A person (e.g. an unknown publishing author) is never merged into a label, nor the other way round.
        if (fromOwner.kind !== intoOwner.kind) {
          throw new RuleViolationError(
            'Owners of different kinds (person / label) cannot be merged',
            'merge_kind_mismatch',
          );
        }
        const confirmed = await confirmedOwnerIds();
        // Direction is fixed: the unconfirmed record merges into the confirmed original (02, "Объединение записей").
        if (confirmed.has(fromId) || !confirmed.has(intoId)) {
          throw new RuleViolationError(
            'Only an owner without approved documents can be merged, and only into a confirmed owner',
            'merge_direction',
          );
        }
        await repo.moveArtistsToOwner(fromId, intoId);
        await repo.moveAliases(fromId, intoId);
        await repo.moveDocuments(fromId, intoId);
        await repo.moveContracts(fromId, intoId);
        await repo.setOwnerMergedInto(fromId, intoId);
        await repo.insertMerge({ id: newId(), entity: 'owner', fromId, intoId, reason, at: nowIso() });
      });
    },

    /** Merges duplicate artist records of the same owner (or an artist without owner into an existing one). */
    async mergeArtists(fromId: string, intoId: string, reason: string): Promise<void> {
      if (fromId === intoId) throw new ValidationError('Cannot merge an artist into itself');
      await repo.transaction(async () => {
        const from = await repo.getArtist(fromId);
        const into = await repo.getArtist(intoId);
        if (!from) throw new NotFoundError('Artist', fromId);
        if (!into) throw new NotFoundError('Artist', intoId);
        if (from.mergedInto || into.mergedInto)
          throw new RuleViolationError(
            'Both artists must be live records (no merge chains or cycles)',
            'artist_merged',
          );
        if (from.ownerId && from.ownerId !== into.ownerId) {
          throw new RuleViolationError(
            'Artists with different owners cannot be merged (open question 99/11)',
            'merge_owner_conflict',
          );
        }
        await repo.moveArtistTracks(fromId, intoId);
        await repo.moveContractArtists(fromId, intoId);
        await repo.setArtistMergedInto(fromId, intoId);
        await repo.insertMerge({ id: newId(), entity: 'artist', fromId, intoId, reason, at: nowIso() });
      });
    },

    listMerges: () => repo.listMerges(),

    // ---- catalog (D-172): the label history of an ISRC and the release registry. Navigation, not money: the
    // calculation never reads them. The label id is opaque here (the facade checks it is an own label) and the
    // month-start rule (M52) is the facade's: the module only refuses what the CHECKs of 0018 refuse.
    trackLabels: {
      list: (f: { isrcs?: string[]; labelId?: string } = {}): Promise<TrackLabelView[]> =>
        repo.trackLabels.list({ ...f, isrcs: f.isrcs?.map(assertIsrc) }),
      /** Inserts an interval (new id) or rewrites the interval `id`; an overlap is `409 catalog_overlap`. */
      async upsert(input: {
        id?: string;
        isrc: string;
        labelId: string;
        validFrom: string;
        validTo?: string | null;
        source: TrackLabelSource;
        note?: string | null;
      }): Promise<TrackLabelView> {
        const isrc = assertIsrc(input.isrc);
        const row = {
          id: input.id ?? newId(),
          isrc,
          labelId: input.labelId,
          validFrom: assertDate(input.validFrom),
          validTo: input.validTo ? assertDate(input.validTo) : null,
          source: input.source,
          note: input.note ?? null,
          createdAt: nowIso(),
        };
        await repo.transaction(() => repo.trackLabels.upsert(row)).catch(catalogRefusal);
        const saved = (await repo.trackLabels.list({ isrcs: [isrc] })).find((r) => r.id === row.id);
        if (!saved) throw new NotFoundError('Label interval', row.id);
        return saved;
      },
      /** Replaces every interval of `source` of one ISRC (the others stay); all or nothing. */
      async replaceOfIsrc(
        isrcRaw: string,
        source: TrackLabelSource,
        rows: { labelId: string; validFrom: string; validTo?: string | null; note?: string | null }[],
      ): Promise<TrackLabelView[]> {
        const isrc = assertIsrc(isrcRaw);
        const createdAt = nowIso();
        const values = rows.map((r) => ({
          id: newId(),
          isrc,
          labelId: r.labelId,
          validFrom: assertDate(r.validFrom),
          validTo: r.validTo ? assertDate(r.validTo) : null,
          source,
          note: r.note ?? null,
          createdAt,
        }));
        await repo.transaction(() => repo.trackLabels.replaceOfIsrc(isrc, source, values)).catch(catalogRefusal);
        return repo.trackLabels.list({ isrcs: [isrc] });
      },
    },
    releases: {
      list: (f: { labelId?: string; upcs?: string[] } = {}): Promise<ReleaseView[]> => repo.releases.list(f),
      /** Inserts or rewrites the rows of one label by UPC (the UPCs not listed stay); all or nothing. */
      async upsert(labelId: string, rows: ReleaseInput[]): Promise<void> {
        if (new Set(rows.map((r) => r.upc)).size !== rows.length)
          throw new ValidationError('A UPC is listed twice');
        const importedAt = nowIso();
        const values = rows.map((r) => ({ ...r, labelId, source: 'believe_export' as const, importedAt }));
        await repo.transaction(() => repo.releases.upsert(values)).catch(catalogRefusal);
      },
    },
  };
}

export type OwnersService = ReturnType<typeof createOwnersService>;
