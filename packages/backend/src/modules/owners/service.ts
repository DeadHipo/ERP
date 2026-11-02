import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId, normalizeName, normalizeUpc } from '../../shared/identifiers';
import { assertDate, nowIso } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type {
  AliasRow,
  ArtistRow,
  ContractArtistRow,
  ContractRow,
  DocumentRow,
  OwnerRow,
  TrackRow,
} from './repository';
import { createOwnersRepository } from './repository';

export const DOCUMENT_KINDS = [
  'contract',
  'appendix',
  'buyout',
  'advance_basis',
  'adjustment_basis',
  'payment_proof',
  'return_proof',
  'other',
  'assumption',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentStatus = 'not_attached' | 'not_approved' | 'approved';

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
  };
}

const toTrackView = (t: TrackRow): TrackView => ({
  id: t.id,
  isrc: t.isrc,
  upc: t.upc,
  title: t.title,
  note: t.note,
});

/** Owners whose contract document is approved. Payout is possible only for them. */
function computeConfirmedOwners(contracts: ContractRow[], documents: DocumentRow[]): Set<string> {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const result = new Set<string>();
  for (const c of contracts) {
    const d = docs.get(c.documentId);
    if (d && documentStatus(d) === 'approved') result.add(c.ownerId);
  }
  return result;
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
export function createOwnersService(db: Db) {
  const repo = createOwnersRepository(db);

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

    async listTracks(): Promise<TrackView[]> {
      return (await repo.allTracks()).map(toTrackView);
    },

    /** Set of "ISRC|UPC" keys known in module 1. */
    async knownPairs(): Promise<Set<string>> {
      return new Set((await repo.knownPairs()).map((p) => `${p.isrc}|${p.upc}`));
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
        });
        return this.getDocument(id);
      });
    },

    async getDocument(id: string): Promise<DocumentView> {
      const d = await repo.getDocument(id);
      if (!d) throw new NotFoundError('Document', id);
      return toDocumentView(d);
    },

    async listDocuments(ownerId?: string): Promise<DocumentView[]> {
      return (await repo.listDocuments(ownerId)).map(toDocumentView);
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
        if (doc.kind !== 'contract')
          throw new ValidationError('A contract must reference a document of kind "contract"');
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
  };
}

export type OwnersService = ReturnType<typeof createOwnersService>;
