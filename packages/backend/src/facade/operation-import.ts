import { createReadStream } from 'node:fs';
import {
  OPERATION_IMPORT_COLUMNS,
  OPERATION_IMPORT_ISSUES,
  OPERATION_IMPORT_MAX_ROWS,
  OPERATION_IMPORT_SCOPES,
  type OperationImportAction,
  type OperationImportColumn,
  type OperationImportIssueCode,
} from '@erp/shared/operation-import';
import {
  IMPORTABLE_KINDS,
  isOperationKind,
  KIND_DIRECTION,
  KIND_DOCUMENT_KINDS,
  KIND_SIGN,
  KIND_WITH_SCOPE,
  type OperationKind,
} from '@erp/shared/operation-kinds';
import type { Scope } from '../modules/settlements';
import { AppError, RuleViolationError, ValidationError } from '../shared/errors';
import { assertDate } from '../shared/dates';
import { normalizeIsrc, normalizeName } from '../shared/identifiers';
import { Decimal, ZERO } from '../shared/money';
import { parseCsv } from '../shared/csv';
import type { ArtistIndexEntry, FacadeContext } from './context';
import { csvDelimiter, sha256Of } from './split-import';
import type { payoutsApi } from './payouts';

// The operation import (D-173 §1.5, P29): a csv of the cash register (Tipalti, EasyStaff, the owner's cabinet) becomes
// operations through the facade's own `createOperation`, never around it. Every row is `migration: true` (paid outside
// the ERP: counted at once, never blocking, D-048; the exception of D-051 extended by the import), under the label of the
// request (`label_source = 'operator'`). The preview classifies the rows in one snapshot; the apply repeats the
// classification inside ONE write transaction and writes everything or nothing. A repeated file is all `unchanged`:
// a row whose content key (kind, owner, pseudonym, date, amount, channel, external id) is an active operation already.

const LABEL_REQUIRED = 'Choose the own label of the import: ?label=';

/** The kinds that are paid out and may carry a payment proof (`confirmation`). */
const PAID_KINDS: readonly OperationKind[] = ['payout', 'advance', 'buyout'];
/** The kinds whose `external_id` is required (FIX-9: a repeated cash file would double `paid`). */
const EXTERNAL_ID_KINDS: readonly OperationKind[] = ['payout', 'buyout'];
/** The kinds that go to an owner and need a basis document (as `createOperation`). */
const OWNER_DOCUMENT_KINDS: readonly OperationKind[] = ['buyout', 'writeoff', 'adjustment'];

type Issue = { code: OperationImportIssueCode; severity: 'error' | 'warning' | 'info'; details?: Record<string, unknown> };
const issue = (code: OperationImportIssueCode, details?: Record<string, unknown>): Issue => ({
  code,
  severity: OPERATION_IMPORT_ISSUES[code],
  ...(details ? { details } : {}),
});

type Cells = Partial<Record<OperationImportColumn, string>>;
interface RawRow {
  line: number;
  cells: Cells;
}

// ------------------------------------------------------------------ reading the file

const tooLarge = () =>
  new AppError(`The import holds more than ${OPERATION_IMPORT_MAX_ROWS} rows: split the file`, 413, 'import_too_large', {
    maxRows: OPERATION_IMPORT_MAX_ROWS,
  });

function headerColumns(header: string[]): Map<OperationImportColumn, number> {
  const known = new Set<string>(OPERATION_IMPORT_COLUMNS.map((c) => c.name));
  const cols = new Map<OperationImportColumn, number>();
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (!h) return;
    if (!known.has(h) || cols.has(h as OperationImportColumn)) unknown.push(raw.trim());
    else cols.set(h as OperationImportColumn, i);
  });
  const missing = OPERATION_IMPORT_COLUMNS.filter((c) => c.required && !cols.has(c.name)).map((c) => c.name);
  if (missing.length > 0 || unknown.length > 0)
    throw new ValidationError(
      `The header of the import does not fit the template${missing.length ? `: missing ${missing.join(', ')}` : ''}${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}`,
      { missing, unknown },
      'import_header',
    );
  return cols;
}

