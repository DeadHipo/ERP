import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Publishing (B17 now): statements, their lines, writer -> owner mapping and the author's contract percentage.
// Money is accrued to the owner (a person), never to an artist or a label.

export const pubStatements = sqliteTable('pub_statements', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  periods: text('periods').notNull(),
  fileName: text('file_name').notNull(),
  storedPath: text('stored_path').notNull(),
  sha256: text('sha256').notNull(),
  generatedAt: text('generated_at').notNull(),
  generatedAtSource: text('generated_at_source').notNull(),
  uploadedAt: text('uploaded_at').notNull(),
  status: text('status').notNull(),
  lineCount: integer('line_count').notNull(),
  totalPayable: text('total_payable').notNull(),
  warnings: text('warnings').notNull(),
});

export const pubStatementPeriods = sqliteTable('pub_statement_periods', {
  source: text('source').notNull(),
  period: text('period').notNull(),
  statementId: text('statement_id').notNull(),
});

export const pubLines = sqliteTable('pub_lines', {
  statementId: text('statement_id').notNull(),
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
  payablePico: integer('payable_pico').notNull(),
});

export const pubWriters = sqliteTable('pub_writers', {
  writerNorm: text('writer_norm').primaryKey(),
  displayName: text('display_name').notNull(),
  ownerId: text('owner_id'),
  resolution: text('resolution').notNull(),
  /** holder: the rights-holder of a line; songwriter: a writer listed in the songwriters cell. */
  role: text('role').notNull(),
});

export const pubTerms = sqliteTable('pub_terms', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  percent: text('percent').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  documentId: text('document_id'),
  createdAt: text('created_at').notNull(),
});

export const publishingSchema = { pubStatements, pubStatementPeriods, pubLines, pubWriters, pubTerms };

export const PUBLISHING_DDL = `
CREATE TABLE IF NOT EXISTS pub_statements (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, periods TEXT NOT NULL, file_name TEXT NOT NULL, stored_path TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE, generated_at TEXT NOT NULL, generated_at_source TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL, line_count INTEGER NOT NULL, total_payable TEXT NOT NULL, warnings TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pub_statement_periods (
  source TEXT NOT NULL, period TEXT NOT NULL, statement_id TEXT NOT NULL REFERENCES pub_statements(id),
  PRIMARY KEY (source, period)
);
CREATE TABLE IF NOT EXISTS pub_lines (
  statement_id TEXT NOT NULL REFERENCES pub_statements(id), line_no INTEGER NOT NULL, period TEXT NOT NULL,
  writer_name TEXT NOT NULL, writer_norm TEXT NOT NULL, songwriters TEXT, work_title TEXT NOT NULL, work_code TEXT,
  operation_type TEXT, retailer TEXT, country TEXT, payable_pico INTEGER NOT NULL,
  PRIMARY KEY (statement_id, line_no)
);
CREATE INDEX IF NOT EXISTS pub_lines_writer ON pub_lines(writer_norm);
CREATE TABLE IF NOT EXISTS pub_writers (
  writer_norm TEXT PRIMARY KEY, display_name TEXT NOT NULL, owner_id TEXT, resolution TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'holder'
);
CREATE TABLE IF NOT EXISTS pub_terms (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, percent TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
  document_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pub_terms_owner ON pub_terms(owner_id);
`;
