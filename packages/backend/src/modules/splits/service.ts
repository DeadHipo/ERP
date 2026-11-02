import { Decimal, sum } from '../../shared/money';
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { assertDate, nowIso, type IsoDate } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { ParticipationRow, ShareRow, SplitRow } from './repository';
import { createSplitsRepository } from './repository';

export interface ShareInput {
  artistId: string;
  percent: string;
  /** The row's own document: overrides the split's document for this row only (D-126). */
  documentId?: string | null;
}

export type ParticipationBase = 'net' | 'bucket';
export type FundedFrom = 'top' | 'artist_pool' | 'artist_share' | 'label_share';
const FUNDED_ORDER: FundedFrom[] = ['top', 'artist_pool', 'artist_share', 'label_share'];

export interface ParticipationInput {
  isrc: string;
  /** The recipient pseudonym. */
  artistId: string;
  percent: string;
  base: ParticipationBase;
  fundedFrom: FundedFrom;
  /** Only for `artist_share`: the artist whose amount the percent is taken from. */
  fromArtistId?: string | null;
  validFrom: string;
  validTo?: string | null;
  documentId?: string | null;
  origin?: string;
  note?: string | null;
}

export interface ParticipationView {
  id: string;
  isrc: string;
  artistId: string;
  percent: string;
  base: ParticipationBase;
  fundedFrom: FundedFrom;
  fromArtistId: string | null;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  documentId: string | null;
  origin: string;
  note: string | null;
}

export interface ParticipationAtDate {
  id: string;
  artistId: string;
  percent: Decimal;
  base: ParticipationBase;
  fundedFrom: FundedFrom;
  fromArtistId: string | null;
  documentId: string | null;
}

export interface SplitView {
  id: string;
  isrc: string;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  documentId: string | null;
  origin: string;
  note: string | null;
  shares: { artistId: string; percent: string; documentId: string | null }[];
  /** Our share is never stored: 100 minus the sum of artist and MC shares. */
  ourShare: string;
}

export interface SplitAtDate {
  splitId: string;
  documentId: string | null;
  shares: { artistId: string; percent: Decimal; documentId: string | null }[];
  ourShare: Decimal;
}

const HUNDRED = new Decimal(100);

/** Percent of a share: 0..100 with at most 6 decimals (so net x percent stays exact within decimal.js precision). */
function parsePercent(raw: string): Decimal {
  if (!/^\d+(\.\d{1,6})?$/.test(raw.trim()))
    throw new ValidationError(`Invalid percent "${raw}" (0..100, up to 6 decimals)`);
  const d = new Decimal(raw.trim());
  if (d.gt(HUNDRED)) throw new ValidationError(`Percent ${raw} is above 100`);
  return d;
}

/** Validates shares: each 0..100, no artist twice, the sum not above 100 (our share cannot be negative). */
export function validateShares(
  shares: ShareInput[],
): { artistId: string; percent: Decimal; documentId: string | null }[] {
  const seen = new Set<string>();
  const parsed = shares.map((s) => {
    if (!s.artistId) throw new ValidationError('Share without artist');
    if (seen.has(s.artistId)) throw new ValidationError(`Artist ${s.artistId} appears twice in one split`);
    seen.add(s.artistId);
    return { artistId: s.artistId, percent: parsePercent(s.percent), documentId: s.documentId ?? null };
  });
  const total = sum(parsed.map((p) => p.percent));
  if (total.gt(HUNDRED)) {
    throw new RuleViolationError(
      `Sum of artist shares ${total.toFixed()} exceeds 100`,
      'split_sum_above_100',
    );
  }
  return parsed;
}

const covers = (s: Pick<SplitRow, 'validFrom' | 'validTo'>, date: IsoDate) =>
  s.validFrom <= date && (s.validTo === null || date < s.validTo);

const overlaps = (
  a: { validFrom: string; validTo: string | null },
  b: { validFrom: string; validTo: string | null },
) => a.validFrom < (b.validTo ?? '9999-12-31') && b.validFrom < (a.validTo ?? '9999-12-31');

