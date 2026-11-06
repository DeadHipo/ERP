// The operation import (D-173 §1.5, P29): the columns of the template and the row classes of the preview. One list for
// the backend (`facade/operation-import.ts`) and the frontend (the template Blob, the chips). Plain data: no zod.

/**
 * The columns of the import file, in the order of the template; a header is matched without case and surrounding
 * spaces. `owner` and `pseudonym` are an id or the exact name (at least one of them); `amount` is the signed amount of
 * the operation as the API takes it (a credit is negative, an adjustment of either sign); `document` is an id or the
 * exact title (else the `documentId` of the request, for the kinds that take a basis document); `confirmation` is the
 * reference of the payment document (a `payment_proof` is created for it); `external_id` is the cash register's id of
 * the payment (required for a payout and a buyout); `scope` is the recoup area of an advance or a deduction (`any`,
 * `master`, `publishing`, `master_publishing` or `isrcs:<ISRC> <ISRC>…`).
 */
export const OPERATION_IMPORT_COLUMNS = [
  { name: 'owner', required: false },
  { name: 'pseudonym', required: false },
  { name: 'date', required: true },
  { name: 'amount', required: true },
  { name: 'kind', required: true },
  { name: 'channel', required: false },
  { name: 'confirmation', required: false },
  { name: 'document', required: false },
  { name: 'external_id', required: false },
  { name: 'scope', required: false },
  { name: 'comment', required: false },
] as const;
export type OperationImportColumn = (typeof OPERATION_IMPORT_COLUMNS)[number]['name'];

/** At most this many data rows (the stream stops at the next one: 413 `import_too_large`). */
export const OPERATION_IMPORT_MAX_ROWS = 5000;
/** At most this many bytes of the uploaded file. */
export const OPERATION_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Every class a row of the preview can carry, with its severity: an `error` blocks the apply, a `warning` and an `info`
 * do not. The codes equal the API's where `POST /settlements/operations` gives such a refusal (`kind_sign`,
 * `owner_required`, `artist_required`, `scope_required`, `scope_forbidden`, `document_required`, `document_kind`,
 * `document_owner_mismatch`, `artist_without_owner`, `writeoff_exceeds`).
 */
export const OPERATION_IMPORT_ISSUES = {
  owner_not_found: 'error',
  owner_ambiguous: 'error',
  pseudonym_not_found: 'error',
  pseudonym_ambiguous: 'error',
  pseudonym_other_owner: 'error',
  artist_without_owner: 'error',
  kind_unknown: 'error',
  kind_not_importable: 'error',
  amount_invalid: 'error',
  date_invalid: 'error',
  kind_sign: 'error',
  owner_required: 'error',
  artist_required: 'error',
  scope_invalid: 'error',
  scope_required: 'error',
  scope_forbidden: 'error',
  document_not_found: 'error',
  document_ambiguous: 'error',
  document_required: 'error',
  document_kind: 'error',
  document_owner_mismatch: 'error',
  confirmation_forbidden: 'error',
  channel_invalid: 'error',
  external_ref_required: 'error',
  duplicate_in_file: 'error',
  duplicate_external_ref: 'error',
  writeoff_exceeds: 'error',
  no_external_ref: 'warning',
  no_contract_for_label: 'warning',
  unchanged: 'info',
} as const satisfies Record<string, 'error' | 'warning' | 'info'>;
export type OperationImportIssueCode = keyof typeof OPERATION_IMPORT_ISSUES;
export const OPERATION_IMPORT_ISSUE_CODES = Object.keys(OPERATION_IMPORT_ISSUES) as OperationImportIssueCode[];

/** What the apply does with a row: create the operation, skip it (the same operation is already active), or nothing. */
export const OPERATION_IMPORT_ACTIONS = ['create', 'unchanged', 'error'] as const;
export type OperationImportAction = (typeof OPERATION_IMPORT_ACTIONS)[number];

/** The scope values of the `scope` column besides `isrcs:…`. */
export const OPERATION_IMPORT_SCOPES = ['any', 'master', 'publishing', 'master_publishing'] as const;
