import { RuleViolationError } from '../shared/errors';
import type { OperationFilter } from '../modules/settlements';
import type { FacadeContext } from './context';

export function ownerViewApi(ctx: FacadeContext) {
  const { db, owners, settlements, publishing } = ctx;
  const api = {
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
        const [ops, ownerList, idx] = await Promise.all([
          settlements.listOperations(filter),
          owners.listOwners(),
          owners.artistIndex(),
        ]);
        const ownerName = new Map(ownerList.map((o) => [o.id, o.name]));
        return ops.map((o) => ({
          ...o,
          ownerName: o.ownerId ? (ownerName.get(o.ownerId) ?? null) : null,
          pseudonym: o.artistId ? (idx.get(o.artistId)?.pseudonym ?? null) : null,
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
