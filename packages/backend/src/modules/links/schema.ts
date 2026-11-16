import { date, numeric, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// The links between modules (D-183): an operator's decisions that belong to no module, since modules do not know each
// other. The ids are opaque text with no foreign key (D-121). The DDL is migrations/postgres/0024_links.sql, 0025_song_isrc.sql, 0026_publishing_terms.sql, 0027_terms_cancel.sql, 0029_isrc_terms.sql and 0033_sublabels.sql: change both.

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
  // the songwriter of the song (D-191): one ISRC under one song per songwriter
  songwriterId: text('songwriter_id').notNull(),
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
  /** D-192: the track the term is about; null = the owner's own percent. */
  isrc: text('isrc'),
  /** D-192: what the term rests on (the contract, the share sold), free text. */
  basis: text('basis'),
  decidedBy: text('decided_by').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
  /** A cancelled term never counts (D-188); the row stays for the history. */
  cancelledAt: isoTimestamp('cancelled_at'),
  cancelledBy: text('cancelled_by'),
  cancelReason: text('cancel_reason'),
});

/**
 * The term of a sublabel on a track (D-217, 0033_sublabels.sql): `percent` of the label share after the artists and
 * the participations, for a period, on a document. The same rules as the publishing terms: one live term per ISRC at a
 * month, a new one closes the open one, only the latest is cancelled. The money does not read it yet.
 */
export const sublabelTerms = s.table('sublabel_terms', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  sublabelId: text('sublabel_id').notNull(),
  isrc: text('isrc').notNull(),
  percent: numeric('percent', { precision: 9, scale: 6 }).notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  note: text('note'),
  decidedBy: text('decided_by').notNull(),
  decidedAt: isoTimestamp('decided_at').notNull(),
  /** A document attached later to a term that had none: the one allowed change of a term. */
  documentBy: text('document_by'),
  documentAt: isoTimestamp('document_at'),
  cancelledAt: isoTimestamp('cancelled_at'),
  cancelledBy: text('cancelled_by'),
  cancelReason: text('cancel_reason'),
});
