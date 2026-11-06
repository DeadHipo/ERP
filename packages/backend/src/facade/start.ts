import { createReadStream } from 'node:fs';
import {
  START_IMPORT_COLUMNS,
  START_IMPORT_ISSUES,
  START_IMPORT_MAX_ROWS,
  type OpeningBalanceKind,
  type StartImportAction,
  type StartImportColumn,
  type StartImportIssueCode,
} from '@erp/shared/start-import';
import type { OpeningBalanceView, OperationView } from '../modules/settlements';
import { AppError, RuleViolationError, ValidationError } from '../shared/errors';
import { assertMonth, normalizeTimestamp } from '../shared/dates';
import { normalizeName } from '../shared/identifiers';
import { centsToDecimal, decimalToCents, Decimal, ZERO } from '../shared/money';
import { parseCsv } from '../shared/csv';
import type { ArtistIndexEntry, FacadeContext } from './context';
import { csvDelimiter, sha256Of } from './split-import';
import { ALL_VIEWER, assertViewerHolds, type Viewer } from './viewer';

// The opening balances (D-174, the cut of 15.10.2026): the approved position of every pseudonym in the book of a label
// at the cut, instead of the recalculated history (`balance.ts` drops the inputs of the book up to the cut and adds the
// start). The rows come from a csv (`START_IMPORT_COLUMNS`): the preview classifies them in one snapshot, the apply
// repeats the classification inside ONE write transaction and writes everything or nothing through the settlements
// module. A row is never edited: a correction is a new `adjustment` row, an error is a soft rollback.

const LABEL_REQUIRED = 'Choose the own label of the start: ?label=';

type Issue = { code: StartImportIssueCode; severity: 'error' | 'warning' | 'info'; details?: Record<string, unknown> };
const issue = (code: StartImportIssueCode, details?: Record<string, unknown>): Issue => ({
  code,
  severity: START_IMPORT_ISSUES[code],
  ...(details ? { details } : {}),
});

type Cells = Partial<Record<StartImportColumn, string>>;
interface RawRow {
  line: number;
  cells: Cells;
}

const tooLarge = () =>
  new AppError(`The import holds more than ${START_IMPORT_MAX_ROWS} rows: split the file`, 413, 'import_too_large', { maxRows: START_IMPORT_MAX_ROWS });

function headerColumns(header: string[]): Map<StartImportColumn, number> {
  const known = new Set<string>(START_IMPORT_COLUMNS.map((c) => c.name));
  const cols = new Map<StartImportColumn, number>();
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (!h) return;
    if (!known.has(h) || cols.has(h as StartImportColumn)) unknown.push(raw.trim());
    else cols.set(h as StartImportColumn, i);
  });
  const missing = START_IMPORT_COLUMNS.filter((c) => c.required && !cols.has(c.name)).map((c) => c.name);
  if (missing.length > 0 || unknown.length > 0)
    throw new ValidationError(
      `The header of the import does not fit the template${missing.length ? `: missing ${missing.join(', ')}` : ''}${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}`,
      { missing, unknown },
      'import_header',
    );
  return cols;
}

/** The data rows of a start file (csv only: `;` or `,`, a BOM, quotes). */
export async function readStartImportFile(path: string, fileName: string): Promise<RawRow[]> {
  if (!fileName.toLowerCase().endsWith('.csv')) throw new ValidationError('The start import file must be a .csv');
  const out: RawRow[] = [];
  let cols: Map<StartImportColumn, number> | undefined;
  let line = 0;
  for await (const record of parseCsv(createReadStream(path), await csvDelimiter(path))) {
    line++;
    if (!cols) {
      cols = headerColumns(record);
      continue;
    }
    if (record.every((v) => v.trim() === '')) continue;
    if (out.length >= START_IMPORT_MAX_ROWS) throw tooLarge();
    const cells: Cells = {};
    for (const [name, i] of cols) cells[name] = (record[i] ?? '').trim();
    out.push({ line, cells });
  }
  if (!cols) throw new ValidationError('The import file is empty', { missing: [], unknown: [] }, 'import_header');
  return out;
}

