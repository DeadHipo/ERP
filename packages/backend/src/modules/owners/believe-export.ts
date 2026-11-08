import type { Readable } from 'node:stream';
import { parseCsv } from '../../shared/csv';
import { AppError, ValidationError } from '../../shared/errors';
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

/** The codes of a row the preview refuses (D-195: a row error, the other rows still preview). */
export type ReleaseRowCode = 'upc_invalid' | 'track_count_invalid' | 'date_invalid' | 'duplicate_upc';

/** One release of an export, as the registry stores it (without the label and the times of the row). */
export interface ExportRelease {
  /** The line of the file (the header is line 1). */
  line: number;
  upc: string;
  releaseTitle: string;
  version: string | null;
  artistString: string | null;
  labelString: string | null;
  /** `YYYY-MM-DDTHH:MM:SS` as the export gives it (no zone); a date without a time is 00:00:00; null = no date. */
  releasedAt: string | null;
  trackCount: number;
  catalogNumber: string | null;
  territories: number | null;
  stores: number | null;
}

/** A line of the export that cannot be read: its codes, and the UPC when it is readable. */
export interface ExportIssue {
  line: number;
  upc: string | null;
  codes: ReleaseRowCode[];
}

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

/**
 * `2022-10-31<br />00:00:00` (also `2022-10-31 00:00`, `2022-10-31T00:00:00`, a bare date) → `2022-10-31T00:00:00`;
 * empty → undefined (no date); not a calendar date or time → null. A zone that may follow the time is not read.
 */
export function exportDateTime(cell: string | undefined): string | null | undefined {
  const parts = (cell ?? '').split(/<br\s*\/?>|T|\s+/i).map((x) => x.trim()).filter((x) => x !== '');
  if (parts.length === 0) return undefined;
  const [day, time = '00:00:00'] = parts as [string, string | undefined];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return null;
  const t = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(time);
  if (!t) return null;
  return `${day}T${t[1] as string}:${t[2] as string}:${t[3] ?? '00'}`;
}

const exportInt = (cell: string | undefined): number | null => {
  const v = (cell ?? '').trim();
  return INT_RE.test(v) ? parseInt(v, 10) : null;
};

/**
 * Reads the Believe release export (D-172, D-195): `400 release_import_header` without a required column (`details.missing`),
 * `413 import_too_large` over `RELEASE_IMPORT_MAX_ROWS`. A row that cannot be read is an issue of its line, not a refusal
 * of the file: the preview shows it and the other rows. Two lines of one UPC are both kept: the facade compares them.
 * Columns not in the format are ignored. An empty Version, Artist, Label, Cat. #, date is null; `# of territories` /
 * `# of stores` that are not integers are null (information only).
 */
export async function parseBelieveExport(input: Readable): Promise<{ rows: ExportRelease[]; issues: ExportIssue[] }> {
  let index: Map<string, number> | undefined;
  let line = 0;
  const rows: ExportRelease[] = [];
  const issues: ExportIssue[] = [];
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
    if (rows.length + issues.length >= RELEASE_IMPORT_MAX_ROWS)
      throw new AppError(`The release export has more than ${RELEASE_IMPORT_MAX_ROWS} rows`, 413, 'import_too_large', {
        maxRows: RELEASE_IMPORT_MAX_ROWS,
      });
    const cell = (c: (typeof RELEASE_EXPORT_COLUMNS)[number]) => record[index?.get(c) ?? -1];
    const upc = exportUpc(cell('UPC'));
    const trackCount = exportInt(cell('# of track'));
    const releasedAt = exportDateTime(cell('Release date / Hour / Time zone'));
    const codes: ReleaseRowCode[] = [];
    if (upc === null) codes.push('upc_invalid');
    if (trackCount === null) codes.push('track_count_invalid');
    if (releasedAt === null) codes.push('date_invalid');
    if (upc === null || trackCount === null || releasedAt === null) {
      issues.push({ line, upc, codes });
      continue;
    }
    rows.push({
      line,
      upc,
      releaseTitle: (cell('Release Title') ?? '').trim(),
      version: text(cell('Version')),
      artistString: text(cell('Artist')),
      labelString: text(cell('Label')),
      releasedAt: releasedAt ?? null,
      trackCount,
      catalogNumber: text(cell('Cat. #')),
      territories: exportInt(cell('# of territories')),
      stores: exportInt(cell('# of stores')),
    });
  }
  if (!index)
    throw new ValidationError('The release export is empty', { missing: [...RELEASE_EXPORT_COLUMNS] }, 'release_import_header');
  return { rows, issues };
}

/** The readers of a release export by its source (D-195): a new format is a new source, the registry stays one. */
export const RELEASE_READERS = { believe: parseBelieveExport } as const;
export type ReleaseSource = keyof typeof RELEASE_READERS;
