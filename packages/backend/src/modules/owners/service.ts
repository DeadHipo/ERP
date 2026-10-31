import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId, normalizeName, normalizeUpc } from '../../shared/identifiers';
import { assertDate, nowIso } from '../../shared/dates';
import type { DocumentRow, OwnerRow, OwnersDb, TrackRow } from './repository';
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

const toTrackView = (t: TrackRow): TrackView => ({ id: t.id, isrc: t.isrc, upc: t.upc, title: t.title });

export function createOwnersService(db: OwnersDb) {
  const repo = createOwnersRepository(db);

  function requireOwner(id: string): OwnerRow {
    const o = repo.getOwner(id);
    if (!o) throw new NotFoundError('Owner', id);
    return o;
  }

  /** A live owner: merged records cannot receive new artists, documents or contracts. */
  function requireLiveOwner(id: string): OwnerRow {
    const o = requireOwner(id);
    if (o.mergedInto)
      throw new RuleViolationError(
        `Owner ${id} was merged into ${o.mergedInto}; use the surviving owner`,
        'owner_merged',
      );
    return o;
  }

  /** Owners whose contract document is approved. Payout is possible only for them. */
  function confirmedOwnerIds(): Set<string> {
    const contracts = repo.allContracts();
    const docs = new Map(
      repo.documentsByIds([...new Set(contracts.map((c) => c.documentId))]).map((d) => [d.id, d]),
    );
    const result = new Set<string>();
    for (const c of contracts) {
      const d = docs.get(c.documentId);
      if (d && documentStatus(d) === 'approved') result.add(c.ownerId);
    }
    return result;
  }

  /** Artists listed in an approved contract of their own owner. */
  function confirmedArtistIds(): Set<string> {
    const confirmed = confirmedOwnerIds();
    const contracts = repo.allContracts().filter((c) => confirmed.has(c.ownerId));
    const docs = new Map(repo.documentsByIds(contracts.map((c) => c.documentId)).map((d) => [d.id, d]));
    const approved = contracts.filter((c) => {
      const d = docs.get(c.documentId);
      return d !== undefined && documentStatus(d) === 'approved';
    });
    const ownerOfContract = new Map(approved.map((c) => [c.id, c.ownerId]));
    const result = new Set<string>();
    const artistOwner = new Map(repo.allArtists().map((a) => [a.id, a.ownerId]));
    for (const l of repo.contractArtistsOf(approved.map((c) => c.id))) {
      if (artistOwner.get(l.artistId) === ownerOfContract.get(l.contractId)) result.add(l.artistId);
    }
    return result;
  }

  function ownerView(o: OwnerRow, confirmed: Set<string>): OwnerView {
    return {
      id: o.id,
      name: o.name,
      kind: o.kind,
      ipi: o.ipi,
      status: confirmed.has(o.id) ? 'confirmed' : 'waiting_documents',
      origin: o.origin,
      aliases: repo.aliasesOf(o.id).map((a) => a.alias),
      createdAt: o.createdAt,
    };
  }

  function artistStatus(ownerId: string | null, id: string, confirmed: Set<string>): ArtistStatus {
    if (!ownerId) return 'no_owner';
    return confirmed.has(id) ? 'confirmed' : 'unconfirmed';
  }

  function resolve(id: string, get: (id: string) => { mergedInto: string | null } | undefined): string {
    let current = id;
    for (let i = 0; i < 50; i++) {
      const row = get(current);
      if (!row || !row.mergedInto) return current;
      current = row.mergedInto;
    }
    throw new ConflictError(`Merge chain too long for ${id}`);
  }

  return {
    // ---- owners ----
    createOwner(input: {
      name: string;
      kind: 'label' | 'person';
      ipi?: string | null;
      aliases?: string[];
      origin?: string;
    }): OwnerView {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Owner name is required');
      const id = newId();
      repo.transaction(() => {
        repo.insertOwner({
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
          repo.insertAlias({ ownerId: id, alias, aliasNorm: normalizeName(alias) });
        }
      });
      return ownerView(requireOwner(id), confirmedOwnerIds());
    },

    /** Possible duplicates for the operator: same normalized name or alias. Never merged automatically. */
    findSimilarOwners(name: string): SimilarRecord[] {
      const norm = normalizeName(name);
      const byId = new Map<string, SimilarRecord>();
      for (const o of repo.ownersByNameNorm(norm))
        byId.set(o.id, { id: o.id, name: o.name, matchedBy: ['name'] });
      for (const ownerId of repo.ownerIdsByAlias(norm)) {
        const o = repo.getOwner(ownerId);
        if (!o || o.mergedInto) continue;
        const rec = byId.get(o.id) ?? { id: o.id, name: o.name, matchedBy: [] };
        if (!rec.matchedBy.includes('alias')) rec.matchedBy.push('alias');
        byId.set(o.id, rec);
      }
      // Same words in another order ("LAST, FIRST" vs "First Last"): shown to the operator, never merged automatically.
      const tokens = (s: string) => normalizeName(s).split(' ').filter(Boolean).sort().join(' ');
      const key = tokens(name);
      if (key.includes(' ')) {
        for (const o of repo.listOwners()) {
          if (byId.has(o.id)) continue;
          const aliases = repo.aliasesOf(o.id).map((a) => a.alias);
          if ([o.name, ...aliases].some((n) => tokens(n) === key))
            byId.set(o.id, { id: o.id, name: o.name, matchedBy: ['name words'] });
        }
      }
      return [...byId.values()];
    },

    /** Publishing writer lookup: exact normalized alias or IPI. */
    /** Publishing is paid only to a person (08, decision 7): label owners are never candidates. */
    findOwnersByWriter(name: string, ipi?: string | null): string[] {
      const ids = new Set(repo.ownerIdsByAlias(normalizeName(name)).map((id) => resolve(id, repo.getOwner)));
      if (ipi) for (const o of repo.allOwners()) if (o.ipi === ipi && !o.mergedInto) ids.add(o.id);
      return [...ids].filter((id) => repo.getOwner(id)?.kind === 'person');
    },

    ownerKind(id: string): 'label' | 'person' {
      return requireOwner(resolve(id, repo.getOwner)).kind;
    },

    addOwnerAlias(ownerId: string, alias: string): void {
      requireLiveOwner(ownerId);
      if (!normalizeName(alias)) throw new ValidationError('Alias is empty');
      repo.insertAlias({ ownerId, alias, aliasNorm: normalizeName(alias) });
    },

    listOwners(): OwnerView[] {
      const confirmed = confirmedOwnerIds();
      return repo.listOwners().map((o) => ownerView(o, confirmed));
    },

    getOwner(id: string): OwnerView {
      return ownerView(requireOwner(resolve(id, repo.getOwner)), confirmedOwnerIds());
    },

    isOwnerConfirmed(id: string): boolean {
      return confirmedOwnerIds().has(resolve(id, repo.getOwner));
    },

    confirmedOwnerIds,

    resolveOwnerId(id: string): string {
      return resolve(id, repo.getOwner);
    },

    // ---- artists ----
    createArtist(input: { pseudonym: string; ownerId?: string | null; origin?: string }): ArtistView {
      const pseudonym = input.pseudonym.trim();
      if (!pseudonym) throw new ValidationError('Pseudonym is required');
      if (input.ownerId) requireLiveOwner(input.ownerId);
      const id = newId();
      repo.insertArtist({
        id,
        pseudonym,
        pseudonymNorm: normalizeName(pseudonym),
        ownerId: input.ownerId ?? null,
        mergedInto: null,
        createdAt: nowIso(),
        origin: input.origin ?? 'manual',
      });
      return {
        id,
        pseudonym,
        ownerId: input.ownerId ?? null,
        status: input.ownerId ? 'unconfirmed' : 'no_owner',
        origin: input.origin ?? 'manual',
      };
    },

    findSimilarArtists(pseudonym: string): SimilarRecord[] {
      return repo
        .artistsByPseudonymNorm(normalizeName(pseudonym))
        .map((a) => ({ id: a.id, name: a.pseudonym, matchedBy: ['pseudonym'], ownerId: a.ownerId }));
    },

    /**
     * An artist without an owner (created from a split, "waiting for documents") gets its owner when documents arrive.
     * Changing an existing owner is not allowed: one artist belongs to exactly one owner (open question 99/11).
     */
    assignArtistOwner(artistId: string, ownerId: string): void {
      const a = repo.getArtist(artistId);
      if (!a) throw new NotFoundError('Artist', artistId);
      requireLiveOwner(ownerId);
      if (a.mergedInto)
        throw new RuleViolationError('Artist was merged; use the surviving record', 'artist_merged');
      if (a.ownerId && a.ownerId !== ownerId) {
        throw new RuleViolationError(
          'Artist already belongs to another owner; create a separate artist record',
          'artist_owner_fixed',
        );
      }
      repo.setArtistOwner(artistId, ownerId);
    },

    listArtistsOfOwner(ownerId: string): ArtistView[] {
      const confirmed = confirmedArtistIds();
      return repo.artistsOfOwner(ownerId).map((a) => ({
        id: a.id,
        pseudonym: a.pseudonym,
        ownerId: a.ownerId,
        status: artistStatus(a.ownerId, a.id, confirmed),
        origin: a.origin,
      }));
    },

    /** Every artist (including merged ones) with its resolved id and resolved owner; used by the facade. */
    artistIndex(): Map<
      string,
      { id: string; pseudonym: string; ownerId: string | null; status: ArtistStatus }
    > {
      const confirmed = confirmedArtistIds();
      const all = repo.allArtists();
      const byId = new Map(all.map((a) => [a.id, a]));
      const result = new Map<
        string,
        { id: string; pseudonym: string; ownerId: string | null; status: ArtistStatus }
      >();
      for (const a of all) {
        const rid = resolve(a.id, (id) => byId.get(id));
        const r = byId.get(rid) ?? a;
        const ownerId = r.ownerId ? resolve(r.ownerId, repo.getOwner) : null;
        result.set(a.id, {
          id: rid,
          pseudonym: r.pseudonym,
          ownerId,
          status: artistStatus(ownerId, rid, confirmed),
        });
      }
      return result;
    },

    getArtist(id: string): ArtistView {
      const a = repo.getArtist(id);
      if (!a) throw new NotFoundError('Artist', id);
      return {
        id: a.id,
        pseudonym: a.pseudonym,
        ownerId: a.ownerId,
        status: artistStatus(a.ownerId, a.id, confirmedArtistIds()),
        origin: a.origin,
      };
    },

    // ---- tracks ----
    /** A track may be created before delivery without ISRC/UPC. The pair (ISRC, UPC) is unique. */
    createTrack(input: {
      title: string;
      isrc?: string | null;
      upc?: string | null;
      artistIds?: string[];
    }): TrackView {
      const isrc = input.isrc ? assertIsrc(input.isrc) : null;
      const upc = input.upc ? normalizeUpc(input.upc) || null : null;
      if (isrc && upc && repo.trackByPair(isrc, upc))
        throw new ConflictError(`Track ${isrc} / ${upc} already exists`, 'duplicate_track');
      const id = newId();
      const title = input.title.trim() || '(untitled)';
      repo.transaction(() => {
        repo.insertTrack({ id, isrc, upc, title, createdAt: nowIso() });
        for (const artistId of input.artistIds ?? []) {
          if (!repo.getArtist(artistId)) throw new NotFoundError('Artist', artistId);
          repo.linkArtistTrack(artistId, id);
        }
      });
      return { id, isrc, upc, title };
    },

    setTrackIdentifiers(trackId: string, isrcRaw: string | null, upcRaw: string | null): TrackView {
      const t = repo.getTrack(trackId);
      if (!t) throw new NotFoundError('Track', trackId);
      const isrc = isrcRaw ? assertIsrc(isrcRaw) : null;
      const upc = upcRaw ? normalizeUpc(upcRaw) || null : null;
      const clash = isrc && upc ? repo.trackByPair(isrc, upc) : undefined;
      if (clash && clash.id !== trackId)
        throw new ConflictError(`Track ${isrc} / ${upc} already exists`, 'duplicate_track');
      repo.setTrackIds(trackId, isrc, upc);
      return toTrackView({ ...t, isrc, upc });
    },

    /** Informational link: shows which artist a track belongs to. It never decides who gets paid. */
    linkArtistTrack(artistId: string, trackId: string): void {
      if (!repo.getArtist(artistId)) throw new NotFoundError('Artist', artistId);
      if (!repo.getTrack(trackId)) throw new NotFoundError('Track', trackId);
      repo.linkArtistTrack(artistId, trackId);
    },

    tracksOfArtists(artistIds: string[]): { artistId: string; track: TrackView }[] {
      return repo
        .tracksOfArtists(artistIds)
        .map((r) => ({ artistId: r.artistId, track: toTrackView(r.track) }));
    },

    listTracks(): TrackView[] {
      return repo.allTracks().map(toTrackView);
    },

    /** Set of "ISRC|UPC" keys known in module 1. */
    knownPairs(): Set<string> {
      return new Set(repo.knownPairs().map((p) => `${p.isrc}|${p.upc}`));
    },

    // ---- documents ----
    createDocument(input: {
      kind: DocumentKind;
      title: string;
      fileRef?: string | null;
      ownerId?: string | null;
      requiresApproval: boolean;
      uploadDeadline?: string | null;
      migration?: boolean;
    }): DocumentView {
      if (!DOCUMENT_KINDS.includes(input.kind))
        throw new ValidationError(`Unknown document kind ${input.kind}`);
      if (input.ownerId) requireLiveOwner(input.ownerId);
      if (input.uploadDeadline) assertDate(input.uploadDeadline);
      const id = newId();
      repo.insertDocument({
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
    },

    getDocument(id: string): DocumentView {
      const d = repo.getDocument(id);
      if (!d) throw new NotFoundError('Document', id);
      return toDocumentView(d);
    },

    listDocuments(ownerId?: string): DocumentView[] {
      return repo.listDocuments(ownerId).map(toDocumentView);
    },

    documentStatuses(ids: string[]): Map<string, DocumentStatus> {
      return new Map(repo.documentsByIds([...new Set(ids)]).map((d) => [d.id, documentStatus(d)]));
    },

    attachFile(id: string, fileRef: string): DocumentView {
      if (!fileRef.trim()) throw new ValidationError('File reference is required');
      this.getDocument(id);
      // A new file has not been reviewed: a previous approval does not carry over to it.
      repo.updateDocument(id, { fileRef: fileRef.trim(), approvedAt: null, approvedBy: null });
      return this.getDocument(id);
    },

    /** Manager approval. A document without a file cannot be approved; approving twice keeps the first approval. */
    approveDocument(id: string, by: string): DocumentView {
      const d = this.getDocument(id);
      if (d.status === 'not_attached')
        throw new RuleViolationError(
          'Attach the file before approving the document',
          'document_not_attached',
        );
      if (d.approvedAt) return d;
      repo.updateDocument(id, { approvedAt: nowIso(), approvedBy: by });
      return this.getDocument(id);
    },

    // ---- contracts ----
    /** A contract is concluded with the owner; it confirms the owner and the listed pseudonyms (artists). */
    createContract(input: {
      ownerId: string;
      documentId: string;
      number?: string | null;
      artistIds: string[];
    }) {
      requireLiveOwner(input.ownerId);
      const doc = this.getDocument(input.documentId);
      if (doc.kind !== 'contract')
        throw new ValidationError('A contract must reference a document of kind "contract"');
      // The owner is confirmed only by its own document.
      if (doc.ownerId && doc.ownerId !== input.ownerId)
        throw new RuleViolationError(
          'The contract document belongs to another owner',
          'document_owner_mismatch',
        );
      const id = newId();
      repo.transaction(() => {
        if (!doc.ownerId) repo.updateDocument(doc.id, { ownerId: input.ownerId });
        repo.insertContract({
          id,
          ownerId: input.ownerId,
          documentId: input.documentId,
          number: input.number ?? null,
          createdAt: nowIso(),
        });
        if (new Set(input.artistIds).size !== input.artistIds.length)
          throw new ValidationError('An artist is listed twice');
        for (const artistId of input.artistIds) {
          const a = repo.getArtist(artistId);
          if (!a) throw new NotFoundError('Artist', artistId);
          if (a.mergedInto)
            throw new RuleViolationError('Artist was merged; use the surviving record', 'artist_merged');
          if (a.ownerId === null) repo.setArtistOwner(artistId, input.ownerId);
          else if (a.ownerId !== input.ownerId) {
            throw new RuleViolationError(
              `Artist ${a.pseudonym} belongs to another owner`,
              'artist_owner_fixed',
            );
          }
          repo.linkContractArtist(id, artistId);
        }
      });
      return {
        id,
        ownerId: input.ownerId,
        documentId: input.documentId,
        number: input.number ?? null,
        artistIds: input.artistIds,
      };
    },

    contractsOfOwner(ownerId: string) {
      const list = repo.contractsOfOwner(ownerId);
      const links = repo.contractArtistsOf(list.map((c) => c.id));
      return list.map((c) => ({
        id: c.id,
        number: c.number,
        documentId: c.documentId,
        artistIds: links.filter((l) => l.contractId === c.id).map((l) => l.artistId),
      }));
    },

    // ---- merge ----
    /**
     * Merges an owner created without documents (e.g. an unknown publishing writer) into the confirmed original.
     * The merged record survives with merged_into set; references to it resolve to the original.
     */
    mergeOwners(fromId: string, intoId: string, reason: string): void {
      if (fromId === intoId) throw new ValidationError('Cannot merge an owner into itself');
      const fromOwner = requireLiveOwner(fromId);
      const intoOwner = requireLiveOwner(intoId);
      // A person (e.g. an unknown publishing author) is never merged into a label, nor the other way round.
      if (fromOwner.kind !== intoOwner.kind) {
        throw new RuleViolationError(
          'Owners of different kinds (person / label) cannot be merged',
          'merge_kind_mismatch',
        );
      }
      const confirmed = confirmedOwnerIds();
      // Direction is fixed: the unconfirmed record merges into the confirmed original (02, "Объединение записей").
      if (confirmed.has(fromId) || !confirmed.has(intoId)) {
        throw new RuleViolationError(
          'Only an owner without approved documents can be merged, and only into a confirmed owner',
          'merge_direction',
        );
      }
      repo.transaction(() => {
        repo.moveArtistsToOwner(fromId, intoId);
        repo.moveAliases(fromId, intoId);
        repo.moveDocuments(fromId, intoId);
        repo.moveContracts(fromId, intoId);
        repo.setOwnerMergedInto(fromId, intoId);
        repo.insertMerge({ id: newId(), entity: 'owner', fromId, intoId, reason, at: nowIso() });
      });
    },

    /** Merges duplicate artist records of the same owner (or an artist without owner into an existing one). */
    mergeArtists(fromId: string, intoId: string, reason: string): void {
      if (fromId === intoId) throw new ValidationError('Cannot merge an artist into itself');
      const from = repo.getArtist(fromId);
      const into = repo.getArtist(intoId);
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
      repo.transaction(() => {
        repo.moveArtistTracks(fromId, intoId);
        repo.moveContractArtists(fromId, intoId);
        repo.setArtistMergedInto(fromId, intoId);
        repo.insertMerge({ id: newId(), entity: 'artist', fromId, intoId, reason, at: nowIso() });
      });
    },

    listMerges: () => repo.listMerges(),
  };
}

export type OwnersService = ReturnType<typeof createOwnersService>;