/** Whole cents, `.` or `,` as the decimal mark, spaces as thousands separators; undefined = not an amount; null = empty. */
function parseAmount(raw: string): Decimal | null | undefined {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return new Decimal(s);
}

/** `1`, `yes`, `true`, `да` = true; empty, `0`, `no`, `false`, `нет` = false; else undefined. */
function parseFlag(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (s === '' || s === '0' || s === 'no' || s === 'false' || s === 'нет') return false;
  if (s === '1' || s === 'yes' || s === 'true' || s === 'да') return true;
  return undefined;
}

interface RowState {
  line: number;
  cells: Cells;
  kind: OpeningBalanceKind | null;
  artistId: string | null;
  ownerId: string | null;
  master: Decimal | null;
  publishing: Decimal | null;
  missing: boolean;
  basis: string | null;
  documentId: string | null;
  operationRef: string | null;
  action: StartImportAction;
  issues: Issue[];
}

interface World {
  index: Map<string, ArtistIndexEntry>;
  resolveOwner: (id: string) => string;
  documents: { id: string; title: string }[];
  operations: OperationView[];
  existing: OpeningBalanceView[];
  confirmedUnder: (ownerId: string) => Promise<boolean>;
}

const cents = (d: Decimal) => d.mul(100).toFixed(0);

