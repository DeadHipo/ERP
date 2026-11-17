import { Decimal } from '../../shared/money';
import type { CReason } from './types';

// The pure publishing layers (10 §4): writer parts → author share → categorise. Same style as the master layers:
// no storage access, the context is built by calculate() from one snapshot (or by hand in the tests).

/** One accrual of a report summary (period, rights-holder = songwriter of v2, work, the ISRC-term slot; payable summed). */
export interface PublishingLine {
  period: string;
  /** The report month of a quarterly statement: the last month of the quarter. */
  reportMonth: string;
  writerNorm: string;
  writerName: string;
  workTitle: string;
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
 * Layer 1: the line belongs to its rights-holder (D-186; the equal parts of the B17 «songwriters» of D-087 left with the
 * old module, D-234): one part, the owner of the holder's writer (merges resolved) or none (it waits).
 */
export const writerParts: PublishingLayer = (s, ctx) => {
  const r = s.line;
  const h = ctx.writers.get(r.writerNorm);
  const part: PublishingPart = {
    writerNorm: r.writerNorm,
    writerName: r.writerName,
    ownerId: h?.ownerId ? ctx.resolveOwner(h.ownerId) : null,
    payable: r.payable,
    percent: new Decimal(DEFAULT_AUTHOR_PERCENT),
    authorAmount: new Decimal(0),
    labelAmount: new Decimal(0),
    termsId: null,
    termsDocumentId: null,
    defaultTerms: true,
    category: 'C',
    reason: null,
  };
  return { ...s, parts: [part] };
};
