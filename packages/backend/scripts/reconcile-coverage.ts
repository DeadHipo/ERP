/**
 * Checks two reference workbooks against the remainder rule and the loaded Believe reports.
 * Does not write splits and does not change calculate().
 * A gap of 20 dollars or more stays a case in the report. A smaller gap is counted and left.
 *
 * From the repo root:
 *
 *   npx tsx packages/backend/scripts/reconcile-coverage.ts \
 *     "/absolute/path/Annex 14.xlsx" \
 *     "/absolute/path/0to8 Main.xlsx"
 *
 * Writes context_data/contract_index/coverage_reconcile.json (ISRCs and amounts, no names).
 * The warehouse read uses the loaded Believe files of .env (D-121). Label filter is the
 * imprint name "0to8": other imprints are a different population and are not folded in.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { clickHouseConfigFromEnv, createClickHouse } from '../src/shared/clickhouse';
import {
  artistShareOfReceipts,
  participationPercents,
  reconcileCoverage,
  type CoverageRow,
} from '../src/shared/coverage-check';
import { normalizeIsrc } from '../src/shared/identifiers';
import { Decimal } from '../src/shared/money';
import { createPostgres, postgresConfigFromEnv } from '../src/shared/postgres';

const root = resolve(import.meta.dirname, '..', '..', '..');
const WINDOW_FROM = '2024-01-01';
const WINDOW_TO = '2026-09-01';
const LABEL = '0to8';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const annexPath = process.argv[2];
const mainPath = process.argv[3];
if (!annexPath || !mainPath) {
  throw new Error('Usage: reconcile-coverage.ts <annex.xlsx> <main.xlsx>');
}

function loadEnv(): void {
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    // the variables may already be in the environment
  }
}

function cellRaw(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && 'result' in value) return value.result;
  return value;
}

function cellText(value: ExcelJS.CellValue): string {
  const raw = cellRaw(value);
  if (raw == null) return '';
  if (raw instanceof Date) {
    const time = raw.getTime();
    if (Number.isNaN(time)) return '';
    return raw.toISOString();
  }
  if (typeof raw === 'object' && raw && 'richText' in raw) {
    const parts = (raw as { richText: { text: string }[] }).richText;
    return parts.map((part) => part.text).join('');
  }
  return String(raw);
}

function cellDecimal(value: ExcelJS.CellValue): Decimal | null {
  const raw = cellRaw(value);
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return new Decimal(raw.toString());
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return new Decimal(trimmed.replace(',', '.'));
    } catch {
      return null;
    }
  }
  return null;
}

function isoDate(value: ExcelJS.CellValue): string | null {
  const raw = cellRaw(value);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const year = raw.getUTCFullYear();
    const month = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const day = String(raw.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function recordingCode(raw: string): string {
  const code = normalizeIsrc(raw);
  return code || raw.trim();
}

/** A stated label share of 0.5 is half. A number above 1 is already in percent points. */
function labelFraction(value: Decimal | null): Decimal | null {
  if (!value) return null;
  return value.abs().lte(1) ? value : value.div(100);
}

interface SheetTable {
  header: string[];
  rows: ExcelJS.CellValue[][];
}

async function readTable(path: string, sheetName: string): Promise<SheetTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`No sheet ${sheetName} in ${path}`);
  let header: string[] | null = null;
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells = values.slice(1);
    if (!header) {
      if (cellText(cells[0] ?? null) === 'ISRC') header = cells.map((cell) => cellText(cell).trim());
      return;
    }
    if (cells.some((cell) => cell != null && cell !== '')) rows.push(cells);
  });
  if (!header) throw new Error(`No ISRC header on ${sheetName}`);
  return { header, rows };
}

function column(header: string[], name: string): number {
  const index = header.findIndex((item) => item === name);
  if (index < 0) throw new Error(`Column not found: ${name}`);
  return index;
}

