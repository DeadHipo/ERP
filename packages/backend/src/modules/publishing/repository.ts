import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { pubStatementPeriods, pubStatements, pubTerms, pubWriters } from './schema';

export type StatementRow = typeof pubStatements.$inferSelect;
export type WriterRow = typeof pubWriters.$inferSelect;
export type TermsRow = typeof pubTerms.$inferSelect;

export interface LineInsert {
  statementId: string;
  lineNo: number;
  period: string;
  writerName: string;
  writerNorm: string;
  songwriters: string | null;
  workTitle: string;
  workCode: string | null;
  operationType: string | null;
  retailer: string | null;
  country: string | null;
  payablePico: bigint;
}

export interface AggregatedLine {
  period: string;
  writerNorm: string;
  writerName: string;
  workTitle: string;
  songwriters: string | null;
  operationType: string | null;
  payablePico: bigint;
}

/** A writer registered by a statement load when absent (role as it ends up after the load's own upgrades). */
export interface WriterInsert {
  writerNorm: string;
  displayName: string;
  role: 'holder' | 'songwriter';
}

/** Lines per INSERT: 12 array parameters per statement (unnest), so the size is bound by memory, not by parameters. */
const LINE_CHUNK = 5000;

/** PostgreSQL keeps numeric as entered or padded; the application keeps percents canonical ('50', '14.34'). */
const canonicalTerms = (r: TermsRow): TermsRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

