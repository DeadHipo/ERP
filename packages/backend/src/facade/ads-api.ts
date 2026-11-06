import { NotFoundError, ValidationError } from '../shared/errors';
import type { AdExpense, AdExpenseInput, AdScope } from '../modules/ads';
import { ZERO } from '../shared/money';
import { calculate, type Calculation } from './calculation';
import { scoped } from './scope';

/** The distinct ISRCs of advertising records (a record on a pseudonym alone has none and needs no unit). */
const isrcsOf = (records: readonly { isrc: string | null }[]) =>
  [...new Set(records.map((r) => r.isrc).filter((x): x is string => x !== null))].sort();
import { adSummary, type AdResult, type AdStatus } from './ads';
import type { FacadeContext } from './context';
import { timed } from '../shared/timing';

export interface AdsQuery {
  isrc?: string;
  artistId?: string;
  ownerId?: string;
  /** YYYY-MM, inclusive. */
  from?: string;
  to?: string;
  status?: AdStatus;
  /** Also the deactivated records (they take part in nothing). */
  includeInactive?: boolean;
  /** Records paid by this own label (D-169, R9: the record's label); filtered before the calculation. */
  labelId?: string;
  limit?: number;
  offset?: number;
}

/** A record with what the calculation decides for it (null for a deactivated record). */
export type AdView = AdExpense & {
  allocation: (Omit<AdResult, 'parts' | 'adId'> & { parts: (AdResult['parts'][number] & { pseudonym: string })[] }) | null;
};

function viewOf(rec: AdExpense, r: AdResult | undefined, artistIndex: Calculation['artistIndex']): AdView {
  if (!r) return { ...rec, allocation: null };
  const { parts, ...rest } = r;
  return {
    ...rec,
    allocation: {
      ...rest,
      parts: parts.map((p) => ({ ...p, pseudonym: artistIndex.get(p.artistId)?.pseudonym ?? p.artistId })),
    },
  };
}

/** Advertising expenses (D-155, D-156): records in the ads module, allocation recalculated from scratch. */
export function adsApi(ctx: FacadeContext) {
  const { ads, owners, modules, assertOwnLabel } = ctx;

  async function checkArtists(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0) return;
    const idx = await owners.artistIndex();
    const missing = unique.filter((id) => !idx.has(id));
    if (missing.length > 0) throw new NotFoundError('Artist', missing[0] as string);
  }

  return {
    /** A batch of expenses: every arrival of data is a new record; a known external ref is skipped. */
    async createAds(items: AdExpenseInput[]) {
      await checkArtists(items.map((i) => i.artistId));
      for (const id of new Set(items.map((i) => i.labelId).filter((x): x is string => !!x))) await assertOwnLabel(id);
      return ads.createMany(items);
    },

    /** The recovery percent, the scope (D-155) and the payer (D-169: an own label). */
    async updateAd(id: string, patch: { recoveryPercent?: string; scope?: AdScope; labelId?: string }) {
      if (patch.labelId !== undefined) await assertOwnLabel(patch.labelId);
      return ads.update(id, patch);
    },

    async deactivateAd(id: string, reason: string) {
      return ads.deactivate(id, reason);
    },

    /** Records with their allocation, newest month first; filters on the record and on the allocation. */
    async listAds(q: AdsQuery = {}) {
      if (q.ownerId) await owners.getOwner(await owners.resolveOwnerId(q.ownerId));
      if (q.labelId) await assertOwnLabel(q.labelId);
      const records = await ads.list({
        ...(q.isrc ? { isrc: q.isrc } : {}),
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.labelId ? { labelId: q.labelId } : {}),
      });
      // only the allocations of the listed records are read: the units of their ISRCs suffice (D-161)
      const calc = await timed('calculate', () => calculate(scoped(modules, { isrcs: isrcsOf(records), publishingLines: false })));
      const byId = new Map(calc.ads.map((r) => [r.adId, r]));
      const ownerId = q.ownerId ? await owners.resolveOwnerId(q.ownerId) : undefined;
      const artistId = q.artistId ? (calc.artistIndex.get(q.artistId)?.id ?? q.artistId) : undefined;
      const views: AdView[] = [];
      for (const rec of records) {
        const r = byId.get(rec.id);
        if (q.status && r?.status !== q.status) continue;
        if (artistId) {
          const hit =
            (rec.artistId && (calc.artistIndex.get(rec.artistId)?.id ?? rec.artistId) === artistId) ||
            r?.parts.some((p) => p.artistId === artistId) ||
            (r?.borneBy.kind === 'sublabel' && r.borneBy.artistId === artistId);
          if (!hit) continue;
        }
        if (ownerId) {
          const hit =
            r?.parts.some((p) => p.ownerId === ownerId) ||
            (r?.borneBy.kind === 'sublabel' && r.borneBy.ownerId === ownerId);
          if (!hit) continue;
        }
        views.push(viewOf(rec, r, calc.artistIndex));
      }
      const offset = Math.max(q.offset ?? 0, 0);
      const limit = Math.min(Math.max(q.limit ?? 200, 1), 5000);
      return { count: views.length, items: views.slice(offset, offset + limit) };
    },

    /** One record with its allocation (null when it is deactivated). */
    async getAd(id: string): Promise<AdView> {
      const rec = await ads.get(id);
      const calc = await timed('calculate', () => calculate(scoped(modules, { isrcs: isrcsOf([rec]), publishingLines: false })));
      return viewOf(rec, calc.ads.find((r) => r.adId === id), calc.artistIndex);
    },

    /** Per month and payer: the expense, what artists return, what sublabels and we bear (YYYY-MM). */
    async adsSummary(f: { from?: string; to?: string; labelId?: string } = {}) {
      for (const m of [f.from, f.to])
        if (m && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ValidationError(`Invalid month "${m}"`);
      if (f.labelId) await assertOwnLabel(f.labelId);
      // the active records (under a label: those it pays, D-169) take part: the units of their ISRCs (all months: the
      // label string of an earlier month may decide the sublabel rule)
      const records = await ads.list({ active: true, ...(f.labelId ? { labelId: f.labelId } : {}) });
      const calc = await calculate(scoped(modules, { isrcs: isrcsOf(records), publishingLines: false }));
      const ids = new Set(records.map((r) => r.id));
      const rows = adSummary(calc.ads.filter((r) => ids.has(r.adId)), f.from, f.to);
      const total = (k: 'amount' | 'recoveredFromArtists' | 'borneBySublabels' | 'borneByUs' | 'noSplit') =>
        rows.reduce((s, r) => s.add(r[k]), ZERO);
      return {
        rows,
        totals: {
          count: rows.reduce((n, r) => n + r.count, 0),
          amount: total('amount'),
          recoveredFromArtists: total('recoveredFromArtists'),
          borneBySublabels: total('borneBySublabels'),
          borneByUs: total('borneByUs'),
          noSplit: total('noSplit'),
        },
      };
    },
  };
}
