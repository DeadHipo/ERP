// The split import (D-172, P28): the columns of the template and the row classes of the preview. One list for the
// backend (`facade/split-import.ts`) and the frontend (the template Blob, the chips). Plain data: no zod.

/**
 * The columns of the import file, in the order of the template; a header is matched without case and surrounding
 * spaces. `document_number` is accepted as a synonym of `document` (a document has no number: an id or the exact title).
 */
export const SPLIT_IMPORT_COLUMNS = [
  { name: 'isrc', required: true },
  { name: 'pseudonym', required: true },
  { name: 'percent', required: true },
  { name: 'from', required: true },
  { name: 'to', required: false },
  { name: 'owner', required: false },
  { name: 'document', required: false },
  { name: 'artist_id', required: false },
  { name: 'note', required: false },
] as const;
export type SplitImportColumn = (typeof SPLIT_IMPORT_COLUMNS)[number]['name'];

/** Header synonyms: the alias → the column. */
export const SPLIT_IMPORT_SYNONYMS: Readonly<Record<string, SplitImportColumn>> = { document_number: 'document' };

/** At most this many data rows (the stream stops at the next one: 413 `import_too_large`). */
export const SPLIT_IMPORT_MAX_ROWS = 5000;
/** At most this many bytes of the uploaded file. */
export const SPLIT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportSeverity = 'error' | 'warning' | 'info';

/**
 * Every class a row of the preview can carry, with its severity: an `error` blocks the apply, a `warning` and an
 * `info` do not. The codes equal the API's where the API gives such a refusal (`split_sum_above_100`, `split_overlap`,
 * `double_participation`, `empty_period`, `document_required`, `label_forbidden`, `forbidden`).
 */
export const SPLIT_IMPORT_ISSUES = {
  isrc_invalid: 'error',
  percent_invalid: 'error',
  date_invalid: 'error',
  row_incomplete: 'error',
  date_floored: 'info',
  empty_period: 'error',
  to_on_change: 'error',
  split_sum_above_100: 'error',
  our_share: 'info',
  duplicate_artist: 'error',
  split_overlap: 'error',
  double_participation: 'error',
  replaces: 'warning',
  unchanged: 'info',
  document_required: 'error',
  document_not_found: 'error',
  document_ambiguous: 'error',
  document_kind: 'error',
  document_other_label: 'error',
  existing: 'info',
  new_pseudonym: 'warning',
  pseudonym_ambiguous: 'error',
  artist_not_found: 'error',
  owner_new: 'warning',
  owner_found: 'info',
  owner_ambiguous: 'error',
  owner_mismatch: 'error',
  owner_assign: 'warning',
  isrc_outside_label: 'warning',
  label_forbidden: 'error',
  forbidden: 'error',
} as const satisfies Record<string, ImportSeverity>;
export type SplitImportIssueCode = keyof typeof SPLIT_IMPORT_ISSUES;
export const SPLIT_IMPORT_ISSUE_CODES = Object.keys(SPLIT_IMPORT_ISSUES) as SplitImportIssueCode[];

/** What the apply does with a group (one group = one split: the rows of one ISRC and one floored `from`). */
export const SPLIT_IMPORT_ACTIONS = ['create', 'change', 'unchanged', 'blocked'] as const;
export type SplitImportAction = (typeof SPLIT_IMPORT_ACTIONS)[number];