function classify(
  raw: RawRow[],
  w: World,
  ctx: { labelId: string; cutoff: string; syncedDay: string; defaultBasis: string | null },
): Promise<RowState[]> {
  const live = [...w.index.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a);
  const artistsByNorm = new Map<string, ArtistIndexEntry[]>();
  for (const a of live) {
    const n = normalizeName(a.pseudonym);
    if (n) artistsByNorm.set(n, [...(artistsByNorm.get(n) ?? []), a]);
  }
  const docsById = new Map(w.documents.map((d) => [d.id, d]));
  const docsByTitle = new Map<string, typeof w.documents>();
  for (const d of w.documents) docsByTitle.set(d.title.trim(), [...(docsByTitle.get(d.title.trim()) ?? []), d]);
  const opsById = new Map(w.operations.map((o) => [o.id, o]));
  const canon = (id: string) => w.index.get(id)?.id ?? id;
  // the active rows of the book at this cut, by pseudonym
  const existingStart = new Map<string, OpeningBalanceView>();
  const existingAdjust = new Set<string>();
  for (const r of w.existing) {
    if (!r.active || r.labelId !== ctx.labelId || r.cutoffMonth !== ctx.cutoff) continue;
    const a = canon(r.artistId);
    if (r.kind === 'start') existingStart.set(a, r);
    else existingAdjust.add([a, r.masterCents, r.publishingCents, r.basis].join('|'));
  }
  const seenStart = new Map<string, number>();
  const confirmed = new Map<string, boolean>();

  return (async () => {
    const out: RowState[] = [];
    for (const { line, cells } of raw) {
      const issues: Issue[] = [];
      // the kind
      const kindRaw = (cells.kind ?? '').trim().toLowerCase();
      let kind: OpeningBalanceKind | null = null;
      if (kindRaw === '' || kindRaw === 'start') kind = 'start';
      else if (kindRaw === 'adjustment') kind = 'adjustment';
      else issues.push(issue('kind_unknown', { kind: cells.kind ?? '' }));

      // the pseudonym: an id (merged ids too) or the one live pseudonym of the exact name
      let artistId: string | null = null;
      let ownerId: string | null = null;
      const pseudonymRaw = cells.pseudonym ?? '';
      const byId = w.index.get(pseudonymRaw);
      const found = byId ? [byId] : (artistsByNorm.get(normalizeName(pseudonymRaw)) ?? []);
      if (found.length === 1) {
        const a = found[0] as ArtistIndexEntry;
        artistId = a.id;
        if (!a.ownerId) issues.push(issue('artist_without_owner', { artistId: a.id }));
        else ownerId = w.resolveOwner(a.ownerId);
      } else if (found.length > 1)
        issues.push(issue('pseudonym_ambiguous', { candidates: found.map((a) => ({ id: a.id, name: a.pseudonym, ownerId: a.ownerId })) }));
      else issues.push(issue('pseudonym_not_found', { pseudonym: pseudonymRaw }));

      // the amounts and the flag
      const masterParsed = parseAmount(cells.master ?? '');
      const pubParsed = parseAmount(cells.publishing ?? '');
      if (masterParsed === undefined || pubParsed === undefined) issues.push(issue('amount_invalid'));
      const flag = parseFlag(cells.missing ?? '');
      if (flag === undefined) issues.push(issue('missing_invalid', { missing: cells.missing ?? '' }));
      const missing = flag === true;
      let master: Decimal | null = masterParsed ?? null;
      let publishing: Decimal | null = pubParsed ?? null;
      if (masterParsed !== undefined && pubParsed !== undefined) {
        if (missing) {
          if (kind !== 'start' || (master && !master.isZero()) || (publishing && !publishing.isZero())) issues.push(issue('missing_with_amount'));
          master = ZERO;
          publishing = ZERO;
        } else {
          if (master === null && publishing === null) issues.push(issue('amount_required'));
          master = master ?? ZERO;
          publishing = publishing ?? ZERO;
          if (kind === 'adjustment' && master.isZero() && publishing.isZero()) issues.push(issue('amount_required'));
        }
      }

      // the basis: the cell, else the request's default
      const basis = (cells.basis ?? '').trim() || ctx.defaultBasis;
      if (!basis) issues.push(issue('basis_required'));

      // the document: an id or the one exact title
      let documentId: string | null = null;
      const docRaw = (cells.document ?? '').trim();
      if (docRaw) {
        const byTitle = docsByTitle.get(docRaw) ?? [];
        const d = docsById.get(docRaw) ?? (byTitle.length === 1 ? byTitle[0] : undefined);
        if (!d) issues.push(issue(byTitle.length > 1 ? 'document_ambiguous' : 'document_not_found', { document: docRaw }));
        else documentId = d.id;
      }

      // the reopened advance: active, of the pseudonym's owner, in the book, dated inside the cut
      let operationRef: string | null = null;
      const opRaw = (cells.operation_ref ?? '').trim();
      if (opRaw) {
        const o = opsById.get(opRaw);
        if (!o || !o.active) issues.push(issue('operation_not_found', { operation: opRaw }));
        else if (o.kind !== 'advance') issues.push(issue('operation_not_advance', { operation: opRaw, kind: o.kind }));
        else if (ownerId && o.ownerId && w.resolveOwner(o.ownerId) !== ownerId) issues.push(issue('operation_other_owner', { operation: opRaw }));
        else if (o.labelId !== ctx.labelId) issues.push(issue('operation_forbidden', { operation: opRaw, labelId: o.labelId }));
        else if (o.date > ctx.syncedDay) issues.push(issue('operation_after_cut', { operation: opRaw, date: o.date }));
        else operationRef = o.id;
      }

      // one start per pseudonym in the file; a start already in the book: the same amounts = unchanged, else an error
      let unchanged = false;
      if (artistId && kind && master && publishing && !issues.some((i) => i.severity === 'error')) {
        if (kind === 'start') {
          const earlier = seenStart.get(artistId);
          if (earlier !== undefined) issues.push(issue('duplicate_in_file', { line: earlier }));
          else {
            seenStart.set(artistId, line);
            const have = existingStart.get(artistId);
            if (have) {
              if (String(have.masterCents) === cents(master) && String(have.publishingCents) === cents(publishing) && have.missing === missing) unchanged = true;
              else issues.push(issue('start_exists', { id: have.id, masterCents: have.masterCents, publishingCents: have.publishingCents, missing: have.missing }));
            }
          }
        } else if (existingAdjust.has([artistId, cents(master), cents(publishing), basis].join('|'))) unchanged = true;
        if (!unchanged && ownerId) {
          if (!confirmed.has(ownerId)) confirmed.set(ownerId, await w.confirmedUnder(ownerId));
          if (!confirmed.get(ownerId)) issues.push(issue('no_contract_for_label'));
        }
      }
      if (unchanged) issues.push(issue('unchanged'));
      const hasError = issues.some((i) => i.severity === 'error');
      out.push({
        line,
        cells,
        kind,
        artistId,
        ownerId,
        master,
        publishing,
        missing,
        basis,
        documentId,
        operationRef,
        action: hasError ? 'error' : unchanged ? 'unchanged' : 'create',
        issues,
      });
    }
    return out;
  })();
}

