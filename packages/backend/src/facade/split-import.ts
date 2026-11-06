import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  SPLIT_IMPORT_COLUMNS,
  SPLIT_IMPORT_ISSUES,
  SPLIT_IMPORT_MAX_ROWS,
  SPLIT_IMPORT_SYNONYMS,
  type SplitImportAction,
  type SplitImportColumn,
  type SplitImportIssueCode,
} from '@erp/shared/split-import';
import { SPLIT_DOCUMENT_KINDS } from '@erp/shared/document-kinds';
import { AppError, RuleViolationError, ValidationError } from '../shared/errors';
import { assertDate, monthOf, monthStart } from '../shared/dates';
import { normalizeIsrc, normalizeName } from '../shared/identifiers';
import { Decimal, sum, ZERO } from '../shared/money';
import { parseCsv } from '../shared/csv';
import { cellText, memoryRows, readRows, type SheetRow } from '../shared/xlsx-rows';
import { artistIndexCache, cacheArtist, type ArtistIndexCache, type ArtistIndexEntry, type FacadeContext } from './context';
import type { splitsApi } from './splits';
import { ALL_VIEWER, type Viewer } from './viewer';

// The split import (D-172, P28): a csv / xlsx of artist rows becomes splits through the facade's own `createSplit` /
// `changeSplit` and the owners module's `createOwner` / `createArtist` / `assignArtistOwner`, never around them.
// One group (ISRC + floored `from`) = one split. The preview classifies the groups in file order over a model of the
// ISRC's splits that every earlier group updates (as the stage 4 loader's `ctx.model`); the apply repeats the
// classification inside ONE write transaction and writes everything or nothing.

const HUNDRED = new Decimal(100);
const LABEL_REQUIRED = 'Choose the own label of the import: ?label=';

type Issue = { code: SplitImportIssueCode; severity: 'error' | 'warning' | 'info'; details?: Record<string, unknown> };
const issue = (code: SplitImportIssueCode, details?: Record<string, unknown>): Issue => ({
  code,
  severity: SPLIT_IMPORT_ISSUES[code],
  ...(details ? { details } : {}),
});

type Cells = Partial<Record<SplitImportColumn, string>>;
interface RawRow {
  line: number;
  cells: Cells;
}

// ------------------------------------------------------------------ reading the file

const tooLarge = () =>
  new AppError(
    `The import holds more than ${SPLIT_IMPORT_MAX_ROWS} rows: split the file`,
    413,
    'import_too_large',
    { maxRows: SPLIT_IMPORT_MAX_ROWS },
  );

/** The header → column index; `import_header` when a required column is missing or a column is unknown. */
function headerColumns(header: string[]): Map<SplitImportColumn, number> {
  const known = new Set<string>(SPLIT_IMPORT_COLUMNS.map((c) => c.name));
  const cols = new Map<SplitImportColumn, number>();
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (!h) return;
    const name = (SPLIT_IMPORT_SYNONYMS[h] ?? h) as SplitImportColumn;
    if (!known.has(name) || cols.has(name)) unknown.push(raw.trim());
    else cols.set(name, i);
  });
  const missing = SPLIT_IMPORT_COLUMNS.filter((c) => c.required && !cols.has(c.name)).map((c) => c.name);
  if (missing.length > 0 || unknown.length > 0)
    throw new ValidationError(
      `The header of the import does not fit the template${missing.length ? `: missing ${missing.join(', ')}` : ''}${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}`,
      { missing, unknown },
      'import_header',
    );
  return cols;
}

function cellsOf(values: string[], cols: Map<SplitImportColumn, number>): Cells {
  const out: Cells = {};
  for (const [name, i] of cols) out[name] = (values[i] ?? '').trim();
  return out;
}

/** `;` or `,`: whichever the header line holds more of. */
export async function csvDelimiter(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const first = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? '';
    const count = (c: string) => first.split(c).length - 1;
    return count(';') > count(',') ? ';' : ',';
  } finally {
    await fh.close();
  }
}

async function readCsv(path: string): Promise<RawRow[]> {
  const out: RawRow[] = [];
  let cols: Map<SplitImportColumn, number> | undefined;
  let line = 0;
  for await (const record of parseCsv(createReadStream(path), await csvDelimiter(path))) {
    line++;
    if (!cols) {
      cols = headerColumns(record);
      continue;
    }
    if (record.every((v) => v.trim() === '')) continue;
    if (out.length >= SPLIT_IMPORT_MAX_ROWS) throw tooLarge();
    out.push({ line, cells: cellsOf(record, cols) });
  }
  if (!cols) throw new ValidationError('The import file is empty', { missing: [], unknown: [] }, 'import_header');
  return out;
}