/** The data rows of an operation file (csv only: `;` or `,`, a BOM, quotes; the stage 4 reader). */
export async function readOperationImportFile(path: string, fileName: string): Promise<RawRow[]> {
  if (!fileName.toLowerCase().endsWith('.csv')) throw new ValidationError('The operation import file must be a .csv');
  const out: RawRow[] = [];
  let cols: Map<OperationImportColumn, number> | undefined;
  let line = 0;
  for await (const record of parseCsv(createReadStream(path), await csvDelimiter(path))) {
    line++;
    if (!cols) {
      cols = headerColumns(record);
      continue;
    }
    if (record.every((v) => v.trim() === '')) continue;
    if (out.length >= OPERATION_IMPORT_MAX_ROWS) throw tooLarge();
    const cells: Cells = {};
    for (const [name, i] of cols) cells[name] = (record[i] ?? '').trim();
    out.push({ line, cells });
  }
  if (!cols) throw new ValidationError('The import file is empty', { missing: [], unknown: [] }, 'import_header');
  return out;
}

// ------------------------------------------------------------------ classification

/** Whole cents, `.` or `,` as the decimal mark, spaces as thousands separators; undefined = not an amount. */
function parseAmount(raw: string): Decimal | undefined {
  const s = raw.replace(/\s/g, '') /* \s takes the no-break space too */.replace(',', '.');
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return new Decimal(s);
}

function parseScope(raw: string): Scope | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if ((OPERATION_IMPORT_SCOPES as readonly string[]).includes(s)) return { kind: s as Scope['kind'] };
  const m = /^isrcs:(.+)$/i.exec(s);
  if (!m) return undefined;
  const isrcs = (m[1] as string).split(/[\s|]+/).filter(Boolean).map((x) => normalizeIsrc(x));
  if (isrcs.length === 0 || !isrcs.every((x) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(x))) return undefined;
  return { kind: 'isrcs', isrcs };
}

/** The content key of an operation (FIX-9): equal keys = the same operation, a repeated row is `unchanged`. */
const keyOf = (k: { kind: string; ownerId: string | null; artistId: string | null; date: string; cents: string; channel: string | null; externalRef: string | null }) =>
  [k.kind, k.ownerId ?? '', k.artistId ?? '', k.date, k.cents, k.channel ?? '', k.externalRef ?? ''].join('|');

interface RowState {
  line: number;
  cells: Cells;
  kind: OperationKind | null;
  ownerId: string | null;
  artistId: string | null;
  amount: Decimal | null;
  date: string | null;
  scope: Scope | null;
  documentId: string | null;
  externalRef: string | null;
  channel: string | null;
  confirmation: string | null;
  action: OperationImportAction;
  issues: Issue[];
}

/** What the classification reads: one consistent picture (a snapshot for the preview, the transaction for the apply). */
interface World {
  index: Map<string, ArtistIndexEntry>;
  owners: { id: string; name: string; aliases: string[] }[];
  resolveOwner: (id: string) => string;
  documents: { id: string; kind: string; title: string; ownerId: string | null }[];
  operations: { id: string; kind: string; ownerId: string | null; artistId: string | null; date: string; amountCents: number; channel: string | null; externalRef: string | null }[];
  /** Owner → confirmed under the label (the warning `no_contract_for_label`). */
  confirmedUnder: (ownerId: string) => Promise<boolean>;
  /** Owner → the publishing its book still has for a write-off (earned − recouped − write-offs). */
  writeoffAvailable: (ownerId: string) => Promise<Decimal>;
}