export function startApi(ctx: FacadeContext) {
  const { db, owners, settlements, assertOwnLabel, labels } = ctx;

  async function worldOf(labelId: string): Promise<World> {
    const [index, resolveOwner, documents, operations, existing] = await Promise.all([
      owners.artistIndex(),
      owners.ownerResolver(),
      owners.listDocuments(),
      settlements.listOperations({ active: true }),
      settlements.listOpeningBalances({ active: true }),
    ]);
    return {
      index,
      resolveOwner,
      documents: documents.map((d) => ({ id: d.id, title: d.title })),
      operations,
      existing,
      confirmedUnder: (ownerId) => owners.isOwnerConfirmedUnder(ownerId, labelId),
    };
  }

  function answer(
    rows: RowState[],
    meta: { labelId: string; cutoffMonth: string; syncedAt: string; fileName: string; sha256: string; dryRun: boolean },
    result: { ids: string[] } | null,
  ) {
    const issues = rows.flatMap((r) => r.issues);
    const creating = rows.filter((r) => r.action === 'create');
    const sumOf = (pick: (r: RowState) => Decimal | null) => creating.reduce((s, r) => s.add(pick(r) ?? ZERO), ZERO);
    return {
      ...meta,
      applied: result !== null,
      totals: {
        rows: rows.length,
        create: creating.length,
        unchanged: rows.filter((r) => r.action === 'unchanged').length,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        starts: creating.filter((r) => r.kind === 'start').length,
        adjustments: creating.filter((r) => r.kind === 'adjustment').length,
        missing: creating.filter((r) => r.missing).length,
        master: sumOf((r) => r.master).toFixed(),
        publishing: sumOf((r) => r.publishing).toFixed(),
      },
      rows: rows.map((r) => ({
        line: r.line,
        pseudonym: r.cells.pseudonym ?? '',
        artistId: r.artistId,
        ownerId: r.ownerId,
        kind: r.cells.kind?.trim() || 'start',
        master: r.master ? r.master.toFixed() : null,
        publishing: r.publishing ? r.publishing.toFixed() : null,
        missing: r.missing,
        documentId: r.documentId,
        operationRef: r.operationRef,
        action: r.action,
        issues: r.issues,
      })),
      result,
    };
  }

  const api = {
    /**
     * The import of the opening balances (D-174): `dryRun` = the preview (one snapshot, nothing written, no audit row);
     * else the apply in ONE write transaction through `settlements.createOpeningBalance` row by row (all or nothing:
     * `422 import_invalid` with `details.rows` or `details.line` + `details.cause`). The ability is `pay`.
     */
    async importStart(input: {
      path: string;
      fileName: string;
      labelId: string | undefined;
      cutoff: string;
      syncedAt: string;
      dryRun: boolean;
      basis?: string | undefined;
    }) {
      if (!input.labelId) throw new ValidationError(LABEL_REQUIRED, undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      const cutoff = assertMonth(input.cutoff);
      const syncedAt = normalizeTimestamp(input.syncedAt);
      if (syncedAt.slice(0, 7) < cutoff) throw new ValidationError('The synchronisation is not before the cut month', undefined, 'synced_before_cutoff');
      const raw = await readStartImportFile(input.path, input.fileName);
      const sha256 = await sha256Of(input.path);
      const defaultBasis = input.basis?.trim() || null;
      const meta = { labelId: label.id, cutoffMonth: cutoff, syncedAt, fileName: input.fileName, sha256, dryRun: input.dryRun };
      const run = async () => classify(raw, await worldOf(label.id), { labelId: label.id, cutoff, syncedDay: syncedAt.slice(0, 10), defaultBasis });

      if (input.dryRun) return answer(await db.snapshot(run), meta, null);

      return db.transaction(async () => {
        const rows = await run();
        const errors = rows.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => ({ line: r.line, code: i.code })));
        if (errors.length > 0)
          throw new RuleViolationError(`The import has ${errors.length} errors: fix the file and preview it again`, 'import_invalid', {
            rows: errors.slice(0, 200),
            errors: errors.length,
          });
        const ids: string[] = [];
        for (const r of rows) {
          if (r.action !== 'create') continue;
          try {
            const row = await settlements.createOpeningBalance({
              labelId: label.id,
              artistId: r.artistId as string,
              kind: r.kind as OpeningBalanceKind,
              cutoffMonth: cutoff,
              syncedAt,
              masterCents: decimalToCents(r.master as Decimal),
              publishingCents: decimalToCents(r.publishing as Decimal),
              missing: r.missing,
              basis: r.basis as string,
              documentId: r.documentId,
              operationRef: r.operationRef,
              comment: r.cells.comment ? r.cells.comment : `Imported from ${input.fileName}, line ${r.line}`,
            });
            ids.push(row.id);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            throw new RuleViolationError(`The import stopped at line ${r.line}: ${e.message}; nothing was written`, 'import_invalid', {
              line: r.line,
              cause: e.code,
            });
          }
        }
        return answer(rows, meta, { ids });
      });
    },

    /** The opening balances of a book (or of every book) with their pseudonyms, owners and sums (D-174). */
    async listStart(input: { labelId?: string | undefined; active?: boolean | undefined } = {}, viewer: Viewer = ALL_VIEWER) {
      const label = input.labelId ? await assertOwnLabel(input.labelId) : null;
      if (viewer.kind !== 'all') {
        if (!label) throw new ValidationError(LABEL_REQUIRED, undefined, 'label_required');
        assertViewerHolds(viewer, label.id);
      }
      const active = input.active ?? true;
      const { rows, index, ownerNames, resolveOwner } = await db.snapshot(async () => ({
        rows: await settlements.listOpeningBalances({ ...(label ? { labelId: label.id } : {}), ...(active ? { active: true } : {}) }),
        index: await owners.artistIndex(),
        ownerNames: new Map((await owners.listOwners()).map((o) => [o.id, o.name])),
        resolveOwner: await owners.ownerResolver(),
      }));
      const out = rows.map((r) => {
        const a = index.get(r.artistId);
        const ownerId = a?.ownerId ? resolveOwner(a.ownerId) : null;
        return { ...r, pseudonym: a?.pseudonym ?? '?', ownerId, ownerName: ownerId ? (ownerNames.get(ownerId) ?? null) : null };
      });
      const live = out.filter((r) => r.active);
      const sum = (pick: (r: OpeningBalanceView) => number) => live.reduce((s, r) => s.add(centsToDecimal(pick(r))), ZERO);
      const master = sum((r) => r.masterCents);
      const publishing = sum((r) => r.publishingCents);
      return {
        label: label ? { id: label.id, name: label.name } : null,
        rows: out,
        totals: {
          rows: out.length,
          starts: live.filter((r) => r.kind === 'start').length,
          adjustments: live.filter((r) => r.kind === 'adjustment').length,
          missing: live.filter((r) => r.missing).length,
          inactive: out.length - live.length,
          master,
          publishing,
          total: master.add(publishing),
          cutoffMonths: [...new Set(live.map((r) => r.cutoffMonth))].sort(),
        },
      };
    },

    /** The soft rollback of an opening balance row (D-174): the balance no longer reads it; the row stays with its reason. */
    async deactivateStart(id: string, reason: string) {
      const row = await settlements.getOpeningBalance(id);
      await labels.getLabel(row.labelId);
      return settlements.deactivateOpeningBalance(id, reason);
    },
  };
  return api;
}
