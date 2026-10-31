import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Settlements and payouts: every balance change is an operation `in` or `out` with a signed amount in integer cents.
// There are no operation types; optional fields (artist, period, scope, document, payment proof, operation ref) say
// what an operation is.

export const operations = sqliteTable('operations', {
  id: text('id').primaryKey(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  ownerId: text('owner_id'),
  artistId: text('artist_id'),
  date: text('date').notNull(),
  period: text('period'),
  scope: text('scope'),
  documentId: text('document_id'),
  paymentProofId: text('payment_proof_id'),
  operationRef: text('operation_ref'),
  deferred: integer('deferred', { mode: 'boolean' }).notNull(),
  migration: integer('migration', { mode: 'boolean' }).notNull(),
  comment: text('comment').notNull(),
  externalRef: text('external_ref'),
  createdAt: text('created_at').notNull(),
  deactivatedAt: text('deactivated_at'),
  deactivatedReason: text('deactivated_reason'),
});

export const payoutSnapshots = sqliteTable('payout_snapshots', {
  operationId: text('operation_id').primaryKey(),
  createdAt: text('created_at').notNull(),
  payload: text('payload').notNull(),
});

export const settlementsSchema = { operations, payoutSnapshots };

export const SETTLEMENTS_DDL = `
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY, direction TEXT NOT NULL, amount_cents INTEGER NOT NULL, owner_id TEXT, artist_id TEXT,
  date TEXT NOT NULL, period TEXT, scope TEXT, document_id TEXT, payment_proof_id TEXT, operation_ref TEXT,
  deferred INTEGER NOT NULL DEFAULT 0, migration INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL, external_ref TEXT,
  created_at TEXT NOT NULL, deactivated_at TEXT, deactivated_reason TEXT
);
CREATE INDEX IF NOT EXISTS operations_owner ON operations(owner_id);
CREATE INDEX IF NOT EXISTS operations_artist ON operations(artist_id);
CREATE TABLE IF NOT EXISTS payout_snapshots (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id), created_at TEXT NOT NULL, payload TEXT NOT NULL
);
`;
