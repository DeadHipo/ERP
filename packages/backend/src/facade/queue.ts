import { Decimal, ZERO } from '../shared/money';
import type { Calculation, CReason, MasterAllocation, PublishingResult, UnitResult } from './calculation';
import { pubInPeriod, unitInPeriod, type PeriodFilter } from './period';

/**
 * The category-C queue (17 N3, 16 §2.6): every dollar that waits, as items, then grouped by what the operator fixes.
 * `cItems` is the ONE place that decides what counts as C; `reconcile()` sums the same items, so the queue and the
 * reconciliation cannot drift (D-141).
 */
export interface CItem {
  source: 'believe' | 'b17';
  account: string;
  month: string;
  reason: CReason;
  amount: Decimal;
  unit?: UnitResult;
  allocation?: MasterAllocation;
  pub?: PublishingResult;
}

export function* cItems(calc: Calculation, f: PeriodFilter = {}): Generator<CItem> {
  const sales = (f.basis ?? 'report') === 'sales';
  for (const u of calc.units) {
    if (!unitInPeriod(u, f)) continue;
    const month = sales ? u.salesMonth : u.reportingMonth;
    for (const a of u.allocations)
      if (a.category !== 'B')
        yield {
          source: 'believe',
          account: u.account,
          month,
          reason: a.reason as CReason,
          amount: a.amount,
          unit: u,
          allocation: a,
        };
    if (u.labelShareCategory !== 'ours')
      yield {
        source: 'believe',
        account: u.account,
        month,
        reason: u.labelShareCategory,
        amount: u.labelShare,
        unit: u,
      };
  }
  for (const p of calc.publishing) {
    if (!pubInPeriod(p, f)) continue;
    if (!p.ownerId)
      yield {
        source: 'b17',
        account: 'b17',
        month: p.reportMonth,
        reason: 'writer_unmapped',
        amount: p.payable,
        pub: p,
      };
    else if (p.category !== 'B')
      yield {
        source: 'b17',
        account: 'b17',
        month: p.reportMonth,
        reason: p.reason as CReason,
        amount: p.authorAmount,
        pub: p,
      };
  }
}

export type QueueKeyKind =
  | 'owner'
  | 'split'
  | 'participation'
  | 'labelRule'
  | 'artist'
  | 'labelString'
  | 'pair'
  | 'writer'
  | 'ownerTerms';

export interface QueueGroup {
  key: { kind: QueueKeyKind; id: string; label: string };
  ownerId: string | null;
  ownerName: string | null;
  artistId: string | null;
  pseudonym: string | null;
  documentId: string | null;
  documentStatus: 'approved' | 'not_approved' | 'not_attached' | 'missing' | null;
  /** The rule behind the group (split, participation or label rule id), when it is one. */
  ruleId: string | null;
  amount: Decimal;
  isrcCount: number;
  months: { from: string; to: string };
  /** Top 20 by |amount|. */
  isrcs: { isrc: string; amount: Decimal }[];
  assumptionBasis: 'document' | 'q11' | 'r1' | null;
}

export interface QueueLabels {
  /** owner id -> display name */
  ownerNames: Map<string, string>;
}

export interface QueueOptions {
  reason?: CReason;
  account?: string;
  month?: string;
  ownerId?: string;
  q?: string;
}

export interface QueueSummaryRow {
  reason: CReason;
  amount: Decimal;
  groups: number;
  isrcs: number;
}

const NO_ISRC = '(без ISRC)';

interface Acc {
  group: QueueGroup;
  byIsrc: Map<string, Decimal>;
  artistIds: Set<string>;
  ownerIds: Set<string | null>;
  docIds: Set<string | null>;
}

function ruleKind(a: MasterAllocation): QueueKeyKind {
  return a.layer === 'split' ? 'split' : a.layer === 'sublabel' ? 'labelRule' : 'participation';
}

function keyOf(
  it: CItem,
  calc: Calculation,
  labels: QueueLabels,
): { kind: QueueKeyKind; id: string; label: string } {
  const a = it.allocation;
  const u = it.unit;
  const p = it.pub;
  const pseud = (id: string) => calc.artistIndex.get(id)?.pseudonym ?? '?';
  const ownerKey = (id: string | null | undefined) => ({
    kind: 'owner' as const,
    id: id ?? '',
    label: id ? (labels.ownerNames.get(id) ?? id) : '(без владельца)',
  });
  switch (it.reason) {
    case 'owner_unconfirmed':
      return ownerKey(a?.ownerId ?? p?.ownerId);
    case 'artist_without_owner':
      return a ? { kind: 'artist', id: a.artistId, label: pseud(a.artistId) } : ownerKey(null);
    case 'label_unmapped':
      return { kind: 'labelString', id: u?.labelName ?? '', label: u?.labelName ?? '' };
    case 'unknown_pair':
    case 'no_isrc':
    case 'no_split':
      return {
        kind: 'pair',
        id: `${u?.isrc ?? ''}|${u?.upc ?? ''}`,
        label: `${u?.isrc || NO_ISRC} / ${u?.upc ?? ''}`,
      };
    case 'writer_unmapped':
      return { kind: 'writer', id: p?.writerName ?? '', label: p?.writerName ?? '' };
    case 'publishing_terms_unconfirmed':
      return {
        kind: 'ownerTerms',
        id: p?.ownerId ?? '',
        label: p?.ownerId ? (labels.ownerNames.get(p.ownerId) ?? p.ownerId) : '(без владельца)',
      };
    default: {
      // split_unconfirmed, rule_unconfirmed, assumption: the rule that is not confirmed
      if (!a) return ownerKey(p?.ownerId);
      const kind = ruleKind(a);
      const isrc = u?.isrc ?? '';
      const label =
        kind === 'split'
          ? isrc
          : kind === 'labelRule'
            ? `${u?.labelName ?? ''} → ${pseud(a.artistId)}`
            : `${pseud(a.artistId)} · ${isrc}`;
      return { kind, id: a.ruleId, label };
    }
  }
}

