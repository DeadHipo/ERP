import { START_IMPORT_COLUMNS } from '@erp/shared/start-import';
import { saveCsv } from '../../../lib/download';

// The start import template (D-174, P30): a csv Blob built from `START_IMPORT_COLUMNS` with synthetic example rows (a
// start with an amount, a start without one, an adjustment that reopens an advance); no API operation.

const EXAMPLE: Record<string, string>[] = [
  { pseudonym: 'Example Artist', kind: 'start', master: '123.45', publishing: '0', comment: 'example' },
  { pseudonym: 'Example Missing', kind: 'start', missing: '1', comment: 'the cabinet gave no amount' },
  { pseudonym: 'Example Artist', kind: 'adjustment', master: '6000', basis: 'publishing advance reopened', operation_ref: '<advance id>', comment: 'example' },
];

/** The text of the template: the header of every column, then the example rows (comma-separated). */
export function templateText(): string {
  const names = START_IMPORT_COLUMNS.map((c) => c.name);
  const lines = [names.join(','), ...EXAMPLE.map((row) => names.map((n) => row[n] ?? '').join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

/** Saves the template as `start-import-template.csv`. */
export function downloadTemplate(): void {
  saveCsv('start-import-template.csv', templateText());
}
