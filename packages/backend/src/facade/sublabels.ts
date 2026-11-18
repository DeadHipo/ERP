import { metaLookup } from './track-meta-lite';
import { SPLIT_DOCUMENT_KINDS } from '@erp/shared/document-kinds';
import { assertDate, monthOf, monthStart, todayIso } from '../shared/dates';
import { RuleViolationError, ValidationError } from '../shared/errors';
import { normalizeIsrc } from '../shared/identifiers';
import { Decimal } from '../shared/money';
import type { LinksService, NewSublabelTerm, SublabelTermRow } from '../modules/links';
import type { FacadeContext } from './context';

// The sublabels (D-217, D-218): a register of names (`labels.sublabels`) and the terms of a sublabel on a track
// (`links.sublabel_terms`), by the rules of the publishing terms. The facade floors the dates (M52), checks the
// sublabel, the document and the catalog, and classifies a batch before it is written. The money does not read any of
// it yet: `calculate()` still takes the sublabel rules of `labels`.

/** At most this many tracks in one batch (the body stays under the JSON limit). */
export const SUBLABEL_TERMS_MAX = 5000;

const splitDocumentKinds: readonly string[] = SPLIT_DOCUMENT_KINDS;

/** A date or a month floored to the first day of its month (M52); `YYYY-MM` is taken as its first day. */
function floorMonth(raw: string): string {
  const d = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  return monthStart(monthOf(assertDate(d)));
}

/** The state of a term today: open (in force or starting later), closed, cancelled. */
export type SublabelTermState = 'open' | 'future' | 'closed' | 'cancelled';

function stateOf(t: SublabelTermRow, today: string): SublabelTermState {
  if (t.cancelledAt) return 'cancelled';
  if (t.validTo !== null && t.validTo <= today) return 'closed';
  if (t.validFrom > today) return 'future';
  return 'open';
}

/** A term covers the first day of a month. */
const covers = (t: Pick<SublabelTermRow, 'validFrom' | 'validTo'>, day: string) =>
  t.validFrom <= day && (t.validTo === null || day < t.validTo);

export interface SublabelTermsBody {
  documentId?: string | null;
  percent: string;
  validFrom: string;
  validTo?: string | null;
  note?: string | null;
  items: { isrc: string; percent?: string | null; validFrom?: string | null; validTo?: string | null }[];
}

/** The class of one row of a batch. */
export type SublabelTermRowKind = 'new' | 'closes' | 'unchanged' | 'error';
export type SublabelTermRowError =
  | 'isrc_invalid'
  | 'percent_invalid'
  | 'date_invalid'
  | 'empty_period'
  | 'duplicate_in_request'
  | 'term_overlap';

export interface SublabelTermPreviewRow {
  line: number;
  isrc: string;
  title: string | null;
  percent: string | null;
  validFrom: string | null;
  validTo: string | null;
  kind: SublabelTermRowKind;
  error: SublabelTermRowError | null;
  /** Information that does not stop the batch: the track is not in the catalog yet. */
  notInCatalog: boolean;
  /** The term this one closes at its start (a buyout, a move to another sublabel). */
  closes: { termId: string; sublabelId: string; sublabelName: string; percent: string; validFrom: string } | null;
}

function percentOf(raw: string): string | null {
  const p = String(raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(p)) return null;
  const d = new Decimal(p);
  return d.isZero() || d.gt(100) ? null : d.toFixed();
}