async function classify(raw: RawRow[], w: World, ctx: { defaultDocumentId: string | null }): Promise<RowState[]> {
  const { index } = w;
  const live = [...index.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a);
  const artistsByNorm = new Map<string, ArtistIndexEntry[]>();
  for (const a of live) {
    const n = normalizeName(a.pseudonym);
    if (n) artistsByNorm.set(n, [...(artistsByNorm.get(n) ?? []), a]);
  }
  const ownersById = new Map(w.owners.map((o) => [o.id, o]));
  const ownersByNorm = new Map<string, Set<string>>();
  for (const o of w.owners)
    for (const n of [o.name, ...o.aliases]) {
      const k = normalizeName(n);
      if (k) ownersByNorm.set(k, (ownersByNorm.get(k) ?? new Set()).add(o.id));
    }
  const docsById = new Map(w.documents.map((d) => [d.id, d]));
  const docsByTitle = new Map<string, typeof w.documents>();
  for (const d of w.documents) docsByTitle.set(d.title.trim(), [...(docsByTitle.get(d.title.trim()) ?? []), d]);
  const canonArtist = (id: string | null) => (id ? (index.get(id)?.id ?? id) : null);

  // the active operations by content key and by external id
  const existingKeys = new Set<string>();
  const byExternal = new Map<string, { id: string; key: string }[]>();
  for (const o of w.operations) {
    const key = keyOf({
      kind: o.kind,
      ownerId: o.ownerId ? w.resolveOwner(o.ownerId) : null,
      artistId: canonArtist(o.artistId),
      date: o.date,
      cents: String(o.amountCents),
      channel: o.channel,
      externalRef: o.externalRef,
    });
    existingKeys.add(key);
    if (o.externalRef) byExternal.set(o.externalRef, [...(byExternal.get(o.externalRef) ?? []), { id: o.id, key }]);
  }

  const seenKeys = new Map<string, number>();
  const seenExternal = new Map<string, number>();
  const writeoffUsed = new Map<string, Decimal>();
  const confirmed = new Map<string, boolean>();
  const out: RowState[] = [];

  for (const { line, cells } of raw) {
    const issues: Issue[] = [];
    // the kind
    const kindRaw = (cells.kind ?? '').trim().toLowerCase();
    let kind: OperationKind | null = null;
    if (!isOperationKind(kindRaw)) issues.push(issue('kind_unknown', { kind: cells.kind ?? '' }));
    else if (!(IMPORTABLE_KINDS as readonly string[]).includes(kindRaw)) issues.push(issue('kind_not_importable', { kind: kindRaw }));
    else kind = kindRaw;

    // the amount and the date
    const amount = parseAmount(cells.amount ?? '') ?? null;
    if (amount === null) issues.push(issue('amount_invalid'));
    let date: string | null = null;
    try {
      date = assertDate(cells.date ?? '');
    } catch {
      issues.push(issue('date_invalid'));
    }
    if (kind && amount) {
      const sign = KIND_SIGN[kind];
      if (amount.isZero() || (sign === '+' && amount.isNegative()) || (sign === '-' && amount.isPositive()))
        issues.push(issue('kind_sign', { kind, sign }));
    }

    // the owner: an id (a merged one answers for the survivor) or the one owner of the exact name / alias
    let ownerId: string | null = null;
    let ownerFailed = false;
    const ownerRaw = cells.owner ?? '';
    if (ownerRaw) {
      const byId = ownersById.get(w.resolveOwner(ownerRaw));
      const found = byId ? [byId.id] : [...(ownersByNorm.get(normalizeName(ownerRaw)) ?? [])];
      if (found.length === 1) ownerId = found[0] as string;
      else {
        ownerFailed = true;
        if (found.length > 1)
          issues.push(issue('owner_ambiguous', { candidates: found.map((id) => ({ id, name: ownersById.get(id)?.name })) }));
        else issues.push(issue('owner_not_found', { owner: ownerRaw }));
      }
    }
    // the pseudonym: an id (merged ids too) or the one live pseudonym of the exact name
    let artistId: string | null = null;
    let artistFailed = false;
    const pseudonymRaw = cells.pseudonym ?? '';
    if (pseudonymRaw) {
      const byId = index.get(pseudonymRaw);
      const found = byId ? [byId] : (artistsByNorm.get(normalizeName(pseudonymRaw)) ?? []);
      if (found.length === 1) {
        const a = found[0] as ArtistIndexEntry;
        artistId = a.id;
        if (!a.ownerId) issues.push(issue('artist_without_owner', { artistId: a.id }));
        else {
          const artistOwner = w.resolveOwner(a.ownerId);
          if (ownerId && ownerId !== artistOwner) issues.push(issue('pseudonym_other_owner', { artistId: a.id, ownerId: artistOwner }));
          ownerId = ownerId ?? artistOwner;
        }
      } else {
        artistFailed = true;
        if (found.length > 1)
          issues.push(issue('pseudonym_ambiguous', { candidates: found.map((a) => ({ id: a.id, name: a.pseudonym, ownerId: a.ownerId })) }));
        else issues.push(issue('pseudonym_not_found', { pseudonym: pseudonymRaw }));
      }
    }
    if (kind) {
      if ((kind === 'payout' || OWNER_DOCUMENT_KINDS.includes(kind)) && !ownerId && !ownerFailed && !artistFailed)
        issues.push(issue('owner_required'));
      if ((kind === 'advance' || kind === 'deduction' || kind === 'credit') && !artistId && !artistFailed) issues.push(issue('artist_required'));
    }

    // the scope: the recoup area of an advance (required) or a deduction (default any), none elsewhere
    const scopeParsed = parseScope(cells.scope ?? '');
    let scope: Scope | null = null;
    if (scopeParsed === undefined) issues.push(issue('scope_invalid', { scope: cells.scope ?? '' }));
    else scope = scopeParsed;
    if (kind && scopeParsed !== undefined) {
      if (kind === 'advance' && !scope) issues.push(issue('scope_required'));
      if (scope && !(KIND_WITH_SCOPE as readonly string[]).includes(kind)) issues.push(issue('scope_forbidden', { kind }));
    }

    // the basis document: the cell (an id or the one exact title), else the request's default for kinds that take one
    let documentId: string | null = null;
    const docRaw = cells.document ?? '';
    const takesDocument = kind ? KIND_DOCUMENT_KINDS[kind].length > 0 : false;
    const docCandidate = docRaw || (takesDocument ? (ctx.defaultDocumentId ?? '') : '');
    if (docCandidate) {
      const byTitle = docsByTitle.get(docCandidate) ?? [];
      const d = docsById.get(docCandidate) ?? (byTitle.length === 1 ? byTitle[0] : undefined);
      if (!d) issues.push(issue(byTitle.length > 1 ? 'document_ambiguous' : 'document_not_found', { document: docCandidate }));
      else {
        documentId = d.id;
        const allowed: readonly string[] = kind ? KIND_DOCUMENT_KINDS[kind] : [];
        if (kind && !allowed.includes(d.kind)) issues.push(issue('document_kind', { kind: d.kind, allowed }));
        if (d.ownerId && ownerId && w.resolveOwner(d.ownerId) !== ownerId) issues.push(issue('document_owner_mismatch', { documentId: d.id }));
      }
    }
    if (kind && !documentId && (kind === 'advance' || OWNER_DOCUMENT_KINDS.includes(kind)) && !issues.some((i) => i.code.startsWith('document_')))
      issues.push(issue('document_required'));

    // the payment proof, the channel, the external id
    const confirmation = cells.confirmation ? cells.confirmation : null;
    if (confirmation && kind && !PAID_KINDS.includes(kind)) issues.push(issue('confirmation_forbidden', { kind }));
    const channel = cells.channel ? cells.channel : null;
    if (channel && channel.length > 100) issues.push(issue('channel_invalid'));
    const externalRef = cells.external_id ? cells.external_id : null;
    if (kind && !externalRef) issues.push(issue(EXTERNAL_ID_KINDS.includes(kind) ? 'external_ref_required' : 'no_external_ref'));

    // the content key: in the store already = unchanged; twice in the file = duplicate_in_file
    let unchanged = false;
    if (kind && amount && date) {
      const key = keyOf({ kind, ownerId, artistId, date, cents: amount.mul(100).toFixed(0), channel, externalRef });
      const sameExternal = externalRef ? (byExternal.get(externalRef) ?? []) : [];
      if (existingKeys.has(key)) unchanged = true;
      else if (sameExternal.length > 0) issues.push(issue('duplicate_external_ref', { operationIds: sameExternal.map((o) => o.id) }));
      const earlier = (externalRef ? seenExternal.get(externalRef) : undefined) ?? seenKeys.get(key);
      if (earlier !== undefined) issues.push(issue('duplicate_in_file', { line: earlier }));
      else if (!issues.some((i) => i.severity === 'error')) {
        // only a row that may be written claims its key and external id
        seenKeys.set(key, line);
        if (externalRef) seenExternal.set(externalRef, line);
      }
    }

    const hasError = () => issues.some((i) => i.severity === 'error');
    if (!hasError() && !unchanged && kind && ownerId && amount) {
      // a write-off takes at most the publishing the book still has, the earlier rows of the file included
      if (kind === 'writeoff') {
        const used = writeoffUsed.get(ownerId) ?? ZERO;
        const available = (await w.writeoffAvailable(ownerId)).sub(used);
        if (amount.gt(available)) issues.push(issue('writeoff_exceeds', { available: Decimal.max(available, 0).toFixed() }));
        else writeoffUsed.set(ownerId, used.add(amount));
      }
      if (PAID_KINDS.includes(kind)) {
        if (!confirmed.has(ownerId)) confirmed.set(ownerId, await w.confirmedUnder(ownerId));
        if (!confirmed.get(ownerId)) issues.push(issue('no_contract_for_label'));
      }
    }
    if (unchanged) issues.push(issue('unchanged'));
    out.push({
      line,
      cells,
      kind,
      ownerId,
      artistId,
      amount,
      date,
      scope,
      documentId,
      externalRef,
      channel,
      confirmation,
      action: hasError() ? 'error' : unchanged ? 'unchanged' : 'create',
      issues,
    });
  }
  return out;
}