async function annexRows(path: string): Promise<{ rows: CoverageRow[]; duplicateRows: number }> {
  const splits = await readTable(path, 'Splits by ISRC');
  const receipts = await readTable(path, 'Monthly receipts by ISRC');
  const labels = await readTable(path, 'Monthly NLS by ISRC');
  const isrc = (header: string[]) => column(header, 'ISRC');
  const receiptTotal = column(receipts.header, 'Total January 2024 – August 2026');
  const labelTotal = column(labels.header, 'Total January 2024 – August 2026');
  const participations = column(splits.header, 'Registered participations');
  const fraction = column(splits.header, 'Share of 0to8 after the participations shown');
  let duplicateRows = 0;

  const receiptOf = new Map<string, Decimal>();
  for (const row of receipts.rows) {
    const code = recordingCode(cellText(row[isrc(receipts.header)] ?? null));
    if (!code || code === 'TOTAL') continue;
    const amount = cellDecimal(row[receiptTotal] ?? null);
    if (!amount) continue;
    const previous = receiptOf.get(code);
    if (previous) {
      duplicateRows += 1;
      receiptOf.set(code, previous.add(amount));
    } else {
      receiptOf.set(code, amount);
    }
  }
  const labelOf = new Map<string, Decimal>();
  for (const row of labels.rows) {
    const code = recordingCode(cellText(row[isrc(labels.header)] ?? null));
    if (!code || code === 'TOTAL') continue;
    const amount = cellDecimal(row[labelTotal] ?? null);
    if (!amount) continue;
    const previous = labelOf.get(code);
    if (previous) {
      duplicateRows += 1;
      labelOf.set(code, previous.add(amount));
    } else {
      labelOf.set(code, amount);
    }
  }
  const byIsrc = new Map<string, CoverageRow>();
  for (const row of splits.rows) {
    const code = recordingCode(cellText(row[isrc(splits.header)] ?? null));
    if (!code || code === 'TOTAL') continue;
    if (byIsrc.has(code)) {
      duplicateRows += 1;
      const existing = byIsrc.get(code);
      if (existing && !existing.conflictingPercents) {
        const next = participationPercents(cellText(row[participations] ?? null));
        const same =
          next.length === existing.percents.length &&
          next.every((percent, index) => percent.eq(existing.percents[index] ?? new Decimal(0)));
        if (!same) existing.conflictingPercents = next;
      }
      continue;
    }
    byIsrc.set(code, {
      isrc: code,
      receipts: receiptOf.get(code) ?? null,
      referenceLabel: labelOf.get(code) ?? null,
      percents: participationPercents(cellText(row[participations] ?? null)),
      referenceLabelFraction: labelFraction(cellDecimal(row[fraction] ?? null)),
      conflictingPercents: null,
    });
  }
  for (const [code, amount] of receiptOf) {
    if (byIsrc.has(code)) continue;
    byIsrc.set(code, {
      isrc: code,
      receipts: amount,
      referenceLabel: labelOf.get(code) ?? null,
      percents: [],
      referenceLabelFraction: null,
      conflictingPercents: null,
    });
  }
  return { rows: [...byIsrc.values()], duplicateRows };
}

async function royaltyLedger(path: string): Promise<{ royalties: Decimal; publishing: Decimal; unparsed: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.getWorksheet('INCOME  EXPENSE');
  if (!sheet) throw new Error('No sheet INCOME  EXPENSE');
  let header: string[] | null = null;
  let royalties = new Decimal(0);
  let publishing = new Decimal(0);
  let unparsed = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = (row.values as ExcelJS.CellValue[]).slice(1);
    if (!header) {
      if (cells.some((cell) => cellText(cell) === 'AMOUNT')) header = cells.map((cell) => cellText(cell).trim());
      return;
    }
    const date = cells[header.indexOf('Date')];
    const kind = cellText(cells[header.indexOf('Type')] ?? null);
    const category = cellText(cells[header.indexOf('Category')] ?? null);
    const amount = cellDecimal(cells[header.indexOf('AMOUNT')] ?? null);
    if (kind !== 'Income' || !amount) return;
    const iso = isoDate(date ?? null);
    if (!iso) {
      unparsed += 1;
      return;
    }
    if (iso < WINDOW_FROM || iso >= WINDOW_TO) return;
    if (category === 'Royalties') royalties = royalties.add(amount);
    if (category === 'Publishing') publishing = publishing.add(amount);
  });
  return { royalties, publishing, unparsed };
}

