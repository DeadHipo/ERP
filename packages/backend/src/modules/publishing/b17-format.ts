import ExcelJS from 'exceljs';
import { Decimal, parsePico, SOURCE_SCALE } from '../../shared/money';
import { ValidationError } from '../../shared/errors';

export interface B17Line {
  lineNo: number;
  period: string;
  writerName: string;
  /** Writers of the work as listed by B17 ("songwriters"): comma-separated full names. */
  songwriters: string | null;
  workTitle: string;
  workCode: string | null;
  operationType: string | null;
  retailer: string | null;
  country: string | null;
  payablePico: bigint;
}

/** Quarters named in the file name: `Q22026` or `2Q26`. */
export function quartersFromFileName(name: string): string[] {
  const found = new Set<string>();
  // Anchored on both sides: "…Q120265…" is not a quarter (D-100).
  for (const m of name.matchAll(/(?<![A-Za-z0-9])Q([1-4])(\d{4})(?!\d)/g)) found.add(`${m[2]}-Q${m[1]}`);
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([1-4])Q(\d{2})(?!\d)/g)) found.add(`20${m[2]}-Q${m[1]}`);
  return [...found].sort();
}

/** `1Q25`, `Q1 2025`, `2025-Q1` -> `2025-Q1`. */
export function parsePeriodCell(raw: string): string | undefined {
  const s = raw.trim();
  let m = /^([1-4])Q(\d{2})$/i.exec(s);
  if (m) return `20${m[2]}-Q${m[1]}`;
  m = /^Q([1-4])\s*(\d{4})$/i.exec(s);
  if (m) return `${m[2]}-Q${m[1]}`;
  m = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (m) return `${m[1]}-Q${m[2]}`;
  return undefined;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('error' in v) return `#ERROR:${(v as ExcelJS.CellErrorValue).error}`;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return String(v).trim();
}

/** xlsx stores doubles: 15 significant digits are reliable, then cut to SOURCE_SCALE decimals. */
const fromDouble = (v: number) =>
  parsePico(new Decimal(v).toSignificantDigits(15).toDecimalPlaces(SOURCE_SCALE).toFixed());

function amountPico(v: ExcelJS.CellValue, line: number, column: string): bigint {
  if (typeof v === 'number') return fromDouble(v);
  if (
    v &&
    typeof v === 'object' &&
    'result' in v &&
    typeof (v as ExcelJS.CellFormulaValue).result === 'number'
  ) {
    return fromDouble((v as ExcelJS.CellFormulaValue).result as number);
  }
  const s = cellText(v);
  if (s.startsWith('#')) throw new ValidationError(`Row ${line}: ${column} has an Excel error ${s}`);
  if (/[$,]/.test(s))
    throw new ValidationError(`Row ${line}: ${column} "${s}" is text with currency/grouping`);
  try {
    return parsePico(s);
  } catch (e) {
    throw new ValidationError(`Row ${line}: ${column}: ${(e as Error).message}`);
  }
}

const REQUIRED = ['asset title', 'rights-holder name', 'Total Payable'];

interface SheetRow {
  sheet: number;
  number: number;
  values: ExcelJS.CellValue[];
}

/** Streaming read, sheet by sheet. */
async function* streamRows(path: string): AsyncGenerator<SheetRow> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: 'cache',
    worksheets: 'emit',
    styles: 'ignore',
    hyperlinks: 'ignore',
  });
  let sheetNo = 0;
  for await (const sheet of reader) {
    sheetNo++;
    for await (const row of sheet)
      yield { sheet: sheetNo, number: row.number, values: (row.values as ExcelJS.CellValue[]) ?? [] };
  }
}

/** In-memory read: used only when the archive puts workbook.xml after the sheets (the streaming reader cannot). */
async function* memoryRows(path: string): AsyncGenerator<SheetRow> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  let sheetNo = 0;
  for (const ws of wb.worksheets) {
    sheetNo++;
    const rows: SheetRow[] = [];
    ws.eachRow((row, number) =>
      rows.push({ sheet: sheetNo, number, values: (row.values as ExcelJS.CellValue[]) ?? [] }),
    );
    yield* rows;
  }
}

async function* readRows(path: string): AsyncGenerator<SheetRow> {
  let yielded = false;
  try {
    for await (const r of streamRows(path)) {
      yielded = true;
      yield r;
    }
  } catch (e) {
    if (yielded || !(e instanceof TypeError)) throw e;
    yield* memoryRows(path);
  }
}

