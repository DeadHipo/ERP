import { pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// The links between modules (D-183): an operator's decisions that belong to no module, since modules do not know each
// other. The ids are opaque text with no foreign key (D-121). The DDL is migrations/postgres/0024_links.sql: change both.

const s = pgSchema('links');

export const songwriterOwner = s.table('songwriter_owner', {
  orgId: text('org_id').notNull(),
  songwriterId: text('songwriter_id').notNull(),
  ownerId: text('owner_id').notNull(),
  source: text('source', { enum: ['recommended', 'manual'] }).notNull(),
  decidedBy: text('decided_by').notNull(),
  decidedAt: isoTimestamp('decided_at').notNull(),
});
