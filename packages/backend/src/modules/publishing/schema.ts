import { bigint, date, integer, numeric, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Publishing (B17 now): statements, their lines, writer -> owner mapping and the author's contract percentage.
// Money is accrued to the owner (a person), never to an artist or a label.
// The DDL is migrations/postgres/0005_publishing.sql and 0009_pub_terms_operation_type.sql (schema `publishing`); change both.

const s = pgSchema('publishing');

export const pubStatements = s.table('pub_statements', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  periods: text('periods').notNull(),
  fileName: text('file_name').notNull(),
  storedPath: text('stored_path').notNull(),
  sha256: text('sha256').notNull().unique(),
  generatedAt: isoTimestamp('generated_at').notNull(),
  generatedAtSource: text('generated_at_source').notNull(),
  uploadedAt: isoTimestamp('uploaded_at').notNull(),
  status: text('status').notNull(),
  lineCount: integer('line_count').notNull(),
  totalPayable: numeric('total_payable').notNull(),
  warnings: text('warnings').notNull(),
});

export const pubStatementPeriods = s.table(
  'pub_statement_periods',
  {
    source: text('source').notNull(),
    period: text('period').notNull(),
    statementId: text('statement_id')
      .notNull()
      .references(() => pubStatements.id),
  },
  (t) => [primaryKey({ columns: [t.source, t.period] })],
);

export const pubLines = s.table(
  'pub_lines',
  {
    statementId: text('statement_id')
      .notNull()
      .references(() => pubStatements.id),
    lineNo: integer('line_no').notNull(),
    period: text('period').notNull(),
    writerName: text('writer_name').notNull(),
    writerNorm: text('writer_norm').notNull(),
    songwriters: text('songwriters'),
    workTitle: text('work_title').notNull(),
    workCode: text('work_code'),
    operationType: text('operation_type'),
    retailer: text('retailer'),
    country: text('country'),
    payablePico: bigint('payable_pico', { mode: 'bigint' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.statementId, t.lineNo] })],
);

export const pubWriters = s.table('pub_writers', {
  writerNorm: text('writer_norm').primaryKey(),
  displayName: text('display_name').notNull(),
  ownerId: text('owner_id'),
  resolution: text('resolution').notNull(),
  /** holder: the rights-holder of a line; songwriter: a writer listed in the songwriters cell. */
  role: text('role').notNull().default('holder'),
});

export const pubTerms = s.table('pub_terms', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  percent: numeric('percent').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  /** NULL = terms for any operation type; a typed term wins for a line of that type (D-128). */
  operationType: text('operation_type'),
  createdAt: isoTimestamp('created_at').notNull(),
});
