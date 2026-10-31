import { ValidationError } from '../../shared/errors';
import { assertMonth } from '../../shared/dates';
import { normalizeIsrc, normalizeUpc } from '../../shared/identifiers';
import { parsePico, picoToString } from '../../shared/money';

/** Believe monthly report columns, in the order Believe produces them. */
export const BELIEVE_COLUMNS = [
  'Reporting month',
  'Sales Month',
  'Platform',
  'Country / Region',
  'Label Name',
  'Artist Name',
  'Release title',
  'Track title',
  'UPC',
  'ISRC',
  'Release Catalog nb',
  'Streaming Subscription Type',
  'Release type',
  'Sales Type',
  'Quantity',
  'Client Payment Currency',
  'Unit Price',
  'Mechanical Fee',
  'Gross Revenue',
  'Client share rate',
  'Net Revenue',
] as const;

const OPTIONAL = new Set([
  'Release Catalog nb',
  'Client Payment Currency',
  'Unit Price',
  'Mechanical Fee',
  'Client share rate',
]);

export interface BelieveFileName {
  reportId: string;
  account: string;
  reportingMonth: string;
}

/**
 * File name `<reportId>_<account>_<from YYYY-MM-DD>_<to YYYY-MM-DD>.csv[.zip]`; browser copies such as
 * `... .csv (2).zip` are tolerated. The reporting month is taken from `from`.
 */
export function parseBelieveFileName(name: string): BelieveFileName {
  const base = name.replace(/^.*[\\/]/, '');
  const m = /^(\d+)_(\d+)_(\d{4})-(\d{2})-\d{2}_\d{4}-\d{2}-\d{2}\.csv(?: \(\d+\))?(?:\.zip)?$/i.exec(base);
  if (!m) {
    throw new ValidationError(
      `File name "${base}" does not match the Believe pattern <reportId>_<account>_<YYYY-MM-DD>_<YYYY-MM-DD>.csv.zip`,
    );
  }
  return {
    reportId: m[1] as string,
    account: m[2] as string,
    reportingMonth: assertMonth(`${m[3]}-${m[4]}`),
  };
}

/** 'YYYY/MM/DD' or 'YYYY-MM-DD' -> 'YYYY-MM'. */
function toMonth(raw: string, column: string, line: number): string {
  const m = /^(\d{4})[/-](\d{2})(?:[/-]\d{2})?$/.exec(raw.trim());
  if (!m) throw new ValidationError(`Line ${line}: invalid ${column} "${raw}"`);
  try {
    return assertMonth(`${m[1]}-${m[2]}`);
  } catch {
    throw new ValidationError(`Line ${line}: invalid ${column} "${raw}"`);
  }
}

export type ColumnIndex = Record<(typeof BELIEVE_COLUMNS)[number], number>;

export function indexHeader(header: string[]): ColumnIndex {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const trimmed = header.map(norm);
  const dup = trimmed.filter((h, i) => h && trimmed.indexOf(h) !== i);
  if (dup.length)
    throw new ValidationError(`Believe header has duplicated columns: ${[...new Set(dup)].join(', ')}`);
  const idx = {} as ColumnIndex;
  const missing: string[] = [];
  for (const col of BELIEVE_COLUMNS) {
    const i = trimmed.indexOf(norm(col));
    if (i < 0 && !OPTIONAL.has(col)) missing.push(col);
    idx[col] = i;
  }
  if (missing.length) throw new ValidationError(`Believe header is missing columns: ${missing.join(', ')}`);
  return idx;
}

/**
 * One report line as ClickHouse stores it (believe.rows): the columns of the report, dates as first-of-month
 * ISO dates, ISRC and UPC normalized, amounts as exact decimal text (never parsed into a number).
 */
export interface BelieveRecord {
  reporting_month: string;
  sales_month: string;
  platform: string;
  country_region: string;
  label_name: string;
  artist_name: string;
  release_title: string;
  track_title: string;
  upc: string;
  isrc: string;
  release_catalog_number: string;
  streaming_subscription_type: string;
  release_type: string;
  sales_type: string;
  quantity: string;
  client_payment_currency: string;
  unit_price: string;
  mechanical_fee: string;
  gross_revenue: string;
  client_share_rate: string;
  net_revenue: string;
}

/** Fits Decimal(38, 12): up to 20 integer digits and 12 decimals. Anything else goes the slow, checked way. */
const MONEY_RE = /^-?\d{1,20}(\.\d{1,12})?$/;
/** Fits Decimal(18, 8). */
const RATE_RE = /^-?\d{1,10}(\.\d{1,8})?$/;

function moneyText(raw: string, column: string, line: number): string {
  const t = raw.trim();
  if (MONEY_RE.test(t)) return t;
  try {
    return picoToString(parsePico(t)); // exponent notation, extra zeros; more than 12 real decimals is an error
  } catch (e) {
    throw new ValidationError(`Line ${line}: ${column}: ${(e as Error).message}`);
  }
}

function rateText(raw: string, column: string, line: number): string {
  const t = raw.trim();
  if (!RATE_RE.test(t)) throw new ValidationError(`Line ${line}: invalid ${column} "${raw}"`);
  return t;
}

/** An optional column that the report does not have is 0, a column that has an empty cell is an error. */
export function parseBelieveRecord(
  row: string[],
  idx: ColumnIndex,
  headerLength: number,
  line: number,
): BelieveRecord {
  if (row.length !== headerLength) {
    throw new ValidationError(`Line ${line}: ${row.length} fields, header has ${headerLength}`);
  }
  const get = (c: (typeof BELIEVE_COLUMNS)[number]) => {
    const i = idx[c];
    return i < 0 ? '' : (row[i] ?? '').trim();
  };
  const optional = (c: (typeof BELIEVE_COLUMNS)[number], parse: typeof moneyText) =>
    idx[c] < 0 ? '0' : parse(get(c), c, line);
  const qty = get('Quantity');
  if (!/^-?\d{1,18}$/.test(qty)) throw new ValidationError(`Line ${line}: invalid Quantity "${qty}"`);
  return {
    reporting_month: `${toMonth(get('Reporting month'), 'Reporting month', line)}-01`,
    sales_month: `${toMonth(get('Sales Month'), 'Sales Month', line)}-01`,
    platform: get('Platform'),
    country_region: get('Country / Region'),
    label_name: get('Label Name'),
    artist_name: get('Artist Name'),
    release_title: get('Release title'),
    track_title: get('Track title'),
    upc: normalizeUpc(get('UPC')),
    isrc: normalizeIsrc(get('ISRC')),
    release_catalog_number: get('Release Catalog nb'),
    streaming_subscription_type: get('Streaming Subscription Type'),
    release_type: get('Release type'),
    sales_type: get('Sales Type'),
    quantity: qty,
    client_payment_currency: get('Client Payment Currency').toUpperCase(),
    unit_price: optional('Unit Price', moneyText),
    mechanical_fee: optional('Mechanical Fee', moneyText),
    gross_revenue: moneyText(get('Gross Revenue'), 'Gross Revenue', line),
    client_share_rate: optional('Client share rate', rateText),
    net_revenue: moneyText(get('Net Revenue'), 'Net Revenue', line),
  };
}
