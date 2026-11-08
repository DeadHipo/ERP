import type { DocumentKind } from './document-kinds';

/**
 * The kinds of an operation (`settlements.operations.kind`, migration 0019, D-173). One list for the backend and the
 * frontend. Until D-173 the kind was derived from the fields (`meaningOf`: payout, advance = «recoupable payout»,
 * deduction, credit, return); the migration stores it, derived by the same rule, and adds the four kinds of the payroll
 * (buyout, forgiveness, writeoff, adjustment).
 */
export const OPERATION_KINDS = [
  'payout',
  'advance',
  'deduction',
  'credit',
  'return',
  'buyout',
  'forgiveness',
  'writeoff',
  'adjustment',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** The kinds the history has: what `kindOf` derives from the fields (D-047). */
export const DERIVED_KINDS = ['payout', 'advance', 'deduction', 'credit', 'return'] as const satisfies readonly OperationKind[];
export type DerivedKind = (typeof DERIVED_KINDS)[number];

/** The direction of each kind: `out` = money left us; `in` = a deduction (> 0) or an addition to the balance (< 0). */
export const KIND_DIRECTION = {
  payout: 'out',
  advance: 'out',
  buyout: 'out',
  deduction: 'in',
  credit: 'in',
  return: 'in',
  forgiveness: 'in',
  writeoff: 'in',
  adjustment: 'in',
} as const satisfies Record<OperationKind, 'in' | 'out'>;

/** The sign of the amount in cents: `+` positive, `-` negative, `±` any but zero (an adjustment, D-173 K5). */
export const KIND_SIGN = {
  payout: '+',
  advance: '+',
  buyout: '+',
  deduction: '+',
  forgiveness: '+',
  writeoff: '+',
  credit: '-',
  return: '-',
  adjustment: '±',
} as const satisfies Record<OperationKind, '+' | '-' | '±'>;

/**
 * The kinds of the basis document (`documentId`) each kind accepts; an empty list = no basis document (a payout is
 * confirmed by its payment proof, a return creates its own `return_proof`).
 */
export const KIND_DOCUMENT_KINDS = {
  payout: [],
  advance: ['advance_basis', 'contract'],
  deduction: ['adjustment_basis', 'contract', 'other'],
  credit: ['adjustment_basis', 'contract', 'other'],
  return: ['return_proof'],
  buyout: ['buyout'],
  forgiveness: ['adjustment_basis', 'contract', 'other', 'label_decision'],
  writeoff: ['adjustment_basis', 'other'],
  adjustment: ['adjustment_basis'],
} as const satisfies Record<OperationKind, readonly DocumentKind[]>;

/** The kinds with a recoup scope (`scope`, the area a position is recouped from): every other kind has none. */
export const KIND_WITH_SCOPE = ['advance', 'deduction'] as const satisfies readonly OperationKind[];

/** The kinds that block new payouts of the owner while unconfirmed (D-173 FIX-5): a buyout never blocks (README §5). */
export const BLOCKING_KINDS = ['payout', 'advance'] as const satisfies readonly OperationKind[];

/** The kinds an operation file may hold (D-173 §1.5): a return and a forgiveness have their own actions. */
export const IMPORTABLE_KINDS = ['payout', 'advance', 'deduction', 'credit', 'buyout', 'writeoff', 'adjustment'] as const satisfies readonly OperationKind[];

/** Who set the label of an operation (D-173 §1.2): NULL until `assign-operation-labels.ts --mark-source`. */
export const LABEL_SOURCES = ['one', 'default', 'operator', 'payout'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/**
 * The kind of an operation derived from its fields (`meaningOf` before D-173; the SQL function `settlements.kind_of` of
 * migration 0019 is the same rule): out with a recoup scope = advance, out = payout, in > 0 = deduction, in < 0 with a
 * referenced payout = return, else credit.
 */
export function kindOf(o: { direction: 'in' | 'out'; amountCents: number; scope?: unknown; operationRef?: string | null | undefined }): DerivedKind {
  if (o.direction === 'out') return o.scope ? 'advance' : 'payout';
  if (o.amountCents < 0) return o.operationRef ? 'return' : 'credit';
  return 'deduction';
}

export const isOperationKind = (k: string): k is OperationKind => (OPERATION_KINDS as readonly string[]).includes(k);

/** The external reference of the two rows of a transfer of a cut (D-199): `cut-transfer:<uuid>`. */
export const CUT_TRANSFER = 'cut-transfer:';
