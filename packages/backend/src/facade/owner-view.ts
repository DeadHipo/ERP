import { RuleViolationError } from '../shared/errors';
import type { OperationFilter } from '../modules/settlements';
import type { FacadeContext } from './context';

export function ownerViewApi(ctx: FacadeContext) {
  const { db, owners, settlements, publishing, labels, labelContext, assertOwnLabel } = ctx;
  const api = {
    /** A document; its label (D-169), when given, must be an own label (the module does not know labels). */
    async createDocument(input: Parameters<typeof owners.createDocument>[0]) {
      if (input.labelId) await assertOwnLabel(input.labelId);
      return owners.createDocument(input);
    },

    /** Sets or clears (null = any label) the label of a document (D-169); a contract opens the label of its document. */
    async setDocumentLabel(id: string, labelId: string | null) {
      if (labelId !== null) await assertOwnLabel(labelId);
      return owners.setDocumentLabel(id, labelId);
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

    ownerDetail(ownerId: string) {
      return db.snapshot(async () => {
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
