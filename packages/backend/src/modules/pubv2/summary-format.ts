import type ExcelJS from 'exceljs';
import { ValidationError } from '../../shared/errors';
import { Decimal, parsePico, SOURCE_SCALE } from '../../shared/money';
import { cellText, memoryRows, readRows, type SheetRow } from '../../shared/xlsx-rows';

// The summaries of a B17 report (D-182), read by the shape of a sheet and never by its name. Three shapes cover the
// seven reports: `periods` (two lists of songs, one per quarter, no writer: Q4 2024 + Q1 2025), `blocks` (a row
// `SONGWRITER: name`, then its songs: the Cover of Q2 and Q3 2025, the Songwriter Breakdown of Q1 and Q2 2026) and
// `flat` (a writer on every row: the Songwriter Breakdown of Q4 2025). Pure: no storage.

export type SummaryFormat = 'periods' | 'blocks' | 'flat';

export interface SummaryRow {
  writerName: string;
  title: string;
  /** `2026-Q2`. */
  period: string;
  grossPico: bigint | null;
  withholdingPico: bigint | null;
  payablePico: bigint;
}

export interface Summary {
  format: SummaryFormat;
  periods: string[];
  rows: SummaryRow[];
  /** The total the file names itself (the writers' or the periods' own totals); null when it names none. */
  declaredPayablePico: bigint | null;
}

const fromDouble = (v: number): bigint =>
  parsePico(new Decimal(v).toSignificantDigits(15).toDecimalPlaces(SOURCE_SCALE).toFixed());

/** A number cell, or text such as `$2,862.96`; undefined when the cell is no amount. */
function amount(v: ExcelJS.CellValue): bigint | undefined {
  if (typeof v === 'number') return fromDouble(v);
  if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number') return fromDouble(v.result);
  const s = cellText(v).replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return parsePico(new Decimal(s).toDecimalPlaces(SOURCE_SCALE).toFixed());
}

/** `1Q25`, `2025-Q1` -> `2025-Q1`. */
function periodOfCell(raw: string): string | undefined {
  const s = raw.trim();
  const short = /^([1-4])Q(\d{2})$/i.exec(s);
  if (short) return `20${short[2]}-Q${short[1]}`;
  return /^\d{4}-Q[1-4]$/.test(s) ? s : undefined;
}

/** The one quarter a file name names: `Q22026`, `2Q2026`, `2Q26`. */
export function quarterOfFileName(name: string): string | undefined {
  const found = new Set<string>();
  for (const m of name.matchAll(/(?<![A-Za-z0-9])Q([1-4])(\d{4})(?!\d)/g)) found.add(`${m[2]}-Q${m[1]}`);
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([1-4])Q(\d{4})(?!\d)/g)) found.add(`${m[2]}-Q${m[1]}`);
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([1-4])Q(\d{2})(?!\d)/g)) found.add(`20${m[2]}-Q${m[1]}`);
  return found.size === 1 ? [...found][0] : undefined;
}

const texts = (r: SheetRow): string[] => r.values.map((v) => cellText(v));
const upper = (r: SheetRow): string[] => texts(r).map((v) => v.toUpperCase());

interface Columns {
  gross?: number;
  withholding?: number;
  payable?: number;
}

function columnsOf(headers: string[]): Columns {
  const at = (...names: string[]) => {
    const i = headers.findIndex((h) => names.includes(h));
    return i < 0 ? undefined : i;
  };
  return { gross: at('GROSS'), withholding: at('WITHHOLDING'), payable: at('TOTAL PAYABLE', 'NET', 'AMOUNT') };
}

const cellAmount = (r: SheetRow, col: number | undefined): bigint | null =>
  col === undefined ? null : (amount(r.values[col] ?? null) ?? null);

type SheetKind = 'periods' | 'blocks' | 'flat' | 'detail' | 'other';

function kindOf(first: string[]): SheetKind {
  if (first.includes('SONGWRITER') && first.includes('SONG TITLE')) return 'flat';
  if (first[1] === 'SONG') return 'blocks';
  if (first[1] === 'PERIOD' && first.includes('ASSET TITLE')) return 'detail';
  if (first[1] === 'PERIOD' && first[2] === 'AMOUNT') return 'periods';
  if (/^TOTAL\s+ROYALTIES/.test(first[1] ?? '')) return 'blocks';
  return 'other';
}

