// The text of «Добавить списком»: one expense per line, pasted from a sheet (tabs) or typed (semicolons).
// Only the shape is checked here (strings and patterns, no arithmetic: R1); the API decides everything else.

export type BatchError = 'columns' | 'isrc' | 'month' | 'amount' | 'percent';

export interface BatchRow {
  /** The line of the pasted text, from 1. */
  line: number;
  isrc: string;
  month: string;
  amount: string;
  recoveryPercent: string;
  externalRef: string;
  comment: string;
  error: BatchError | null;
}

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const NOT_ZERO = /[1-9]/;
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/** A decimal comma becomes a point; the spaces of a sheet's thousands go. */
const decimal = (v: string) => v.replace(/\s/g, '').replace(',', '.');

function errorOf(r: Pick<BatchRow, 'isrc' | 'month' | 'amount' | 'recoveryPercent'>, columns: number): BatchError | null {
  if (columns < 3) return 'columns';
  if (!ISRC.test(r.isrc)) return 'isrc';
  if (!MONTH.test(r.month)) return 'month';
  if (!AMOUNT.test(r.amount) || !NOT_ZERO.test(r.amount)) return 'amount';
  if (!PERCENT.test(r.recoveryPercent)) return 'percent';
  return null;
}

/** Columns: ISRC, month, amount, percent (default 100), link, comment. Empty lines and a header line are left out. */
export function parseBatch(text: string): BatchRow[] {
  const rows: BatchRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = raw.split(raw.includes('\t') ? '\t' : ';').map((c) => c.trim());
    if (i === 0 && /isrc/i.test(cells[0] ?? '')) return;
    const row = {
      line: i + 1,
      isrc: (cells[0] ?? '').replace(/[-\s]/g, '').toUpperCase(),
      month: cells[1] ?? '',
      amount: decimal(cells[2] ?? ''),
      recoveryPercent: decimal(cells[3] ?? '') || '100',
      externalRef: cells[4] ?? '',
      comment: cells[5] ?? '',
    };
    rows.push({ ...row, error: errorOf(row, cells.length) });
  });
  return rows;
}
