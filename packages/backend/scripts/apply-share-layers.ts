/**
 * Applies the share layers to Annex 14 and writes the result to a private SQLite file.
 * Does not open the shared PostgreSQL database and does not change calculate().
 * A recording the layers do not bring within 20 dollars is stored as deferred, not hard-coded.
 *
 * From the repo root:
 *
 *   npx tsx packages/backend/scripts/apply-share-layers.ts \
 *     "/absolute/path/Annex 14 — contractual coverage by recording.xlsx"
 *
 * Output: context_data/contract_index/coverage.sqlite
 */
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { normalizeIsrc } from '../src/shared/identifiers';
import { Decimal } from '../src/shared/money';
import {
  deriveLabelPercent,
  labelAmount,
  parseBuyoutParty,
  parseParties,
  parsePercents,
  shareGap,
  type ShareRule,
  type ShareTerm,
} from '../src/shared/share-layers';

const root = resolve(import.meta.dirname, '..', '..', '..');
const annexPath = process.argv[2];
if (!annexPath) throw new Error('Usage: apply-share-layers.ts <annex.xlsx>');
const annex = annexPath;

const PERIOD_RE = /(\d{4}-\d{2})(?:\s*[—–-]\s*(\d{4}-\d{2}))?/;

function cellRaw(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && 'result' in value) return value.result;
  return value;
}

function cellText(value: ExcelJS.CellValue): string {
  const raw = cellRaw(value);
  if (raw == null) return '';
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? '' : raw.toISOString();
  if (typeof raw === 'object' && raw && 'richText' in raw) {
    return (raw as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
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
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return new Decimal(raw.trim().replace(',', '.'));
    } catch {
      return null;
    }
  }
  return null;
}

function recordingCode(raw: string): string {
  return normalizeIsrc(raw);
}

interface SheetTable {
  header: string[];
  rows: ExcelJS.CellValue[][];
}

async function readTable(sheetName: string): Promise<SheetTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(annex);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`No sheet ${sheetName}`);
  let header: string[] | null = null;
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = (row.values as ExcelJS.CellValue[]).slice(1);
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

function asPoints(value: Decimal | null): Decimal | null {
  if (!value) return null;
  return value.abs().lte(1) ? value.mul(100) : value;
}

interface TermRow {
  isrc: string;
  from: string;
  to: string;
  percent: Decimal;
  rule: ShareRule;
}

const splits = await readTable('Splits by ISRC');
const receipts = await readTable('Monthly receipts by ISRC');
const labels = await readTable('Monthly NLS by ISRC');
const participations = column(splits.header, 'Registered participations');
const outside = column(splits.header, 'Participation settled outside the registered split');
const stated = column(splits.header, 'Share of 0to8 after the participations shown');
const period = column(splits.header, 'Period in which it applies');
const source = column(splits.header, 'Source');
const months = receipts.header.filter((name) => /^\d{4}-\d{2}$/.test(name));
const receiptAt = new Map(months.map((month) => [month, column(receipts.header, month)]));
const labelTotal = column(labels.header, 'Total January 2024 – August 2026');

const terms: TermRow[] = [];
for (const row of splits.rows) {
  const isrc = recordingCode(cellText(row[column(splits.header, 'ISRC')] ?? null));
  if (!isrc || isrc === 'TOTAL') continue;
  const span = PERIOD_RE.exec(cellText(row[period] ?? null));
  if (!span?.[1]) continue;
  const parties = parseParties(cellText(row[participations] ?? null));
  const derived = deriveLabelPercent({
    parties,
    outsidePercents: parsePercents(cellText(row[outside] ?? null)),
    buyoutParty: parseBuyoutParty(cellText(row[source] ?? null)),
    explicitLabelPercent: parties.some((party) => party.key.length > 0) ? null : asPoints(cellDecimal(row[stated] ?? null)),
  });
  terms.push({
    isrc,
    from: span[1],
    to: span[2] ?? span[1],
    percent: derived.percent,
    rule: derived.rule,
  });
}