export function sublabelsApi(ctx: FacadeContext, m: { links: LinksService }) {
  const { db, labels, owners } = ctx;
  const { links } = m;

  async function namesOfSublabels(): Promise<Map<string, string>> {
    return new Map((await labels.listSublabels()).map((s) => [s.id, s.name]));
  }

  async function titlesOf(isrcs: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (isrcs.length === 0) return out;
    for (const t of await owners.listTracks({ isrcs })) if (t.isrc && !out.has(t.isrc)) out.set(t.isrc, t.title);
    return out;
  }

  /** The document of a term: it exists and is of a kind that may confirm a split (an appendix, a contract, …). */
  async function checkDocument(documentId: string): Promise<void> {
    const d = await owners.getDocument(documentId);
    if (!splitDocumentKinds.includes(d.kind))
      throw new ValidationError(`A sublabel term is confirmed by a document of a split kind, not "${d.kind}"`, undefined, 'document_kind');
  }

  /** Classifies a batch over the live terms of its ISRCs, in the order of the request; nothing is written. */
  async function classify(sublabelId: string, body: SublabelTermsBody): Promise<{ rows: SublabelTermPreviewRow[]; write: NewSublabelTerm[] }> {
    if (body.items.length === 0) throw new ValidationError('No tracks given');
    if (body.items.length > SUBLABEL_TERMS_MAX)
      throw new ValidationError(`At most ${SUBLABEL_TERMS_MAX} tracks in one batch`, { max: SUBLABEL_TERMS_MAX }, 'too_many_terms');
    await labels.getSublabel(sublabelId);
    if (body.documentId) await checkDocument(body.documentId);
    const names = await namesOfSublabels();
    const isrcs = body.items.map((i) => normalizeIsrc(i.isrc));
    const live = await links.sublabelTerms({ isrcs: [...new Set(isrcs.filter((x) => x !== ''))] });
    const titles = await titlesOf([...new Set(isrcs)]);
    const seen = new Set<string>();
    const rows: SublabelTermPreviewRow[] = [];
    const write: NewSublabelTerm[] = [];
    body.items.forEach((item, i) => {
      const isrc = isrcs[i] as string;
      const row: SublabelTermPreviewRow = {
        line: i + 1,
        isrc,
        title: titles.get(isrc) ?? null,
        percent: null,
        validFrom: null,
        validTo: null,
        kind: 'error',
        error: null,
        notInCatalog: false,
        closes: null,
      };
      rows.push(row);
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return void (row.error = 'isrc_invalid');
      if (seen.has(isrc)) return void (row.error = 'duplicate_in_request');
      seen.add(isrc);
      const percent = percentOf(item.percent ?? body.percent);
      if (percent === null) return void (row.error = 'percent_invalid');
      row.percent = percent;
      let from: string;
      let to: string | null;
      try {
        from = floorMonth(item.validFrom ?? body.validFrom);
        const toRaw = item.validTo !== undefined ? item.validTo : body.validTo;
        to = toRaw ? floorMonth(toRaw) : null;
      } catch {
        return void (row.error = 'date_invalid');
      }
      row.validFrom = from;
      row.validTo = to;
      if (to !== null && to <= from) return void (row.error = 'empty_period');
      row.notInCatalog = !titles.has(isrc);
      const same = live.filter((t) => t.isrc === isrc);
      const open = same.find((t) => t.validTo === null);
      const documentId = body.documentId ?? null;
      if (
        open &&
        open.sublabelId === sublabelId &&
        open.percent === percent &&
        open.validFrom === from &&
        to === null &&
        open.documentId === documentId
      ) {
        row.kind = 'unchanged';
        return;
      }
      if (same.some((t) => t.validFrom >= from || (t.validTo !== null && t.validTo > from))) return void (row.error = 'term_overlap');
      row.kind = open ? 'closes' : 'new';
      if (open)
        row.closes = {
          termId: open.id,
          sublabelId: open.sublabelId,
          sublabelName: names.get(open.sublabelId) ?? open.sublabelId,
          percent: open.percent,
          validFrom: open.validFrom,
        };
      write.push({ sublabelId, isrc, percent, validFrom: from, validTo: to, documentId, note: body.note ?? null });
    });
    return { rows, write };
  }

  const totalsOf = (rows: SublabelTermPreviewRow[]) => ({
    rows: rows.length,
    new: rows.filter((r) => r.kind === 'new').length,
    closes: rows.filter((r) => r.kind === 'closes').length,
    unchanged: rows.filter((r) => r.kind === 'unchanged').length,
    errors: rows.filter((r) => r.kind === 'error').length,
    notInCatalog: rows.filter((r) => r.notInCatalog).length,
  });

  return {
    /** The register with what stands on each sublabel today: the open terms and the terms without a document. */
    async listSublabels() {
      return db.snapshot(async () => {
        const [list, terms] = await Promise.all([labels.listSublabels(), links.sublabelTerms()]);
        const day = monthStart(monthOf(todayIso()));
        return list.map((s) => {
          const own = terms.filter((t) => t.sublabelId === s.id);
          return {
            ...s,
            tracksNow: new Set(own.filter((t) => covers(t, day)).map((t) => t.isrc)).size,
            withoutDocument: own.filter((t) => t.documentId === null && (t.validTo === null || t.validTo > day)).length,
          };
        });
      });
    },

    createSublabel: (name: string) => labels.createSublabel(name),
    renameSublabel: (id: string, name: string) => labels.renameSublabel(id, name),

    /**
     * The terms with the sublabel's name, the track's title and the document's status; `month` = the terms in force
     * on its first day; `noDocument` = only the terms without one; the cancelled ones only with `withCancelled`.
     */
    async listSublabelTerms(f: { sublabel?: string; isrc?: string; month?: string; noDocument?: boolean; withCancelled?: boolean } = {}) {
      return db.snapshot(async () => {
        const isrc = f.isrc ? normalizeIsrc(f.isrc) : undefined;
        let terms = await links.sublabelTerms({ sublabelId: f.sublabel, isrcs: isrc ? [isrc] : undefined, withCancelled: f.withCancelled });
        if (f.month) {
          const day = floorMonth(f.month);
          terms = terms.filter((t) => !t.cancelledAt && covers(t, day));
        }
        if (f.noDocument) terms = terms.filter((t) => t.documentId === null);
        const names = await namesOfSublabels();
        const titles = await titlesOf([...new Set(terms.map((t) => t.isrc))]);
        const docs = [...new Set(terms.map((t) => t.documentId).filter((d): d is string => d !== null))];
        const statuses = docs.length > 0 ? await owners.documentStatuses(docs) : new Map<string, string>();
        const metaOf = await metaLookup(owners, terms.map((t) => t.isrc)); // D-242
        const today = todayIso();
        return terms.map((t) => ({
          ...t,
          meta: metaOf(t.isrc),
          sublabelName: names.get(t.sublabelId) ?? t.sublabelId,
          title: titles.get(t.isrc) ?? null,
          documentStatus: t.documentId ? (statuses.get(t.documentId) ?? 'missing') : null,
          state: stateOf(t, today),
        }));
      });
    },

    /**
     * New terms of a sublabel (D-218): `dryRun` classifies every row in a snapshot and writes nothing; the apply
     * classifies again inside one transaction and writes all or nothing (an error row = 422 `terms_invalid` with the
     * rows); an `unchanged` row is skipped. A new term closes the open term of its ISRC at its start.
     */
    async addSublabelTerms(sublabelId: string, body: SublabelTermsBody, opts: { dryRun: boolean }, by: string) {
      if (opts.dryRun) {
        const { rows } = await db.snapshot(() => classify(sublabelId, body));
        return { applied: false, rows, totals: totalsOf(rows), termIds: [] as string[] };
      }
      return db.transaction(async () => {
        const { rows, write } = await classify(sublabelId, body);
        const bad = rows.filter((r) => r.kind === 'error');
        if (bad.length > 0)
          throw new RuleViolationError('The batch has error rows; nothing is written', 'terms_invalid', {
            rows: bad.slice(0, 200).map((r) => ({ line: r.line, isrc: r.isrc, code: r.error })),
            errors: bad.length,
          });
        const created = write.length > 0 ? await links.addSublabelTerms(write, by) : [];
        return { applied: true, rows, totals: totalsOf(rows), termIds: created.map((t) => t.id) };
      });
    },

    /** Closes an open term from a month (floored): the track is not the sublabel's from then on. */
    closeSublabelTerm: (id: string, validTo: string) => links.closeSublabelTerm(id, floorMonth(validTo)),

    /** Cancels the latest term of its ISRC; the term it had closed is open again. */
    cancelSublabelTerm: (id: string, by: string, reason: string) => links.cancelSublabelTerm(id, by, reason),

    /** A document attached to terms that have none (the money of a term waits without one). */
    async attachSublabelTermsDocument(ids: string[], documentId: string, by: string) {
      return db.transaction(async () => {
        await checkDocument(documentId);
        return links.attachSublabelTermDocument(ids, documentId, by);
      });
    },
  };
}