function matches(it: CItem, o: QueueOptions) {
  if (o.account !== undefined && it.account !== o.account) return false;
  if (o.month !== undefined && it.month !== o.month) return false;
  if (o.ownerId !== undefined) {
    const owner = it.allocation?.ownerId ?? it.pub?.ownerId ?? null;
    if (owner !== o.ownerId) return false;
  }
  return true;
}

const byAbs = (a: Decimal, b: Decimal) => b.abs().cmp(a.abs());

/**
 * Groups the C items by reason and key. The summary covers every reason with money (after the account / month / owner
 * filters); `groups` are those of `opts.reason` (after `q` too), largest |amount| first.
 */
export function cQueue(
  calc: Calculation,
  f: PeriodFilter,
  opts: QueueOptions,
  labels: QueueLabels,
): { summary: QueueSummaryRow[]; groups: QueueGroup[] } {
  const byReason = new Map<CReason, Map<string, Acc>>();
  for (const it of cItems(calc, f)) {
    if (it.amount.isZero() || !matches(it, opts)) continue;
    const key = keyOf(it, calc, labels);
    let groups = byReason.get(it.reason);
    if (!groups) byReason.set(it.reason, (groups = new Map()));
    const k = `${key.kind}:${key.id}`;
    let acc = groups.get(k);
    if (!acc) {
      acc = {
        group: {
          key,
          ownerId: null,
          ownerName: null,
          artistId: null,
          pseudonym: null,
          documentId: null,
          documentStatus: null,
          ruleId: null,
          amount: ZERO,
          isrcCount: 0,
          months: { from: it.month, to: it.month },
          isrcs: [],
          assumptionBasis: null,
        },
        byIsrc: new Map(),
        artistIds: new Set(),
        ownerIds: new Set(),
        docIds: new Set(),
      };
      groups.set(k, acc);
    }
    const g = acc.group;
    g.amount = g.amount.add(it.amount);
    if (it.month < g.months.from) g.months.from = it.month;
    if (it.month > g.months.to) g.months.to = it.month;
    const isrc = it.unit?.isrc;
    if (isrc) acc.byIsrc.set(isrc, (acc.byIsrc.get(isrc) ?? ZERO).add(it.amount));
    const a = it.allocation;
    if (a) {
      acc.artistIds.add(a.artistId);
      acc.ownerIds.add(a.ownerId);
      acc.docIds.add(a.documentId);
      if (a.reason === 'assumption' && !g.assumptionBasis) g.assumptionBasis = a.assumption;
    } else if (it.pub) {
      acc.ownerIds.add(it.pub.ownerId);
    }
  }

  const finish = (acc: Acc): QueueGroup => {
    const g = acc.group;
    const only = <T>(s: Set<T>): T | null => (s.size === 1 ? ([...s][0] as T) : null);
    g.artistId = only(acc.artistIds);
    g.pseudonym = g.artistId ? (calc.artistIndex.get(g.artistId)?.pseudonym ?? null) : null;
    g.ownerId = only(acc.ownerIds);
    g.ownerName = g.ownerId ? (labels.ownerNames.get(g.ownerId) ?? null) : null;
    g.documentId = only(acc.docIds);
    g.documentStatus = acc.docIds.size > 0 ? calc.documentStatus(g.documentId) : null;
    if (g.key.kind === 'split' || g.key.kind === 'participation' || g.key.kind === 'labelRule')
      g.ruleId = g.key.id;
    g.isrcCount = acc.byIsrc.size;
    g.isrcs = [...acc.byIsrc.entries()]
      .map(([isrc, amount]) => ({ isrc, amount }))
      .sort((x, y) => byAbs(x.amount, y.amount) || x.isrc.localeCompare(y.isrc))
      .slice(0, 20);
    return g;
  };

  const sortGroups = (gs: QueueGroup[]) =>
    gs.sort((a, b) => byAbs(a.amount, b.amount) || a.key.label.localeCompare(b.key.label));

  const summary: QueueSummaryRow[] = [];
  const finished = new Map<CReason, QueueGroup[]>();
  for (const [reason, groups] of byReason) {
    const gs = sortGroups([...groups.values()].map(finish));
    finished.set(reason, gs);
    const isrcs = new Set<string>();
    for (const acc of groups.values()) for (const i of acc.byIsrc.keys()) isrcs.add(i);
    summary.push({
      reason,
      amount: gs.reduce((s, g) => s.add(g.amount), ZERO),
      groups: gs.length,
      isrcs: isrcs.size,
    });
  }
  summary.sort((a, b) => byAbs(a.amount, b.amount) || a.reason.localeCompare(b.reason));

  let groups = opts.reason ? (finished.get(opts.reason) ?? []) : [];
  const q = opts.q?.trim().toLowerCase();
  if (q)
    groups = groups.filter((g) =>
      [g.key.label, g.ownerName, g.pseudonym, ...g.isrcs.map((i) => i.isrc)].some((s) =>
        s?.toLowerCase().includes(q),
      ),
    );
  return { summary, groups };
}
