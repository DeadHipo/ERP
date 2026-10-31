import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// Module 1: owners, artists (pseudonyms), tracks, documents and contracts.
// The document registry lives here and is referenced by id from every other module.

export const owners = sqliteTable('owners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(),
  kind: text('kind', { enum: ['label', 'person'] }).notNull(),
  ipi: text('ipi'),
  mergedInto: text('merged_into'),
  createdAt: text('created_at').notNull(),
  origin: text('origin').notNull(),
});

export const ownerAliases = sqliteTable(
  'owner_aliases',
  {
    ownerId: text('owner_id').notNull(),
    alias: text('alias').notNull(),
    aliasNorm: text('alias_norm').notNull(),
  },
  (t) => [primaryKey({ columns: [t.aliasNorm, t.ownerId] })],
);

export const artists = sqliteTable('artists', {
  id: text('id').primaryKey(),
  pseudonym: text('pseudonym').notNull(),
  pseudonymNorm: text('pseudonym_norm').notNull(),
  ownerId: text('owner_id'),
  mergedInto: text('merged_into'),
  createdAt: text('created_at').notNull(),
  origin: text('origin').notNull(),
});

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  isrc: text('isrc'),
  upc: text('upc'),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
});

export const artistTracks = sqliteTable(
  'artist_tracks',
  {
    artistId: text('artist_id').notNull(),
    trackId: text('track_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.trackId] })],
);

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  fileRef: text('file_ref'),
  ownerId: text('owner_id'),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull(),
  approvedAt: text('approved_at'),
  approvedBy: text('approved_by'),
  uploadDeadline: text('upload_deadline'),
  migration: integer('migration', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const contracts = sqliteTable('contracts', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  documentId: text('document_id').notNull(),
  number: text('number'),
  createdAt: text('created_at').notNull(),
});

export const contractArtists = sqliteTable(
  'contract_artists',
  {
    contractId: text('contract_id').notNull(),
    artistId: text('artist_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.artistId] })],
);

export const merges = sqliteTable('merges', {
  id: text('id').primaryKey(),
  entity: text('entity', { enum: ['owner', 'artist'] }).notNull(),
  fromId: text('from_id').notNull(),
  intoId: text('into_id').notNull(),
  reason: text('reason').notNull(),
  at: text('at').notNull(),
});

export const ownersSchema = {
  owners,
  ownerAliases,
  artists,
  tracks,
  artistTracks,
  documents,
  contracts,
  contractArtists,
  merges,
};

export const OWNERS_DDL = `
CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT NOT NULL, kind TEXT NOT NULL,
  ipi TEXT, merged_into TEXT, created_at TEXT NOT NULL, origin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS owners_name_norm ON owners(name_norm);
CREATE TABLE IF NOT EXISTS owner_aliases (
  owner_id TEXT NOT NULL REFERENCES owners(id), alias TEXT NOT NULL, alias_norm TEXT NOT NULL,
  PRIMARY KEY (alias_norm, owner_id)
);
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY, pseudonym TEXT NOT NULL, pseudonym_norm TEXT NOT NULL,
  owner_id TEXT REFERENCES owners(id), merged_into TEXT, created_at TEXT NOT NULL, origin TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artists_owner ON artists(owner_id);
CREATE INDEX IF NOT EXISTS artists_pseudonym_norm ON artists(pseudonym_norm);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, isrc TEXT, upc TEXT, title TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tracks_isrc_upc ON tracks(isrc, upc);
CREATE INDEX IF NOT EXISTS tracks_isrc ON tracks(isrc);
CREATE TABLE IF NOT EXISTS artist_tracks (
  artist_id TEXT NOT NULL REFERENCES artists(id), track_id TEXT NOT NULL REFERENCES tracks(id),
  PRIMARY KEY (artist_id, track_id)
);
CREATE INDEX IF NOT EXISTS artist_tracks_track ON artist_tracks(track_id);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, file_ref TEXT, owner_id TEXT,
  requires_approval INTEGER NOT NULL, approved_at TEXT, approved_by TEXT, upload_deadline TEXT,
  migration INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner_id);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id),
  document_id TEXT NOT NULL REFERENCES documents(id), number TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_owner ON contracts(owner_id);
CREATE TABLE IF NOT EXISTS contract_artists (
  contract_id TEXT NOT NULL REFERENCES contracts(id), artist_id TEXT NOT NULL REFERENCES artists(id),
  PRIMARY KEY (contract_id, artist_id)
);
CREATE TABLE IF NOT EXISTS merges (
  id TEXT PRIMARY KEY, entity TEXT NOT NULL, from_id TEXT NOT NULL, into_id TEXT NOT NULL,
  reason TEXT NOT NULL, at TEXT NOT NULL
);
`;
