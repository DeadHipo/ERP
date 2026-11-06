import { boolean, date, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Module 1: owners, artists (pseudonyms), tracks, documents and contracts.
// The document registry lives here and is referenced by id from every other module.
// The DDL is migrations/postgres/0003_owners.sql, 0007 and 0015 (schema `owners`); change both.

const s = pgSchema('owners');

export const owners = s.table('owners', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(),
  kind: text('kind', { enum: ['label', 'person'] }).notNull(),
  ipi: text('ipi'),
  mergedInto: text('merged_into'),
  createdAt: isoTimestamp('created_at').notNull(),
  origin: text('origin').notNull(),
});

export const ownerAliases = s.table(
  'owner_aliases',
  {
    orgId: text('org_id').notNull(),
    ownerId: text('owner_id').notNull(),
    alias: text('alias').notNull(),
    aliasNorm: text('alias_norm').notNull(),
  },
  (t) => [primaryKey({ columns: [t.aliasNorm, t.ownerId] })],
);

export const artists = s.table('artists', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  pseudonym: text('pseudonym').notNull(),
  pseudonymNorm: text('pseudonym_norm').notNull(),
  ownerId: text('owner_id'),
  mergedInto: text('merged_into'),
  createdAt: isoTimestamp('created_at').notNull(),
  origin: text('origin').notNull(),
});

export const tracks = s.table('tracks', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  isrc: text('isrc'),
  upc: text('upc'),
  title: text('title').notNull(),
  note: text('note'),
  createdAt: isoTimestamp('created_at').notNull(),
});

export const artistTracks = s.table(
  'artist_tracks',
  {
    orgId: text('org_id').notNull(),
    artistId: text('artist_id').notNull(),
    trackId: text('track_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.trackId] })],
);

export const documents = s.table('documents', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  fileRef: text('file_ref'),
  ownerId: text('owner_id'),
  requiresApproval: boolean('requires_approval').notNull(),
  approvedAt: isoTimestamp('approved_at'),
  approvedBy: text('approved_by'),
  uploadDeadline: date('upload_deadline', { mode: 'string' }),
  migration: boolean('migration').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
  /** The own label of the document (D-169, 0015); null = any label. Read from stage 1 commit 4 on. */
  labelId: text('label_id'),
});

export const contracts = s.table('contracts', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  documentId: text('document_id').notNull(),
  number: text('number'),
  createdAt: isoTimestamp('created_at').notNull(),
});

export const contractArtists = s.table(
  'contract_artists',
  {
    orgId: text('org_id').notNull(),
    contractId: text('contract_id').notNull(),
    artistId: text('artist_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.artistId] })],
);

export const merges = s.table('merges', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  entity: text('entity', { enum: ['owner', 'artist'] }).notNull(),
  fromId: text('from_id').notNull(),
  intoId: text('into_id').notNull(),
  reason: text('reason').notNull(),
  at: isoTimestamp('at').notNull(),
});
