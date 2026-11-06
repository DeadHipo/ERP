import { RuleViolationError, ValidationError } from '../shared/errors';
import { assertDate, monthOf, monthStart } from '../shared/dates';
import type { ParticipationInput } from '../modules/splits';
import type { FacadeContext } from './context';
import type { ShareSpec } from './context';
import { ALL_VIEWER, assertViewerLabel, type Viewer } from './viewer';

/** Entry rule (M52): a rule date is the first day of its month, the whole month goes to the new holder. */
const floorToMonth = (d: string) => monthStart(monthOf(assertDate(d)));

/**
 * The same entry rule for an end date (D-130): `valid_to` (exclusive) is floored to its month start too, so a
 * part-month goes to the new holder and `[from, to)` of the predecessor and the successor never overlap. A period
 * that becomes empty after flooring is refused (`empty_period`).
 */
function floorEnd(validFrom: string, validTo: string | null | undefined): string | null {
  if (validTo === null || validTo === undefined || validTo === '') return null;
  const to = floorToMonth(validTo);
  if (to <= validFrom)
    throw new ValidationError(
      `The period ${validFrom} .. ${to} is empty after flooring the end date to the month start`,
      { validFrom, validTo: to },
      'empty_period',
    );
  return to;
}

export function splitsApi(ctx: FacadeContext) {
  const { db, owners, splits, labels, checkSplitDocument, resolveShares, scopeOf } = ctx;

  /**
   * The rule of a viewer of some labels for a row write (D-171): every ISRC in the files of its labels or in no book
   * (`label_forbidden` otherwise), every cited document of its labels or of any label. Read before the transaction.
   */
  async function checkRowWrite(viewer: Viewer, isrcs: (string | null | undefined)[], documentIds: (string | null | undefined)[]) {
    if (viewer.kind === 'all') return;
    const scope = scopeOf(viewer);
    for (const isrc of isrcs) await scope.assertIsrc(isrc);
    for (const id of new Set(documentIds.filter((x): x is string => !!x)))
      assertViewerLabel(viewer, (await owners.getDocument(id)).labelId);
  }

  const api = {
    /** New artists of the shares and the split are written in one transaction (D-121). */
    async createSplit(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      shares: ShareSpec[];
      documentId?: string | null;
      note?: string | null;
    }, viewer: Viewer = ALL_VIEWER) {
      await checkRowWrite(viewer, [input.isrc], [input.documentId, ...input.shares.map((x) => x.documentId)]);
      return db.transaction(async () => {
        const validFrom = floorToMonth(input.validFrom);
        const validTo = floorEnd(validFrom, input.validTo);
        await checkSplitDocument(input.documentId);
        const build = await resolveShares(input.shares);
        await splits.checkCreate({
          isrc: input.isrc,
          validFrom,
          validTo,
          percents: input.shares.map((s) => s.percent),
        });
        return splits.createSplit({ ...input, validFrom, validTo, shares: await build() });
      });
    },
    async changeSplit(input: {
      isrc: string;
      from: string;
      shares: ShareSpec[];
      documentId: string;
      note?: string | null;
    }, viewer: Viewer = ALL_VIEWER) {
      await checkRowWrite(viewer, [input.isrc], [input.documentId, ...input.shares.map((x) => x.documentId)]);
      return db.transaction(async () => {
        if (!input.documentId)
          throw new RuleViolationError('A split change requires a confirming document', 'document_required');
        const from = floorToMonth(input.from);
        await checkSplitDocument(input.documentId);
        const build = await resolveShares(input.shares);
        splits.checkChange({
          isrc: input.isrc,
          from,
          percents: input.shares.map((s) => s.percent),
        });
        return splits.changeSplit({ ...input, from, shares: await build() });
      });
    },
    async confirmSplit(splitId: string, documentId: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') await checkRowWrite(viewer, [(await splits.getSplit(splitId)).isrc], [documentId]);
      await checkSplitDocument(documentId);
      return splits.confirmSplit(splitId, documentId);
    },
    async buyout(input: { isrcs: string[]; sellerArtistId: string; effectiveFrom: string; documentId: string }, viewer: Viewer = ALL_VIEWER) {
      await checkRowWrite(viewer, input.isrcs, [input.documentId]);
      return db.transaction(async () => {
        const doc = await owners.getDocument(input.documentId);
        if (doc.kind !== 'buyout')
          throw new ValidationError('A buyout is confirmed by a document of kind "buyout"');
        await owners.getArtist(input.sellerArtistId);
        // Older splits may still hold an artist id that was merged into the seller (D-074, D-095).
        const idx = await owners.artistIndex();
        const seller = idx.get(input.sellerArtistId)?.id ?? input.sellerArtistId;
        const sellerArtistIds = [...idx].filter(([, v]) => v.id === seller).map(([k]) => k);
        return splits.buyout({ ...input, effectiveFrom: floorToMonth(input.effectiveFrom), sellerArtistIds });
      });
    },
    /** Creates a participation; its start and end are floored to the month start (M52, D-130). */
    async createParticipation(input: ParticipationInput, viewer: Viewer = ALL_VIEWER) {
      await checkRowWrite(viewer, [input.isrc], [input.documentId]);
      return db.transaction(async () => {
        const validFrom = floorToMonth(input.validFrom);
        const validTo = floorEnd(validFrom, input.validTo);
        await checkSplitDocument(input.documentId);
        const idx = await owners.artistIndex();
        const canon = (id: string) => idx.get(id)?.id ?? id;
        await owners.getArtist(input.artistId);
        if (input.fromArtistId) await owners.getArtist(input.fromArtistId);
        return splits.createParticipation({
          ...input,
          artistId: canon(input.artistId),
          fromArtistId: input.fromArtistId ? canon(input.fromArtistId) : null,
          validFrom,
          validTo,
        });
      });
    },
    /** Ends a participation; the end date is floored to the month start (D-130). */
    async closeParticipation(id: string, validTo: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') await checkRowWrite(viewer, [(await splits.getParticipation(id)).isrc], []);
      return db.transaction(async () => {
        const p = await splits.getParticipation(id);
        return splits.closeParticipation(id, floorEnd(p.validFrom, validTo) ?? validTo);
      });
    },
    /** Participations with pseudonyms, owner ids and document status. */
    async listParticipations(filter: { isrc?: string; artistId?: string; limit?: number; offset?: number } = {}, viewer: Viewer = ALL_VIEWER) {
      // a viewer of some labels (D-171): the rows on the ISRCs of the ISRC rule
      const mayTouch = await scopeOf(viewer).isrcFilter();
      return db.snapshot(async () => {
        const list = (await splits.listParticipations({
          ...(filter.isrc ? { isrc: filter.isrc } : {}),
          ...(filter.artistId ? { artistId: filter.artistId } : {}),
        })).filter((p) => mayTouch(p.isrc));
        const idx = await owners.artistIndex();
        const page =
          filter.limit === undefined && filter.offset === undefined
            ? list
            : list.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? list.length));
        const statuses = await owners.documentStatuses(
          page.map((p) => p.documentId).filter((d): d is string => !!d),
        );
        return {
          total: list.length,
          items: page.map((p) => ({
            ...p,
            documentStatus: p.documentId ? (statuses.get(p.documentId) ?? 'missing') : 'missing',
            pseudonym: idx.get(p.artistId)?.pseudonym ?? '?',
            ownerId: idx.get(p.artistId)?.ownerId ?? null,
            fromPseudonym: p.fromArtistId ? (idx.get(p.fromArtistId)?.pseudonym ?? '?') : null,
          })),
        };
      });
    },
    /** Labels with aliases and rules; a rule carries the recipient pseudonym and the document status. */
    listLabels() {
      return db.snapshot(async () => {
        const list = await labels.listLabels();
        const idx = await owners.artistIndex();
        const statuses = await owners.documentStatuses(
          list.flatMap((l) => l.rules.map((r) => r.documentId)).filter((d): d is string => !!d),
        );
        return list.map((l) => ({
          ...l,
          rules: l.rules.map((r) => ({
            ...r,
            recipientPseudonym: idx.get(r.recipientArtistId)?.pseudonym ?? '?',
            documentStatus: r.documentId ? (statuses.get(r.documentId) ?? 'missing') : 'missing',
          })),
        }));
      });
    },
    /**
     * A sublabel rule: the start and the end are floored to the month start (M52, D-130), the recipient must exist,
     * the document kind is checked.
     */
    createLabelRule(input: {
      labelId: string;
      percent: string;
      recipientArtistId: string;
      validFrom: string;
      validTo?: string | null;
      documentId?: string | null;
      note?: string | null;
    }) {
      return db.transaction(async () => {
        const validFrom = floorToMonth(input.validFrom);
        const validTo = floorEnd(validFrom, input.validTo);
        await checkSplitDocument(input.documentId);
        const idx = await owners.artistIndex();
        await owners.getArtist(input.recipientArtistId);
        return labels.setRule({
          ...input,
          recipientArtistId: idx.get(input.recipientArtistId)?.id ?? input.recipientArtistId,
          validFrom,
          validTo,
        });
      });
    },
    /** Ends a sublabel rule; the end date is floored to the month start (D-130). */
    closeLabelRule(id: string, validTo: string) {
      return db.transaction(async () => {
        const r = await labels.getRule(id);
        return labels.closeRule(id, floorEnd(r.validFrom, validTo) ?? validTo);
      });
    },
    /** Splits with artist names and document status, for the splits page. */
    async listSplits(filter: {
      isrc?: string;
      artistId?: string;
      limit?: number;
      offset?: number;
      /** `unconfirmed`: the document is missing or not approved. */
      status?: 'unconfirmed';
    }, viewer: Viewer = ALL_VIEWER) {
      // a viewer of some labels (D-171): the rows on the ISRCs of the ISRC rule
      const mayTouch = await scopeOf(viewer).isrcFilter();
      return db.snapshot(async () => {
        const list = (await splits.listSplits({
          ...(filter.isrc ? { isrc: filter.isrc } : {}),
          ...(filter.artistId ? { artistId: filter.artistId } : {}),
        })).filter((s) => mayTouch(s.isrc));
        const idx = await owners.artistIndex();
        const statuses = await owners.documentStatuses(
          list.map((s) => s.documentId).filter((d): d is string => !!d),
        );
        const withStatus = list.map((s) => ({
          s,
          documentStatus: s.documentId ? (statuses.get(s.documentId) ?? 'missing') : 'missing',
        }));
        const kept =
          filter.status === 'unconfirmed'
            ? withStatus.filter((x) => x.documentStatus !== 'approved')
            : withStatus;
        const from = filter.offset ?? 0;
        return {
          total: kept.length,
          items: kept.slice(from, from + (filter.limit ?? 200)).map(({ s, documentStatus }) => ({
            ...s,
            documentStatus,
            shares: s.shares.map((x) => ({
              ...x,
              pseudonym: idx.get(x.artistId)?.pseudonym ?? '?',
              ownerId: idx.get(x.artistId)?.ownerId ?? null,
            })),
          })),
        };
      });
    },
  };
  return api;
}
