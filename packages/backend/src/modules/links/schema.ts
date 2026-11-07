import { date, numeric, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// The links between modules (D-183): an operator's decisions that belong to no module, since modules do not know each
// other. The ids are opaque text with no foreign key (D-121). The DDL is migrations/postgres/0024_links.sql, 0025_song_isrc.sql and 0026_publishing_terms.sql: change both.

const s = pgSchema('links');

export const songwriterOwner = s.table('songwriter_owner', {
  orgId: text('org_id').notNull(),
  songwriterId: text('songwriter_id').notNull(),
  ownerId: text('owner_id').notNull(),
  source: text('source', { enum: ['recommended', 'manual'] }).notNull(),
  decidedBy: text('decided_by').notNull(),
  decidedAt: isoTimestamp('decided_at').notNull(),
});

export const songIsrc = s.table('song_isrc', {
  orgId: text('org_id').notNull(),
  songId: text('song_id').notNull(),
  isrc: text('isrc').notNull(),
  source: text('source', { enum: ['recommended', 'manual'] }).notNull(),
  decidedBy: text('decided_by').notNull(),
  decidedAt: isoTimestamp('decided_at').notNull(),
});

export const publishingTerms = s.table('publishing_terms', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  percent: numeric('percent').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  /** NULL = terms for any operation type; a typed term wins for a line of that type (D-128). */
  operationType: text('operation_type'),
  decidedBy: text('decided_by').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
});
