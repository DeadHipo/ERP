import { NotFoundError, ValidationError } from '../shared/errors';
import type { AdExpense, AdExpenseInput, AdScope } from '../modules/ads';
import { calculate } from './calculation';
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
  limit?: number;
  offset?: number;
}

/** A record with what the calculation decides for it (null for a deactivated record). */
export type AdView = AdExpense & {
  allocation: (Omit<AdResult, 'parts' | 'adId'> & { parts: (AdResult['parts'][number] & { pseudonym: string })[] }) | null;
};

/** Advertising expenses (D-155, D-156): records in the ads module, allocation recalculated from scratch. */
export function adsApi(ctx: FacadeContext) {
  const { ads, owners, modules } = ctx;

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
      return ads.createMany(items);
    },

    async updateAd(id: string, patch: { recoveryPercent?: string; scope?: AdScope }) {
      return ads.update(id, patch);
    },

    async deactivateAd(id: string, reason: string) {
      return ads.deactivate(id, reason);
    },

    /** Records with their allocation, newest month first; filters on the record and on the allocation. */
    async listAds(q: AdsQuery = {}) {
      if (q.ownerId) await owners.getOwner(await owners.resolveOwnerId(q.ownerId));
      const [records, calc] = await Promise.all([
        ads.list({
          ...(q.isrc ? { isrc: q.isrc } : {}),
          ...(q.from ? { from: q.from } : {}),
          ...(q.to ? { to: q.to } : {}),
          ...(q.includeInactive ? {} : { active: true }),
        }),
        timed('calculate', () => calculate(modules)),
      ]);
      const byId = new Map(calc.ads.map((r) => [r.adId, r]));
      const ownerId = q.ownerId ? await owners.resolveOwnerId(q.ownerId) : undefined;
      const artistId = q.artistId ? (calc.artistIndex.get(q.artistId)?.id ?? q.artistId) : undefined;
      const pseudonym = (id: string) => calc.artistIndex.get(id)?.pseudonym ?? id;
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
        let allocation: AdView['allocation'] = null;
        if (r) {
          const { parts, ...rest } = r;
          allocation = { ...rest, parts: parts.map((p) => ({ ...p, pseudonym: pseudonym(p.artistId) })) };
        }
        views.push({ ...rec, allocation });
      }
      const offset = Math.max(q.offset ?? 0, 0);
      const limit = Math.min(Math.max(q.limit ?? 200, 1), 5000);
      return { count: views.length, items: views.slice(offset, offset + limit) };
    },

    /** Per month and label of record: the expense, what artists return, what sublabels and we bear (YYYY-MM). */
    async adsSummary(f: { from?: string; to?: string } = {}) {
      for (const m of [f.from, f.to])
        if (m && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ValidationError(`Invalid month "${m}"`);
      const calc = await calculate(modules);
      return { rows: adSummary(calc.ads, f.from, f.to) };
    },
  };
}
