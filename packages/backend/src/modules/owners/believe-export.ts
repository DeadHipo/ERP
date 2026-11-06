import type { Readable } from 'node:stream';
import { parseCsv } from '../../shared/csv';
import { AppError, RuleViolationError, ValidationError } from '../../shared/errors';
import { RELEASE_IMPORT_MAX_ROWS } from '@erp/shared/release-import';

// The release export of Believe (D-172, plan «этап4_онбординг.md» §1.5): a csv with a BOM, `;` separators and quoted
// cells; the UPC cell is `UPC : <digits>`, the date cell `YYYY-MM-DD<br />HH:MM:SS`. A pure reader: no storage, the
// facade writes the rows into the release registry of one label. Navigation, not money.

/** The columns of the export, by their exact header names (the order of the file does not matter). */
export const RELEASE_EXPORT_COLUMNS = [
  'Release Title',
  'Version',
  'Artist',
  'Label',
  'Release date / Hour / Time zone',
  '# of track',
  'UPC',
  'Cat. #',
  '# of territories',
  '# of stores',
] as const;

/** The codes of a refused row (`422 release_import_invalid`, `details.rows`). */
export type ReleaseRowCode = 'upc_invalid' | 'track_count_invalid' | 'date_invalid' | 'duplicate_upc';

/** One release of the export, as the registry stores it (without the label, the file hash and the import time). */
export interface ExportRelease {
  /** The line of the file (the header is line 1). */
  line: number;
  upc: string;
  title: string;
  version: string | null;
  artistString: string | null;
  labelString: string | null;
  releaseDate: string | null;
  trackCount: number;
  catalogNumber: string | null;
  territories: number | null;
  stores: number | null;
}

/** At most this many refused rows are listed in `details.rows` (the total is `details.errors`). */
const MAX_LISTED = 200;

const UPC_RE = /^[0-9]{8,14}$/;
const INT_RE = /^[0-9]{1,9}$/;

const text = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** `UPC : 3617…` (or the bare digits) → the digits; anything else is null. */
export function exportUpc(cell: string | undefined): string | null {
  const v = (cell ?? '').trim().replace(/^UPC\s*:\s*/i, '');
  return UPC_RE.test(v) ? v : null;
}

/** `2022-10-31<br />00:00:00` → `2022-10-31`; empty → undefined (no date); not a calendar date → null. */
export function exportDate(cell: string | undefined): string | null | undefined {
  const v = (cell ?? '').split(/<br\s*\/?>/i)[0]?.trim() ?? '';
  if (v === '') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

const exportInt = (cell: string | undefined): number | null => {
  const v = (cell ?? '').trim();
  return INT_RE.test(v) ? parseInt(v, 10) : null;
};

/**
 * Reads the export: `400 release_import_header` without a required column (`details.missing`), `413
 * import_too_large` over `RELEASE_IMPORT_MAX_ROWS`, `422 release_import_invalid` when any row is refused (`details.rows:
 * [{ line, code }]`, first 200, `details.errors` in all): the file is taken whole or not at all. Columns not in the
 * export format are ignored (Believe may add some). An empty Version, Artist, Label, Cat. # is null; an empty date is
 * null; `# of territories` / `# of stores` that are not integers are null (information only).
 */
export async function parseBelieveExport(input: Readable): Promise<ExportRelease[]> {
  let index: Map<string, number> | undefined;
  let line = 0;
  const out: ExportRelease[] = [];
  const refused: { line: number; code: ReleaseRowCode; upc?: string }[] = [];
  const seen = new Map<string, number>();
  for await (const record of parseCsv(input, ';')) {
    line += 1;
    if (!index) {
      const names = record.map((h) => h.trim());
      const missing = RELEASE_EXPORT_COLUMNS.filter((c) => !names.includes(c));
      if (missing.length > 0)
        throw new ValidationError(
          `Not a Believe release export: missing column(s) ${missing.join(', ')}`,
          { missing, expected: RELEASE_EXPORT_COLUMNS },
          'release_import_header',
        );
      index = new Map(names.map((n, i) => [n, i] as const).reverse());
      continue;
    }
    if (record.every((c) => c.trim() === '')) continue;
    if (out.length + refused.length >= RELEASE_IMPORT_MAX_ROWS)
      throw new AppError(`The release export has more than ${RELEASE_IMPORT_MAX_ROWS} rows`, 413, 'import_too_large', {
        maxRows: RELEASE_IMPORT_MAX_ROWS,
      });
    const cell = (c: (typeof RELEASE_EXPORT_COLUMNS)[number]) => record[index?.get(c) ?? -1];
    const upc = exportUpc(cell('UPC'));
    const trackCount = exportInt(cell('# of track'));
    const releaseDate = exportDate(cell('Release date / Hour / Time zone'));
    const before = refused.length;
    if (upc === null) refused.push({ line, code: 'upc_invalid' });
    if (trackCount === null) refused.push({ line, code: 'track_count_invalid' });
    if (releaseDate === null) refused.push({ line, code: 'date_invalid' });
    if (upc !== null) {
      const first = seen.get(upc);
      if (first !== undefined) refused.push({ line, code: 'duplicate_upc', upc });
      else seen.set(upc, line);
    }
    if (refused.length > before || upc === null || trackCount === null || releaseDate === null) continue;
    out.push({
      line,
      upc,
      title: (cell('Release Title') ?? '').trim(),
      version: text(cell('Version')),
      artistString: text(cell('Artist')),
      labelString: text(cell('Label')),
      releaseDate: releaseDate ?? null,
      trackCount,
      catalogNumber: text(cell('Cat. #')),
      territories: exportInt(cell('# of territories')),
      stores: exportInt(cell('# of stores')),
    });
  }
  if (!index)
    throw new ValidationError('The release export is empty', { missing: [...RELEASE_EXPORT_COLUMNS] }, 'release_import_header');
  if (refused.length > 0)
    throw new RuleViolationError(`${refused.length} row(s) of the release export are refused; nothing was imported`, 'release_import_invalid', {
      rows: refused.slice(0, MAX_LISTED),
      errors: refused.length,
    });
  return out;
}