async function warehouseNets(): Promise<Map<string, Decimal>> {
  loadEnv();
  const pg = createPostgres(postgresConfigFromEnv());
  const ch = createClickHouse(clickHouseConfigFromEnv());
  try {
    const found = await pg.pool.query<{ id: string }>(
      `SELECT id::text AS id FROM source_files
       WHERE status = 'loaded' AND source = 'believe'
         AND reporting_month >= $1 AND reporting_month < $2`,
      [WINDOW_FROM, WINDOW_TO],
    );
    const ids = found.rows.map((row) => row.id);
    if (ids.length === 0) throw new Error('no loaded Believe files in the window');
    if (ids.some((id) => !UUID_RE.test(id))) throw new Error('source file id is not a uuid');
    const result = await ch.query({
      query: `SELECT isrc, toString(sum(net_revenue)) AS net
              FROM rows
              WHERE file_id IN {ids:Array(UUID)}
                AND label_name = {label:String}
                AND reporting_month >= {from:Date}
                AND reporting_month < {to:Date}
              GROUP BY isrc`,
      query_params: { ids, label: LABEL, from: WINDOW_FROM, to: WINDOW_TO },
      format: 'JSONEachRow',
    });
    const lines = await result.json<{ isrc: string; net: string }>();
    const nets = new Map<string, Decimal>();
    for (const line of lines) {
      const code = normalizeIsrc(line.isrc);
      if (!code) continue;
      const amount = new Decimal(line.net);
      const previous = nets.get(code);
      nets.set(code, previous ? previous.add(amount) : amount);
    }
    return nets;
  } finally {
    await Promise.allSettled([pg.close(), ch.close()]);
  }
}

const annex = await annexRows(annexPath);
const ledger = await royaltyLedger(mainPath);
const nets = await warehouseNets();
const report = reconcileCoverage(annex.rows, nets);
const outDir = join(root, 'context_data', 'contract_index');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'coverage_reconcile.json');
const body = {
  window: { from: WINDOW_FROM, toExclusive: WINDOW_TO, label: LABEL },
  sources: { annex: annexPath, ledger: mainPath },
  // The ledger is not the annex's set of recordings, so the two totals are shown and not classified.
  ledger: {
    referenceRoyalties: ledger.royalties.toFixed(),
    artistShareOfAnnexReceipts: artistShareOfReceipts(annex.rows).toFixed(),
    publishingInWindow: ledger.publishing.toFixed(),
    unparsedDates: ledger.unparsed,
  },
  duplicateAnnexRows: annex.duplicateRows,
  ...report,
};
writeFileSync(outPath, `${JSON.stringify(body)}\n`);
const summary = {
  file: outPath,
  recordings: report.recordings,
  labelCases: report.labelRemainder.cases,
  labelWithin: report.labelRemainder.within,
  referenceInternalCases: report.referenceInternal.cases,
  receiptCases: report.receipts.cases,
  referenceOnly: report.receipts.referenceOnly,
  smallReferenceOnly: report.receipts.smallReferenceOnly,
  warehouseOnly: report.receipts.warehouseOnly,
  smallWarehouseOnly: report.receipts.smallWarehouseOnly,
  absorbedLabelUsd: report.absorbedUsd.labelRemainder,
  absorbedReceiptsUsd: report.absorbedUsd.receipts,
  receipts: report.totals.receipts,
  labelByRemainder: report.totals.labelByRemainder,
  referenceLabel: report.totals.referenceLabel,
  referenceRoyalties: ledger.royalties.toFixed(),
  artistShareOfAnnexReceipts: artistShareOfReceipts(annex.rows).toFixed(),
  duplicateAnnexRows: annex.duplicateRows,
  cases: report.cases.length,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