export function createSplitsService(db: Db) {
  const repo = createSplitsRepository(db);

  function view(s: SplitRow, shares: ShareRow[]): SplitView {
    const own = shares.filter((x) => x.splitId === s.id);
    return {
      id: s.id,
      isrc: s.isrc,
      validFrom: s.validFrom,
      validTo: s.validTo,
      documentId: s.documentId,
      origin: s.origin,
      note: s.note,
      shares: own.map((x) => ({ artistId: x.artistId, percent: x.percent, documentId: x.documentId })),
      ourShare: HUNDRED.sub(sum(own.map((x) => new Decimal(x.percent)))).toFixed(),
    };
  }

  function partView(p: ParticipationRow): ParticipationView {
    return {
      id: p.id,
      isrc: p.isrc,
      artistId: p.artistId,
      percent: p.percent,
      base: p.base as ParticipationBase,
      fundedFrom: p.fundedFrom as FundedFrom,
      fromArtistId: p.fromArtistId,
      validFrom: p.validFrom,
      validTo: p.validTo,
      documentId: p.documentId,
      origin: p.origin,
      note: p.note,
    };
  }

  /** A pseudonym is a row or a participation on an ISRC and date, never both (D-126), checked from the split side. */
  async function assertNoParticipation(
    isrc: string,
    period: { validFrom: string; validTo: string | null },
    shares: { artistId: string; percent: Decimal }[],
  ) {
    if (period.validTo !== null && period.validTo <= period.validFrom) return; // empty period: nothing in force
    const ids = new Set(shares.filter((x) => x.percent.gt(0)).map((x) => x.artistId));
    if (ids.size === 0) return;
    for (const p of await repo.participationsOfIsrc(isrc)) {
      if (ids.has(p.artistId) && overlaps(p, period)) {
        throw new RuleViolationError(
          `Artist ${p.artistId} has a participation on ${isrc} from ${p.validFrom}: it cannot also be a split row`,
          'double_participation',
        );
      }
    }
  }

  async function insert(input: {
    isrc: string;
    validFrom: IsoDate;
    validTo: IsoDate | null;
    shares: { artistId: string; percent: Decimal; documentId: string | null }[];
    documentId: string | null;
    origin: string;
    note?: string | null;
  }): Promise<string> {
    const id = newId();
    await repo.insertSplit({
      id,
      isrc: input.isrc,
      validFrom: input.validFrom,
      validTo: input.validTo,
      documentId: input.documentId,
      origin: input.origin,
      note: input.note ?? null,
      createdAt: nowIso(),
    });
    await repo.insertShares(
      input.shares.map((s) => ({
        splitId: id,
        artistId: s.artistId,
        percent: s.percent.toFixed(),
        documentId: s.documentId,
      })),
    );
    return id;
  }

  const service = {
    /**
     * Creates a split for an ISRC. Without a confirming document the split is still calculated,
     * but the facade excludes it from totals (category C, "waiting for confirmation").
     */
    async createSplit(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      shares: ShareInput[];
      documentId?: string | null;
      origin?: string;
      note?: string | null;
    }): Promise<SplitView> {
      const isrc = assertIsrc(input.isrc);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      const shares = validateShares(input.shares);
      return repo.transaction(async () => {
        for (const other of await repo.splitsOfIsrc(isrc)) {
          if (overlaps(other, { validFrom, validTo })) {
            throw new ConflictError(
              `Split period overlaps an existing split of ${isrc} from ${other.validFrom}`,
              'split_overlap',
            );
          }
        }
        await assertNoParticipation(isrc, { validFrom, validTo }, shares);
        const id = await insert({
          isrc,
          validFrom,
          validTo,
          shares,
          documentId: input.documentId ?? null,
          origin: input.origin ?? 'manual',
          note: input.note ?? null,
        });
        return service.getSplit(id);
      });
    },

    /**
     * Changes the split of an ISRC from a date: the split in force is closed at that date and a new one starts.
     * Every change must be confirmed by a document (a new contract, appendix or buyout).
     */
    async changeSplit(input: {
      isrc: string;
      from: string;
      shares: ShareInput[];
      documentId: string;
      origin?: string;
      note?: string | null;
    }): Promise<SplitView> {
      if (!input.documentId)
        throw new RuleViolationError('A split change requires a confirming document', 'document_required');
      const isrc = assertIsrc(input.isrc);
      const from = assertDate(input.from);
      const shares = validateShares(input.shares);
      return repo.transaction(async () => {
        const existing = await repo.splitsOfIsrc(isrc);
        const current = existing.find((s) => covers(s, from));
        // The new split lasts until the end of the split it replaces, or until the next existing split.
        let validTo: string | null;
        if (current) {
          validTo = current.validTo;
          // History is kept: a split replaced from its first day stays as an empty period [from, from).
          await repo.setValidTo(current.id, from);
        } else {
          validTo =
            existing
              .map((s) => s.validFrom)
              .filter((d) => d > from)
              .sort()[0] ?? null;
        }
        await assertNoParticipation(isrc, { validFrom: from, validTo }, shares);
        const id = await insert({
          isrc,
          validFrom: from,
          validTo,
          shares,
          documentId: input.documentId,
          origin: input.origin ?? 'manual',
          note: input.note ?? null,
        });
        return service.getSplit(id);
      });
    },

    /** Runs the checks of changeSplit without writing (the facade calls it before creating new artists). */
    checkChange(input: { isrc: string; from: string; percents: string[] }): void {
      assertIsrc(input.isrc);
      assertDate(input.from);
      validateShares(input.percents.map((percent, i) => ({ artistId: `check-${i}`, percent })));
    },

    /** Runs the checks of createSplit without writing (the facade calls it before creating new artists). */
    async checkCreate(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      percents: string[];
    }): Promise<void> {
      const isrc = assertIsrc(input.isrc);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      validateShares(input.percents.map((percent, i) => ({ artistId: `check-${i}`, percent })));
      for (const other of await repo.splitsOfIsrc(isrc)) {
        if (overlaps(other, { validFrom, validTo })) {
          throw new ConflictError(
            `Split period overlaps an existing split of ${isrc} from ${other.validFrom}`,
            'split_overlap',
          );
        }
      }
    },

    /**
     * Buyout: the seller's share becomes 0 on the listed ISRCs from the effective date; our share (the remainder)
     * grows automatically. The buyout payment itself is not part of any balance.
     */
    async buyout(input: {
      isrcs: string[];
      sellerArtistId: string;
      effectiveFrom: string;
      documentId: string;
      /** Every id that stands for the seller (the facade adds artists merged into it); default: the seller only. */
      sellerArtistIds?: string[];
    }): Promise<SplitView[]> {
      const sellerIds = new Set(input.sellerArtistIds ?? [input.sellerArtistId]);
      sellerIds.add(input.sellerArtistId);
      if (!input.documentId)
        throw new RuleViolationError('A buyout requires a buyout document', 'document_required');
      const from = assertDate(input.effectiveFrom);
      return repo.transaction(async () => {
        const changed: SplitView[] = [];
        for (const raw of input.isrcs) {
          const isrc = assertIsrc(raw);
          const all = await repo.splitsOfIsrc(isrc);
          const current = all.find((s) => covers(s, from));
          if (!current) throw new NotFoundError('Split in force for', `${isrc} at ${from}`);
          // The seller's share becomes 0 from the effective date on, also in splits that start later.
          const affected = [current, ...all.filter((s) => s.validFrom > from && s.validTo !== s.validFrom)];
          for (const s of affected) {
            const shares = await repo.sharesOf([s.id]);
            const seller = shares.filter((x) => sellerIds.has(x.artistId));
            if (s === current && seller.length === 0)
              throw new ValidationError(`Seller is not in the split of ${isrc}`);
            if (seller.every((x) => new Decimal(x.percent).isZero())) continue;
            const next = shares.map((x) => ({
              artistId: x.artistId,
              percent: sellerIds.has(x.artistId) ? '0' : x.percent,
              // the other rows keep their own documents (an assumption row stays one, D-127)
              documentId: x.documentId,
            }));
            changed.push(
              await service.changeSplit({
                isrc,
                from: s === current ? from : s.validFrom,
                shares: next,
                documentId: input.documentId,
                origin: 'buyout',
              }),
            );
          }
        }
        return changed;
      });
    },

    /**
     * Creates a participation: `percent` of `base` paid to the recipient pseudonym, funded from `fundedFrom`.
     * Refused: an overlap for the same (ISRC, recipient, funded_from, source artist) `participation_overlap`; a recipient that is a
     * split row on the ISRC in the period `double_participation`; Σ `top` above 100 `top_above_100`.
     */
    async createParticipation(input: ParticipationInput): Promise<ParticipationView> {
      const isrc = assertIsrc(input.isrc);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      if (!input.artistId) throw new ValidationError('Participation without recipient');
      const percent = parsePercent(input.percent);
      if (!FUNDED_ORDER.includes(input.fundedFrom))
        throw new ValidationError(`Unknown funded_from "${input.fundedFrom}"`);
      if (input.base !== 'net' && input.base !== 'bucket')
        throw new ValidationError(`Unknown base "${input.base}"`);
      const fromArtistId = input.fromArtistId || null;
      if (input.fundedFrom === 'top' || input.fundedFrom === 'artist_pool') {
        if (input.base !== 'net') throw new ValidationError(`${input.fundedFrom} requires base "net"`);
      }
      if (input.fundedFrom === 'artist_share') {
        if (input.base !== 'bucket') throw new ValidationError('artist_share requires base "bucket"');
        if (!fromArtistId) throw new ValidationError('artist_share requires fromArtistId');
        if (fromArtistId === input.artistId)
          throw new ValidationError('fromArtistId must differ from the recipient');
      } else if (fromArtistId) {
        throw new ValidationError('fromArtistId is only for artist_share');
      }
      return repo.transaction(async () => {
        const existing = await repo.participationsOfIsrc(isrc);
        const period = { validFrom, validTo };
        for (const o of existing) {
          if (
            o.artistId === input.artistId &&
            o.fundedFrom === input.fundedFrom &&
            (o.fromArtistId ?? '') === (fromArtistId ?? '') &&
            overlaps(o, period)
          ) {
            throw new ConflictError(
              `Participation period overlaps an existing one of ${input.artistId} on ${isrc} from ${o.validFrom}`,
              'participation_overlap',
            );
          }
        }
        if (percent.gt(0)) {
          for (const sp of await repo.splitsOfIsrc(isrc)) {
            if (sp.validTo !== null && sp.validTo <= sp.validFrom) continue;
            if (!overlaps(sp, period)) continue;
            const row = (await repo.sharesOf([sp.id])).find(
              (x) => x.artistId === input.artistId && new Decimal(x.percent).gt(0),
            );
            if (row) {
              throw new RuleViolationError(
                `Artist ${input.artistId} is a split row on ${isrc} from ${sp.validFrom}: it cannot also hold a participation`,
                'double_participation',
              );
            }
          }
        }
        if (input.fundedFrom === 'top') {
          const total = sum([
            percent,
            ...existing
              .filter((o) => o.fundedFrom === 'top' && overlaps(o, period))
              .map((o) => new Decimal(o.percent)),
          ]);
          if (total.gt(HUNDRED)) {
            throw new RuleViolationError(
              `Off-the-top participations of ${isrc} sum to ${total.toFixed()}, above 100`,
              'top_above_100',
            );
          }
        }
        const id = newId();
        await repo.insertParticipation({
          id,
          isrc,
          artistId: input.artistId,
          percent: percent.toFixed(),
          base: input.base,
          fundedFrom: input.fundedFrom,
          fromArtistId,
          validFrom,
          validTo,
          documentId: input.documentId ?? null,
          origin: input.origin ?? 'manual',
          note: input.note ?? null,
          createdAt: nowIso(),
        });
        return service.getParticipation(id);
      });
    },

    /** Ends a participation at `validTo` (exclusive); it may only shorten the period. */
    async closeParticipation(id: string, validToRaw: string): Promise<ParticipationView> {
      const validTo = assertDate(validToRaw);
      return repo.transaction(async () => {
        const p = await repo.getParticipation(id);
        if (!p) throw new NotFoundError('Participation', id);
        if (validTo <= p.validFrom) throw new ValidationError('valid_to must be after valid_from');
        if (p.validTo !== null && validTo > p.validTo)
          throw new ValidationError('A participation can only be closed earlier, not extended');
        await repo.setParticipationValidTo(id, validTo);
        return service.getParticipation(id);
      });
    },

    async getParticipation(id: string): Promise<ParticipationView> {
      const p = await repo.getParticipation(id);
      if (!p) throw new NotFoundError('Participation', id);
      return partView(p);
    },

    async listParticipations(
      filter: { isrc?: string; artistId?: string } = {},
    ): Promise<ParticipationView[]> {
      const rows = filter.isrc
        ? await repo.participationsOfIsrc(assertIsrc(filter.isrc))
        : filter.artistId
          ? await repo.participationsOfArtist(filter.artistId)
          : await repo.allParticipations();
      return rows.filter((r) => !filter.artistId || r.artistId === filter.artistId).map(partView);
    },

    /** Attaches the confirming appendix document to an existing split. */
    async confirmSplit(splitId: string, documentId: string): Promise<SplitView> {
      const s = await repo.getSplit(splitId);
      if (!s) throw new NotFoundError('Split', splitId);
      if (s.documentId && s.documentId !== documentId) {
        throw new ConflictError(
          'The split is already confirmed by another document; a change is a new split',
          'split_document_set',
        );
      }
      await repo.setDocument(splitId, documentId);
      return service.getSplit(splitId);
    },

    async getSplit(id: string): Promise<SplitView> {
      const s = await repo.getSplit(id);
      if (!s) throw new NotFoundError('Split', id);
      return view(s, await repo.sharesOf([id]));
    },

    async listSplits(filter: { isrc?: string; artistId?: string } = {}): Promise<SplitView[]> {
      let rows: SplitRow[];
      let shares: ShareRow[];
      if (filter.isrc) {
        rows = await repo.splitsOfIsrc(assertIsrc(filter.isrc));
        shares = await repo.sharesOf(rows.map((r) => r.id));
      } else if (filter.artistId) {
        const ids = new Set(await repo.splitIdsOfArtist(filter.artistId));
        rows = (await repo.allSplits()).filter((s) => ids.has(s.id));
        shares = await repo.sharesOf(rows.map((r) => r.id));
      } else {
        // every split: one read of all shares instead of a list of ids (13 000+ splits)
        [rows, shares] = await db.snapshot(() => Promise.all([repo.allSplits(), repo.allShares()]));
      }
      const bySplit = new Map<string, ShareRow[]>();
      for (const sh of shares) bySplit.set(sh.splitId, [...(bySplit.get(sh.splitId) ?? []), sh]);
      return rows.map((r) => view(r, bySplit.get(r.id) ?? []));
    },

    /** The split in force for an ISRC on a date (the report date). */
    async splitAt(isrcRaw: string, date: string): Promise<SplitAtDate | undefined> {
      return (await service.index()).at(assertIsrc(isrcRaw), date);
    },

    /**
     * In-memory index of all splits, built once per facade calculation (one consistent read of the module).
     */
    async index() {
      const [allSplits, allShares, allParts] = await db.snapshot(() =>
        Promise.all([repo.allSplits(), repo.allShares(), repo.allParticipations()]),
      );
      const partsByIsrc = new Map<string, ParticipationRow[]>();
      for (const p of allParts) {
        const list = partsByIsrc.get(p.isrc) ?? [];
        list.push(p);
        partsByIsrc.set(p.isrc, list);
      }
      const byIsrc = new Map<string, SplitRow[]>();
      for (const s of allSplits) {
        const list = byIsrc.get(s.isrc) ?? [];
        list.push(s);
        byIsrc.set(s.isrc, list);
      }
      const sharesBySplit = new Map<
        string,
        { artistId: string; percent: Decimal; documentId: string | null }[]
      >();
      for (const sh of allShares) {
        const list = sharesBySplit.get(sh.splitId) ?? [];
        list.push({ artistId: sh.artistId, percent: new Decimal(sh.percent), documentId: sh.documentId });
        sharesBySplit.set(sh.splitId, list);
      }
      const cache = new Map<string, SplitAtDate | undefined>();
      return {
        isrcs: () => [...byIsrc.keys()],
        documentIds: () => [
          ...new Set(
            [
              ...[...byIsrc.values()].flat().map((s) => s.documentId),
              ...allShares.map((s) => s.documentId),
              ...allParts.map((p) => p.documentId),
            ].filter((d): d is string => !!d),
          ),
        ],
        /** Participations in force on a date, ordered top, artist_pool, artist_share, label_share, then validFrom, id. */
        participationsAt(isrc: string, date: IsoDate): ParticipationAtDate[] {
          return (partsByIsrc.get(isrc) ?? [])
            .filter((p) => covers(p, date))
            .sort(
              (a, b) =>
                FUNDED_ORDER.indexOf(a.fundedFrom as FundedFrom) -
                  FUNDED_ORDER.indexOf(b.fundedFrom as FundedFrom) ||
                a.validFrom.localeCompare(b.validFrom) ||
                a.id.localeCompare(b.id),
            )
            .map((p) => ({
              id: p.id,
              artistId: p.artistId,
              percent: new Decimal(p.percent),
              base: p.base as ParticipationBase,
              fundedFrom: p.fundedFrom as FundedFrom,
              fromArtistId: p.fromArtistId,
              documentId: p.documentId,
            }));
        },
        at(isrc: string, date: IsoDate): SplitAtDate | undefined {
          const key = `${isrc}|${date}`;
          if (cache.has(key)) return cache.get(key);
          const s = (byIsrc.get(isrc) ?? []).find((x) => covers(x, date));
          const result = s
            ? (() => {
                const shares = sharesBySplit.get(s.id) ?? [];
                return {
                  splitId: s.id,
                  documentId: s.documentId,
                  shares,
                  ourShare: HUNDRED.sub(sum(shares.map((x) => x.percent))),
                };
              })()
            : undefined;
          cache.set(key, result);
          return result;
        },
      };
    },
  };
  return service;
}

export type SplitsService = ReturnType<typeof createSplitsService>;
export type SplitsIndex = Awaited<ReturnType<SplitsService['index']>>;
