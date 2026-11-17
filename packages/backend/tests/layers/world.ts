import { Decimal, ZERO } from '../../src/shared/money';
import type { FundedFrom, ParticipationAtDate, SplitAtDate } from '../../src/modules/splits';
import type { LabelOfRecord } from '../../src/modules/labels';
import {
  allocateUnit,
  type Allocation,
  type LayerContext,
  type MasterUnit,
  type NamedLayer,
  type UnitState,
} from '../../src/facade/layers';

// A pure, hand-built context for the layer tests (no stack). Synthetic data only.

export const I1 = 'QZTST2600001';
export const I2 = 'QZTST2600002';
export const UPC = '1234567890123';

/** Documents every world knows: approved, not approved, an assumption (never approved). */
const DOCS: Record<string, { status: 'approved' | 'not_approved' | 'not_attached'; kind: string }> = {
  ok: { status: 'approved', kind: 'appendix' },
  no: { status: 'not_approved', kind: 'appendix' },
  assume: { status: 'not_approved', kind: 'assumption' },
};

export interface SplitSpec {
  id?: string;
  from?: string;
  to?: string;
  doc?: string | null;
  /** [artist, percent, own document] */
  /** [artist, percent, row document?, 'mc'? (D-216: an MC row, does not bear pool carves)] */
  shares: [string, string, (string | null)?, 'mc'?][];
}

export interface PartSpec {
  id?: string;
  isrc?: string;
  artist: string;
  percent: string;
  base?: 'net' | 'bucket';
  funded: FundedFrom;
  from?: string;
  validFrom?: string;
  validTo?: string;
  doc?: string | null;
}

export interface LabelSpec {
  id: string;
  name: string;
  aliases: string[];
}

export interface World {
  splits?: Record<string, SplitSpec[]>;
  parts?: PartSpec[];
  /** artist -> owner (default: owner "o-<artist>", confirmed) */
  owners?: Record<string, string | null>;
  unconfirmed?: string[];
  /** merged artist id -> surviving id */
  merged?: Record<string, string>;
  labels?: LabelSpec[];
  /** pairs `isrc|upc` known in module 1; default: every ISRC of the splits and participations with UPC */
  pairs?: string[];
}

// D-232: the sublabel rule model removed (NoGhost and qaraqshy were sublabels with rules); their strings stay as
// aliases of the own labels, so the generated worlds keep mapping them.
export const DEFAULT_LABELS: LabelSpec[] = [
  { id: 'L0', name: '0to8', aliases: ['Test Label', '0to8', 'Ahh Music', 'NoGhost Records'] },
  { id: 'LE', name: 'Echo8', aliases: ['Echo8', 'qaraqshy records'] },
];

