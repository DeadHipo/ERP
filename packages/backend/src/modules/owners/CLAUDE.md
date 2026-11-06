# owners module (module 1)

Knows owners (`person` or `label`), their pseudonyms (artists), tracks (ISRC + UPC, with an optional note), documents
and contracts, and which owner is confirmed. Every recipient of money is a pseudonym: a company, sublabel,
representative, buyer or participant gets its own pseudonym under an owner of kind `label` (or `person`). The document
kind `assumption` is a council decision recorded as a document that is never approved; the module computes no money.

Storage: PostgreSQL schema `owners` (`migrations/postgres/0003_owners.sql`, `0007_owners_track_note_assumption.sql`,
Drizzle in `schema.ts`); merges of owners and artists are recorded here and resolved by the facade.

`documents.label_id` (D-169, R10, migration `0015_label_books_2.sql`): optional; empty = the document holds for any
label (the 1,400 history documents stay so, marked by hand). `createDocument({ labelId })`, `setDocumentLabel(id,
labelId | null)`, `listDocuments({ labelId })` (= the documents of the label and those without one). Confirmation by
label: `isOwnerConfirmedUnder(id, L)` and `confirmedContracts()` (`{ ownerId, labelId | null }`) both go through
`computeConfirmedOwners` over the approved contract documents with `label_id ∈ {L, NULL}`. The module does not know
what a label is: the facade checks the id is an own label; the C categorisation ignores the label.
