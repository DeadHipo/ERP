# owners module (module 1)

Knows owners (`person` or `label`), their pseudonyms (artists), tracks (ISRC + UPC, with an optional note), documents
and contracts, and which owner is confirmed. Every recipient of money is a pseudonym: a company, sublabel,
representative, buyer or participant gets its own pseudonym under an owner of kind `label` (or `person`). The document
kind `assumption` is a council decision recorded as a document that is never approved; the module computes no money.

Storage: PostgreSQL schema `owners` (`migrations/postgres/0003_owners.sql`, `0007_owners_track_note_assumption.sql`,
`0018_catalog.sql`, Drizzle in `schema.ts`); merges of owners and artists are recorded here and resolved by the facade.

`documents.label_id` (D-169, R10, migration `0015_label_books_2.sql`): optional; empty = the document holds for any
label (the 1,400 history documents stay so, marked by hand). `createDocument({ labelId })`, `setDocumentLabel(id,
labelId | null)`, `listDocuments({ labelId })` (= the documents of the label and those without one). Confirmation by
label: `isOwnerConfirmedUnder(id, L)` and `confirmedContracts()` (`{ ownerId, labelId | null }`) both go through
`computeConfirmedOwners` over the approved contract documents with `label_id ∈ {L, NULL}`. The module does not know
what a label is: the facade checks the id is an own label; the C categorisation ignores the label.

Release registry (D-172, `owners.releases`, key `(org, label, upc)`): `believe-export.ts` is the pure reader of the Believe
release export (BOM, `;`, `UPC : <digits>`, `date<br />time`; all or nothing: `release_import_header` 400,
`release_import_invalid` 422 with `details.rows`, `import_too_large` 413); the facade (`facade/release-registry.ts`)
writes it with `releases.upsert` and compares it with the units for the signals `releasesIncomplete` / `releasesUnknown`.
Navigation only: the calculation never reads it (`boundaries.test.ts`).

Document kinds (D-172): the lists are `packages/shared/src/document-kinds.ts` (`DOCUMENT_KINDS`, `CONTRACT_DOCUMENT_KINDS`,
`SPLIT_DOCUMENT_KINDS`), re-exported here; the CHECK of `documents.kind` (0018) must match. `label_decision` is a decision
of the label without a contract: approvable, no term; `createContract` accepts a document of kind `contract` or
`label_decision` (anything else `validation_error`). `computeConfirmedOwners` looks at the status and the label of the
contract document, never its kind, so an approved label decision confirms like a contract.

Label history of an ISRC (D-172, `owners.track_labels`): intervals `[valid_from, valid_to)` from the first of a month,
`source` `files` (derived by the facade, `facade/catalog.ts`, from the loaded files; the rows of an ISRC are replaced as a
whole) or `operator` (a correction; never touched by the derivation; `import` is reserved), `EXCLUDE USING gist` per
`(org_id, isrc)` = one label at a time. The repository group `trackLabels` (`list({ isrcs?, labelId? })`, `upsert`,
`replaceOfIsrc`) knows no rule: the derivation, the operator replacement by the same `from` and the codes
`catalog_overlap` / `catalog_same_label` are the facade's. No `created_by` (the author is the audit). Navigation only, like
the release registry: the calculation never reads it.
