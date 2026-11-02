# publishing module (B17)

- Holds the B17 publisher statements (quarterly xlsx, one per quarter), their lines, the writer to owner mapping and the author terms (percent of our share, by period and optionally by operation type, D-128).
- A line goes to the writers of the `songwriters` cell that are ours, in equal parts, otherwise to the rights-holder (D-087); the money is accrued to the owner, never to an artist or a label.
- Terms: a term with an operation type wins for a line of that type, the term without a type covers the rest; overlap and closing are per (owner, operation type) and checked in the service (no database constraint).
- Storage: schema `publishing` in PostgreSQL (`migrations/postgres/0005_publishing.sql`, `0009_pub_terms_operation_type.sql`), the original files in the data directory; all SQL is in `repository.ts`.
- `accruals()` still applies the author share here; it moves to the facade (`layers/author-share.ts`) in the next step (D-128 part 2), after which the module only returns lines and terms.