/**
 * Reads the detail sheet of a B17 statement (the sheet whose A1 is `Period` and whose header has `asset title`)
 * with the streaming xlsx reader. `Total Payable` is the base (amount after withholding).
 * When the archive stores `sharedStrings.xml` after the sheets, the streaming reader sees the header cells unresolved
 * and finds no detail sheet; the statement is then read in memory (the same rows, resolved).
 */
export async function* readB17Statement(path: string, fileName: string): AsyncGenerator<B17Line> {
  const streamed = parseB17Rows(readRows(path), fileName);
  for await (const line of streamed.lines) yield line;
  if (streamed.found()) return;
  const inMemory = parseB17Rows(memoryRows(path), fileName);
  for await (const line of inMemory.lines) yield line;
  if (!inMemory.found())
    throw new ValidationError(
      'No B17 detail sheet found (row 1 must start with "Period" and contain "asset title")',
    );
}

function parseB17Rows(
  rows: AsyncGenerator<SheetRow>,
  fileName: string,
): { lines: AsyncGenerator<B17Line>; found: () => boolean } {
  let found = false;
  async function* lines(): AsyncGenerator<B17Line> {
    const fileQuarters = quartersFromFileName(fileName);
    let lineSeq = 0;
    let currentSheet = 0;
    let col: Record<string, number> | undefined;
    let skip = false;
    for await (const row of rows) {
      if (row.sheet !== currentSheet) {
        currentSheet = row.sheet;
        col = undefined;
        skip = false;
      }
      {
        if (skip) continue;
        const values = row.values;
        if (!col) {
          const header = values.map((v) => cellText(v));
          if (header[1] !== 'Period' || !header.includes('asset title')) {
            skip = true; // not the detail sheet (Cover, Payment, Top 50 Songs, ...)
            continue;
          }
          col = {};
          header.forEach((h, i) => {
            if (h && col) col[h] = i;
          });
          if (col['Total Payable'] === undefined && col['Payable'] !== undefined)
            col['Total Payable'] = col['Payable'];
          const missing = REQUIRED.filter((r) => col && col[r] === undefined);
          if (missing.length)
            throw new ValidationError(`B17 detail sheet is missing columns: ${missing.join(', ')}`);
          found = true;
          continue;
        }
        const get = (name: string) =>
          col && col[name] !== undefined ? values[col[name] as number] : undefined;
        const title = cellText(get('asset title') ?? null);
        const payableCell = get('Total Payable') ?? null;
        if (!title && cellText(payableCell) === '') continue;
        const lineNo = ++lineSeq; // unique across sheets (row numbers restart per sheet)
        const sheetRow = row.number;
        const periodCell = cellText(get('Period') ?? null);
        const writerName = cellText(get('rights-holder name') ?? null);
        if (!writerName && !title) continue; // subtotal / total row
        const cellPeriod = parsePeriodCell(periodCell);
        const period = fileQuarters.length === 1 ? (fileQuarters[0] as string) : cellPeriod;
        if (!period)
          throw new ValidationError(`Row ${sheetRow}: cannot determine the quarter (Period "${periodCell}")`);
        if (cellPeriod && cellPeriod !== period)
          throw new ValidationError(
            `Row ${sheetRow}: Period ${cellPeriod} differs from the file quarter ${period}`,
          );
        if (!writerName) throw new ValidationError(`Row ${sheetRow}: empty rights-holder name`);
        if (cellText(payableCell) === '') throw new ValidationError(`Row ${sheetRow}: empty Total Payable`);
        const currency = cellText(get('currency') ?? null);
        if (currency && currency.toUpperCase() !== 'USD')
          throw new ValidationError(`Row ${sheetRow}: currency ${currency}; only USD is accepted`);
        yield {
          lineNo,
          period,
          writerName,
          songwriters: cellText(get('songwriters') ?? null) || null,
          workTitle: title,
          workCode: cellText(get('work identifier') ?? null) || null,
          operationType: cellText(get('operation type') ?? null) || null,
          retailer: cellText(get('retailer / service') ?? null) || null,
          country: cellText(get('country') ?? null) || null,
          payablePico: amountPico(payableCell, sheetRow, 'Total Payable'),
        };
      }
    }
  }
  return { lines: lines(), found: () => found };
}

/** "A B, C D, E F" -> ["A B", "C D", "E F"]: each comma-separated part of the songwriters cell is one writer. */
export function parseSongwriters(raw: string | null | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