/** An xlsx cell as text: a number by its 15 reliable significant digits (never a float rounding), else `cellText`. */
const xlsxText = (v: SheetRow['values'][number]): string =>
  typeof v === 'number' ? new Decimal(v).toSignificantDigits(15).toFixed() : cellText(v);

/** The first sheet; the header is its first non-empty row. */
async function readXlsxFrom(rows: AsyncGenerator<SheetRow>): Promise<RawRow[]> {
  const out: RawRow[] = [];
  let cols: Map<SplitImportColumn, number> | undefined;
  for await (const r of rows) {
    if (r.sheet !== 1) break;
    const values = r.values.slice(1).map(xlsxText);
    if (values.every((v) => v === '')) continue;
    if (!cols) {
      cols = headerColumns(values);
      continue;
    }
    if (out.length >= SPLIT_IMPORT_MAX_ROWS) throw tooLarge();
    out.push({ line: r.number, cells: cellsOf(values, cols) });
  }
  if (!cols) throw new ValidationError('The import file is empty', { missing: [], unknown: [] }, 'import_header');
  return out;
}

async function readXlsx(path: string): Promise<RawRow[]> {
  try {
    return await readXlsxFrom(readRows(path));
  } catch (e) {
    // the archive may put sharedStrings.xml after the sheets: the streamed header is unresolved, read it in memory
    if (e instanceof AppError && e.code === 'import_header') return readXlsxFrom(memoryRows(path));
    throw e;
  }
}

/** The data rows of an import file (csv or xlsx) by its name. */
export async function readSplitImportFile(path: string, fileName: string): Promise<RawRow[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return readCsv(path);
  if (lower.endsWith('.xlsx')) return readXlsx(path);
  throw new ValidationError('The import file must be a .csv or an .xlsx');
}

export async function sha256Of(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

// ------------------------------------------------------------------ classification

/** `YYYY-MM-DD` or `YYYY-MM`, floored to the month start (M52); undefined = not a date. */
function floorDate(raw: string): string | undefined {
  const s = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  try {
    return monthStart(monthOf(assertDate(s)));
  } catch {
    return undefined;
  }
}

/** A percent as the splits module takes it: 0 < p ≤ 100, at most 6 decimals (a decimal comma is accepted). */
function parsePercent(raw: string): string | undefined {
  const s = raw.replace(',', '.').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return undefined;
  const d = new Decimal(s);
  if (d.lte(0) || d.gt(HUNDRED)) return undefined;
  return d.toFixed();
}

const wordsKey = (s: string) => normalizeName(s).split(' ').filter(Boolean).sort().join(' ');

interface ModelRow {
  artistId: string;
  percent: string;
  documentId: string | null;
}
interface ModelSplit {
  from: string;
  to: string | null;
  documentId: string | null;
  rows: ModelRow[];
}
const covers = (s: { from: string; to: string | null }, d: string) => s.from <= d && (s.to === null || d < s.to);
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string | null }) =>
  a.from < (b.to ?? '9999-12-31') && b.from < (a.to ?? '9999-12-31');

interface RowState {
  line: number;
  cells: Cells;
  isrc: string | null;
  percent: string | null;
  fromFloored: string | null;
  toFloored: string | null;
  /** The existing pseudonym (surviving id), or the key `new:<norm>` of one the import creates. */
  artistKey: string | null;
  newPseudonym: string | null;
  owner: { kind: 'found'; id: string } | { kind: 'new'; norm: string; name: string } | null;
  ownerAssign: boolean;
  documentId: string | null;
  group: string;
  /** The «100 % label» row (D-175): no pseudonym, percent 100. */
  labelOnly: boolean;
  issues: Issue[];
}

interface GroupState {
  key: string;
  isrc: string;
  from: string;
  to: string | null;
  rows: RowState[];
  action: SplitImportAction;
  ourShare: string;
  documentId: string | null;
  before: { artistId: string; pseudonym: string; percent: string; documentId: string | null }[] | null;
  /** The rows the write passes (artist key, percent, the row's document). */
  shares: ModelRow[];
  note: string | null;
}

/** What the classification reads: one consistent picture (a snapshot for the preview, the transaction for the apply). */
interface World {
  index: Map<string, ArtistIndexEntry>;
  owners: { id: string; name: string; aliases: string[] }[];
  documents: { id: string; kind: string; title: string; labelId: string | null }[];
  splits: { isrc: string; validFrom: string; validTo: string | null; documentId: string | null; shares: ModelRow[] }[];
  participations: { id: string; isrc: string; artistId: string; validFrom: string; validTo: string | null }[];
}

