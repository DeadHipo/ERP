import ExcelJS from 'exceljs';

// The streaming xlsx reader shared by the B17 statements (`modules/publishing/b17-format.ts`) and the split import
// (`facade/split-import.ts`, D-172). Pure: no module, no storage.

export interface SheetRow {
  /** 1-based sheet number. */
  sheet: number;
  /** The row number of the sheet (1-based). */
  number: number;
  /** ExcelJS row values: index 1 is column A. */
  values: ExcelJS.CellValue[];
}

/** The text of a cell: formulas by their result, rich text joined, a date as YYYY-MM-DD, trimmed. */
export function cellText(v: ExcelJS.CellValue): string {
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

/** Streaming read, sheet by sheet. */
export async function* streamRows(path: string): AsyncGenerator<SheetRow> {
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
export async function* memoryRows(path: string): AsyncGenerator<SheetRow> {
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

/** Streaming read; falls back to the in-memory read when the streaming reader fails before the first row. */
export async function* readRows(path: string): AsyncGenerator<SheetRow> {
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
