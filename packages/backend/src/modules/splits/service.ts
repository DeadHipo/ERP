import { Decimal, sum } from '../../shared/money';
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { assertDate, nowIso, type IsoDate } from '../../shared/dates';
import type { ShareRow, SplitRow, SplitsDb } from './repository';
import { createSplitsRepository } from './repository';

export interface ShareInput {
  artistId: string;
  percent: string;
}

export interface SplitView {
  id: string;
  isrc: string;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  documentId: string | null;
  origin: string;
  note: string | null;
  shares: { artistId: string; percent: string }[];
  /** Our share is never stored: 100 minus the sum of artist and MC shares. */
  ourShare: string;
}

export interface SplitAtDate {
  splitId: string;
  documentId: string | null;
  shares: { artistId: string; percent: Decimal }[];
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
export function validateShares(shares: ShareInput[]): { artistId: string; percent: Decimal }[] {
  const seen = new Set<string>();
  const parsed = shares.map((s) => {
    if (!s.artistId) throw new ValidationError('Share without artist');
    if (seen.has(s.artistId)) throw new ValidationError(`Artist ${s.artistId} appears twice in one split`);
    seen.add(s.artistId);
    return { artistId: s.artistId, percent: parsePercent(s.percent) };
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

export function createSplitsService(db: SplitsDb) {
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
      shares: own.map((x) => ({ artistId: x.artistId, percent: x.percent })),
      ourShare: HUNDRED.sub(sum(own.map((x) => new Decimal(x.percent)))).toFixed(),
    };
  }

  function insert(input: {
    isrc: string;
    validFrom: IsoDate;
    validTo: IsoDate | null;
    shares: { artistId: string; percent: Decimal }[];
    documentId: string | null;
    origin: string;
    note?: string | null;
  }): string {
    const id = newId();
    repo.insertSplit({
      id,
      isrc: input.isrc,
      validFrom: input.validFrom,
      validTo: input.validTo,
      documentId: input.documentId,
      origin: input.origin,
      note: input.note ?? null,
      createdAt: nowIso(),
    });
    for (const s of input.shares)
      repo.insertShare({ splitId: id, artistId: s.artistId, percent: s.percent.toFixed() });
    return id;
  }

  const service = {
    /**
     * Creates a split for an ISRC. Without a confirming document the split is still calculated,
     * but the facade excludes it from totals (category C, "waiting for confirmation").
     */
    createSplit(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      shares: ShareInput[];
      documentId?: string | null;
      origin?: string;
      note?: string | null;
    }): SplitView {
      const isrc = assertIsrc(input.isrc);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      const shares = validateShares(input.shares);
      return repo.transaction(() => {
        for (const other of repo.splitsOfIsrc(isrc)) {
          if (overlaps(other, { validFrom, validTo })) {
            throw new ConflictError(
              `Split period overlaps an existing split of ${isrc} from ${other.validFrom}`,
              'split_overlap',
            );
          }
        }
        const id = insert({
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
    changeSplit(input: {
      isrc: string;
      from: string;
      shares: ShareInput[];
      documentId: string;
      origin?: string;
      note?: string | null;
    }): SplitView {
      if (!input.documentId)
        throw new RuleViolationError('A split change requires a confirming document', 'document_required');
      const isrc = assertIsrc(input.isrc);
      const from = assertDate(input.from);
      const shares = validateShares(input.shares);
      return repo.transaction(() => {
        const existing = repo.splitsOfIsrc(isrc);
        const current = existing.find((s) => covers(s, from));
        // The new split lasts until the end of the split it replaces, or until the next existing split.
        let validTo: string | null;
        if (current) {
          validTo = current.validTo;
          // History is kept: a split replaced from its first day stays as an empty period [from, from).
          repo.setValidTo(current.id, from);
        } else {
          validTo =
            existing
              .map((s) => s.validFrom)
              .filter((d) => d > from)
              .sort()[0] ?? null;
        }
        const id = insert({
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
    checkCreate(input: {
      isrc: string;
      validFrom: string;
      validTo?: string | null;
      percents: string[];
    }): void {
      const isrc = assertIsrc(input.isrc);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      validateShares(input.percents.map((percent, i) => ({ artistId: `check-${i}`, percent })));
      for (const other of repo.splitsOfIsrc(isrc)) {
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
    buyout(input: {
      isrcs: string[];
      sellerArtistId: string;
      effectiveFrom: string;
      documentId: string;
      /** Every id that stands for the seller (the facade adds artists merged into it); default: the seller only. */
      sellerArtistIds?: string[];
    }): SplitView[] {
      const sellerIds = new Set(input.sellerArtistIds ?? [input.sellerArtistId]);
      sellerIds.add(input.sellerArtistId);
      if (!input.documentId)
        throw new RuleViolationError('A buyout requires a buyout document', 'document_required');
      const from = assertDate(input.effectiveFrom);
      return repo.transaction(() =>
        input.isrcs.flatMap((raw) => {
          const isrc = assertIsrc(raw);
          const all = repo.splitsOfIsrc(isrc);
          const current = all.find((s) => covers(s, from));
          if (!current) throw new NotFoundError('Split in force for', `${isrc} at ${from}`);
          // The seller's share becomes 0 from the effective date on, also in splits that start later.
          const affected = [current, ...all.filter((s) => s.validFrom > from && s.validTo !== s.validFrom)];
          const changed: SplitView[] = [];
          for (const s of affected) {
            const shares = repo.sharesOf([s.id]);
            const seller = shares.filter((x) => sellerIds.has(x.artistId));
            if (s === current && seller.length === 0)
              throw new ValidationError(`Seller is not in the split of ${isrc}`);
            if (seller.every((x) => new Decimal(x.percent).isZero())) continue;
            const next = shares.map((x) => ({
              artistId: x.artistId,
              percent: sellerIds.has(x.artistId) ? '0' : x.percent,
            }));
            changed.push(
              service.changeSplit({
                isrc,
                from: s === current ? from : s.validFrom,
                shares: next,
                documentId: input.documentId,
                origin: 'buyout',
              }),
            );
          }
          return changed;
        }),
      );
    },

    /** Attaches the confirming appendix document to an existing split. */
    confirmSplit(splitId: string, documentId: string): SplitView {
      const s = repo.getSplit(splitId);
      if (!s) throw new NotFoundError('Split', splitId);
      if (s.documentId && s.documentId !== documentId) {
        throw new ConflictError(
          'The split is already confirmed by another document; a change is a new split',
          'split_document_set',
        );
      }
      repo.setDocument(splitId, documentId);
      return service.getSplit(splitId);
    },

    getSplit(id: string): SplitView {
      const s = repo.getSplit(id);
      if (!s) throw new NotFoundError('Split', id);
      return view(s, repo.sharesOf([id]));
    },

    listSplits(filter: { isrc?: string; artistId?: string } = {}): SplitView[] {
      let rows: SplitRow[];
      if (filter.isrc) rows = repo.splitsOfIsrc(assertIsrc(filter.isrc));
      else if (filter.artistId) {
        const ids = new Set(repo.splitIdsOfArtist(filter.artistId));
        rows = repo.allSplits().filter((s) => ids.has(s.id));
      } else rows = repo.allSplits();
      const shares = repo.sharesOf(rows.map((r) => r.id));
      return rows.map((r) => view(r, shares));
    },

    /** The split in force for an ISRC on a date (the report date). */
    splitAt(isrcRaw: string, date: string): SplitAtDate | undefined {
      return service.index().at(assertIsrc(isrcRaw), date);
    },

    /**
     * In-memory index of all splits, built once per facade calculation (one consistent read of the module).
     */
    index() {
      const byIsrc = new Map<string, SplitRow[]>();
      for (const s of repo.allSplits()) {
        const list = byIsrc.get(s.isrc) ?? [];
        list.push(s);
        byIsrc.set(s.isrc, list);
      }
      const sharesBySplit = new Map<string, { artistId: string; percent: Decimal }[]>();
      for (const sh of repo.allShares()) {
        const list = sharesBySplit.get(sh.splitId) ?? [];
        list.push({ artistId: sh.artistId, percent: new Decimal(sh.percent) });
        sharesBySplit.set(sh.splitId, list);
      }
      const cache = new Map<string, SplitAtDate | undefined>();
      return {
        isrcs: () => [...byIsrc.keys()],
        documentIds: () => [
          ...new Set(
            [...byIsrc.values()]
              .flat()
              .map((s) => s.documentId)
              .filter((d): d is string => !!d),
          ),
        ],
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
export type SplitsIndex = ReturnType<SplitsService['index']>;