const covers = (from: string | undefined, to: string | undefined, date: string) =>
  (from ?? '2000-01-01') <= date && (to === undefined || date < to);
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function makeContext(w: World = {}): LayerContext {
  const labels = w.labels ?? DEFAULT_LABELS;
  const byAlias = new Map<string, LabelSpec>();
  for (const l of labels) for (const a of l.aliases) byAlias.set(norm(a), l);
  const ownerOf = (a: string) => (w.owners && a in w.owners ? (w.owners[a] ?? null) : `o-${a}`);
  const artistIndex = new Map<string, { id: string; pseudonym: string; ownerId: string | null }>();
  const ids = new Set<string>();
  for (const sp of Object.values(w.splits ?? {})) for (const s of sp) for (const [a] of s.shares) ids.add(a);
  for (const p of w.parts ?? []) ids.add(p.artist);
  for (const id of ids) {
    const live = w.merged?.[id] ?? id;
    artistIndex.set(id, { id: live, pseudonym: live, ownerId: ownerOf(live) });
  }
  const confirmedOwners = new Set(
    [...artistIndex.values()]
      .map((a) => a.ownerId)
      .filter((o): o is string => !!o && !(w.unconfirmed ?? []).includes(o)),
  );
  const isrcs = new Set([...Object.keys(w.splits ?? {}), ...(w.parts ?? []).map((p) => p.isrc ?? I1), I1]);
  const knownPairs = new Set(w.pairs ?? [...isrcs].map((i) => `${i}|${UPC}`));
  return {
    labelOf(s: string): LabelOfRecord | undefined {
      const l = byAlias.get(norm(s));
      return l ? { id: l.id, name: l.name } : undefined;
    },
    labelName: (id) => labels.find((l) => l.id === id)?.name,
    knownPairs,
    splitAt(isrc, date): SplitAtDate | undefined {
      const s = (w.splits?.[isrc] ?? []).find((x) => covers(x.from, x.to, date));
      if (!s) return undefined;
      const shares = s.shares.map(([artistId, p, doc, mc]) => ({
        artistId,
        percent: new Decimal(p),
        documentId: doc ?? null,
        ...(mc === 'mc' ? { isMc: true } : {}),
      }));
      return {
        splitId: s.id ?? `split-${isrc}-${s.from ?? 'start'}`,
        documentId: s.doc === undefined ? 'ok' : s.doc,
        shares,
        ourShare: new Decimal(100).sub(shares.reduce((a, x) => a.add(x.percent), ZERO)),
      };
    },
    participationsAt(isrc, date): ParticipationAtDate[] {
      return (w.parts ?? [])
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => (p.isrc ?? I1) === isrc && covers(p.validFrom, p.validTo, date))
        .map(({ p, i }) => ({
          id: p.id ?? `part-${i}-${p.artist}`,
          artistId: p.artist,
          percent: new Decimal(p.percent),
          base: p.base ?? (p.funded === 'artist_share' ? 'bucket' : 'net'),
          fundedFrom: p.funded,
          fromArtistId: p.from ?? null,
          documentId: p.doc === undefined ? 'ok' : p.doc,
        }));
    },
    artistIndex,
    documentStatus: (id) => (id ? (DOCS[id]?.status ?? 'missing') : 'missing'),
    documentKind: (id) => (id ? DOCS[id]?.kind : undefined),
    confirmedOwners,
  };
}

export function unit(net: string, o: Partial<Omit<MasterUnit, 'net'>> = {}): MasterUnit {
  return {
    account: '1052428',
    isrc: I1,
    upc: UPC,
    reportingMonth: '2026-03',
    salesMonth: '2026-03',
    labelName: 'Test Label',
    ...o,
    net: new Decimal(net),
  };
}

export interface Outcome {
  state: UnitState;
  states: { layer: string; state: UnitState }[];
  /** amount per recipient pseudonym (summed over its allocations) */
  amount: (artist: string) => string | undefined;
  reason: (artist: string) => string | null | undefined;
  B: string;
  C: string;
  ours: string;
}

const sumAmounts = (xs: Allocation[]) => xs.reduce((s, a) => s.add(a.amount), ZERO);

export function run(w: World, u: MasterUnit, layers?: readonly NamedLayer[]): Outcome {
  const { state, states } = allocateUnit(u, makeContext(w), layers);
  const of = (a: string) => state.rows.filter((r) => r.artistId === a);
  const ours = state.labelShareCategory === 'ours' ? state.labelShare : ZERO;
  const C = sumAmounts(state.rows.filter((r) => r.category === 'C')).add(
    state.labelShareCategory === 'ours' ? ZERO : state.labelShare,
  );
  return {
    state,
    states,
    amount: (a) => (of(a).length ? sumAmounts(of(a)).toFixed() : undefined),
    reason: (a) => of(a)[0]?.reason,
    B: sumAmounts(state.rows.filter((r) => r.category === 'B')).toFixed(),
    C: C.toFixed(),
    ours: ours.toFixed(),
  };
}

/** Σ allocations + label share = net, and every amount has at most 12 decimals, after every layer. */
export function exactAfterEveryLayer(o: Outcome, net: Decimal): string | null {
  for (const { layer, state } of o.states) {
    const total = sumAmounts(state.rows).add(state.labelShare);
    if (!total.eq(net)) return `${layer}: ${total.toFixed()} != ${net.toFixed()}`;
    for (const r of state.rows)
      if (r.amount.decimalPlaces() > 12) return `${layer}: ${r.amount.toFixed()} has more than 12 decimals`;
    if (state.labelShare.decimalPlaces() > 12) return `${layer}: label share has more than 12 decimals`;
  }
  return null;
}
