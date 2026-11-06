import { RuleViolationError } from '../shared/errors';
import type { OperationFilter } from '../modules/settlements';
import type { FacadeContext } from './context';
import { ALL_VIEWER, assertViewerHolds, assertViewerLabel, labelForbidden, viewerSees, type Viewer } from './viewer';

export function ownerViewApi(ctx: FacadeContext) {
  const { db, owners, settlements, publishing, labels, labelContext, assertOwnLabel, scopeOf } = ctx;
  const api = {
    /** A document; its label (D-169), when given, must be an own label (the module does not know labels). */
    async createDocument(input: Parameters<typeof owners.createDocument>[0]) {
      if (input.labelId) await assertOwnLabel(input.labelId);
      return owners.createDocument(input);
    },

    /**
     * Sets or clears (null = any label) the label of a document (D-169); a contract opens the label of its document.
     * A viewer of some labels (D-171) moves only a document of its labels or of any label, to one of its labels.
     */
    async setDocumentLabel(id: string, labelId: string | null, viewer: Viewer = ALL_VIEWER) {
      if (labelId !== null) await assertOwnLabel(labelId);
      if (viewer.kind !== 'all') {
        assertViewerLabel(viewer, (await owners.getDocument(id)).labelId);
        assertViewerHolds(viewer, labelId); // «any label» is the organization administrator's
      }
      return owners.setDocumentLabel(id, labelId);
    },

    /** Attaches the file of a document; the viewer's (D-171): a document of its labels or of any label. */
    async attachDocumentFile(id: string, fileRef: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') assertViewerLabel(viewer, (await owners.getDocument(id)).labelId);
      return owners.attachFile(id, fileRef);
    },

    /** Approves a document; the viewer's (D-171): a document of its labels or of any label. */
    async approveDocument(id: string, by: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') assertViewerLabel(viewer, (await owners.getDocument(id)).labelId);
      return owners.approveDocument(id, by);
    },

    /**
     * A contract of an owner on a document of kind contract. The viewer's (D-171): the document of its labels or of
     * any label, the owner visible under its labels or under no own label at all (a new owner); else 403.
     */
    async createContract(input: Parameters<typeof owners.createContract>[0], viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') {
        assertViewerLabel(viewer, (await owners.getDocument(input.documentId)).labelId);
        if (!(await scopeOf(viewer).ownerReachable(input.ownerId))) throw labelForbidden(); // another label's owner
      }
      return owners.createContract(input);
    },

    /**
     * The identifiers or the note of a track. The ISRC rule for a viewer of some labels (D-171): the old and the new
     * ISRC each in the files of its labels or in no book; else 403 `label_forbidden`.
     */
    async updateTrack(id: string, patch: { isrc?: string | null; upc?: string | null; note?: string | null }, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') {
        const scope = scopeOf(viewer);
        const track = (await owners.listTracks()).find((t) => t.id === id);
        if (track) await scope.assertIsrc(track.isrc);
        if (patch.isrc !== undefined) await scope.assertIsrc(patch.isrc);
      }
      let track;
      if (patch.isrc !== undefined && patch.upc !== undefined)
        track = await owners.setTrackIdentifiers(id, patch.isrc, patch.upc);
      if (patch.note !== undefined) track = await owners.setTrackNote(id, patch.note);
      return track;
    },

    /** The documents; under a label (D-169) those of the label and those without a label. */
    async listDocuments(
      query: Omit<Exclude<Parameters<typeof owners.listDocuments>[0], string | undefined>, 'labelId'> & {
        label?: string;
      } = {},
    ) {
      const { label, ...rest } = query;
      if (label !== undefined) await assertOwnLabel(label);
      return owners.listDocuments(label === undefined ? rest : { ...rest, labelId: label });
    },

    /** The owners (merged ones hidden); under a label (D-168) those visible under it. */
    async ownerList(f: { label?: string } = {}) {
      const lc = await labelContext(f.label);
      return (await owners.listOwners()).filter((o) => !lc || lc.visible.ownerIds.has(o.id));
    },

    /**
     * The owner card. A viewer of some labels (D-171) sees an owner visible under one of its labels (else 404, as an
     * unknown id), without the documents of other labels and the contracts on them.
     */
    async ownerDetail(ownerId: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') {
        await owners.getOwner(ownerId); // an unknown id first: 404 either way
        await scopeOf(viewer).assertOwnerVisible(ownerId);
      }
      const card = await db.snapshot(async () => {
        const owner = await owners.getOwner(ownerId);
        const artists = await owners.listArtistsOfOwner(owner.id);
        const tracks = await owners.tracksOfArtists(artists.map((a) => a.id));
        return {
          owner,
          artists: artists.map((a) => ({
            ...a,
            tracks: tracks.filter((t) => t.artistId === a.id).map((t) => t.track),
          })),
          documents: await owners.listDocuments(owner.id),
          contracts: await owners.contractsOfOwner(owner.id),
          publishingTerms: await publishing.termsOf([owner.id]),
        };
      });
      if (viewer.kind === 'all') return card;
      const docLabel = new Map(card.documents.map((d) => [d.id, d.labelId]));
      for (const c of card.contracts)
        if (!docLabel.has(c.documentId)) docLabel.set(c.documentId, (await owners.getDocument(c.documentId)).labelId);
      return {
        ...card,
        documents: card.documents.filter((d) => viewerSees(viewer, d.labelId)),
        contracts: card.contracts.filter((c) => viewerSees(viewer, docLabel.get(c.documentId) ?? null)),
      };
    },

    /**
     * Operations with the owner name and the pseudonym (N14). The filters run in SQL (`needsProof` = an active payout
     * without a payment proof); the names come from module 1 in the same snapshot.
     */
    listOperations(filter: OperationFilter = {}) {
      return db.snapshot(async () => {
        const [ops, ownerList, idx, labelList] = await Promise.all([
          settlements.listOperations(filter),
          owners.listOwners(),
          owners.artistIndex(),
          labels.listLabels(),
        ]);
        const ownerName = new Map(ownerList.map((o) => [o.id, o.name]));
        const labelName = new Map(labelList.map((l) => [l.id, l.name]));
        return ops.map((o) => ({
          ...o,
          ownerName: o.ownerId ? (ownerName.get(o.ownerId) ?? null) : null,
          pseudonym: o.artistId ? (idx.get(o.artistId)?.pseudonym ?? null) : null,
          labelName: o.labelId ? (labelName.get(o.labelId) ?? null) : null,
        }));
      });
    },

    /**
     * Merge of an unconfirmed owner into the confirmed one; publishing writer ids and operations follow.
     * The three modules change in one transaction (D-121).
     */
    mergeOwners(fromId: string, intoId: string, reason: string) {
      return db.transaction(async () => {
        if ((await settlements.blockingPayouts(fromId)).length > 0) {
          throw new RuleViolationError(
            'The owner has a payout without payment proof; settle it before merging',
            'payout_blocked',
          );
        }
        await owners.mergeOwners(fromId, intoId, reason);
        await publishing.reassignOwner(fromId, intoId);
        await settlements.reassignOwner(fromId, intoId);
        return owners.getOwner(intoId);
      });
    },
  };
  return api;
}