const byIsrc = new Map<string, ShareTerm[]>();
const ruleOf = new Map<string, ShareRule>();
for (const term of terms) {
  const list = byIsrc.get(term.isrc) ?? [];
  list.push({ from: term.from, to: term.to, percent: term.percent });
  byIsrc.set(term.isrc, list);
  ruleOf.set(term.isrc, term.rule);
}

const reference = new Map<string, Decimal>();
for (const row of labels.rows) {
  const isrc = recordingCode(cellText(row[column(labels.header, 'ISRC')] ?? null));
  if (!isrc || isrc === 'TOTAL') continue;
  const amount = cellDecimal(row[labelTotal] ?? null);
  if (amount) reference.set(isrc, amount);
}

let within = 0;
let deferred = 0;
let absorbed = new Decimal(0);
let openDollars = new Decimal(0);
const deferredRows: { isrc: string; dollars: string; rule: string }[] = [];
const ruleCount = new Map<string, number>();

for (const row of receipts.rows) {
  const isrc = recordingCode(cellText(row[column(receipts.header, 'ISRC')] ?? null));
  if (!isrc || isrc === 'TOTAL' || !reference.has(isrc)) continue;
  const monthRows = months.map((month) => ({
    month,
    receipts: cellDecimal(row[receiptAt.get(month) ?? -1] ?? null) ?? new Decimal(0),
  }));
  const computed = labelAmount(monthRows, byIsrc.get(isrc) ?? []);
  const target = reference.get(isrc) ?? new Decimal(0);
  const rule = ruleOf.get(isrc) ?? 'unallocated';
  ruleCount.set(rule, (ruleCount.get(rule) ?? 0) + 1);
  if (shareGap(computed, target) === 'within' && computed) {
    within += 1;
    absorbed = absorbed.add(computed.sub(target).abs());
  } else {
    deferred += 1;
    const dollars = (computed ?? new Decimal(0)).sub(target).abs();
    openDollars = openDollars.add(dollars);
    deferredRows.push({ isrc, dollars: dollars.toFixed(), rule });
  }
}

const outDir = join(root, 'context_data', 'contract_index');
mkdirSync(outDir, { recursive: true });
const dbPath = join(outDir, 'coverage.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`
  DROP TABLE IF EXISTS terms;
  DROP TABLE IF EXISTS deferred;
  DROP TABLE IF EXISTS summary;
  CREATE TABLE terms (
    isrc TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    label_percent TEXT NOT NULL,
    rule TEXT NOT NULL
  );
  CREATE TABLE deferred (
    isrc TEXT NOT NULL,
    dollars TEXT NOT NULL,
    rule TEXT NOT NULL
  );
  CREATE TABLE summary (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
const insertTerm = db.prepare(
  'INSERT INTO terms (isrc, valid_from, valid_to, label_percent, rule) VALUES (?, ?, ?, ?, ?)',
);
const insertDeferred = db.prepare('INSERT INTO deferred (isrc, dollars, rule) VALUES (?, ?, ?)');
const insertSummary = db.prepare('INSERT INTO summary (key, value) VALUES (?, ?)');
db.exec('BEGIN');
for (const term of terms) {
  insertTerm.run(term.isrc, term.from, term.to, term.percent.toFixed(), term.rule);
}
for (const row of deferredRows) insertDeferred.run(row.isrc, row.dollars, row.rule);
const summaryRows: [string, string][] = [
  ['within', String(within)],
  ['deferred', String(deferred)],
  ['absorbed_usd', absorbed.toFixed()],
  ['deferred_usd', openDollars.toFixed()],
  ['terms', String(terms.length)],
];
for (const [key, value] of summaryRows) insertSummary.run(key, value);
db.exec('COMMIT');
db.close();

process.stdout.write(
  `${JSON.stringify(
    {
      file: dbPath,
      terms: terms.length,
      within,
      deferred,
      absorbedUsd: absorbed.toFixed(),
      deferredUsd: openDollars.toFixed(),
      rules: Object.fromEntries(ruleCount),
    },
    null,
    2,
  )}\n`,
);