// ------------------------------------------------------------------ the facade method

export function operationImportApi(ctx: FacadeContext, writes: Pick<ReturnType<typeof payoutsApi>, 'createOperation'>) {
  const { db, owners, settlements, assertOwnLabel, balanceWithFiles } = ctx;

  async function worldOf(labelId: string): Promise<World> {
    const [index, ownerList, resolveOwner, documents, operations] = await Promise.all([
      owners.artistIndex(),
      owners.listOwners(),
      owners.ownerResolver(),
      owners.listDocuments(),
      settlements.listOperations({ active: true }),
    ]);
    return {
      index,
      owners: ownerList.map((o) => ({ id: o.id, name: o.name, aliases: o.aliases })),
      resolveOwner,
      documents: documents.map((d) => ({ id: d.id, kind: d.kind, title: d.title, ownerId: d.ownerId })),
      operations: operations.map((o) => ({
        id: o.id,
        kind: o.kind,
        ownerId: o.ownerId,
        artistId: o.artistId,
        date: o.date,
        amountCents: o.amountCents,
        channel: o.channel,
        externalRef: o.externalRef,
      })),
      confirmedUnder: (ownerId) => owners.isOwnerConfirmedUnder(ownerId, labelId),
      writeoffAvailable: async (ownerId) => {
        const { balance } = await balanceWithFiles(ownerId, {}, { labelId });
        const pub = balance.total.byArea.publishing;
        return pub.earned.sub(pub.recouped).sub(balance.total.writtenOff);
      },
    };
  }

  function answer(
    rows: RowState[],
    meta: { labelId: string; fileName: string; sha256: string; dryRun: boolean },
    result: { operationIds: string[]; proofIds: string[] } | null,
  ) {
    const issues = rows.flatMap((r) => r.issues);
    const byKind: Record<string, string> = {};
    for (const r of rows)
      if (r.action === 'create' && r.kind && r.amount) byKind[r.kind] = new Decimal(byKind[r.kind] ?? 0).add(r.amount).toFixed();
    return {
      labelId: meta.labelId,
      fileName: meta.fileName,
      sha256: meta.sha256,
      dryRun: meta.dryRun,
      applied: result !== null,
      totals: {
        rows: rows.length,
        create: rows.filter((r) => r.action === 'create').length,
        unchanged: rows.filter((r) => r.action === 'unchanged').length,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        byKind,
      },
      rows: rows.map((r) => ({
        line: r.line,
        kind: r.cells.kind ?? '',
        owner: r.cells.owner ? r.cells.owner : null,
        pseudonym: r.cells.pseudonym ? r.cells.pseudonym : null,
        ownerId: r.ownerId,
        artistId: r.artistId,
        amount: r.amount ? r.amount.toFixed() : (r.cells.amount ?? ''),
        date: r.date ?? (r.cells.date ?? ''),
        externalId: r.externalRef,
        documentId: r.documentId,
        action: r.action,
        issues: r.issues,
      })),
      result,
    };
  }

  return {
    /**
     * The operation import (D-173 §1.5): `dryRun` = the preview (one snapshot, nothing written, no audit row); else the
     * apply in ONE write transaction: the classification again, then per row to create (file order) a `payment_proof`
     * for its `confirmation` (no approval needed) and `createOperation({ kind, migration: true, labelId })`. Any error
     * row = 422 `import_invalid` with `details.rows` (first 200) and `details.errors`; a refusal of `createOperation`
     * while writing = 422 `import_invalid` with `details.line` and `details.cause`; nothing is written either way. The
     * ability is `pay` (the organization's administrator), so no viewer narrows it.
     */
    async importOperations(input: { path: string; fileName: string; labelId: string | undefined; dryRun: boolean; documentId?: string | undefined }) {
      if (!input.labelId) throw new ValidationError(LABEL_REQUIRED, undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      const raw = await readOperationImportFile(input.path, input.fileName);
      const sha256 = await sha256Of(input.path);
      const meta = { labelId: label.id, fileName: input.fileName, sha256, dryRun: input.dryRun };
      const run = async () => classify(raw, await worldOf(label.id), { defaultDocumentId: input.documentId ?? null });

      if (input.dryRun) return answer(await db.snapshot(run), meta, null);

      return db.transaction(async () => {
        const rows = await run();
        const errors = rows.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => ({ line: r.line, code: i.code })));
        if (errors.length > 0)
          throw new RuleViolationError(`The import has ${errors.length} errors: fix the file and preview it again`, 'import_invalid', {
            rows: errors.slice(0, 200),
            errors: errors.length,
          });
        const result = { operationIds: [] as string[], proofIds: [] as string[] };
        for (const r of rows) {
          if (r.action !== 'create') continue;
          const kind = r.kind as OperationKind;
          try {
            let paymentProofId: string | null = null;
            if (r.confirmation) {
              const proof = await owners.createDocument({
                kind: 'payment_proof',
                title: `Payment proof ${r.externalRef ?? `${input.fileName}:${r.line}`}`,
                fileRef: r.confirmation,
                ownerId: r.ownerId,
                requiresApproval: false,
                labelId: label.id,
              });
              paymentProofId = proof.id;
              result.proofIds.push(proof.id);
            }
            const op = await writes.createOperation({
              kind,
              direction: KIND_DIRECTION[kind],
              amount: (r.amount as Decimal).toFixed(2),
              ownerId: r.ownerId,
              artistId: r.artistId,
              date: r.date as string,
              scope: r.scope,
              documentId: r.documentId,
              paymentProofId,
              comment: r.cells.comment ? r.cells.comment : `Imported from ${input.fileName}, line ${r.line}`,
              migration: true,
              labelId: label.id,
              externalRef: r.externalRef,
              channel: r.channel,
            });
            result.operationIds.push(op.id);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            throw new RuleViolationError(`The import stopped at line ${r.line}: ${e.message}; nothing was written`, 'import_invalid', {
              line: r.line,
              cause: e.code,
            });
          }
        }
        return answer(rows, meta, result);
      });
    },
  };
}
