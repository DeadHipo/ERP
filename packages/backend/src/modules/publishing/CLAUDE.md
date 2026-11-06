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
- **A statement is loaded under a label (D-169, R8):** `ingestB17({ labelId })` stores `pub_statements.label_id` (opaque text:
  the facade has checked it is an own label; the module never knows labels); the materialized view `pub_lines_by_key`
  (0015) carries `label_id` of the statement in SELECT and GROUP BY, so `AggregatedLine.labelId` is the book of every line.
  A period belongs to one statement (`pub_statement_periods`), so the label never splits a group and the refusal of a second
  statement for a loaded quarter (D-041 ⚠) is unchanged. `assignStatementLabel(id, labelId, { refresh })` marks only a
  statement without a label (`already_done` otherwise) and refreshes the view; `refreshLinesByKey()` on its own. The books,
  the reads under a label (`underLabel`) and the payout are the facade's (`facade/CLAUDE.md`).
- Organization (D-170): the module is opened under one (`openPublishingModule(db, org, dir)`, every statement through `shared/org-scope.ts`), files in `<dataDir>/orgs/<id>/files/publishing`; a losing concurrent load of the same statement deletes its stored copy only when `repo.statementBySha(sha256)?.storedPath !== storedPath` (it never removes the winner's original; `tests/concurrency.test.ts`).
- **Replacing a statement (D-173):** `replaceStatement(oldId, input, labelId)` runs through the same `load()` (a second
  argument `{ oldId }`; the refusals are checked before the body and again in the transaction, `replaceable()`; the writers are registered and the answer `writers` given exactly as on a load) inside `serial()` and one
  module transaction: the old statement must be `loaded` (`409 replace_not_loaded`) and of the same label
  (`409 replace_label_differs`), the quarters of the new file (from its lines) must equal the old ones as sets
  (`409 periods_differ`); the old one becomes `superseded` with `pub_statements.replaced_by` (text, no foreign key;
  migration 0019) and keeps its lines, stored file and sha (payout snapshots cite the sha); its `pub_statement_periods`
  rows are deleted and the new statement's inserted; `refreshLinesByKey()` (the view reads only `loaded`). The
  file-name pre-check skips the replaced statement's quarters. This closes D-041 by a mechanism; the Q2 2026 «Updated»
  run waits for the owner. The route is `POST /publishing/statements/:id/replace?label=` (facade `sources.ts` `replaceB17`, answer
  `{ superseded, statement, writers }`); `StatementView` has `replacedBy` and `status` `loaded | superseded | failed`.
