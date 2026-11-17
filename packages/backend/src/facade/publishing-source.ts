import type { Db } from '../shared/pg-db';
import { monthStart, quarterEndMonth } from '../shared/dates';
import { Decimal } from '../shared/money';
import type { LinksService } from '../modules/links';
import type { OwnersService } from '../modules/owners';
import { isrcTermOf, ownerTermAt } from './pubv2-isrc-terms';
import { DEFAULT_AUTHOR_PERCENT } from './layers/writer-parts';
import type { PubV2Service } from '../modules/pubv2';

/** A songwriter of v2 as the publishing layers read it: its owner by the operator's link, or none (it waits). */
export interface PublishingWriterRow {
  writerNorm: string;
  displayName: string;
  ownerId: string | null;
  resolution: string;
  role: string;
}

/** A term of the layers: the owner's percent from a date; `operationType` is only the slot of an ISRC term (D-192). */
export interface PublishingTermRow {
  id: string;
  ownerId: string;
  percent: string;
  validFrom: string;
  validTo: string | null;
  documentId: string | null;
  operationType: string | null;
  createdAt: string;
}

/** One accrual of a report summary: a songwriter and a song in a quarter, under the label of its file. */
export interface PublishingLineRow {
  period: string;
  writerNorm: string;
  writerName: string;
  workTitle: string;
  operationType: string | null;
  labelId: string | null;
  payablePico: bigint;
}

/** A loaded report file of v2 in the shape the payout snapshot, the sources and the overview list (D-189). */
export interface StatementView {
  id: string;
  source: string;
  periods: string[];
  fileName: string;
  sha256: string;
  generatedAt: string;
  generatedAtSource: string;
  uploadedAt: string;
  status: string;
  lineCount: number;
  totalPayable: string;
  warnings: string[];
  labelId: string | null;
  replacedBy: string | null;
}

type Snapshot = { writers: PublishingWriterRow[]; terms: PublishingTermRow[]; lines: PublishingLineRow[] };

/**
 * The publishing of the calculation, read from the report summaries and the links (D-185; the only source since D-234,
 * the old module of the B17 lines is gone). The money goes to the owner of the songwriter (the rights-holder of the
 * summary row, D-186); a line carries no operation type and the terms of v2 none (D-188). A songwriter without a link
 * waits as `writer_unmapped`.
 *
 * D-192: a term of an ISRC wins over the owner's own percent on the songs linked to that ISRC. It rides the typed-term
 * slot of the layer (`operationType`, D-128) without a layer change: the line gets the key `isrc:<termId>` and the term
 * is copied with that key. A song whose ISRCs disagree gets a term of its own without a document, so the line waits as
 * `publishing_terms_unconfirmed`, at the highest percent in question (the owner's or one of the ISRCs').
 */
