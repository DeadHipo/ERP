import { ZERO, type Decimal } from '../../shared/money';
import type { ParticipationAtDate } from '../../modules/splits';
import { allocation, canonical, reportDate } from './allocation';
import { distribute, fits, pct, sumOf, usable } from './exact';
import type { Allocation, LayerContext, Shortfall, UnitState } from './types';

/**
 * Targets that do not fit their bucket are scaled down to it (quantised, residue to the largest target, a tie: the
 * first by artist id); each target's missing part is a shortfall. Returns the amounts actually taken.
 */
function fund(
  s: UnitState,
  ctx: LayerContext,
  parts: ParticipationAtDate[],
  targets: Decimal[],
  bucket: Decimal,
  shortfalls: Shortfall[],
): Decimal[] {
  const want = sumOf(targets);
  if (fits(want, bucket)) return targets;
  const amounts = distribute(
    usable(want, bucket),
    parts.map((p, i) => ({ key: canonical(ctx, p.artistId), weight: targets[i] as Decimal })),
  );
  parts.forEach((p, i) => {
    const missing = (targets[i] as Decimal).sub(amounts[i] as Decimal);
    if (!missing.isZero())
      shortfalls.push({
        isrc: s.unit.isrc,
        upc: s.unit.upc,
        month: s.unit.reportingMonth,
        ruleId: p.id,
        missing,
        why: 'bucket_short',
      });
  });
  return amounts;
}

const carveAllocations = (ctx: LayerContext, parts: ParticipationAtDate[], amounts: Decimal[]) =>
  parts.map((p, i) =>
    allocation(ctx, {
      artistId: p.artistId,
      layer: 'carve',
      kind: p.fundedFrom as Allocation['kind'],
      ruleId: p.id,
      documentId: p.documentId,
      percent: p.percent,
      amount: amounts[i] as Decimal,
    }),
  );

/**
 * Pool: targets `q(net × p / 100)`; their total is taken from the split rows pro rata to the rows' amounts at the
 * start of the kind (quantised, residue to the largest row). A pool smaller than the targets funds them scaled down.
 */
function pool(s: UnitState, ctx: LayerContext, parts: ParticipationAtDate[]): UnitState {
  if (parts.length === 0) return s;
  const shortfalls = [...s.shortfalls];
  const targets = parts.map((p) => pct(s.unit.net, p.percent));
  const rowIdx = s.rows.map((r, i) => (r.kind === 'row' ? i : -1)).filter((i) => i >= 0);
  const poolAmount = sumOf(rowIdx.map((i) => (s.rows[i] as Allocation).amount));
  const amounts = fund(s, ctx, parts, targets, poolAmount, shortfalls);
  const taken = sumOf(amounts);
  const shares = distribute(
    taken,
    rowIdx.map((i) => ({ key: (s.rows[i] as Allocation).artistId, weight: (s.rows[i] as Allocation).amount })),
  );
  const rows = [...s.rows];
  rowIdx.forEach((i, k) => {
    const r = rows[i] as Allocation;
    rows[i] = { ...r, amount: r.amount.sub(shares[k] as Decimal) };
  });
  return { ...s, rows: [...rows, ...carveAllocations(ctx, parts, amounts)], shortfalls };
}

/**
 * Artist share: `q(amount(from) × p / 100)` from that artist's row, the base being the row at the start of the kind;
 * several carves above the row are scaled down to it. A missing source row gives 0 and a shortfall.
 */
function artistShare(s: UnitState, ctx: LayerContext, parts: ParticipationAtDate[]): UnitState {
  if (parts.length === 0) return s;
  const shortfalls = [...s.shortfalls];
  const rows = [...s.rows];
  const added: Allocation[] = [];
  const groups = new Map<string, ParticipationAtDate[]>();
  for (const p of parts) {
    const from = canonical(ctx, p.fromArtistId ?? '');
    groups.set(from, [...(groups.get(from) ?? []), p]);
  }
  for (const [from, group] of groups) {
    const idx = rows.findIndex((r) => r.kind === 'row' && r.artistId === from);
    if (idx < 0) {
      for (const p of group)
        shortfalls.push({
          isrc: s.unit.isrc,
          upc: s.unit.upc,
          month: s.unit.reportingMonth,
          ruleId: p.id,
          missing: ZERO,
          why: 'no_source_row',
        });
      added.push(...carveAllocations(ctx, group, group.map(() => ZERO)));
      continue;
    }
    const row = rows[idx] as Allocation;
    const targets = group.map((p) => pct(row.amount, p.percent));
    const amounts = fund(s, ctx, group, targets, row.amount, shortfalls);
    rows[idx] = { ...row, amount: row.amount.sub(sumOf(amounts)) };
    added.push(...carveAllocations(ctx, group, amounts));
  }
  return { ...s, rows: [...rows, ...added], shortfalls };
}

/**
 * Label share: one base for the kind (the label share at its start); each carve is `q(net × p / 100)` (base net) or
 * `q(labelShare × p / 100)` (base bucket); all are taken together, scaled down if above the label share.
 */
function labelShare(s: UnitState, ctx: LayerContext, parts: ParticipationAtDate[]): UnitState {
  if (parts.length === 0) return s;
  const shortfalls = [...s.shortfalls];
  const base = s.labelShare;
  const targets = parts.map((p) => pct(p.base === 'net' ? s.unit.net : base, p.percent));
  const amounts = fund(s, ctx, parts, targets, base, shortfalls);
  return {
    ...s,
    rows: [...s.rows, ...carveAllocations(ctx, parts, amounts)],
    labelShare: base.sub(sumOf(amounts)),
    shortfalls,
  };
}

/** Sublabel: `q(labelShare × rule.percent / 100)` of what remains, to the rule's recipient (not for an unmapped string). */
function sublabel(s: UnitState, ctx: LayerContext): UnitState {
  const rule = s.rule;
  if (!rule || rule.percent.isZero() || s.labelShareCategory !== 'ours') return s;
  const a = allocation(ctx, {
    artistId: rule.recipientArtistId,
    layer: 'sublabel',
    kind: 'sublabel',
    ruleId: rule.id,
    documentId: rule.documentId,
    percent: rule.percent,
    amount: pct(s.labelShare, rule.percent),
  });
  return { ...s, rows: [...s.rows, a], labelShare: s.labelShare.sub(a.amount) };
}

/**
 * Layer 5: the carves, four kinds in a fixed order (pool, artist share, label share, sublabel), one shared base per
 * kind, so the order of the participations inside a kind never changes an amount. Every amount is quantised right
 * after its multiplication and every remainder is obtained by subtraction (10 §3 "Exactness").
 */
export function carve(s: UnitState, ctx: LayerContext): UnitState {
  const parts = ctx
    .participationsAt(s.unit.isrc, reportDate(s.unit))
    .filter((p) => !p.percent.isZero());
  const of = (k: ParticipationAtDate['fundedFrom']) => parts.filter((p) => p.fundedFrom === k);
  let out = pool(s, ctx, of('artist_pool'));
  out = artistShare(out, ctx, of('artist_share'));
  out = labelShare(out, ctx, of('label_share'));
  return sublabel(out, ctx);
}