/** All SQL of the publishing module lives here (schema `publishing`). */
export function createPublishingRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    snapshot: <T>(fn: () => Promise<T>): Promise<T> => db.snapshot(fn),

    // ---- statements and lines ----
    periodTaken: async (period: string) =>
      (
        await orm()
          .select()
          .from(pubStatementPeriods)
          .where(and(eq(pubStatementPeriods.source, 'b17'), eq(pubStatementPeriods.period, period)))
      )[0],
    statementBySha: async (sha256: string) =>
      (await orm().select().from(pubStatements).where(eq(pubStatements.sha256, sha256)))[0],
    insertStatement: async (row: typeof pubStatements.$inferInsert) => {
      await orm().insert(pubStatements).values(row);
    },
    insertStatementPeriod: async (period: string, statementId: string) => {
      await orm().insert(pubStatementPeriods).values({ source: 'b17', period, statementId });
    },
    /** The grouped lines of the loaded statements (D-164): run after every change of pub_lines or a statement status. */
    async refreshLinesByKey(): Promise<void> {
      await db.query('REFRESH MATERIALIZED VIEW publishing.pub_lines_by_key');
    },
    /** Inserts the lines in chunks, one multi-row INSERT (unnest of column arrays) per chunk. */
    async insertLines(lines: LineInsert[]): Promise<void> {
      for (let i = 0; i < lines.length; i += LINE_CHUNK) {
        const c = lines.slice(i, i + LINE_CHUNK);
        await db.query(
          `INSERT INTO publishing.pub_lines (statement_id, line_no, period, writer_name, writer_norm, songwriters,
                                             work_title, work_code, operation_type, retailer, country, payable_pico)
           SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                                $8::text[], $9::text[], $10::text[], $11::text[], $12::bigint[])`,
          [
            c.map((l) => l.statementId),
            c.map((l) => l.lineNo),
            c.map((l) => l.period),
            c.map((l) => l.writerName),
            c.map((l) => l.writerNorm),
            c.map((l) => l.songwriters),
            c.map((l) => l.workTitle),
            c.map((l) => l.workCode),
            c.map((l) => l.operationType),
            c.map((l) => l.retailer),
            c.map((l) => l.country),
            c.map((l) => l.payablePico.toString()),
          ],
        );
      }
    },
    /** The control figures of the lines stored for a statement. */
    async linesCheck(statementId: string): Promise<{ sum: bigint; count: bigint }> {
      const r = await db.query<{ s: string; n: string }>(
        `SELECT COALESCE(SUM(payable_pico), 0)::text AS s, COUNT(*)::text AS n
         FROM publishing.pub_lines WHERE statement_id = $1`,
        [statementId],
      );
      const row = r.rows[0] as { s: string; n: string };
      return { sum: BigInt(row.s), count: BigInt(row.n) };
    },
    setStatementTotal: async (id: string, totalPayable: string) => {
      await orm().update(pubStatements).set({ totalPayable }).where(eq(pubStatements.id, id));
    },
    getStatement: async (id: string) =>
      (await orm().select().from(pubStatements).where(eq(pubStatements.id, id)))[0],
    /** In load order, as the SQLite rowid order was. */
    listStatements: () =>
      orm().select().from(pubStatements).orderBy(asc(pubStatements.uploadedAt), asc(pubStatements.id)),
    /**
     * Lines of loaded statements summed per (period, writer, songwriters, work). Text compares byte-wise (COLLATE "C")
     * and NULL songwriters come first, as in the SQLite version, so MIN(writer_name) and the row order do not depend on
     * the database locale.
     */
    async aggregatedLines(): Promise<AggregatedLine[]> {
      const r = await db.query<{
        period: string;
        writer_norm: string;
        writer_name: string;
        work_title: string;
        songwriters: string | null;
        operation_type: string | null;
        payable: string;
      }>(
        // the grouped lines are kept by the materialized view pub_lines_by_key (D-164), refreshed by every load
        `SELECT period, writer_norm, writer_name, work_title, songwriters, operation_type, payable_pico::text AS payable
         FROM publishing.pub_lines_by_key
         ORDER BY period COLLATE "C", writer_norm COLLATE "C", songwriters COLLATE "C" NULLS FIRST,
                  work_title COLLATE "C", operation_type COLLATE "C" NULLS FIRST`,
      );
      return r.rows.map((x) => ({
        period: x.period,
        writerNorm: x.writer_norm,
        writerName: x.writer_name,
        workTitle: x.work_title,
        songwriters: x.songwriters,
        operationType: x.operation_type,
        payablePico: BigInt(x.payable),
      }));
    },

    // ---- writers ----
    /** Registers the writers of a load that do not exist yet (unmapped, no owner); existing rows are kept. */
    async insertWritersIfAbsent(rows: WriterInsert[]): Promise<void> {
      if (rows.length === 0) return;
      await db.query(
        `INSERT INTO publishing.pub_writers (writer_norm, display_name, owner_id, resolution, role)
         SELECT n, d, NULL, 'unmapped', r FROM unnest($1::text[], $2::text[], $3::text[]) AS t(n, d, r)
         ON CONFLICT (writer_norm) DO NOTHING`,
        [rows.map((w) => w.writerNorm), rows.map((w) => w.displayName), rows.map((w) => w.role)],
      );
    },
    /** Names seen first as songwriters are upgraded to holders. */
    async upgradeToHolders(writerNorms: string[]): Promise<void> {
      if (writerNorms.length === 0) return;
      await db.query(
        `UPDATE publishing.pub_writers SET role = 'holder' WHERE writer_norm = ANY($1::text[]) AND role = 'songwriter'`,
        [writerNorms],
      );
    },
    /** Writers marked external are retried when they show up again as holders. */
    async retryExternal(writerNorms: string[]): Promise<void> {
      if (writerNorms.length === 0) return;
      await db.query(
        `UPDATE publishing.pub_writers SET resolution = 'unmapped'
         WHERE writer_norm = ANY($1::text[]) AND resolution = 'external'`,
        [writerNorms],
      );
    },
    unmappedWriters: () =>
      orm()
        .select({
          writerNorm: pubWriters.writerNorm,
          displayName: pubWriters.displayName,
          role: pubWriters.role,
          resolution: pubWriters.resolution,
        })
        .from(pubWriters)
        .where(isNull(pubWriters.ownerId)),
    setWriterResolution: async (writerNorm: string, resolution: 'external' | 'ambiguous') => {
      await orm().update(pubWriters).set({ resolution }).where(eq(pubWriters.writerNorm, writerNorm));
    },
    allWriters: () => orm().select().from(pubWriters),
    getWriter: async (writerNorm: string) =>
      (await orm().select().from(pubWriters).where(eq(pubWriters.writerNorm, writerNorm)))[0],
    mapWriter: async (writerNorm: string, ownerId: string, resolution: WriterRow['resolution']) => {
      await orm()
        .update(pubWriters)
        .set({ ownerId, resolution })
        .where(eq(pubWriters.writerNorm, writerNorm));
    },
    reassignWriters: async (fromOwnerId: string, intoOwnerId: string) => {
      await orm()
        .update(pubWriters)
        .set({ ownerId: intoOwnerId, resolution: 'merged' })
        .where(eq(pubWriters.ownerId, fromOwnerId));
    },

    // ---- contract terms ----
    termsOfOwner: async (ownerId: string) =>
      (await orm().select().from(pubTerms).where(eq(pubTerms.ownerId, ownerId))).map(canonicalTerms),
    termsOfOwners: async (ownerIds: string[]) =>
      ownerIds.length === 0
        ? []
        : (await orm().select().from(pubTerms).where(inArray(pubTerms.ownerId, ownerIds))).map(
            canonicalTerms,
          ),
    allTerms: async () => (await orm().select().from(pubTerms)).map(canonicalTerms),
    getTerms: async (id: string) => {
      const r = (await orm().select().from(pubTerms).where(eq(pubTerms.id, id)))[0];
      return r && canonicalTerms(r);
    },
    closeTerms: async (id: string, validTo: string) => {
      await orm().update(pubTerms).set({ validTo }).where(eq(pubTerms.id, id));
    },
    insertTerms: async (row: typeof pubTerms.$inferInsert) => {
      await orm().insert(pubTerms).values(row);
    },
  };
}

export type PublishingRepository = ReturnType<typeof createPublishingRepository>;