export function pubV2Source(db: Db, m: { pubv2: PubV2Service; links: LinksService; owners: OwnersService }) {
  const snapshotForCalculation = (o: { lines?: boolean } = {}): Promise<Snapshot> =>
    db.snapshot(async () => {
      const decided = new Map((await m.links.songwriterOwners()).map((l) => [l.songwriterId, l.ownerId]));
      const writers = (await m.pubv2.listSongwriters()).map((w) => ({
        writerNorm: w.id,
        displayName: w.name,
        ownerId: decided.get(w.id) ?? null,
        resolution: decided.has(w.id) ? 'manual' : 'unmapped',
        role: 'holder',
      }));
      type Term = Snapshot['terms'][number];
      const termOf = ({ decidedBy: _b, cancelledAt: _c, cancelledBy: _cb, cancelReason: _r, isrc: _i, basis: _s, ...t }: Awaited<
        ReturnType<LinksService['publishingTerms']>
      >[number]): Term => ({ ...t, operationType: null });
      const ownerTerms = await m.links.ownerTerms();
      const isrcTerms = await m.links.isrcTerms();
      const terms: Term[] = ownerTerms.map(termOf);
      if (o.lines === false) return { writers, terms, lines: [] };
      const resolve = await m.owners.ownerResolver();
      const isrcsOf = new Map<string, string[]>();
      for (const l of await m.links.songIsrcs()) isrcsOf.set(l.songId, [...(isrcsOf.get(l.songId) ?? []), l.isrc]);
      const typed = new Map<string, Term>();
      const lines = (await m.pubv2.linesForCalculation()).map((l) => {
        let operationType: string | null = null;
        const linked = decided.get(l.songwriterId);
        if (linked && isrcTerms.length > 0) {
          const owner = resolve(linked);
          const date = monthStart(quarterEndMonth(l.period));
          const state = isrcTermOf(isrcsOf.get(l.songId) ?? [], owner, date, isrcTerms, resolve);
          if (state.kind === 'term') {
            operationType = `isrc:${state.term.id}`;
            typed.set(operationType, { ...termOf(state.term), operationType });
          } else if (state.kind === 'conflict') {
            operationType = `isrc-conflict:${l.songId}:${l.period}`;
            const percents = [
              ...state.byIsrc.flatMap((x) => (x.term ? [x.term.percent] : [])),
              ownerTermAt(ownerTerms, owner, date, resolve)?.percent ?? DEFAULT_AUTHOR_PERCENT,
            ];
            const top = percents.reduce((a, b) => (new Decimal(b).gt(a) ? b : a));
            typed.set(operationType, { id: operationType, ownerId: linked, percent: String(top), validFrom: date, validTo: null, documentId: null, operationType, createdAt: date });
          }
        }
        return {
          period: l.period,
          writerNorm: l.songwriterId,
          writerName: l.songwriter,
          workTitle: l.title,
          operationType,
          labelId: l.labelId,
          payablePico: l.payablePico,
        };
      });
      return { writers, terms: [...terms, ...typed.values()], lines };
    });
  type Statement = StatementView;
  /** A file of v2 in the shape of an old statement (D-189): the payout snapshot, the sources and the overview list it. */
  const statementOf = (f: Awaited<ReturnType<PubV2Service['listFiles']>>[number]): Statement => ({
    id: f.id,
    source: 'b17',
    periods: f.periods,
    fileName: f.fileName,
    sha256: f.sha256,
    generatedAt: f.uploadedAt,
    generatedAtSource: 'upload',
    uploadedAt: f.uploadedAt,
    status: f.status,
    lineCount: f.rowCount,
    totalPayable: f.payable,
    warnings: f.difference && f.difference !== '0' ? [`the total the file names differs by ${f.difference}`] : [],
    labelId: f.labelId,
    replacedBy: f.replacedBy,
  });
  const listStatements = async () => (await m.pubv2.listFiles()).map(statementOf);
  const activeStatements = async () => (await listStatements()).filter((s) => s.status === 'loaded');
  /** The terms of `links` (D-185, D-188) for the owner card. */
  const termsOf = async (ownerIds: string[]) =>
    (await m.links.ownerTerms())
      .filter((t) => ownerIds.includes(t.ownerId))
      .map(({ decidedBy: _b, cancelledAt: _c, cancelledBy: _cb, cancelReason: _r, isrc: _i, basis: _s, ...t }) => ({ ...t, operationType: null }));
  /** The songwriters of v2 with their links: nothing is ambiguous, a songwriter without a link waits. */
  const listWriters = async () => (await snapshotForCalculation({ lines: false })).writers;
  return {
    snapshotForCalculation,
    listStatements,
    activeStatements,
    termsOf,
    listWriters,
    /** D-194: a merge of owners moves the links of v2. */
    async reassignOwner(fromOwnerId: string, intoOwnerId: string) {
      await m.links.reassignOwner(fromOwnerId, intoOwnerId);
    },
  };
}

/** The publishing of a facade (D-234: the report summaries of v2 and the links). */
export type PublishingSource = ReturnType<typeof pubV2Source>;