interface Books {
  /** The ISRCs in the files of the import's label. */
  own: Set<string>;
  /** ISRC → the label of another book that has it (`null` = a file without a label). */
  other: Map<string, { labelId: string | null; labelName: string | null }>;
}

interface Classified {
  rows: RowState[];
  groups: GroupState[];
  /** New owners and pseudonyms in the order of their first row. */
  newOwners: { norm: string; name: string }[];
  newArtists: { norm: string; pseudonym: string; ownerKey: string | null }[];
  /** Existing pseudonyms that get an owner: artist id → owner key (`id` or `new:<norm>`). */
  assigns: Map<string, string>;
}

function classify(
  raw: RawRow[],
  w: World,
  ctx: {
    labelId: string;
    books: Books;
    /** a viewer of some labels (D-171): the ISRC rule, the owners it reaches; undefined = every label */
    viewer?: { mayTouch: (isrc: string) => boolean; ownerReachable: (id: string) => boolean };
  },
): Classified {
  const { index } = w;
  // live pseudonyms by normalised name and by the words of the name
  const live = [...index.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a);
  const byNorm = new Map<string, ArtistIndexEntry[]>();
  const byWords = new Map<string, ArtistIndexEntry[]>();
  for (const a of live) {
    const n = normalizeName(a.pseudonym);
    if (!n) continue;
    byNorm.set(n, [...(byNorm.get(n) ?? []), a]);
    const k = wordsKey(a.pseudonym);
    byWords.set(k, [...(byWords.get(k) ?? []), a]);
  }
  const ownersByNorm = new Map<string, Set<string>>();
  const ownersByWords = new Map<string, Set<string>>();
  const ownerName = new Map<string, string>();
  for (const o of w.owners) {
    ownerName.set(o.id, o.name);
    for (const n of [o.name, ...o.aliases]) {
      const k = normalizeName(n);
      if (k) ownersByNorm.set(k, (ownersByNorm.get(k) ?? new Set()).add(o.id));
      const wk = wordsKey(n);
      if (wk.includes(' ')) ownersByWords.set(wk, (ownersByWords.get(wk) ?? new Set()).add(o.id));
    }
  }
  const docsById = new Map(w.documents.map((d) => [d.id, d]));
  const docsByTitle = new Map<string, typeof w.documents>();
  for (const d of w.documents) docsByTitle.set(d.title.trim(), [...(docsByTitle.get(d.title.trim()) ?? []), d]);
  const canon = (id: string) => index.get(id)?.id ?? id;
  const pseudonymOf = (id: string) => index.get(id)?.pseudonym ?? '?';

  // ---- rows
  const newOwners = new Map<string, { norm: string; name: string }>();
  const newArtists = new Map<string, { norm: string; pseudonym: string; ownerKey: string | null; lines: number[] }>();
  const assigns = new Map<string, string>();
  const rows: RowState[] = raw.map(({ line, cells }) => {
    const issues: Issue[] = [];
    const isrcRaw = cells.isrc ?? '';
    const pseudonym = cells.pseudonym ?? '';
    const percentRaw = cells.percent ?? '';
    const fromRaw = cells.from ?? '';
    const toRaw = cells.to ?? '';
    // the «100 % label» row (D-175): no pseudonym, percent 100 → a split without rows
    const labelOnly = !pseudonym && !cells.artist_id && !!isrcRaw && !!fromRaw && percentRaw.trim() !== '' && parsePercent(percentRaw) !== undefined && new Decimal(parsePercent(percentRaw) as string).eq(100);
    if (labelOnly) issues.push(issue('label_only'));
    else if (!isrcRaw || (!pseudonym && !cells.artist_id) || !percentRaw || !fromRaw) issues.push(issue('row_incomplete'));
    let isrc: string | null = null;
    if (isrcRaw) {
      const n = normalizeIsrc(isrcRaw);
      if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(n)) isrc = n;
      else issues.push(issue('isrc_invalid'));
    }
    const percent = percentRaw ? (parsePercent(percentRaw) ?? null) : null;
    if (percentRaw && percent === null) issues.push(issue('percent_invalid'));
    const fromFloored = fromRaw ? (floorDate(fromRaw) ?? null) : null;
    const toFloored = toRaw ? (floorDate(toRaw) ?? null) : null;
    if ((fromRaw && !fromFloored) || (toRaw && !toFloored)) issues.push(issue('date_invalid'));
    if ((fromFloored && fromFloored !== fromRaw) || (toFloored && toFloored !== toRaw))
      issues.push(issue('date_floored', { from: fromFloored, to: toFloored }));
    if (fromFloored && toFloored && toFloored <= fromFloored)
      issues.push(issue('empty_period', { from: fromFloored, to: toFloored }));

    // the pseudonym: artist_id, else the one live pseudonym of the name, else a new one
    let artistKey: string | null = null;
    let newPseudonym: string | null = null;
    let existing: ArtistIndexEntry | undefined;
    const artistIdRaw = cells.artist_id ?? '';
    if (artistIdRaw) {
      existing = index.get(artistIdRaw);
      if (!existing) issues.push(issue('artist_not_found', { artistId: artistIdRaw }));
    } else if (pseudonym) {
      const norm = normalizeName(pseudonym);
      const same = norm ? (byNorm.get(norm) ?? []) : [];
      if (same.length === 1) existing = same[0];
      else if (same.length > 1)
        issues.push(
          issue('pseudonym_ambiguous', {
            similar: same.map((a) => ({ id: a.id, name: a.pseudonym, matchedBy: ['pseudonym'], ownerId: a.ownerId })),
          }),
        );
      else if (norm) {
        newPseudonym = pseudonym;
        artistKey = `new:${norm}`;
        const similar = (byWords.get(wordsKey(pseudonym)) ?? []).map((a) => ({
          id: a.id,
          name: a.pseudonym,
          matchedBy: ['pseudonym words'],
          ownerId: a.ownerId,
        }));
        issues.push(issue('new_pseudonym', { similar }));
      } else issues.push(issue('row_incomplete'));
    }
    if (existing) {
      artistKey = existing.id;
      issues.push(issue('existing', { artistId: existing.id }));
    }

    // the owner: found by its name or alias (exactly one), else created (kind person)
    let owner: RowState['owner'] = null;
    const ownerRaw = cells.owner ?? '';
    if (ownerRaw) {
      const norm = normalizeName(ownerRaw);
      const found = [...(ownersByNorm.get(norm) ?? [])];
      if (!norm) issues.push(issue('row_incomplete'));
      else if (found.length > 1) issues.push(issue('owner_ambiguous', { candidates: found.map((id) => ({ id, name: ownerName.get(id) })) }));
      else if (found.length === 1) {
        const id = found[0] as string;
        if (ctx.viewer && !ctx.viewer.ownerReachable(id)) issues.push(issue('label_forbidden', { reason: 'owner' }));
        else {
          owner = { kind: 'found', id };
          issues.push(issue('owner_found', { ownerId: id }));
        }
      } else {
        owner = { kind: 'new', norm, name: ownerRaw };
        const similar = [...(ownersByWords.get(wordsKey(ownerRaw)) ?? [])].map((id) => ({
          id,
          name: ownerName.get(id),
          matchedBy: ['name words'],
        }));
        issues.push(issue('owner_new', { similar }));
      }
    }
    const ownerKey = owner ? (owner.kind === 'found' ? owner.id : `new:${owner.norm}`) : null;
    let ownerAssign = false;
    if (existing && owner) {
      if (existing.ownerId) {
        if (owner.kind === 'new' || owner.id !== existing.ownerId) issues.push(issue('owner_mismatch', { ownerId: existing.ownerId }));
      } else {
        const prev = assigns.get(existing.id);
        if (prev !== undefined && prev !== ownerKey) issues.push(issue('owner_mismatch'));
        else {
          assigns.set(existing.id, ownerKey as string);
          ownerAssign = true;
          issues.push(issue('owner_assign', { artistId: existing.id }));
          if (ctx.viewer) issues.push(issue('forbidden', { reason: 'owner_assign' }));
        }
      }
    }
    if (newPseudonym && artistKey) {
      const norm = artistKey.slice(4);
      const prev = newArtists.get(norm);
      if (!prev) newArtists.set(norm, { norm, pseudonym: newPseudonym, ownerKey, lines: [line] });
      else if (ownerKey !== null && prev.ownerKey !== null && prev.ownerKey !== ownerKey) issues.push(issue('owner_mismatch'));
      else if (ownerKey !== null) prev.ownerKey = ownerKey;
    }
    if (owner?.kind === 'new' && !newOwners.has(owner.norm)) newOwners.set(owner.norm, { norm: owner.norm, name: owner.name });

    // the document: an id, else the one document of that exact title
    let documentId: string | null = null;
    const docRaw = cells.document ?? '';
    if (docRaw) {
      const byTitle = docsByTitle.get(docRaw) ?? [];
      const d = docsById.get(docRaw) ?? (byTitle.length === 1 ? byTitle[0] : undefined);
      if (!d) issues.push(issue(byTitle.length > 1 ? 'document_ambiguous' : 'document_not_found', { document: docRaw }));
      else if (!(SPLIT_DOCUMENT_KINDS as readonly string[]).includes(d.kind)) issues.push(issue('document_kind', { kind: d.kind }));
      else if (d.labelId !== null && d.labelId !== ctx.labelId) issues.push(issue('document_other_label', { labelId: d.labelId }));
      else documentId = d.id;
    }

    const group = isrc && fromFloored ? `${isrc}|${fromFloored}` : `line:${line}`;
    return {
      line,
      cells,
      isrc,
      percent,
      fromFloored,
      toFloored,
      artistKey,
      newPseudonym,
      owner,
      ownerAssign,
      documentId,
      group,
      labelOnly,
      issues,
    };
  });

  // ---- groups, in the order of their first row, over the model of the ISRC's splits
  const model = new Map<string, ModelSplit[]>();
  for (const s of w.splits) {
    const list = model.get(s.isrc) ?? [];
    list.push({ from: s.validFrom, to: s.validTo, documentId: s.documentId, rows: s.shares.map((r) => ({ ...r, artistId: canon(r.artistId) })) });
    model.set(s.isrc, list);
  }
  const sortModel = (list: ModelSplit[]) => list.sort((a, b) => a.from.localeCompare(b.from));
  for (const list of model.values()) sortModel(list);
  const partsOf = new Map<string, World['participations']>();
  for (const p of w.participations) partsOf.set(p.isrc, [...(partsOf.get(p.isrc) ?? []), p]);

  const byGroup = new Map<string, RowState[]>();
  for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const groups: GroupState[] = [];
  for (const [key, members] of byGroup) {
    const first = members[0] as RowState;
    const g: GroupState = {
      key,
      isrc: first.isrc ?? (first.cells.isrc ?? ''),
      from: first.fromFloored ?? '',
      to: null,
      rows: members,
      action: 'blocked',
      ourShare: '100',
      documentId: null,
      before: null,
      shares: [],
      note: members.map((r) => r.cells.note ?? '').find((n) => n !== '') ?? null,
    };
    groups.push(g);
    const all = (i: Issue) => members.forEach((r) => r.issues.push(i));
    if (!first.isrc || !first.fromFloored) continue;
    const isrc = first.isrc;
    const from = first.fromFloored;
    // the end: every row of the group names the same one (or none)
    const tos = new Set(members.map((r) => r.toFloored ?? ''));
    if (tos.size > 1) all(issue('date_invalid', { reason: 'to_differs_in_group' }));
    g.to = first.toFloored;
    // the label: the ISRC in the files of the label, in another book (a warning; a viewer of some labels: its rule)
    if (!ctx.books.own.has(isrc)) {
      const other = ctx.books.other.get(isrc);
      all(issue('isrc_outside_label', other ? { book: 'other', labelId: other.labelId, labelName: other.labelName } : { book: 'none' }));
    }
    if (ctx.viewer && !ctx.viewer.mayTouch(isrc)) all(issue('label_forbidden', { reason: 'isrc' }));
    // the rows: one artist once, the sum ≤ 100; a «100 % label» row is alone in its group (D-175)
    const labelGroup = members.some((r) => r.labelOnly);
    if (labelGroup && members.length > 1) {
      all(issue('label_row_with_rows'));
      continue;
    }
    const keys = members.map((r) => r.artistKey);
    const seen = new Set<string>();
    for (const r of members) {
      if (!r.artistKey) continue;
      if (seen.has(r.artistKey)) r.issues.push(issue('duplicate_artist'));
      seen.add(r.artistKey);
    }
    if (!labelGroup && (keys.some((k) => !k) || members.some((r) => r.percent === null))) continue; // nothing to classify
    const total = labelGroup ? ZERO : sum(members.map((r) => new Decimal(r.percent as string)));
    g.ourShare = HUNDRED.sub(total).toFixed();
    if (total.gt(HUNDRED)) all(issue('split_sum_above_100', { sum: total.toFixed() }));
    else if (total.lt(HUNDRED) && !labelGroup) all(issue('our_share', { ourShare: g.ourShare }));
    // the document of the split: every row names the same one; else each row keeps its own
    const docs = new Set(members.map((r) => r.documentId));
    const common = docs.size === 1 ? (members[0]?.documentId ?? null) : null;
    g.documentId = common;
    const wanted: ModelRow[] = labelGroup
      ? []
      : members.map((r) => ({
          artistId: r.artistKey as string,
          percent: r.percent as string,
          documentId: common ? null : r.documentId,
        }));

    const list = model.get(isrc) ?? [];
    let period: { from: string; to: string | null };
    let intended: 'create' | 'change' | 'unchanged';
    const current = list.find((s) => covers(s, from));
    if (list.length === 0) {
      // as the loader: an ISRC without any split is created
      intended = 'create';
      period = { from, to: g.to };
      g.shares = wanted;
    } else if (
      current &&
      current.rows.length === wanted.length &&
      wanted.every((x) => current.rows.some((y) => y.artistId === x.artistId && new Decimal(y.percent).eq(x.percent)))
    ) {
      intended = 'unchanged';
      period = { from, to: current.to };
      all(issue('unchanged'));
    } else {
      intended = 'change';
      // the change lasts to the end of the split it replaces, or to the next split (splits.changeSplit)
      const to = current ? current.to : (list.map((s) => s.from).filter((d) => d > from).sort()[0] ?? null);
      period = { from, to };
      g.before = current
        ? current.rows.map((r) => ({ artistId: r.artistId, pseudonym: pseudonymOf(r.artistId), percent: r.percent, documentId: r.documentId }))
        : null;
      all(issue('replaces', { from, before: g.before }));
      if (g.to !== null) all(issue('to_on_change'));
      if (!common) all(issue('document_required'));
      if (ctx.viewer) all(issue('forbidden', { reason: 'change' }));
      // a row with the same percent as before keeps its document (the loader's `keepRowDocs … 'same_percent'`)
      g.shares = wanted.map((x) => {
        const prev = current?.rows.find((y) => y.artistId === x.artistId);
        const keep = prev && new Decimal(prev.percent).eq(x.percent);
        return { ...x, documentId: keep ? (prev.documentId ?? current?.documentId ?? null) : null };
      });
    }
    // a pseudonym is a row or a participation on an ISRC and date, never both (D-126)
    for (const r of members) {
      if (!r.artistKey || r.artistKey.startsWith('new:')) continue;
      const p = (partsOf.get(isrc) ?? []).find((x) => canon(x.artistId) === r.artistKey && overlaps({ from: x.validFrom, to: x.validTo }, period));
      if (p) r.issues.push(issue('double_participation', { from: p.validFrom }));
    }
    // the model as if the group were written: later groups of the ISRC see it
    if (intended === 'create') {
      list.push({ from, to: g.to, documentId: common, rows: g.shares });
      model.set(isrc, sortModel(list));
    } else if (intended === 'change') {
      if (current) current.to = from;
      list.push({ from, to: period.to, documentId: common, rows: g.shares });
      model.set(isrc, sortModel(list));
    }
    g.action = members.some((r) => r.issues.some((i) => i.severity === 'error')) ? 'blocked' : intended;
  }
  // a group with an error anywhere is blocked (its rows may have got errors after the group was classified)
  for (const g of groups) if (g.rows.some((r) => r.issues.some((i) => i.severity === 'error'))) g.action = 'blocked';

  return {
    rows,
    groups,
    newOwners: [...newOwners.values()],
    newArtists: [...newArtists.values()].map(({ norm, pseudonym, ownerKey }) => ({ norm, pseudonym, ownerKey })),
    assigns,
  };
}

