import { OPERATION_IMPORT_COLUMNS } from '@erp/shared/operation-import';
import { saveCsv } from '../../../lib/download';

// The operation import template (D-173, P29): a csv Blob built from `OPERATION_IMPORT_COLUMNS` with two synthetic example
// rows (a payout of the cash register with its external id, an advance with a recoup scope); no API operation.

const EXAMPLE: Record<string, string>[] = [
  { owner: 'Example Owner', date: '2026-04-01', amount: '100.00', kind: 'payout', channel: 'bank', external_id: 'CASH-0001', comment: 'example' },
  { pseudonym: 'Example Artist', date: '2026-04-01', amount: '50.00', kind: 'advance', document: 'Example advance basis', external_id: 'CASH-0002', scope: 'any', comment: 'example' },
];

/** The text of the template: the header of every column, then the example rows (comma-separated). */
export function templateText(): string {
  const names = OPERATION_IMPORT_COLUMNS.map((c) => c.name);
  const lines = [names.join(','), ...EXAMPLE.map((row) => names.map((n) => row[n] ?? '').join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

/** Saves the template as `operation-import-template.csv`. */
export function downloadTemplate(): void {
  saveCsv('operation-import-template.csv', templateText());
}
