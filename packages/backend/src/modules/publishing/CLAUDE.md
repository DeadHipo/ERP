# publishing module (B17)

Loads statements and keeps lines, the writer → owner map and the terms (percent per owner, period, optional operation
type, document). It returns the aggregated lines with `operation_type`, the writers and the terms. It no longer
computes the author share: that moved to the facade layers.

## Notes

- Holds the B17 publisher statements (quarterly xlsx, one per quarter), their lines, the writer to owner mapping and the author terms (percent of our share, by period and optionally by operation type, D-128).
- A line goes to the writers of the `songwriters` cell that are ours, in equal parts, otherwise to the rights-holder (D-087); the money is accrued to the owner, never to an artist or a label.
- Terms: a term with an operation type wins for a line of that type, the term without a type covers the rest; overlap and closing are per (owner, operation type) and checked in the service (no database constraint).
- Storage: schema `publishing` in PostgreSQL (`migrations/postgres/0005_publishing.sql`, `0009_pub_terms_operation_type.sql`), the original files in the data directory; all SQL is in `repository.ts`.
- The module computes no money (D-128 part 2): `snapshotForCalculation()` returns `{ writers, terms, lines }` from one snapshot, and the facade layers (`facade/layers/{writer-parts,author-share,publishing-categorise}.ts`) work out the writer parts, the author share and B/C.
