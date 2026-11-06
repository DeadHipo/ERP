import { bigint, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Publishing v2 (D-182): what the summaries of the reports say and nothing else: the files, the songwriters, the
// songs and the accruals. No owner, no ISRC. The DDL is migrations/postgres/0023_pubv2.sql (schema `pubv2`): change both.

const s = pgSchema('pubv2');

export const files = s.table('files', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  labelId: text('label_id').notNull(),
  fileName: text('file_name').notNull(),
  sha256: text('sha256').notNull(),
  source: text('source', { enum: ['b17'] }).notNull(),
  format: text('format').notNull(),
  periods: text('periods').array().notNull(),
  status: text('status', { enum: ['loaded', 'superseded'] }).notNull(),
  replacedBy: text('replaced_by'),
  rowCount: integer('row_count').notNull(),
  payablePico: bigint('payable_pico', { mode: 'bigint' }).notNull(),
  declaredPayablePico: bigint('declared_payable_pico', { mode: 'bigint' }),
  storedPath: text('stored_path').notNull(),
  uploadedAt: isoTimestamp('uploaded_at').notNull(),
});

export const songwriters = s.table('songwriters', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
});

export const songwriterAliases = s.table('songwriter_aliases', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  songwriterId: text('songwriter_id').notNull(),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(),
});

export const songs = s.table('songs', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  songwriterId: text('songwriter_id').notNull(),
  title: text('title').notNull(),
  titleNorm: text('title_norm').notNull(),
});

export const songAliases = s.table('song_aliases', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  songId: text('song_id').notNull(),
  title: text('title').notNull(),
  titleNorm: text('title_norm').notNull(),
});

export const accruals = s.table('accruals', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  songwriterId: text('songwriter_id').notNull(),
  songId: text('song_id').notNull(),
  period: text('period').notNull(),
  grossPico: bigint('gross_pico', { mode: 'bigint' }),
  withholdingPico: bigint('withholding_pico', { mode: 'bigint' }),
  payablePico: bigint('payable_pico', { mode: 'bigint' }).notNull(),
});
