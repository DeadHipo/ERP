import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BELIEVE_COLUMNS } from '../../src/modules/sources';

// Synthetic Believe reports for tests: invented ISRCs, UPCs, names and amounts.

export interface Spec {
  reportingMonth?: string; // YYYY/MM/DD
  salesMonth?: string;
  platform?: string;
  country?: string;
  artist?: string;
  track?: string;
  isrc?: string;
  upc?: string;
  subscription?: string;
  salesType?: string;
  quantity?: string;
  currency?: string;
  unitPrice?: string;
  gross?: string;
  net?: string;
  labelName?: string;
}

/** The report text. `reportingMonth` of every row defaults to 2026/07/01: pass `month` ('YYYY-MM') to set them all. */
export function believeReport(
  rows: Spec[],
  opts: { month?: string; header?: readonly string[]; extraField?: boolean } = {},
): string {
  const header = opts.header ?? BELIEVE_COLUMNS;
  const line = (fields: string[]) => fields.map((f) => `"${f}"`).join(';');
  const rm = opts.month ? `${opts.month.replace('-', '/')}/01` : '2026/07/01';
  const data = rows.map((r) => {
    const all: Record<string, string> = {
      'Reporting month': r.reportingMonth ?? rm,
      'Sales Month': r.salesMonth ?? '2026/06/01',
      Platform: r.platform ?? 'Spotify',
      'Country / Region': r.country ?? 'Latvia',
      'Label Name': r.labelName ?? 'Test Label',
      'Artist Name': r.artist ?? 'Test Artist',
      'Release title': 'Test Release',
      'Track title': r.track ?? 'Test Track',
      UPC: r.upc ?? '3617380000001',
      ISRC: r.isrc ?? 'XX-TST-26-00001',
      'Release Catalog nb': '',
      'Streaming Subscription Type': r.subscription ?? 'Premium',
      'Release type': 'Music Release',
      'Sales Type': r.salesType ?? 'Stream',
      Quantity: r.quantity ?? '1',
      'Client Payment Currency': r.currency ?? 'USD',
      'Unit Price': r.unitPrice ?? '0.004000000000',
      'Mechanical Fee': '0.000000',
      'Gross Revenue': r.gross ?? '0.004000000000',
      'Client share rate': '0.85000000',
      'Net Revenue': r.net ?? '0.003400000000',
    };
    const fields = header.map((h) => all[h] ?? '');
    if (opts.extraField) fields.push('x');
    return line(fields);
  });
  return [line([...header]), ...data].join('\r\n') + '\r\n';
}

let seq = 0;
/** Writes a report named like a real one (<reportId>_<account>_<from>_<to>.csv) and returns its path and name. */
export function writeReport(
  dir: string,
  account: string,
  month: string,
  content: string,
): { path: string; fileName: string } {
  const fileName = `${9_100_000 + ++seq}_${account}_${month}-01_${month}-01.csv`;
  const path = join(dir, fileName);
  writeFileSync(path, content);
  return { path, fileName };
}