/** Reads rows into a summary; undefined when no sheet of the workbook has a known shape. */
async function parse(rows: AsyncGenerator<SheetRow>, fileName: string): Promise<Summary | undefined> {
  const out: SummaryRow[] = [];
  const declaredByWriter = new Map<string, bigint>();
  const declaredByPeriod = new Map<string, bigint>();
  const periodLists: { period: string; title: string; payablePico: bigint }[] = [];
  const holders = new Set<string>();
  let format: SummaryFormat | undefined;
  const quarter = () => {
    const q = quarterOfFileName(fileName);
    if (!q) throw new ValidationError(`The quarter of ${fileName} is unknown: name it like Q22026 in the file name`);
    return q;
  };

  let sheet = 0;
  let kind: SheetKind = 'other';
  let cols: Columns = {};
  let writer: string | undefined;
  let flat: { writer: number; title: number } | undefined;
  let holderCol: number | undefined;
  let listCols: { col: number; period?: string }[] = [];

  for await (const r of rows) {
    if (r.sheet !== sheet) {
      sheet = r.sheet;
      const first = upper(r);
      kind = kindOf(first);
      writer = undefined;
      cols = kind === 'blocks' || kind === 'flat' ? columnsOf(first) : {};
      if (kind === 'flat') {
        flat = { writer: first.indexOf('SONGWRITER'), title: first.indexOf('SONG TITLE') };
        format = 'flat';
      }
      if (kind === 'blocks') format = format ?? 'blocks';
      if (kind === 'periods') {
        format = 'periods';
        listCols = first.flatMap((h, col) => (h === 'PERIOD' ? [{ col }] : []));
      }
      if (kind === 'detail') holderCol = first.indexOf('RIGHTS-HOLDER NAME');
      continue;
    }
    if (kind === 'other') continue;

    if (kind === 'detail') {
      const name = cellText(r.values[holderCol ?? -1] ?? null);
      if (name) holders.add(name);
      continue;
    }

    if (kind === 'periods') {
      for (const list of listCols) {
        const text = cellText(r.values[list.col] ?? null);
        if (!text) continue;
        const value = amount(r.values[list.col + 1] ?? null);
        if (value === undefined) continue;
        if (!list.period) {
          list.period = periodOfCell(text);
          if (!list.period) throw new ValidationError(`Row ${r.number}: "${text}" is not a quarter`);
          declaredByPeriod.set(list.period, value);
        } else periodLists.push({ period: list.period, title: text, payablePico: value });
      }
      continue;
    }

    if (kind === 'flat' && flat) {
      const title = cellText(r.values[flat.title] ?? null);
      const name = cellText(r.values[flat.writer] ?? null);
      const payable = cellAmount(r, cols.payable);
      if (!title || !name || payable === null) continue;
      out.push({
        writerName: name,
        title,
        period: quarter(),
        grossPico: cellAmount(r, cols.gross),
        withholdingPico: cellAmount(r, cols.withholding),
        payablePico: payable,
      });
      continue;
    }

    // blocks
    const row = texts(r);
    const a = row[1] ?? '';
    const headers = upper(r);
    if (/^SONGS?$/.test(headers[1] ?? '') && headers.includes('WITHHOLDING')) {
      cols = columnsOf(headers);
      continue;
    }
    const block = /^SONGWRITER:\s*(.+)$/i.exec(a);
    if (block) {
      writer = (block[1] as string).trim();
      const total = row.map((c) => /^TOTAL:\s*(.+)$/i.exec(c)?.[1]).find(Boolean);
      const declared = total ? amount(total) : (cellAmount(r, cols.payable) ?? undefined);
      if (declared !== undefined) declaredByWriter.set(writer, declared);
      continue;
    }
    const payable = cellAmount(r, cols.payable);
    if (!writer || !a || payable === null) continue;
    out.push({
      writerName: writer,
      title: a,
      period: quarter(),
      grossPico: cellAmount(r, cols.gross),
      withholdingPico: cellAmount(r, cols.withholding),
      payablePico: payable,
    });
  }

  if (format === 'periods') {
    if (holders.size !== 1)
      throw new ValidationError(`A report without writers needs one rights-holder in its lines, found ${holders.size}`);
    const writerName = [...holders][0] as string;
    for (const l of periodLists)
      out.push({ writerName, title: l.title, period: l.period, grossPico: null, withholdingPico: null, payablePico: l.payablePico });
  }
  if (!format || out.length === 0) return undefined;
  const declared = [...declaredByWriter.values(), ...declaredByPeriod.values()];
  return {
    format,
    periods: [...new Set(out.map((x) => x.period))].sort(),
    rows: out,
    declaredPayablePico: declared.length ? declared.reduce((s, v) => s + v, 0n) : null,
  };
}

/** The summary of a report; the in-memory read when the archive keeps the shared strings after the sheets. */
export async function readB17Summary(path: string, fileName: string): Promise<Summary> {
  const summary = (await parse(readRows(path), fileName)) ?? (await parse(memoryRows(path), fileName));
  if (!summary) throw new ValidationError('No B17 summary found: no sheet with songwriters and songs');
  return summary;
}
