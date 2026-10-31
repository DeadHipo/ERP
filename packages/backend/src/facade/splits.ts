import { RuleViolationError, ValidationError } from '../shared/errors';
import type { FacadeContext } from './context';
import type { ShareSpec } from './context';

export function splitsApi(ctx: FacadeContext) {
  const { owners, splits, checkSplitDocument, resolveShares } = ctx;
  const api = {
    createSplit(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      shares: ShareSpec[];
      documentId?: string | null;
      note?: string | null;
    }) {
      checkSplitDocument(input.documentId);
      const build = resolveShares(input.shares);
      splits.checkCreate({
        isrc: input.isrc,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        percents: input.shares.map((s) => s.percent),
      });
      return splits.createSplit({ ...input, shares: build() });
    },
    changeSplit(input: {
      isrc: string;
      from: string;
      shares: ShareSpec[];
      documentId: string;
      note?: string | null;
    }) {
      if (!input.documentId)
        throw new RuleViolationError('A split change requires a confirming document', 'document_required');
      checkSplitDocument(input.documentId);
      const build = resolveShares(input.shares);
      splits.checkChange({
        isrc: input.isrc,
        from: input.from,
        percents: input.shares.map((s) => s.percent),
      });
      return splits.changeSplit({ ...input, shares: build() });
    },
    confirmSplit(splitId: string, documentId: string) {
      checkSplitDocument(documentId);
      return splits.confirmSplit(splitId, documentId);
    },
    buyout(input: { isrcs: string[]; sellerArtistId: string; effectiveFrom: string; documentId: string }) {
      const doc = owners.getDocument(input.documentId);
      if (doc.kind !== 'buyout')
        throw new ValidationError('A buyout is confirmed by a document of kind "buyout"');
      owners.getArtist(input.sellerArtistId);
      // Older splits may still hold an artist id that was merged into the seller (D-074, D-095).
      const idx = owners.artistIndex();
      const seller = idx.get(input.sellerArtistId)?.id ?? input.sellerArtistId;
      const sellerArtistIds = [...idx].filter(([, v]) => v.id === seller).map(([k]) => k);
      return splits.buyout({ ...input, sellerArtistIds });
    },
    /** Splits with artist names and document status, for the splits page. */
    listSplits(filter: { isrc?: string; artistId?: string; limit?: number }) {
      const list = splits.listSplits({
        ...(filter.isrc ? { isrc: filter.isrc } : {}),
        ...(filter.artistId ? { artistId: filter.artistId } : {}),
      });
      const idx = owners.artistIndex();
      const statuses = owners.documentStatuses(list.map((s) => s.documentId).filter((d): d is string => !!d));
      return {
        total: list.length,
        items: list.slice(0, filter.limit ?? 200).map((s) => ({
          ...s,
          documentStatus: s.documentId ? (statuses.get(s.documentId) ?? 'missing') : 'missing',
          shares: s.shares.map((x) => ({
            ...x,
            pseudonym: idx.get(x.artistId)?.pseudonym ?? '?',
            ownerId: idx.get(x.artistId)?.ownerId ?? null,
          })),
        })),
      };
    },
  };
  return api;
}
