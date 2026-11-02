import { Decimal } from '../../shared/money';
import { normalizeName } from '../../shared/identifiers';
import { parseSongwriters } from '../../modules/publishing';
import { SCALE } from './exact';
import type { CReason } from './types';

// The pure publishing layers (10 §4): writer parts → author share → categorise. Same style as the master layers:
// no storage access, the context is built by calculate() from one snapshot (or by hand in the tests).

/** One aggregated B17 line (period, holder, songwriters, work, operation type; payable summed). */
export interface PublishingLine {
  period: string;
  /** The report month of a quarterly statement: the last month of the quarter. */
  reportMonth: string;
  writerNorm: string;
  writerName: string;
  workTitle: string;
  songwriters: string | null;
  operationType: string | null;
  payable: Decimal;
}

export interface PublishingWriter {
  writerNorm: string;
  displayName: string;
  ownerId: string | null;
  resolution: string;
}

export interface PublishingTerm {
  id: string;
  ownerId: string;
  percent: string;
  validFrom: string;
  validTo: string | null;
  documentId: string | null;
  operationType: string | null;
}

/** One writer's part of a line, and what the layers worked out for it. */
export interface PublishingPart {
  writerNorm: string;
  writerName: string;
  /** The owner (merges resolved); null for an ambiguous writer or a holder without an owner. */
  ownerId: string | null;
  payable: Decimal;
  percent: Decimal;
  authorAmount: Decimal;
  labelAmount: Decimal;
  termsId: string | null;
  termsDocumentId: string | null;
  /** True when no contract terms exist and the default 50% is used (counts as waiting for confirmation). */
  defaultTerms: boolean;
  category: 'B' | 'C';
  reason: CReason | null;
}

export interface PublishingState {
  line: PublishingLine;
  parts: PublishingPart[];
}

export type DocumentStatusOf = (
  id: string | null | undefined,
) => 'approved' | 'not_approved' | 'not_attached' | 'missing';

export interface PublishingContext {
  writers: Map<string, PublishingWriter>;
  terms: PublishingTerm[];
  /** Follows merges to the surviving owner (memoised by the caller). */
  resolveOwner(id: string): string;
  /** Publishing is never accrued to a label (08, decision 7). */
  labelOwners: Set<string>;
  confirmedOwners: Set<string>;
  documentStatus: DocumentStatusOf;
}

export type PublishingLayer = (s: PublishingState, ctx: PublishingContext) => PublishingState;
export interface NamedPublishingLayer {
  name: string;
  run: PublishingLayer;
}

export const DEFAULT_AUTHOR_PERCENT = '50';

/**
 * Layer 1: the line belongs to our writers listed in "songwriters" (registered by us), in equal parts (D-087).
 * External co-writers are not ours. Without any of our writers the line goes to its rights-holder. An ambiguous
 * writer keeps a part with owner null (it stays unmapped, never goes to the others). Equal parts are cut at
 * 12 decimals (the exactness rule of 10 §3, ROUND_DOWN so no part exceeds its equal share, D-130); the last writer
 * takes the remainder so the parts add up to the line exactly.
 */
export const writerParts: PublishingLayer = (s, ctx) => {
  const r = s.line;
  const ours = new Map<string, { norm: string; name: string; owner: string | null }>();
  for (const name of parseSongwriters(r.songwriters)) {
    const w = ctx.writers.get(normalizeName(name));
    if (w?.ownerId) {
      const owner = ctx.resolveOwner(w.ownerId);
      if (!ours.has(owner)) ours.set(owner, { norm: w.writerNorm, name: w.displayName, owner });
    } else if (w?.resolution === 'ambiguous') {
      ours.set(`ambiguous:${w.writerNorm}`, { norm: w.writerNorm, name: w.displayName, owner: null });
    }
  }
  const make = (norm: string, name: string, ownerId: string | null, payable: Decimal): PublishingPart => ({
    writerNorm: norm,
    writerName: name,
    ownerId,
    payable,
    percent: new Decimal(DEFAULT_AUTHOR_PERCENT),
    authorAmount: new Decimal(0),
    labelAmount: new Decimal(0),
    termsId: null,
    termsDocumentId: null,
    defaultTerms: true,
    category: 'C',
    reason: null,
  });
  if (ours.size === 0) {
    const h = ctx.writers.get(r.writerNorm);
    return {
      ...s,
      parts: [make(r.writerNorm, r.writerName, h?.ownerId ? ctx.resolveOwner(h.ownerId) : null, r.payable)],
    };
  }
  const part = r.payable.div(ours.size).toDecimalPlaces(SCALE, Decimal.ROUND_DOWN);
  let left = r.payable;
  let i = 0;
  const parts: PublishingPart[] = [];
  for (const w of ours.values()) {
    const amount = ++i === ours.size ? left : part;
    left = left.sub(amount);
    parts.push(make(w.norm, w.name, w.owner, amount));
  }
  return { ...s, parts };
};
