import { date, numeric, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Splits per track (ISRC) with validity periods. Only artist and MC shares are stored; our share is the remainder.
// valid_from is inclusive, valid_to is exclusive (NULL = open-ended). Periods of one ISRC never overlap.
// The DDL is migrations/postgres/0002_splits.sql (schema `splits`); change both.

const s = pgSchema('splits');

export const splits = s.table('splits', {
  id: text('id').primaryKey(),
  isrc: text('isrc').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  origin: text('origin').notNull(),
  note: text('note'),
  createdAt: isoTimestamp('created_at').notNull(),
});

export const splitShares = s.table(
  'split_shares',
  {
    splitId: text('split_id').notNull(),
    artistId: text('artist_id').notNull(),
    percent: numeric('percent', { precision: 9, scale: 6 }).notNull(),
    documentId: text('document_id'),
  },
  (t) => [primaryKey({ columns: [t.splitId, t.artistId] })],
);

// A percent of a base paid to a recipient pseudonym from one bucket (D-126). DDL: migrations/postgres/0008_participations.sql.
export const participations = s.table('participations', {
  id: text('id').primaryKey(),
  isrc: text('isrc').notNull(),
  artistId: text('artist_id').notNull(),
  percent: numeric('percent', { precision: 9, scale: 6 }).notNull(),
  base: text('base').notNull(),
  fundedFrom: text('funded_from').notNull(),
  fromArtistId: text('from_artist_id'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  origin: text('origin').notNull(),
  note: text('note'),
  createdAt: isoTimestamp('created_at').notNull(),
});
