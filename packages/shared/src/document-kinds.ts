/**
 * The kinds of a document (module 1, `owners.documents.kind`; the CHECK of migrations 0007 and 0018) and the kinds
 * each use accepts. One list for the backend and the frontend (D-172).
 *
 * `assumption` is a council decision that is never approved (its money waits in C `assumption`); `label_decision` is a
 * decision of the label without a contract: approved, it confirms an owner exactly like a contract and a split row or
 * participation exactly like an appendix (D-172).
 */
export const DOCUMENT_KINDS = [
  'contract',
  'appendix',
  'buyout',
  'advance_basis',
  'adjustment_basis',
  'payment_proof',
  'return_proof',
  'other',
  'assumption',
  'label_decision',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The kinds a contract may reference (`owners.createContract`): it confirms the owner and the listed pseudonyms. */
export const CONTRACT_DOCUMENT_KINDS = ['contract', 'label_decision'] as const satisfies readonly DocumentKind[];

/** The kinds that can confirm a split (its own document or a row's) or a participation (`facade/context.ts`). */
export const SPLIT_DOCUMENT_KINDS = [
  'appendix',
  'contract',
  'buyout',
  'other',
  'assumption',
  'label_decision',
] as const satisfies readonly DocumentKind[];

export const isDocumentKind = (k: string): k is DocumentKind => (DOCUMENT_KINDS as readonly string[]).includes(k);