// ------------------------------------------------------------------ the facade method

export function splitImportApi(ctx: FacadeContext, writes: Pick<ReturnType<typeof splitsApi>, 'createSplit' | 'changeSplit'>) {
  const { db, owners, splits, labels, sources, assertOwnLabel, scopeOf } = ctx;

  /** Where the ISRCs of the import already sit: the files of the label, of another label, of a file without one. */
  async function booksOf(labelId: string): Promise<Books> {
    const files = (await sources.listFiles()).filter((f) => f.status === 'loaded');
    const byLabel = new Map<string | null, string[]>();
    for (const f of files) byLabel.set(f.labelId, [...(byLabel.get(f.labelId) ?? []), f.id]);
    const own = new Set(await sources.isrcsOfFiles(byLabel.get(labelId) ?? []));
    const other = new Map<string, { labelId: string | null; labelName: string | null }>();
    for (const [id, fileIds] of byLabel) {
      if (id === labelId) continue;
      const labelName = id ? (await labels.getLabel(id)).name : null;
      for (const isrc of await sources.isrcsOfFiles(fileIds)) if (!other.has(isrc)) other.set(isrc, { labelId: id, labelName });
    }
    return { own, other };
  }

  async function worldOf(raw: RawRow[], index: Map<string, ArtistIndexEntry>): Promise<World> {
    const isrcs = [...new Set(raw.map((r) => normalizeIsrc(r.cells.isrc)).filter((x) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(x)))];
    const [ownerList, documents, splitList, parts] = await Promise.all([
      owners.listOwners(),
      owners.listDocuments(),
      isrcs.length ? splits.listSplits({ isrcs }) : Promise.resolve([]),
      isrcs.length ? splits.listParticipations({ isrcs }) : Promise.resolve([]),
    ]);
    return {
      index,
      owners: ownerList.map((o) => ({ id: o.id, name: o.name, aliases: o.aliases })),
      documents: documents.map((d) => ({ id: d.id, kind: d.kind, title: d.title, labelId: d.labelId })),
      splits: splitList.map((s) => ({
        isrc: s.isrc,
        validFrom: s.validFrom,
        validTo: s.validTo,
        documentId: s.documentId,
        shares: s.shares.map((x) => ({ artistId: x.artistId, percent: x.percent, documentId: x.documentId })),
      })),
      participations: parts.map((p) => ({ id: p.id, isrc: p.isrc, artistId: p.artistId, validFrom: p.validFrom, validTo: p.validTo })),
    };
  }

  function answer(
    c: Classified,
    meta: { labelId: string; fileName: string; sha256: string; dryRun: boolean },
    result: { splitIds: string[]; artistIds: string[]; ownerIds: string[] } | null,
  ) {
    const issues = c.rows.flatMap((r) => r.issues);
    const count = (a: SplitImportAction) => c.groups.filter((g) => g.action === a).length;
    return {
      labelId: meta.labelId,
      fileName: meta.fileName,
      sha256: meta.sha256,
      dryRun: meta.dryRun,
      applied: result !== null,
      totals: {
        rows: c.rows.length,
        groups: c.groups.length,
        create: count('create'),
        change: count('change'),
        unchanged: count('unchanged'),
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        artistsNew: c.newArtists.length,
        ownersNew: c.newOwners.length,
      },
      rows: c.rows.map((r) => ({
        line: r.line,
        isrc: r.isrc ?? (r.cells.isrc ?? ''),
        pseudonym: r.cells.pseudonym ?? '',
        artistId: r.artistKey && !r.artistKey.startsWith('new:') ? r.artistKey : null,
        percent: r.percent ?? (r.cells.percent ?? ''),
        from: r.cells.from ?? '',
        fromFloored: r.fromFloored,
        to: r.cells.to ? r.cells.to : null,
        toFloored: r.toFloored,
        owner: r.cells.owner ? r.cells.owner : null,
        documentId: r.documentId,
        group: r.group,
        issues: r.issues,
      })),
      groups: c.groups.map((g) => ({
        key: g.key,
        isrc: g.isrc,
        from: g.from,
        to: g.to,
        action: g.action,
        ourShare: g.ourShare,
        documentId: g.documentId,
        before: g.before,
      })),
      result,
    };
  }

  const api = {
    /**
     * The split import (D-172): `dryRun` = the preview (one snapshot, nothing written); else the apply in ONE write
     * transaction (`createOwner` / `createArtist` / `assignArtistOwner`, then `createSplit` / `changeSplit` per group in
     * file order, with the pseudonym index of the transaction): any error row = 422 `import_invalid` with
     * `details.rows`, a refusal of the facade while writing = 422 `import_invalid` with `details.group` and
     * `details.cause`; nothing is written either way. A viewer of some labels (D-171) may only create: a change or an
     * owner assignment is a `forbidden` row, an ISRC of another book `label_forbidden`; the import itself applies the
     * ISRC and document rules, so the writes inside run as `ALL_VIEWER`.
     */
    async importSplits(
      input: { path: string; fileName: string; labelId: string | undefined; dryRun: boolean },
      viewer: Viewer = ALL_VIEWER,
    ) {
      if (!input.labelId) throw new ValidationError(LABEL_REQUIRED, undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      const raw = await readSplitImportFile(input.path, input.fileName);
      const sha256 = await sha256Of(input.path);
      const books = await booksOf(label.id);
      let scope: { mayTouch: (isrc: string) => boolean; ownerReachable: (id: string) => boolean } | undefined;
      if (viewer.kind !== 'all') {
        const s = scopeOf(viewer);
        const mayTouch = await s.isrcFilter();
        // the owners the file names, read once (a found owner must be visible under the viewer's labels or new)
        const reachable = new Set<string>();
        const names = new Set(raw.map((r) => normalizeName(r.cells.owner ?? '')).filter(Boolean));
        for (const o of await owners.listOwners())
          if ([o.name, ...o.aliases].some((n) => names.has(normalizeName(n))) && (await s.ownerReachable(o.id))) reachable.add(o.id);
        scope = { mayTouch, ownerReachable: (id) => reachable.has(id) };
      }
      const meta = { labelId: label.id, fileName: input.fileName, sha256, dryRun: input.dryRun };
      const run = (index: Map<string, ArtistIndexEntry>) =>
        worldOf(raw, index).then((w) => classify(raw, w, { labelId: label.id, books, ...(scope ? { viewer: scope } : {}) }));

      if (input.dryRun) {
        const c = await db.snapshot(async () => run(await owners.artistIndex()));
        return answer(c, meta, null);
      }

      return db.transaction(async () => {
        const cache: ArtistIndexCache = await artistIndexCache(owners);
        const c = await run(cache.map);
        const errors = c.rows.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => ({ line: r.line, code: i.code })));
        if (errors.length > 0)
          throw new RuleViolationError(
            `The import has ${errors.length} errors: fix the file and preview it again`,
            'import_invalid',
            { rows: errors.slice(0, 200), errors: errors.length },
          );
        const result = { splitIds: [] as string[], artistIds: [] as string[], ownerIds: [] as string[] };
        const ownerIds = new Map<string, string>(); // owner key → id
        const artistIds = new Map<string, string>(); // `new:<norm>` → id
        const newArtist = new Map(c.newArtists.map((a) => [`new:${a.norm}`, a]));
        const newOwner = new Map(c.newOwners.map((o) => [`new:${o.norm}`, o]));
        const assigned = new Set<string>();
        const ownerOf = async (key: string): Promise<string> => {
          if (!key.startsWith('new:')) return key;
          const known = ownerIds.get(key);
          if (known) return known;
          const o = newOwner.get(key) as { name: string };
          const id = (await owners.createOwner({ name: o.name, kind: 'person', origin: 'import' })).id;
          ownerIds.set(key, id);
          result.ownerIds.push(id);
          return id;
        };
        const artistOf = async (key: string): Promise<string> => {
          if (!key.startsWith('new:')) return key;
          const known = artistIds.get(key);
          if (known) return known;
          const a = newArtist.get(key) as { pseudonym: string; ownerKey: string | null };
          const ownerId = a.ownerKey ? await ownerOf(a.ownerKey) : null;
          const created = await owners.createArtist({ pseudonym: a.pseudonym, ownerId, origin: 'import' });
          cacheArtist(cache, created);
          artistIds.set(key, created.id);
          result.artistIds.push(created.id);
          return created.id;
        };
        for (const g of c.groups) {
          if (g.action === 'blocked') continue;
          try {
            // an owner the preview promised is assigned in every group, an `unchanged` one too
            for (const r of g.rows) {
              if (r.ownerAssign && r.artistKey && !assigned.has(r.artistKey)) {
                const ownerId = await ownerOf(c.assigns.get(r.artistKey) as string);
                await owners.assignArtistOwner(r.artistKey, ownerId);
                const entry = cache.map.get(r.artistKey);
                if (entry) cacheArtist(cache, { ...entry, ownerId });
                assigned.add(r.artistKey);
              }
            }
            if (g.action !== 'create' && g.action !== 'change') continue;
            const shares = [];
            for (const s of g.shares) shares.push({ artistId: await artistOf(s.artistId), percent: s.percent, documentId: s.documentId });
            const written =
              g.action === 'create'
                ? await writes.createSplit(
                    { isrc: g.isrc, validFrom: g.from, validTo: g.to, shares, documentId: g.documentId, note: g.note, origin: 'import' },
                    ALL_VIEWER,
                    { index: cache },
                  )
                : await writes.changeSplit(
                    { isrc: g.isrc, from: g.from, shares, documentId: g.documentId as string, note: g.note, origin: 'import' },
                    ALL_VIEWER,
                    { index: cache },
                  );
            result.splitIds.push(written.id);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            throw new RuleViolationError(
              `The import stopped at the group ${g.key}: ${e.message}; nothing was written`,
              'import_invalid',
              { group: g.key, cause: e.code },
            );
          }
        }
        return answer(c, meta, result);
      });
    },
  };
  return api;
}
