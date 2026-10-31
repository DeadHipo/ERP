import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

// Splits per track (ISRC) with validity periods. Only artist and MC shares are stored; our share is the remainder.
// valid_from is inclusive, valid_to is exclusive (NULL = open-ended). Periods of one ISRC never overlap.

export const splits = sqliteTable('splits', {
  id: text('id').primaryKey(),
  isrc: text('isrc').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  documentId: text('document_id'),
  origin: text('origin').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
});

export const splitShares = sqliteTable(
  'split_shares',
  {
    splitId: text('split_id').notNull(),
    artistId: text('artist_id').notNull(),
    percent: text('percent').notNull(),
  },
  (t) => [primaryKey({ columns: [t.splitId, t.artistId] })],
);

export const splitsSchema = { splits, splitShares };

export const SPLITS_DDL = `
CREATE TABLE IF NOT EXISTS splits (
  id TEXT PRIMARY KEY, isrc TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
  document_id TEXT, origin TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS splits_isrc ON splits(isrc, valid_from);
CREATE TABLE IF NOT EXISTS split_shares (
  split_id TEXT NOT NULL REFERENCES splits(id), artist_id TEXT NOT NULL, percent TEXT NOT NULL,
  PRIMARY KEY (split_id, artist_id)
);
CREATE INDEX IF NOT EXISTS split_shares_artist ON split_shares(artist_id);
`;
