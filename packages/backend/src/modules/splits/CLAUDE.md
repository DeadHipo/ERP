# splits module: notes for agents

Stores per ISRC and period the artist rows (percent of net, each row optionally with its own document) and the
participations (a percent of a base to a recipient pseudonym, funded from one bucket: the top of the net, the artist
pool, one artist's amount, or the label share), each with a document. It validates percents, periods, "Σ off-the-top
(`top`) ≤ 100" (`top_above_100`) and the rule "a pseudonym is a row or a participation on an ISRC and date, never
both" (`double_participation`, checked from both sides), and computes no money. A buyout is a split change; our share
is never stored.

Storage: schema `splits`, `migrations/postgres/0002_splits.sql` and `0008_participations.sql` (tables `splits`,
`split_shares` with `document_id`, `participations`), Drizzle tables in `schema.ts` (change both); all SQL in
`repository.ts`. Dates are floored to the month start by the facade, not here (D-126).

Two deletes exist for the migration loader only (`scripts/mvp`, D-137): `deleteEmptySplits(ids)` removes splits whose
period is empty (`valid_to = valid_from`, left when a split is replaced from its first day; never in force) and
`deleteParticipations(ids)` removes participations the loader created (found by its note marker). No route or facade
method calls them.
