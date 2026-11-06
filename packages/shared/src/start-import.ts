// The import of the opening balances (D-174, the cut of 15.10.2026): the columns of the template and the row classes of
// the preview. One list for the backend (`facade/start.ts`) and the frontend (the template, the chips). Plain data.

/**
 * The columns of the import file, in the order of the template; a header is matched without case and surrounding
 * spaces. `pseudonym` is an id or the exact name; `kind` is `start` (default) or `adjustment`; `master` and
 * `publishing` are the signed amounts in dollars (a dot or a comma, two decimals at most); `missing` (`1`, `yes`,
 * `true`) marks a start the cabinet gave no amount for (both amounts empty or 0: not a zero, the payout is closed);
 * `basis` is the basis of the row (else the `basis` of the request); `document` is an id or the exact title of a
 * document; `operation_ref` names an advance before the cut that stays alive after it (an adjustment that reopens it).
 */
export const START_IMPORT_COLUMNS = [
  { name: 'pseudonym', required: true },
  { name: 'kind', required: false },
  { name: 'master', required: false },
  { name: 'publishing', required: false },
  { name: 'missing', required: false },
  { name: 'basis', required: false },
  { name: 'document', required: false },
  { name: 'operation_ref', required: false },
  { name: 'comment', required: false },
] as const;
export type StartImportColumn = (typeof START_IMPORT_COLUMNS)[number]['name'];

export const START_IMPORT_MAX_ROWS = 5000;
export const START_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Every class a row of the preview can carry: an `error` blocks the apply, a `warning` and an `info` do not. */
export const START_IMPORT_ISSUES = {
  pseudonym_not_found: 'error',
  pseudonym_ambiguous: 'error',
  artist_without_owner: 'error',
  kind_unknown: 'error',
  amount_invalid: 'error',
  missing_invalid: 'error',
  missing_with_amount: 'error',
  amount_required: 'error',
  basis_required: 'error',
  document_not_found: 'error',
  document_ambiguous: 'error',
  operation_not_found: 'error',
  operation_not_advance: 'error',
  operation_other_owner: 'error',
  operation_after_cut: 'error',
  operation_forbidden: 'error',
  duplicate_in_file: 'error',
  start_exists: 'error',
  no_contract_for_label: 'warning',
  unchanged: 'info',
} as const satisfies Record<string, 'error' | 'warning' | 'info'>;
export type StartImportIssueCode = keyof typeof START_IMPORT_ISSUES;
export const START_IMPORT_ISSUE_CODES = Object.keys(START_IMPORT_ISSUES) as StartImportIssueCode[];

export const START_IMPORT_ACTIONS = ['create', 'unchanged', 'error'] as const;
export type StartImportAction = (typeof START_IMPORT_ACTIONS)[number];

export const OPENING_BALANCE_KINDS = ['start', 'adjustment'] as const;
export type OpeningBalanceKind = (typeof OPENING_BALANCE_KINDS)[number];
