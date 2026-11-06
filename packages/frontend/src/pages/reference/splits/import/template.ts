import { SPLIT_IMPORT_COLUMNS } from '@erp/shared/split-import';

// The import template (D-172, P28): a csv Blob built from `SPLIT_IMPORT_COLUMNS` with two synthetic example rows (one
// split of two pseudonyms, our share 40 %); no API operation.

const EXAMPLE: Record<string, string>[] = [
  { isrc: 'QZTST2600001', pseudonym: 'Example Artist', percent: '40', from: '2026-01-01', owner: 'Example Owner', note: 'example' },
  { isrc: 'QZTST2600001', pseudonym: 'Example Guest', percent: '20', from: '2026-01-01', note: 'example' },
];

/** The text of the template: the header of every column, then the example rows (`;`-free, comma-separated). */
export function templateText(): string {
  const names = SPLIT_IMPORT_COLUMNS.map((c) => c.name);
  const lines = [names.join(','), ...EXAMPLE.map((row) => names.map((n) => row[n] ?? '').join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

/** Saves the template as `split-import-template.csv` through a temporary link. */
export function downloadTemplate(): void {
  const blob = new Blob([templateText()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'split-import-template.csv';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
