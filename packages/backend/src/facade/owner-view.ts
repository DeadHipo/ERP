import { RuleViolationError } from '../shared/errors';
import type { FacadeContext } from './context';

export function ownerViewApi(ctx: FacadeContext) {
  const { owners, settlements, publishing } = ctx;
  const api = {
    ownerDetail(ownerId: string) {
      const owner = owners.getOwner(ownerId);
      const artists = owners.listArtistsOfOwner(owner.id);
      const tracks = owners.tracksOfArtists(artists.map((a) => a.id));
      return {
        owner,
        artists: artists.map((a) => ({
          ...a,
          tracks: tracks.filter((t) => t.artistId === a.id).map((t) => t.track),
        })),
        documents: owners.listDocuments(owner.id),
        contracts: owners.contractsOfOwner(owner.id),
        publishingTerms: publishing.termsOf([owner.id]),
      };
    },

    /** Merge of an unconfirmed owner into the confirmed one; publishing writer ids and operations follow. */
    mergeOwners(fromId: string, intoId: string, reason: string) {
      if (settlements.blockingPayouts(fromId).length > 0) {
        throw new RuleViolationError(
          'The owner has a payout without payment proof; settle it before merging',
          'payout_blocked',
        );
      }
      owners.mergeOwners(fromId, intoId, reason);
      publishing.reassignOwner(fromId, intoId);
      settlements.reassignOwner(fromId, intoId);
      return owners.getOwner(intoId);
    },
  };
  return api;
}
