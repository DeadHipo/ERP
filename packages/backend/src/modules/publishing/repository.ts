import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ModuleDb } from '../../shared/db';
import { pubStatementPeriods, pubStatements, pubTerms, pubWriters, publishingSchema } from './schema';

export type PublishingDb = ModuleDb<typeof publishingSchema>;
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
  payablePico: bigint;
}

/** All SQL of the publishing module lives here. */
export function createPublishingRepository(db: PublishingDb) {
  const { orm, sqlite } = db;
  const sumByStatement = sqlite
    .prepare('SELECT COALESCE(SUM(payable_pico),0) AS s, COUNT(*) AS n FROM pub_lines WHERE statement_id = ?')
    .safeIntegers(true);
  const aggregated = sqlite
    .prepare(
      `SELECT l.period AS period, l.writer_norm AS writerNorm, MIN(l.writer_name) AS writerName, l.work_title AS workTitle,
              l.songwriters AS songwriters, SUM(l.payable_pico) AS payablePico
       FROM pub_lines l JOIN pub_statements s ON s.id = l.statement_id WHERE s.status = 'loaded'
       GROUP BY l.period, l.writer_norm, l.songwriters, l.work_title`,
    )
    .safeIntegers(true);
  const insertLineStmt = sqlite.prepare(
    `INSERT INTO pub_lines (statement_id, line_no, period, writer_name, writer_norm, songwriters, work_title, work_code, operation_type, retailer, country, payable_pico)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  return {
    transaction<T>(fn: () => T): T {
      return sqlite.transaction(fn)();
    },

    // ---- statements and lines ----
    periodTaken: (period: string) =>
      orm
        .select()
        .from(pubStatementPeriods)
        .where(and(eq(pubStatementPeriods.source, 'b17'), eq(pubStatementPeriods.period, period)))
        .get(),
    statementBySha: (sha256: string) =>
      orm.select().from(pubStatements).where(eq(pubStatements.sha256, sha256)).get(),
    insertStatement: (row: typeof pubStatements.$inferInsert) => orm.insert(pubStatements).values(row).run(),
    insertStatementPeriod: (period: string, statementId: string) =>
      orm.insert(pubStatementPeriods).values({ source: 'b17', period, statementId }).run(),
    insertLine(l: LineInsert): void {
      insertLineStmt.run(
        l.statementId,
        l.lineNo,
        l.period,
        l.writerName,
        l.writerNorm,
        l.songwriters,
        l.workTitle,
        l.workCode,
        l.operationType,
        l.retailer,
        l.country,
        l.payablePico,
      );
    },
    /** The control figures of the lines stored for a statement. */
    linesCheck(statementId: string): { sum: bigint; count: bigint } {
      const r = sumByStatement.get(statementId) as { s: bigint; n: bigint };
      return { sum: r.s, count: r.n };
    },
    setStatementTotal: (id: string, totalPayable: string) =>
      orm.update(pubStatements).set({ totalPayable }).where(eq(pubStatements.id, id)).run(),
    getStatement: (id: string) => orm.select().from(pubStatements).where(eq(pubStatements.id, id)).get(),
    listStatements: () => orm.select().from(pubStatements).all(),
    /** Lines of loaded statements summed per (period, writer, songwriters, work). */
    aggregatedLines: () => aggregated.all() as AggregatedLine[],

    // ---- writers ----
    insertWriterIfAbsent: (row: typeof pubWriters.$inferInsert) =>
      orm.insert(pubWriters).values(row).onConflictDoNothing().run(),
    /** A name seen first as a songwriter is upgraded to holder. */
    upgradeToHolder: (writerNorm: string) =>
      orm
        .update(pubWriters)
        .set({ role: 'holder' })
        .where(and(eq(pubWriters.writerNorm, writerNorm), eq(pubWriters.role, 'songwriter')))
        .run(),
    /** A writer marked external is retried when it shows up again as a holder. */
    retryExternal: (writerNorm: string) =>
      orm
        .update(pubWriters)
        .set({ resolution: 'unmapped' })
        .where(and(eq(pubWriters.writerNorm, writerNorm), eq(pubWriters.resolution, 'external')))
        .run(),
    unmappedWriters: () =>
      orm
        .select({
          writerNorm: pubWriters.writerNorm,
          displayName: pubWriters.displayName,
          role: pubWriters.role,
          resolution: pubWriters.resolution,
        })
        .from(pubWriters)
        .where(isNull(pubWriters.ownerId))
        .all(),
    setWriterResolution: (writerNorm: string, resolution: 'external' | 'ambiguous') =>
      orm.update(pubWriters).set({ resolution }).where(eq(pubWriters.writerNorm, writerNorm)).run(),
    allWriters: () => orm.select().from(pubWriters).all(),
    getWriter: (writerNorm: string) =>
      orm.select().from(pubWriters).where(eq(pubWriters.writerNorm, writerNorm)).get(),
    mapWriter: (writerNorm: string, ownerId: string, resolution: WriterRow['resolution']) =>
      orm.update(pubWriters).set({ ownerId, resolution }).where(eq(pubWriters.writerNorm, writerNorm)).run(),
    reassignWriters: (fromOwnerId: string, intoOwnerId: string) =>
      orm
        .update(pubWriters)
        .set({ ownerId: intoOwnerId, resolution: 'merged' })
        .where(eq(pubWriters.ownerId, fromOwnerId))
        .run(),

    // ---- contract terms ----
    termsOfOwner: (ownerId: string) => orm.select().from(pubTerms).where(eq(pubTerms.ownerId, ownerId)).all(),
    termsOfOwners: (ownerIds: string[]) =>
      ownerIds.length === 0
        ? []
        : orm.select().from(pubTerms).where(inArray(pubTerms.ownerId, ownerIds)).all(),
    allTerms: () => orm.select().from(pubTerms).all(),
    getTerms: (id: string) => orm.select().from(pubTerms).where(eq(pubTerms.id, id)).get(),
    closeTerms: (id: string, validTo: string) =>
      orm.update(pubTerms).set({ validTo }).where(eq(pubTerms.id, id)).run(),
    insertTerms: (row: typeof pubTerms.$inferInsert) => orm.insert(pubTerms).values(row).run(),
  };
}

export type PublishingRepository = ReturnType<typeof createPublishingRepository>;
