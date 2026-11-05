import { Decimal } from '../../src/shared/money';
import type { AdExpenseInput } from '../../src/modules/ads';
import { hasFile, readJson, type Ctx } from './lib';

// Step `ads` (D-156): the advertising history of 0to8 Main as ad records. The mapping is built read-only by
// scripts/mvp/extract-main-ads.py (data/mvp-load/ads/main_ads_mapping.json): one record per INCOME/EXPENSE row that
// carries ads, the whole amount on the row's pseudonym (Main already allocated it), an ISRC chosen from PROMO or the
// top net of the month, recovery 100 % or 0 % by the column "ОБНУЛИТЬ ADS расход", scope `any` (Main charged the
// statement total). Writes go through the facade; a repeated run skips the known external refs.

interface MappingRecord {
  source: 'income_expense' | 'echo8';
  row: number;
  nickname: string;
  nicknameStatus: string;
  artistId: string | null;
  month: string;
  spendMonth: string;
  gross: string;
  charged: string;
  recoveryPercent: number;
  isrc: string | null;
  method: string;
  confidence?: string;
  labelOfRecord: string | null;
  comment: string;
}

export async function stepAds(ctx: Ctx) {
  const { log } = ctx;
  log.h('Advertising history of 0to8 Main (D-156)');
  if (!hasFile('ads/main_ads_mapping.json')) {
    log.event('no_mapping', 'run scripts/mvp/extract-main-ads.py first');
    return;
  }
  const { records } = readJson<{ records: MappingRecord[] }>('ads/main_ads_mapping.json');
  const items: AdExpenseInput[] = [];
  const totals = new Map<string, Decimal>();
  const add = (k: string, v: string) => totals.set(k, (totals.get(k) ?? new Decimal(0)).add(v));
  const payerLabelId = ctx.labelsCache.get('0to8');
  if (!payerLabelId) throw new Error('the own label 0to8 must exist before the ads step (the payer of the history)');
  for (const r of records) {
    add('gross_all', r.gross);
    const artistId = r.artistId ? (ctx.canonArtist.get(r.artistId) ?? null) : null;
    if (!artistId) {
      // unmatched or ambiguous nicknames stay out until the operator resolves them (as in the Main step)
      log.event('skipped_no_pseudonym', `${r.source}:${r.row} ${r.nickname} (${r.nicknameStatus}) ${r.month} ${r.gross}`);
      add('gross_skipped', r.gross);
      continue;
    }
    if (!new Decimal(r.gross).gt(0)) {
      log.event('skipped_not_positive', `${r.source}:${r.row} ${r.gross}`);
      continue;
    }
    items.push({
      isrc: r.isrc,
      // a record without an ISRC needs the label it belongs to (D-168); the history was paid by 0to8 (the owner, 2026-11-05)
      ...(r.isrc ? {} : { labelId: payerLabelId }),
      month: r.month,
      amount: new Decimal(r.gross).toFixed(2),
      recoveryPercent: String(r.recoveryPercent),
      scope: 'any',
      artistId,
      externalRef: `mvp:main:ads:${r.source}:${r.row}`,
      source: 'mvp:main',
      migration: true,
      comment: `Main ${r.source} row ${r.row}, spend ${r.spendMonth}, ISRC method ${r.method}${r.confidence ? ` (${r.confidence})` : ''}`,
    });
    add('gross_loaded', r.gross);
    add(`gross_recovery_${r.recoveryPercent}`, r.gross);
    add(`gross_method_${r.method}`, r.gross);
    log.count(`method_${r.method}`);
    log.count(`recovery_${r.recoveryPercent}`);
  }
  log.count('records', records.length);
  log.count('to_load', items.length);
  for (const [k, v] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) log.bullet(`${k}: ${v.toFixed(2)}`);
  if (!ctx.apply) return;
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const r = await ctx.f.createAds(items.slice(i, i + 1000));
    created += r.created.length;
    skipped += r.skipped.length;
  }
  log.count('created', created);
  log.count('skipped_known_ref', skipped);
}
